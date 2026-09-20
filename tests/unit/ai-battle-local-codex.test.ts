import { CodexBattleSession } from '../../src/server/ai-battle/codex-session';
import { CODEX_OBSERVED_HISTORY_MAX_BYTES } from '../../src/server/ai-battle/codex-observed-history';
import { createLiveSetFixture } from '../helpers/ai-battle-live-set-fixture';
import { decision, submit } from '../helpers/ai-battle-fixture';
import { parseAiBattleResponse } from '../../src/server/ai-battle/decision';
import * as codexProcess from '../../src/server/ai-battle/codex-process';
import { DEFAULT_CODEX_AI_BATTLE_MODEL } from '../../src/online/ai-battle-model-registry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readLocalCodexConfig,
  isLocalCodexRequest,
} from '../../src/server/ai-battle/local-codex-config';
import {
  codexEnvironment,
  codexExecArgs,
  parseCodexUsage,
  parseCodexOutput,
  runCodexProcess,
  verifyCodexLogin,
  CodexInvocationNotStartedError,
  executeCodexDecision,
} from '../../src/server/ai-battle/codex-process';
import {
  CodexAiBattleClient,
  createLocalCodexClient,
  codexResponseSchema,
} from '../../src/server/ai-battle/codex-model-client';
import {
  AiBattleBilling,
  createAiBillingRecord,
  projectAiBilling,
} from '../../src/server/ai-battle/billing';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import { createMemoryAiBilling } from '../helpers/ai-battle-billing';
import type { AiDecisionInput } from '../../src/server/ai-battle/protocol';

const TEST_BUDGET = {
  maxCalls: 5,
  maxInputTokens: 500000,
  maxUncachedInputTokens: 150000,
  maxOutputTokens: 10000,
};
const env = {
  AI_BATTLE_LOCAL_CODEX: '1',
  NODE_ENV: 'development',
  API_HOST: '127.0.0.1',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  FRONTEND_URL: 'http://localhost:5173',
};
const config = readLocalCodexConfig(env)!;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('explicit local Codex deployment boundary', () => {
  it('keeps session reuse experimental and requires an explicit local opt-in', () => {
    expect(readLocalCodexConfig(env)?.sessionReuse).toBe(false);
    expect(readLocalCodexConfig({ ...env, AI_BATTLE_CODEX_SESSION_REUSE: '1' })?.sessionReuse).toBe(
      true
    );
  });
  it('keeps thread rotation off unless explicitly enabled together with reuse', () => {
    expect(readLocalCodexConfig(env)?.threadRotation).toBe(false);
    expect(
      readLocalCodexConfig({
        ...env,
        AI_BATTLE_CODEX_SESSION_REUSE: '1',
        AI_BATTLE_CODEX_THREAD_ROTATION: '1',
      })?.threadRotation
    ).toBe(true);
  });
  it('stays disabled without opt-in even on localhost', () => {
    expect(readLocalCodexConfig({ ...env, AI_BATTLE_LOCAL_CODEX: undefined })).toBeNull();
  });
  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: 'test' },
    { API_HOST: '0.0.0.0' },
    { API_HOST: undefined },
    { DATABASE_URL: 'postgres://test:test@db.example/test' },
    { DATABASE_URL: 'invalid' },
    { FRONTEND_URL: 'https://example.com' },
    { AI_BATTLE_LOCAL_CODEX: 'true' },
    { AI_BATTLE_CODEX_SESSION_REUSE: 'true' },
    { AI_BATTLE_CODEX_THREAD_ROTATION: '1' },
    { AI_BATTLE_CODEX_THREAD_ROTATION: 'true' },
    { AI_BATTLE_CODEX_REASONING: 'ultra' },
    { AI_BATTLE_CODEX_PATH: 'codex' },
  ])('fails closed with incompatible settings %j', (override) => {
    expect(() => readLocalCodexConfig({ ...env, ...override })).toThrow();
  });
  it.each(['0', '-1', '1.5', 'Infinity', 'NaN', '9007199254740992', ''])(
    'rejects an invalid budget %s',
    (raw) => {
      expect(() => readLocalCodexConfig({ ...env, AI_BATTLE_CODEX_MAX_CALLS: raw })).toThrow();
    }
  );
  it('reads explicit positive budgets without changing the defaults', () => {
    expect(readLocalCodexConfig(env)?.budget).toBeUndefined();
    expect(
      readLocalCodexConfig({ ...env, AI_BATTLE_CODEX_MAX_CALLS: '9' })?.budget?.maxInputTokens
    ).toBeUndefined();
    expect(
      readLocalCodexConfig({
        ...env,
        AI_BATTLE_CODEX_MAX_CALLS: '9',
        AI_BATTLE_CODEX_MAX_INPUT_TOKENS: '1234',
        AI_BATTLE_CODEX_MAX_UNCACHED_INPUT_TOKENS: '123',
        AI_BATTLE_CODEX_MAX_OUTPUT_TOKENS: '12',
      })?.budget
    ).toEqual({
      maxCalls: 9,
      maxInputTokens: 1234,
      maxUncachedInputTokens: 123,
      maxOutputTokens: 12,
    });
  });
  const request = {
    remoteAddress: '127.0.0.1',
    host: 'localhost:3007',
    origin: 'http://localhost:5173',
  };
  it('accepts direct local and local Vite proxy requests', () => {
    expect(isLocalCodexRequest(config, request)).toBe(true);
    expect(isLocalCodexRequest(config, { ...request, origin: 'http://127.0.0.1:5173' })).toBe(true);
    expect(
      isLocalCodexRequest(config, {
        ...request,
        remoteAddress: '::ffff:127.0.0.1',
        forwardedFor: '::1, 127.0.0.1',
      })
    ).toBe(true);
  });
  it.each([
    { remoteAddress: '192.168.1.2' },
    { forwardedFor: '192.168.1.2, 127.0.0.1' },
    { remoteAddress: '192.168.1.2', forwardedFor: '127.0.0.1' },
    { origin: 'https://public.example' },
    { origin: 'http://localhost:5999' },
    { origin: 'null' },
    { host: 'public.example' },
    { host: 'localhost:3007@public.example' },
    { forwarded: 'for=127.0.0.1' },
  ])('rejects remote/proxied/rebound requests %j', (override) => {
    expect(isLocalCodexRequest(config, { ...request, ...override })).toBe(false);
  });
});

