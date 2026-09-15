import * as codexProcess from '../../src/server/ai-battle/codex-process';
import { DEFAULT_CODEX_AI_BATTLE_MODEL } from '../../src/online/ai-battle-billing-types';
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
  TESTED_CODEX_VERSIONS,
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
    { AI_BATTLE_CODEX_REASONING: 'ultra' },
    { AI_BATTLE_CODEX_PATH: 'codex' },
  ])('fails closed with incompatible settings %j', (override) => {
    expect(() => readLocalCodexConfig({ ...env, ...override })).toThrow();
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
  it.each(TESTED_CODEX_VERSIONS)(
    'accepts ChatGPT login only for validated CLI %s',
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
  it.each(TESTED_CODEX_VERSIONS)(
    'rejects API-key login for %s and untested CLI versions without starting a model',
    async (version) => {
      const dir = await mkdtemp(join(tmpdir(), 'codex-login-test-'));
      const cli = join(dir, 'cli');
      try {
        await writeFile(
          cli,
          `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; else echo "Logged in using an API key"; fi\n`,
          { mode: 0o700 }
        );
        await expect(verifyCodexLogin({ ...config, cliPath: cli })).rejects.toThrow('ChatGPT');
        await writeFile(cli, '#!/bin/sh\necho "codex-cli untested"\n');
        await expect(verifyCodexLogin({ ...config, cliPath: cli })).rejects.toThrow('version');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  );
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
      selfResources: {},
    },
    space: { kind: 'ACTION', candidates: [{ ref: 'a1', description: '完成主要阶段' }] },
    responseSchema: {},
  } as unknown as AiDecisionInput;
  async function fixture(
    execute: ConstructorParameters<typeof CodexAiBattleClient>[5],
    verify = vi.fn(async () => {}),
    sessionReuse = true
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
      { ...config, sessionReuse },
      'codex:gpt-5.6-luna',
      { rules: material, tutorial: material, handbook: material, ownDeck: material },
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
      knowledge: { rules: material, tutorial: material, handbook: material, ownDeck: material },
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
  it('keeps default stateless requests self-contained without claiming a resumed context', async () => {
    const execute = vi.fn(async () => ({ text: '{}', usage: null }));
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
  it('sends frozen knowledge once, keeps schema stable and rejects cross-match/seat reuse', async () => {
    const execute = vi.fn(async () => ({
      text: '{"selection":{"kind":"ACTION","actionRef":"a1"}}',
      usage: null,
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
