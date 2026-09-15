import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexBattleSession } from '../../src/server/ai-battle/codex-session';
import { CodexInvocationNotStartedError } from '../../src/server/ai-battle/codex-process';
import { AiBattleDriver } from '../../src/server/ai-battle/driver';
const dirs: string[] = [];
const sessions: CodexBattleSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});
async function fixture(mode = 'normal') {
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
 let turns=0;const mode=${JSON.stringify(mode)},log=${JSON.stringify(log)};
 const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
 rl.on('line',line=>{const m=JSON.parse(line);if(!m.method)return;
 fs.appendFileSync(log,JSON.stringify({method:m.method,params:m.method==='account/login/start'?{type:m.params.type}:m.params,home:process.env.CODEX_HOME,cwd:process.cwd(),hasAuth:fs.existsSync(process.env.CODEX_HOME+'/auth.json'),hasConfig:fs.existsSync(process.env.CODEX_HOME+'/config.toml')})+'\\n');
 if(m.id===undefined)return;
 if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'t',ephemeral:true}}});
 if(m.method!=='turn/start')return send({id:m.id,result:{}});
 const id='turn-'+(++turns);send({id:m.id,result:{turn:{id}}});
 if(mode==='hang')return;
 if(mode==='tool'){send({method:'item/started',params:{threadId:'t',turnId:id,item:{type:'commandExecution'}}});return;}
 if(mode==='rpc'){send({id:900,method:'item/commandExecution/requestApproval',params:{}});return;}
 if(mode==='crash'){process.exit(2);return;}
 send({method:'thread/tokenUsage/updated',params:{threadId:'t',turnId:'old',tokenUsage:{last:{inputTokens:999999,cachedInputTokens:0,outputTokens:5}}}});
 if(mode!=='unknown')send({method:'thread/tokenUsage/updated',params:{threadId:'t',turnId:id,tokenUsage:{total:{inputTokens:999999},last:{inputTokens:100+turns,cachedInputTokens:turns===1?0:80,cacheWriteInputTokens:0,outputTokens:5},modelContextWindow:1000000}}});
 send({method:'item/completed',params:{threadId:'t',turnId:id,item:{type:'agentMessage',text:'{"selection":{"kind":"ACTION","actionRef":"a1"},"tradeoff":"ok"}'}}});
 send({method:'turn/completed',params:{threadId:'t',turn:{id,status:'completed'}}});
 });`;
  await writeFile(cli, script, { mode: 0o700 });
  const session = new CodexBattleSession(
    { cliPath: cli, reasoningEffort: 'low', frontendOrigin: 'http://localhost:5173' },
    'codex:gpt-5.6-luna'
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
  it('reuses one thread, sends only new input and reports last-turn usage, then removes private workspace', async () => {
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
    expect(r.every((x) => !x.hasAuth && !x.hasConfig)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('private-access-token');
    const home = r[0].home;
    await f.session.close();
    await expect(access(home)).rejects.toThrow();
    await expect(f.session.decide('closed', schema, signal())).rejects.toBeInstanceOf(
      CodexInvocationNotStartedError
    );
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
    await vi.waitFor(async () =>
      expect((await f.records()).some((x) => x.method === 'turn/start')).toBe(true)
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
