import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CodexBattleSession,
  CodexContextLimitError,
} from '../../src/server/ai-battle/codex-session';
import { CodexInvocationNotStartedError } from '../../src/server/ai-battle/codex-process';
import { AiBattleDriver } from '../../src/server/ai-battle/driver';
const dirs: string[] = [];
const sessions: CodexBattleSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});
async function fixture(mode = 'normal', turnErrorInfo: unknown = null, fastMode = false) {
  const dir = await mkdtemp(join(tmpdir(), 'loveca-session-test-'));
  dirs.push(dir);
  await writeFile(
    join(dir, 'auth.json'),
    JSON.stringify({ tokens: { access_token: 'private-access-token', account_id: 'test-account' } })
  );
  await writeFile(join(dir, 'config.toml'), 'do_not_load_user_config = true');
  vi.stubEnv('CODEX_HOME', dir);
  const log = join(dir, 'capture.jsonl'),
    cli = join(dir, 'cli');
  const script = `#!${process.execPath}
 const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});
 let turns=0,threads=0;const mode=${JSON.stringify(mode)},log=${JSON.stringify(log)};
 const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
 rl.on('line',line=>{const m=JSON.parse(line);if(!m.method)return;
 fs.appendFileSync(log,JSON.stringify({args:process.argv.slice(2),method:m.method,params:m.method==='account/login/start'?{type:m.params.type}:m.params,home:process.env.CODEX_HOME,cwd:process.cwd(),hasAuth:fs.existsSync(process.env.CODEX_HOME+'/auth.json'),hasConfig:fs.existsSync(process.env.CODEX_HOME+'/config.toml')})+'\\n');
 if(m.id===undefined)return;
 if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'t-'+(++threads),ephemeral:true}}});
 if(m.method==='thread/compact/start'){
  const id='compact';send({id:m.id,result:{}});send({method:'turn/started',params:{threadId:m.params.threadId,turn:{id}}});
  if(mode==='compact-hang')return;
  if(mode==='compact-tool'){send({method:'item/started',params:{threadId:m.params.threadId,turnId:id,item:{type:'commandExecution'}}});return;}
  send({method:'thread/tokenUsage/updated',params:{threadId:m.params.threadId,turnId:id,tokenUsage:{total:{inputTokens:999999},last:{totalTokens:500,inputTokens:0,cachedInputTokens:0,outputTokens:0},modelContextWindow:1000000}}});
  if(mode!=='compact-incomplete')send({method:'item/completed',params:{threadId:m.params.threadId,turnId:id,item:{type:'contextCompaction'}}});
  send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id,status:'completed'}}});return;
 }
 if(m.method!=='turn/start')return send({id:m.id,result:{}});
 if(mode==='rpc-error'){send({id:m.id,error:{code:-32603,message:'private-access-token /private/secret',data:{secret:'private-access-token'}}});return;}
 const id='turn-'+(++turns);send({id:m.id,result:{turn:{id}}});
 if(mode==='turn-failed'){send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id,status:'failed',error:{message:'private-access-token',additionalDetails:'/private/secret',codexErrorInfo:${JSON.stringify(turnErrorInfo)}}}}});return;}
 if(mode==='hang')return;
 if(mode==='tool'){send({method:'item/started',params:{threadId:m.params.threadId,turnId:id,item:{type:'commandExecution'}}});return;}
 if(mode==='rpc'){send({id:900,method:'item/commandExecution/requestApproval',params:{}});return;}
 if(mode==='crash'){process.exit(2);return;}
 send({method:'thread/tokenUsage/updated',params:{threadId:m.params.threadId,turnId:'old',tokenUsage:{last:{inputTokens:999999,cachedInputTokens:0,outputTokens:5}}}});
 if(mode!=='unknown')send({method:'thread/tokenUsage/updated',params:{threadId:m.params.threadId,turnId:id,tokenUsage:{total:{inputTokens:999999},last:{inputTokens:mode==='context-high'?810000:mode==='above-old-cap'?170000:100+turns,cachedInputTokens:turns===1?0:80,cacheWriteInputTokens:0,outputTokens:5},modelContextWindow:1000000}}});
 send({method:'item/completed',params:{threadId:m.params.threadId,turnId:id,item:{type:'agentMessage',text:'{"selection":{"kind":"ACTION","actionRef":"a1"},"tradeoff":"ok"}'}}});
 send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id,status:'completed'}}});
 });`;
  await writeFile(cli, script, { mode: 0o700 });
  const session = new CodexBattleSession(
    { cliPath: cli, fastMode, reasoningEffort: 'low', frontendOrigin: 'http://localhost:5173' },
    'codex:gpt-6-luna'
  );
  sessions.push(session);
  return {
    session,
    dir,
    records: async () =>
      (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((x) => JSON.parse(x)),
  };
}
const schema = { type: 'object' },
  signal = () => AbortSignal.timeout(3000);
describe('isolated ephemeral Codex sessions', () => {
  it.each([true, false])(
    'keeps speed %s on the isolated thread and subsequent turns',
    async (fastMode) => {
      const f = await fixture('normal', null, fastMode);
      await f.session.decide('FIRST', schema, signal());
      await f.session.decide('NEXT', schema, signal());
      const records = await f.records();
      const requests = records.filter(
        (r) => r.method === 'thread/start' || r.method === 'turn/start'
      );
      expect(requests).toHaveLength(3);
      for (const r of requests) {
        expect(r.params.serviceTier).toBe(fastMode ? 'priority' : null);
        expect(r.args).toContain(`features.fast_mode=${fastMode}`);
        expect(r.hasConfig).toBe(false);
      }
    }
  );
  it.each([
    ['usageLimitExceeded', { category: 'usageLimitExceeded' }],
    ['unauthorized', { category: 'unauthorized' }],
    [
      { httpConnectionFailed: { httpStatusCode: 503, secret: 'private-access-token' } },
      { category: 'httpConnectionFailed', httpStatusCode: 503 },
    ],
    [
      { responseStreamDisconnected: { httpStatusCode: null } },
      { category: 'responseStreamDisconnected' },
    ],
    [{ httpConnectionFailed: { httpStatusCode: 999999 } }, { category: 'httpConnectionFailed' }],
    ['private-access-token', { category: 'UNKNOWN' }],
    [{ secret: 'private-access-token' }, { category: 'UNKNOWN' }],
  ])('retains only allowlisted upstream failure metadata: %j', async (info, expected) => {
    const f = await fixture('turn-failed', info);
    await expect(f.session.decide('current', schema, signal())).rejects.toThrow();
    expect(f.session.failureDiagnostics).toMatchObject({
      reason: 'TURN_FAILED',
      upstream: expected,
    });
    expect(f.session.failureDiagnostics.upstream).toEqual(expected);
    expect(JSON.stringify(f.session.failureDiagnostics)).not.toMatch(/private|secret/);
    expect((await f.records()).filter((r) => r.method === 'turn/start')).toHaveLength(1);
  });
  it.each([
    ['rpc-error', 'RPC_ERROR'],
    ['turn-failed', 'TURN_FAILED'],
    ['tool', 'UNEXPECTED_ITEM'],
    ['rpc', 'UNEXPECTED_RPC'],
    ['crash', 'PROCESS_EXIT'],
  ])('retains safe first-failure diagnostics after cleanup: %s', async (mode, reason) => {
    const f = await fixture(mode);
    await expect(f.session.decide('private prompt', schema, signal())).rejects.toThrow();
    expect(f.session.failureDiagnostics).toMatchObject({ reason });
    expect(f.session.failureDiagnostics.phase).toMatch(/^TURN_(START|RUNNING)$/);
    if (mode === 'rpc-error')
      expect(f.session.failureDiagnostics).toMatchObject({ rpcCode: -32603 });
    expect(JSON.stringify(f.session.failureDiagnostics)).not.toMatch(/private|secret|prompt/);
    await f.session.close();
    expect(f.session.failureDiagnostics.reason).toBe(reason);
    expect((await f.records()).filter((r) => r.method === 'turn/start')).toHaveLength(1);
    await expect(access((await f.records())[0].home)).rejects.toThrow();
  });
  it('reuses one ephemeral thread, sends only new input and reports last-turn usage, then removes private workspace', async () => {
    const f = await fixture();
    const first = await f.session.decide('FIRST STATIC', schema, signal());
    const next = await f.session.decide('NEXT WINDOW', schema, signal());
    expect(first.usage?.inputTokens).toBe(101);
    expect(next.usage).toMatchObject({
      inputTokens: 22,
      implicitCachedTokens: 80,
      outputTokens: 5,
    });
    const r = await f.records();
    expect(r.filter((x) => x.method === 'thread/start')).toHaveLength(1);
    expect(r.filter((x) => x.method === 'thread/start')[0].params).toMatchObject({
      ephemeral: true,
      environments: [],
      dynamicTools: [],
      permissions: 'ai_decision',
      allowProviderModelFallback: false,
    });
    expect(r.filter((x) => x.method === 'turn/start').map((x) => x.params.input[0].text)).toEqual([
      'FIRST STATIC',
      'NEXT WINDOW',
    ]);
    expect(r.filter((x) => x.method === 'turn/start').map((x) => x.params.threadId)).toEqual([
      't-1',
      't-1',
    ]);
    expect(r.filter((x) => x.method === 'thread/unsubscribe')).toHaveLength(0);
    expect(r.every((x) => !x.hasAuth && !x.hasConfig)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('private-access-token');
    const home = r[0].home;
    await f.session.close();
    await expect(access(home)).rejects.toThrow();
    await expect(f.session.decide('closed', schema, signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
  });
  it('uses the reported model window, not the old 150k cap or prompt bytes as tokens', async () => {
    const f = await fixture('above-old-cap');
    await f.session.decide('first', schema, signal());
    await f.session.decide('界'.repeat(40000), schema, signal());
    expect(f.session.contextStatus).toMatchObject({
      lastContextTokens: 170005,
      modelContextWindow: 1000000,
      stopAtTokens: 800000,
      completedTurns: 2,
    });
    expect((await f.records()).filter((x) => x.method === 'thread/start')).toHaveLength(1);
  });
  it('keeps completed usage and stops before the next call at the context watermark', async () => {
    const f = await fixture('context-high');
    expect((await f.session.decide('current', schema, signal())).usage?.inputTokens).toBe(810000);
    await expect(f.session.decide('next', schema, signal())).rejects.toBeInstanceOf(
      CodexContextLimitError
    );
    expect((await f.records()).filter((x) => x.method === 'turn/start')).toHaveLength(1);
  });
  it('does not continue a thread without reported usage', async () => {
    const f = await fixture('unknown');
    expect((await f.session.decide('current', schema, signal())).usage).toBeNull();
    await expect(f.session.decide('next', schema, signal())).rejects.toBeInstanceOf(
      CodexContextLimitError
    );
    expect((await f.records()).filter((x) => x.method === 'turn/start')).toHaveLength(1);
  });
  it('compacts on the same thread without pretending its reset usage is a free invocation', async () => {
    const f = await fixture('context-high');
    await expect(f.session.compact(signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
    await f.session.decide('current', schema, signal());
    expect(await f.session.compact(signal())).toMatchObject({
      usage: null,
      context: { lastContextTokens: 500, compactions: 1 },
    });
    await f.session.decide('new window', schema, signal());
    const r = await f.records();
    expect(r.filter((x) => x.method === 'thread/start')).toHaveLength(1);
    expect(r.filter((x) => x.method === 'turn/start')).toHaveLength(2);
    expect(r.filter((x) => x.method === 'thread/compact/start')).toHaveLength(1);
  });
  it.each(['compact-tool', 'compact-incomplete'])(
    'fails closed for %s without an automatic retry',
    async (mode) => {
      const f = await fixture(mode);
      await f.session.decide('current', schema, signal());
      await expect(f.session.compact(signal())).rejects.toThrow();
      await expect(f.session.decide('next', schema, signal())).rejects.toBeInstanceOf(
        CodexInvocationNotStartedError
      );
    }
  );
  it('rejects overlap and cleans up cancellation during compaction', async () => {
    const f = await fixture('compact-hang');
    await f.session.decide('current', schema, signal());
    const controller = new AbortController();
    const pending = f.session.compact(controller.signal);
    void pending.catch(() => {});
    await vi.waitFor(async () =>
      expect((await f.records()).some((x) => x.method === 'thread/compact/start')).toBe(true)
    );
    await expect(f.session.decide('overlap', schema, signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
    await expect(access((await f.records())[0].home)).rejects.toThrow();
  });
  it.each([false, true])(
    'carries the original account into a fresh isolated successor (changed: %s)',
    async (changed) => {
      const f = await fixture();
      await f.session.decide('old', schema, signal());
      const oldHome = (await f.records())[0].home;
      const next = await f.session.createSuccessor();
      try {
        await expect(access(oldHome)).rejects.toThrow();
        if (changed)
          await writeFile(
            join(f.dir, 'auth.json'),
            JSON.stringify({ tokens: { access_token: 'other', account_id: 'other' } })
          );
        if (changed)
          await expect(next.decide('fresh', schema, signal())).rejects.toBeInstanceOf(
            CodexInvocationNotStartedError
          );
        else await next.decide('fresh', schema, signal());
        const starts = (await f.records()).filter((x) => x.method === 'turn/start');
        expect(starts).toHaveLength(changed ? 1 : 2);
        if (!changed) expect(starts[0].home).not.toBe(starts[1].home);
        await expect(f.session.decide('old again', schema, signal())).rejects.toBeInstanceOf(
          CodexInvocationNotStartedError
        );
      } finally {
        await next.close();
      }
    }
  );
  it('checks account identity before compaction', async () => {
    const f = await fixture();
    await f.session.decide('current', schema, signal());
    await writeFile(
      join(f.dir, 'auth.json'),
      JSON.stringify({ tokens: { access_token: 'other', account_id: 'other' } })
    );
    await expect(f.session.compact(signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
    expect((await f.records()).filter((x) => x.method === 'thread/compact/start')).toHaveLength(0);
  });
  it.each(['tool', 'rpc', 'crash'])('closes and never retries after %s', async (mode) => {
    const f = await fixture(mode);
    await expect(f.session.decide('window', schema, signal())).rejects.toThrow();
    await expect(f.session.decide('retry', schema, signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
    expect((await f.records()).filter((x) => x.method === 'turn/start')).toHaveLength(1);
  });
  it('cancels an in-flight turn, rejects overlap and removes its workspace', async () => {
    const f = await fixture('hang');
    const controller = new AbortController();
    const pending = f.session.decide('window', schema, controller.signal);
    void pending.catch(() => {});
    await vi.waitFor(
      async () => expect((await f.records()).some((x) => x.method === 'turn/start')).toBe(true),
      { timeout: 3000 }
    );
    await expect(f.session.decide('overlap', schema, signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
    await f.session.close();
    await expect(access((await f.records())[0].home)).rejects.toThrow();
  });
  it('keeps missing usage unknown and fails before sending oversized context', async () => {
    const f = await fixture('unknown');
    expect((await f.session.decide('window', schema, signal())).usage).toBeNull();
    await expect(f.session.decide('x'.repeat(600000), schema, signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
    expect((await f.records()).filter((x) => x.method === 'turn/start')).toHaveLength(1);
  });
  it('rejects a changed login account before sending another turn', async () => {
    const f = await fixture();
    await f.session.decide('first', schema, signal());
    await writeFile(
      join(f.dir, 'auth.json'),
      JSON.stringify({ tokens: { access_token: 'other-token', account_id: 'other-account' } })
    );
    await expect(f.session.decide('next', schema, signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
    expect((await f.records()).filter((x) => x.method === 'turn/start')).toHaveLength(1);
  });
  it('creates distinct private workspaces for independent clients', async () => {
    const a = await fixture();
    const b = await fixture();
    await a.session.decide('A private', schema, signal());
    await b.session.decide('B private', schema, signal());
    const ar = await a.records(),
      br = await b.records();
    expect(ar[0].home).not.toBe(br[0].home);
    expect(JSON.stringify(ar)).not.toContain('B private');
    expect(JSON.stringify(br)).not.toContain('A private');
  });
  it('cleans up initialization failures without treating them as model invocations', async () => {
    const f = await fixture();
    await writeFile(join(f.dir, 'auth.json'), '{}');
    await expect(f.session.decide('window', schema, signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
  });
  it.each(['ENDED', 'STOPPED'])('driver disposes the provider once on %s', async (kind) => {
    let wake!: () => void;
    const model = { decide: vi.fn(), dispose: vi.fn(async () => {}) };
    const driver = new AiBattleDriver({
      attachAiBattle: vi.fn(async (_id, w) => {
        wake = w;
      }),
      advanceAiBattle: vi.fn(async () => ({ kind }) as any),
      completeAiBattleTask: vi.fn(),
    });
    await driver.start('m', model);
    wake();
    await vi.waitFor(() => expect(model.dispose).toHaveBeenCalledTimes(1));
    await driver.stop('m');
    expect(model.dispose).toHaveBeenCalledTimes(1);
  });
});