describe('Codex subprocess transport and subscription accounting', () => {
  it('does not pass API keys, database secrets or desktop tool routing to the child', () => {
    expect(
      codexEnvironment({
        HOME: '/home/test',
        PATH: '/bin',
        OPENAI_API_KEY: 'secret',
        CODEX_API_KEY: 'secret',
        DATABASE_URL: 'secret',
        CODEX_ACCESS_TOKEN: 'secret',
        CODEX_THREAD_ID: 'private-thread',
        MINIO_SECRET_KEY: 'secret',
      })
    ).toEqual({ HOME: '/home/test', PATH: '/bin' });
    const args = codexExecArgs(config, 'codex:gpt-5.6-luna', '/tmp/schema.json');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('forced_login_method="chatgpt"');
    expect(args).toContain('features.shell_tool=false');
    expect(args).toContain('default_permissions="ai_decision"');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
  it('keeps unknown usage unknown and separates cached input without pricing the subscription', () => {
    expect(
      parseCodexUsage({ input_tokens: 20, cached_input_tokens: 5, output_tokens: 3 })
    ).toMatchObject({ inputTokens: 15, implicitCachedTokens: 5, outputTokens: 3 });
    for (const value of [
      {},
      { input_tokens: 2, cached_input_tokens: 5, output_tokens: 3 },
      { input_tokens: 2, cached_input_tokens: 0, output_tokens: -1 },
    ])
      expect(parseCodexUsage(value)).toBeNull();
    const record = createAiBillingRecord('codex:gpt-5.6-luna');
    expect(record.prices).toBeNull();
    expect(record.pricingDate).toBeNull();
    expect(projectAiBilling(record).estimatedCny).toBeNull();
    expect(projectAiBilling(createAiBillingRecord('qwen3.8-flash')).estimatedCny).toBe(
      '0.00000000'
    );
  });
  const stream = (usage: unknown) =>
    [
      {
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"selection":{"kind":"ACTION","actionRef":"a1"}}' },
      },
      { type: 'turn.completed', usage },
    ]
      .map((x) => JSON.stringify(x))
      .join('\n');
  it('uses only completed final messages and rejects tool activity, failure and partial turns', () => {
    expect(parseCodexOutput(stream({})).usage).toBeNull();
    expect(parseCodexOutput(stream({})).text).toContain('a1');
    expect(
      parseCodexOutput(
        '{"type":"item.completed","item":{"type":"error","message":"Code mode disabled"}}\n' +
          stream({})
      ).text
    ).toContain('a1');
    expect(() => parseCodexOutput('{}')).toThrow();
    expect(() => parseCodexOutput(stream({}) + '\n{"type":"turn.failed"}')).toThrow();
    expect(() =>
      parseCodexOutput('{"type":"item.started","item":{"type":"command_execution"}}\n' + stream({}))
    ).toThrow();
  });
  it.each(['codex-cli 0.153.4', 'codex-cli 0.155.0-alpha.9.2', 'codex-cli 9.0.0'])(
    'allows local ChatGPT login regardless of CLI version %s without starting a model',
    async (version) => {
      const dir = await mkdtemp(join(tmpdir(), 'codex-login-test-'));
      const cli = join(dir, 'cli');
      try {
        await writeFile(
          cli,
          `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; elif [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT"; else exit 99; fi\n`,
          { mode: 0o700 }
        );
        await expect(verifyCodexLogin({ ...config, cliPath: cli })).resolves.toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  );
  it.each(['Logged in using an API key', 'Not logged in'])(
    'still rejects login status %s without starting a model',
    async (status) => {
      const dir = await mkdtemp(join(tmpdir(), 'codex-login-test-'));
      const cli = join(dir, 'cli');
      try {
        await writeFile(
          cli,
          `#!/bin/sh\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "${status}"; else exit 99; fi\n`,
          { mode: 0o700 }
        );
        await expect(verifyCodexLogin({ ...config, cliPath: cli })).rejects.toThrow('ChatGPT');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  );
  it('still rejects an unavailable CLI or a failed login command', async () => {
    await expect(
      verifyCodexLogin({ ...config, cliPath: '/missing-loveca-codex-cli' })
    ).rejects.toThrow('Cannot start');
    const dir = await mkdtemp(join(tmpdir(), 'codex-login-test-'));
    try {
      const cli = join(dir, 'cli');
      await writeFile(cli, '#!/bin/sh\necho "Logged in using ChatGPT"\nexit 1\n', { mode: 0o700 });
      await expect(verifyCodexLogin({ ...config, cliPath: cli })).rejects.toThrow(
        'exited with code 1'
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('distinguishes failures before spawn from unconfirmed model usage', async () => {
    await expect(
      executeCodexDecision(
        { ...config, cliPath: '/missing-loveca-codex-cli' },
        'codex:gpt-6-astra',
        'test',
        {},
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(CodexInvocationNotStartedError);
  });

  it('bounds subprocess output and terminates cancelled processes', async () => {
    await expect(
      runCodexProcess(
        process.execPath,
        ['-e', 'process.stdout.write("x".repeat(2000))'],
        tmpdir(),
        '',
        new AbortController().signal,
        {},
        100
      )
    ).rejects.toThrow('limit');
    const dir = await mkdtemp(join(tmpdir(), 'codex-cancel-test-'));
    try {
      const pidPath = join(dir, 'pid');
      const controller = new AbortController();
      const running = runCodexProcess(
        process.execPath,
        [
          '-e',
          `require('fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(()=>{},1000)`,
        ],
        dir,
        '',
        controller.signal,
        {}
      );
      // Attach rejection handling before cancellation.
      const settled = expect(running).rejects.toThrow('cancelled');
      let pid = 0;
      for (let i = 0; i < 100 && !pid; i++) {
        try {
          pid = Number(await readFile(pidPath, 'utf8'));
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      controller.abort();
      await settled;
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Codex provider preserves the existing decision contract', () => {
  const input = {
    purpose: 'MAIN',
    state: {
      table: { zones: {} },
      objects: {},
      turn: 1,
      phase: 'MAIN_PHASE',
      subPhase: 'NONE',
      selfSeat: 'SECOND',
      firstSeat: 'FIRST',
      activeSeat: 'SECOND',
      selfResources: { handCards: [], stageMembers: [] },
    },
    space: { kind: 'ACTION', candidates: [{ ref: 'a1', description: '完成主要阶段' }] },
    responseSchema: {},
  } as unknown as AiDecisionInput;
  async function fixture(
    execute: ConstructorParameters<typeof CodexAiBattleClient>[5],
    verify = vi.fn(async () => {}),
    sessionReuse = true,
    ownDeck?: ReturnType<typeof createLiveSetFixture>['ownDeck'],
    budget:
      | import('../../src/online/ai-battle-billing-types').CodexBattleBudget
      | undefined = config.budget,
    threadRotation = false
  ) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const memory = createMemoryAiBilling();
    const traces = new AiBattleTraceStore();
    traces.open('m', []);
    traces.begin('m', { id: 'd', revision: 1, windowKey: 'MAIN', seat: 'SECOND', purpose: 'MAIN' });
    const billing = new AiBattleBilling(
      'codex:gpt-5.6-luna',
      memory.persistence,
      (id, value, decision, delta) => traces.updateBilling(id, value, decision, delta)
    );
    await billing.initialize('m');
    const material = {
      id: 'test',
      title: 'test',
      source: 'test',
      sha256: 'test',
      content: 'ONLY_FROZEN_PUBLIC_OR_SELF_KNOWLEDGE',
    };
    const client = new CodexAiBattleClient(
      { ...config, sessionReuse, budget, threadRotation },
      'codex:gpt-5.6-luna',
      { rules: material, tutorial: material, handbook: material, ownDeck: ownDeck ?? material },
      traces,
      billing,
      execute,
      verify
    );
    return {
      client,
      billing,
      traces,
      memory,
      verify,
      knowledge: {
        rules: material,
        tutorial: material,
        handbook: material,
        ownDeck: ownDeck ?? material,
      },
    };
  }
  it('defaults new local games to Luna', () => {
    expect(DEFAULT_CODEX_AI_BATTLE_MODEL).toBe('codex:gpt-5.6-luna');
  });
  it('freezes the selected effort per game and forwards it to CLI arguments and observation', async () => {
    const f = await fixture(vi.fn());
    const login = vi.spyOn(codexProcess, 'verifyCodexLogin').mockResolvedValue(undefined);
    const create = (effort?: 'low' | 'medium') =>
      createLocalCodexClient(
        config,
        'codex:gpt-5.6-luna',
        f.knowledge,
        f.traces,
        f.billing,
        effort
      );
    const medium = await create('medium');
    const frozen = login.mock.calls[0]![0];
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(codexProcess.codexExecArgs(frozen, 'codex:gpt-5.6-luna', '/schema.json')).toContain(
      'model_reasoning_effort="medium"'
    );
    expect(JSON.parse(medium.configurationMaterial.content)).toMatchObject({
      reasoningEffort: 'medium',
      model: 'codex:gpt-5.6-luna',
    });
    vi.stubEnv('AI_BATTLE_CODEX_REASONING', 'low');
    const low = await create('low');
    expect(low.reasoningEffort).toBe('low');
    expect(medium.reasoningEffort).toBe('medium');
    expect(config.reasoningEffort).toBe('low');
    const serverDefault = await createLocalCodexClient(
      { ...config, reasoningEffort: 'medium' },
      'codex:gpt-5.6-luna',
      f.knowledge,
      f.traces,
      f.billing
    );
    expect(serverDefault.reasoningEffort).toBe('medium');
  });
  it('cannot use effort selection to bypass the local gate or inject CLI settings', async () => {
    const f = await fixture(vi.fn());
    const login = vi.spyOn(codexProcess, 'verifyCodexLogin').mockResolvedValue(undefined);
    await expect(
      createLocalCodexClient(null, 'codex:gpt-5.6-luna', f.knowledge, f.traces, f.billing, 'low')
    ).rejects.toThrow('本地 Codex 尚未启用');
    await expect(
      createLocalCodexClient(
        config,
        'codex:gpt-5.6-luna',
        f.knowledge,
        f.traces,
        f.billing,
        'high' as 'low'
      )
    ).rejects.toThrow('不支持的 Codex 思考强度');
    expect(login).not.toHaveBeenCalled();
  });
  const context = { matchId: 'm', taskId: 'd', revision: 1, windowKey: 'MAIN', attempt: 0 };
  it.each([true, false])(
    'enforces the call cap before dispatch in sessionReuse=%s',
    async (reuse) => {
      const execute = vi.fn(async () => ({
        text: '{}',
        usage: parseCodexUsage({ input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 }),
      }));
      const f = await fixture(execute, undefined, reuse, undefined, TEST_BUDGET);
      for (let i = 0; i < 5; i++)
        expect((await f.client.decide(input, new AbortController().signal, context)).kind).toBe(
          'RESPONSE'
        );
      expect(await f.client.decide(input, new AbortController().signal, context)).toMatchObject({
        kind: 'ADAPTER_ERROR',
        message: expect.stringContaining('调用次数达到上限'),
      });
      expect(execute).toHaveBeenCalledTimes(5);
      expect(f.billing.view()).toMatchObject({ attempts: 5, reportedAttempts: 5 });
    }
  );
  it.each([
    ['maxInputTokens', 10, '累计输入'],
    ['maxUncachedInputTokens', 8, '非缓存输入'],
    ['maxOutputTokens', 1, '累计输出'],
  ] as const)('stops the next call at %s using reported usage', async (key, limit, reason) => {
    const execute = vi.fn(async () => ({
      text: '{}',
      usage: parseCodexUsage({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 }),
    }));
    const limits = { ...TEST_BUDGET, [key]: limit };
    const f = await fixture(execute, undefined, false, undefined, limits);
    limits[key] = 99999; // A caller cannot mutate a game's frozen limits.
    expect((await f.client.decide(input, new AbortController().signal, context)).kind).toBe(
      'RESPONSE'
    );
    expect(await f.client.decide(input, new AbortController().signal, context)).toMatchObject({
      kind: 'ADAPTER_ERROR',
      message: expect.stringContaining(reason),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(f.billing.view().attempts).toBe(1);
  });
  it('does not impose the former five-call default or unspecified token limits', async () => {
    const execute = vi.fn(async () => ({
      text: '{}',
      usage: parseCodexUsage({
        input_tokens: 200000,
        cached_input_tokens: 0,
        output_tokens: 20000,
      }),
    }));
    const f = await fixture(execute, undefined, false);
    expect(f.client.codexBudget).toBeUndefined();
    for (let i = 0; i < 6; i++)
      expect((await f.client.decide(input, new AbortController().signal, context)).kind).toBe(
        'RESPONSE'
      );
    expect(execute).toHaveBeenCalledTimes(6);
  });
  it('keeps cache hits out of the uncached threshold while counting them toward total input', async () => {
    const execute = vi.fn(async () => ({
      text: '{}',
      usage: parseCodexUsage({ input_tokens: 100, cached_input_tokens: 99, output_tokens: 1 }),
    }));
    const f = await fixture(execute, undefined, true, undefined, {
      ...TEST_BUDGET,
      maxInputTokens: 200,
      maxUncachedInputTokens: 3,
    });
    for (let i = 0; i < 2; i++)
      expect((await f.client.decide(input, new AbortController().signal, context)).kind).toBe(
        'RESPONSE'
      );
    expect(await f.client.decide(input, new AbortController().signal, context)).toMatchObject({
      message: expect.stringContaining('累计输入'),
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('stops immediately on unreported usage and never executes a second call', async () => {
    const execute = vi.fn(async () => ({ text: '{}', usage: null }));
    const f = await fixture(execute, undefined, false);
    expect(await f.client.decide(input, new AbortController().signal, context)).toMatchObject({
      kind: 'ADAPTER_ERROR',
      message: expect.stringContaining('用量未确认'),
    });
    await f.client.decide(input, new AbortController().signal, context);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(f.billing.view()).toMatchObject({
      attempts: 1,
      reportedAttempts: 0,
      unreportedAttempts: 1,
    });
  });
  it.each([0, 180 * 1024])(
    'rotates at the watermark and preserves public history (%i bytes of content) without replaying an old request',
    async (historyContentBytes) => {
      const decide = vi.spyOn(CodexBattleSession.prototype, 'decide').mockResolvedValue({
        text: '{}',
        usage: parseCodexUsage({ input_tokens: 20, cached_input_tokens: 0, output_tokens: 1 }),
      });
      const close = vi.spyOn(CodexBattleSession.prototype, 'close').mockResolvedValue();
      vi.spyOn(CodexBattleSession.prototype, 'createSuccessor').mockImplementation(
        async function () {
          await this.close();
          return new CodexBattleSession(
            { ...config, sessionReuse: true, threadRotation: true },
            'codex:gpt-5.6-luna'
          );
        }
      );
      vi.spyOn(CodexBattleSession.prototype, 'contextStatus', 'get').mockImplementation(() => ({
        lastContextTokens: decide.mock.calls.length === 1 ? 200 : null,
        modelContextWindow: 250,
        stopAtTokens: 200,
        completedTurns: decide.mock.calls.length,
        automaticCompaction: false,
        compactions: 0,
      }));
      const f = await fixture(undefined, undefined, true, undefined, undefined, true);
      const event = {
        type: 'PlayerDeclared',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        matchId: 'm',
        eventId: 'm:1',
        seq: 1,
        timestamp: 1,
        declarationType: 'OLD_PUBLIC_FACT',
        publicValue: 'x'.repeat(historyContentBytes),
      };
      const first = {
        ...input,
        history: {
          selection: 'LAST_12_PUBLIC_EVENTS',
          throughPublicSeq: 1,
          omittedEventCount: 0,
          events: [event],
        },
      } as AiDecisionInput;
      const next = {
        ...input,
        history: {
          selection: 'LAST_12_PUBLIC_EVENTS',
          throughPublicSeq: 5,
          omittedEventCount: 5,
          events: [],
        },
        space: { kind: 'ACTION', candidates: [{ ref: 'new-ref', description: 'CURRENT_ONLY' }] },
      } as AiDecisionInput;
      expect((await f.client.decide(first, new AbortController().signal, context)).kind).toBe(
        'RESPONSE'
      );
      expect(close).not.toHaveBeenCalled();
      expect(
        (await f.client.decide(next, new AbortController().signal, { ...context, taskId: 'next' }))
          .kind
      ).toBe('RESPONSE');
      expect(close).toHaveBeenCalledTimes(1);
      expect(decide).toHaveBeenCalledTimes(2);
      expect(decide.mock.instances[0]).not.toBe(decide.mock.instances[1]);
      const sent = decide.mock.calls[1]![0];
      expect(sent).toContain('ONLY_FROZEN_PUBLIC_OR_SELF_KNOWLEDGE');
      expect(sent).toContain('OLD_PUBLIC_FACT');
      expect(sent).toContain(JSON.stringify(event));
      expect(Buffer.byteLength(sent)).toBeLessThan(512 * 1024);
      expect(sent).toContain('"unobservedEventCount":4');
      expect(sent).toContain('new-ref');
      expect(sent).not.toContain('完成主要阶段');
      expect(f.billing.view().attempts).toBe(2);
      await f.client.dispose();
    }
  );
  it('stops before a model request when rotation history is unavailable', async () => {
    const execute = vi.fn();
    const f = await fixture(execute, undefined, true, undefined, undefined, true);
    expect((await f.client.decide(input, new AbortController().signal, context)).kind).toBe(
      'ADAPTER_ERROR'
    );
    expect(execute).not.toHaveBeenCalled();
    expect(f.billing.view().attempts).toBe(0);
  });
  it('reports history capacity separately and stops before dispatch or billing', async () => {
    const execute = vi.fn();
    const f = await fixture(execute, undefined, true, undefined, undefined, true);
    const capture = vi.spyOn(f.traces, 'append');
    const tooLarge = {
      ...input,
      history: {
        selection: 'LAST_12_PUBLIC_EVENTS',
        throughPublicSeq: 1,
        omittedEventCount: 0,
        events: [
          {
            type: 'PlayerDeclared',
            source: 'PLAYER',
            matchId: 'm',
            eventId: 'm:1',
            seq: 1,
            timestamp: 1,
            declarationType: 'PUBLIC_FACT',
            publicValue: 'x'.repeat(CODEX_OBSERVED_HISTORY_MAX_BYTES),
          },
        ],
      },
    } as AiDecisionInput;
    const attemptedBytes = Buffer.byteLength(JSON.stringify(tooLarge.history!.events[0]));
    const result = await f.client.decide(tooLarge, new AbortController().signal, context);
    expect(result.kind).toBe('ADAPTER_ERROR');
    expect(result).toHaveProperty(
      'message',
      expect.stringContaining(
        `本次累计 ${attemptedBytes} 字节，上限 ${CODEX_OBSERVED_HISTORY_MAX_BYTES} 字节`
      )
    );
    expect(capture).toHaveBeenCalledWith(
      'm',
      'd',
      'HISTORY_STOP',
      {
        reason: 'CAPACITY',
        attemptedBytes,
        limitBytes: CODEX_OBSERVED_HISTORY_MAX_BYTES,
      },
      undefined
    );
    await f.client.decide(input, new AbortController().signal, context);
    expect(execute).not.toHaveBeenCalled();
    expect(f.billing.view().attempts).toBe(0);
  });
  it('keeps the independent 512 KiB request cap even when history fits', async () => {
    const execute = vi.fn();
    const f = await fixture(execute);
    const capture = vi.spyOn(f.traces, 'append');
    const oversizedInput = {
      ...input,
      space: { kind: 'ACTION', candidates: [{ ref: 'a1', description: 'x'.repeat(512 * 1024) }] },
    } as AiDecisionInput;
    const result = await f.client.decide(oversizedInput, new AbortController().signal, context);
    expect(result.kind).toBe('ADAPTER_ERROR');
    expect(result).toHaveProperty('message', expect.stringContaining('单次请求容量超限'));
    expect(capture).toHaveBeenCalledWith(
      'm',
      'd',
      'CONTEXT_STOP',
      expect.objectContaining({
        reason: 'REQUEST_BYTES',
        limitBytes: 512 * 1024,
      }),
      undefined
    );
    await f.client.decide(input, new AbortController().signal, context);
    expect(execute).not.toHaveBeenCalled();
    expect(f.billing.view().attempts).toBe(0);
  });
  it('forwards only current input and returns untrusted text to the original validator', async () => {
    const execute = vi.fn(async () => ({
      text: '{"selection":{"kind":"ACTION","actionRef":"invalid"}}',
      usage: parseCodexUsage({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 }),
    }));
    const f = await fixture(execute);
    const result = await f.client.decide(input, new AbortController().signal, context);
    expect(result).toMatchObject({ kind: 'RESPONSE', text: expect.stringContaining('invalid') });
    expect(execute.mock.calls[0]![2]).toContain('ONLY_FROZEN_PUBLIC_OR_SELF_KNOWLEDGE');
    expect(f.billing.view()).toMatchObject({
      attempts: 1,
      reportedAttempts: 1,
      estimatedCny: null,
      usage: { inputTokens: 8, implicitCachedTokens: 2 },
    });
    expect(f.traces.list('m')!.decisions[0]!.decisionBilling?.estimatedCny).toBeNull();
  });
  it('restates MAIN after a CARDS window without changing schema or repairing stale model output', async () => {
    const stale = JSON.stringify({ selection: { kind: 'CARDS', cardRefs: ['c1'] } });
    const execute = vi.fn(async () => ({
      text: stale,
      usage: parseCodexUsage({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 }),
    }));
    const f = await fixture(execute);
    const prior = {
      ...input,
      purpose: 'EFFECT',
      space: {
        kind: 'CARDS',
        candidates: [{ ref: 'c1', description: 'old effect' }],
        min: 1,
        max: 1,
        ordered: false,
      },
    } as AiDecisionInput;
    await f.client.decide(prior, new AbortController().signal, context);
    const result = await f.client.decide(input, new AbortController().signal, {
      ...context,
      taskId: 'main',
    });
    expect(JSON.parse(execute.mock.calls[1]![2].split('\n').at(-1)!)).toEqual({
      turn: input.state.turn,
      phase: input.state.phase,
      purpose: input.purpose,
      selectionKind: 'ACTION',
    });
    expect(execute.mock.calls[0]![3]).toEqual(execute.mock.calls[1]![3]);
    expect(result).toEqual({ kind: 'RESPONSE', text: stale });
    expect(() => parseAiBattleResponse({ input }, stale)).toThrow();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(f.billing.view().attempts).toBe(2);
  });
  it('keeps default stateless requests self-contained without claiming a resumed context', async () => {
    const execute = vi.fn(async () => ({
      text: '{}',
      usage: parseCodexUsage({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 }),
    }));
    const f = await fixture(execute, undefined, false);
    await f.client.decide(input, new AbortController().signal, context);
    await f.client.decide(input, new AbortController().signal, { ...context, taskId: 'next' });
    expect(execute.mock.calls.map((call) => call[2])).toEqual([
      expect.stringContaining('ONLY_FROZEN_PUBLIC_OR_SELF_KNOWLEDGE'),
      expect.stringContaining('ONLY_FROZEN_PUBLIC_OR_SELF_KNOWLEDGE'),
    ]);
    expect(JSON.parse(f.client.configurationMaterial.content)).toMatchObject({
      transport: 'EPHEMERAL_EXEC',
      staticKnowledge: 'EVERY_REQUEST',
    });
  });
  it('sends frozen knowledge once and appends the current author input, keeps schema stable and rejects cross-match/seat reuse', async () => {
    const execute = vi.fn(async () => ({
      text: '{"selection":{"kind":"ACTION","actionRef":"a1"}}',
      usage: parseCodexUsage({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 }),
    }));
    const f = await fixture(execute);
    await f.client.decide(input, new AbortController().signal, context);
    const next = {
      ...input,
      space: {
        kind: 'CARDS' as const,
        candidates: [{ ref: 'new-card', description: 'visible' }],
        min: 0,
        max: 1,
        ordered: false,
      },
    };
    await f.client.decide(next, new AbortController().signal, { ...context, taskId: 'next' });
    expect(execute.mock.calls[0]![2]).toContain('ONLY_FROZEN_PUBLIC_OR_SELF_KNOWLEDGE');
    expect(execute.mock.calls[1]![2]).not.toContain('ONLY_FROZEN_PUBLIC_OR_SELF_KNOWLEDGE');
    expect(execute.mock.calls[1]![2]).not.toContain('完成主要阶段');
    expect(execute.mock.calls[0]![3]).toEqual(execute.mock.calls[1]![3]);
    expect(execute.mock.calls[1]![2]).toContain('new-card');
    expect(
      (
        await f.client.decide(input, new AbortController().signal, {
          ...context,
          matchId: 'another',
        })
      ).kind
    ).toBe('ADAPTER_ERROR');
    expect(
      (
        await f.client.decide(
          { ...input, state: { ...input.state, selfSeat: 'another' } },
          new AbortController().signal,
          context
        )
      ).kind
    ).toBe('ADAPTER_ERROR');
    await f.client.dispose();
    expect((await f.client.decide(input, new AbortController().signal, context)).kind).toBe(
      'ADAPTER_ERROR'
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('executes a three-card LIVE set and confirmation from one Codex response through the original validator', async () => {
    const game = createLiveSetFixture();
    const current = decision(game.session);
    const selected = current.input.space.candidates.slice(0, 3).map((card) => card.ref);
    const execute = vi.fn(async () => ({
      text: JSON.stringify({
        selection: { kind: 'CARDS', cardRefs: selected },
        tradeoff: 'fixture',
      }),
      usage: parseCodexUsage({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 }),
    }));
    const f = await fixture(execute, undefined, true, game.ownDeck);
    const deckBefore = game.session.state!.players[0].mainDeck.cardIds.length;
    const answer = await f.client.decide(current.input, new AbortController().signal, context);
    expect(answer.kind).toBe('RESPONSE');
    if (answer.kind !== 'RESPONSE') throw new Error('Expected model response');
    const parsed = parseAiBattleResponse(current, answer.text);
    submit(game.session, current, parsed.selection);
    expect(game.session.state!.players[0].mainDeck.cardIds.length).toBe(deckBefore - 3);
    expect(game.session.state!.currentSubPhase).not.toBe(current.input.state.subPhase);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('records unknown failed calls and never retries or falls back', async () => {
    const execute = vi.fn(async () => {
      throw new Error('private-stderr-secret');
    });
    const f = await fixture(execute);
    expect(await f.client.decide(input, new AbortController().signal, context)).toMatchObject({
      kind: 'ADAPTER_ERROR',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(f.billing.view()).toMatchObject({
      attempts: 1,
      reportedAttempts: 0,
      unreportedAttempts: 1,
      estimatedCny: null,
    });
    expect(JSON.stringify(f.traces.export('m'))).not.toContain('private-stderr-secret');
  });
  it('does not invoke or count a call after login failure or early cancellation', async () => {
    const execute = vi.fn();
    const f = await fixture(
      execute,
      vi.fn(async () => {
        throw new Error('API login');
      })
    );
    expect((await f.client.decide(input, new AbortController().signal, context)).kind).toBe(
      'ADAPTER_ERROR'
    );
    expect(execute).not.toHaveBeenCalled();
    expect(f.billing.view().attempts).toBe(0);
  });
  it('removes an unsent invocation from subscription totals', async () => {
    const f = await fixture(async () => {
      throw new CodexInvocationNotStartedError('not started');
    });
    expect((await f.client.decide(input, new AbortController().signal, context)).kind).toBe(
      'ADAPTER_ERROR'
    );
    expect(f.billing.view()).toMatchObject({
      attempts: 0,
      pendingAttempts: 0,
      unreportedAttempts: 0,
    });
  });

  it('drops late answers after cancellation while retaining reported usage', async () => {
    const controller = new AbortController();
    const f = await fixture(async () => {
      controller.abort();
      return {
        text: '{}',
        usage: parseCodexUsage({ input_tokens: 3, cached_input_tokens: 0, output_tokens: 1 }),
      };
    });
    expect(await f.client.decide(input, controller.signal, context)).toMatchObject({
      kind: 'SERVICE_ERROR',
      retryable: false,
    });
    expect(f.billing.view()).toMatchObject({ reportedAttempts: 1, pendingAttempts: 0 });
  });
  it('adapts the wire schema without replacing group constraints in the input', () => {
    const cards = {
      ...input,
      space: {
        kind: 'CARDS' as const,
        candidates: [{ ref: 'c1', description: '公开候选' }],
        min: 1,
        max: 1,
        ordered: false,
        groups: [{ cardRefs: ['c1'], min: 1, max: 1 }],
      },
    };
    const before = structuredClone(cards);
    expect(codexResponseSchema(cards)).toMatchObject({ required: ['selection', 'tradeoff'] });
    expect(cards).toEqual(before);
  });
});
