import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProbabilityFixture } from '../helpers/ai-live-probability-fixture';
import { createMemoryAiBilling } from '../helpers/ai-battle-billing';
import { createLiveSetFixture } from '../helpers/ai-battle-live-set-fixture';
import { decision, submit } from '../helpers/ai-battle-fixture';
import { AiBattleBilling } from '../../src/server/ai-battle/billing';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import { CodexAiBattleClient } from '../../src/server/ai-battle/codex-model-client';
import { CodexBattleSession } from '../../src/server/ai-battle/codex-session';
import { readLocalCodexConfig } from '../../src/server/ai-battle/local-codex-config';
import {
  parseCodexUsage,
  type executeCodexDecision,
} from '../../src/server/ai-battle/codex-process';
import {
  DashScopeAiBattleClient,
  createAiModelConfig,
} from '../../src/server/ai-battle/model-client';
import { parseAiBattleResponse } from '../../src/server/ai-battle/protocol';

const context = { matchId: 'm', taskId: 'd', revision: 1, windowKey: 'LIVE_SET', attempt: 0 };
const query = JSON.stringify({
  tradeoff: '假设补一粉比较',
  selection: {
    kind: 'LIVE_PROBABILITY_QUERY',
    scenarios: [
      {
        id: 'pink',
        cardRefs: ['c1'],
        additionalHearts: [{ color: 'PINK', count: 1 }],
        additionalCheer: 0,
        assumptionNote: '测试假设，未支付费用',
      },
    ],
  },
});
const answer = JSON.stringify({
  tradeoff: '最终选择',
  selection: { kind: 'CARDS', cardRefs: ['c1'] },
});
const usage = parseCodexUsage({ input_tokens: 100, cached_input_tokens: 75, output_tokens: 5 })!;
const localEnv = {
  AI_BATTLE_LOCAL_CODEX: '1',
  NODE_ENV: 'development',
  API_HOST: '127.0.0.1',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  FRONTEND_URL: 'http://localhost:5173',
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function fixture(model: 'codex:gpt-5.6-luna' | 'qwen3.8-max' = 'codex:gpt-5.6-luna') {
  const { input, ownDeck } = createProbabilityFixture();
  const material = { ...ownDeck, content: 'FROZEN_RULES' };
  const knowledge = { rules: material, tutorial: material, handbook: material, ownDeck };
  const traces = new AiBattleTraceStore();
  traces.open('m', []);
  traces.begin('m', {
    id: 'd',
    revision: 1,
    windowKey: 'LIVE_SET',
    seat: 'FIRST',
    purpose: 'LIVE_SET',
  });
  const billing = new AiBattleBilling(
    model,
    createMemoryAiBilling().persistence,
    (id, value, decision, delta) => traces.updateBilling(id, value, decision, delta)
  );
  await billing.initialize('m');
  return { input, knowledge, traces, billing };
}
function config(sessionReuse = true) {
  for (const [k, v] of Object.entries(localEnv)) vi.stubEnv(k, v);
  return { ...readLocalCodexConfig(localEnv)!, sessionReuse };
}
function evidence(traces: AiBattleTraceStore, stage: string) {
  const bundle = traces.export('m', 'd')!;
  return bundle.decisions[0]!.events.filter((e) => e.stage === stage).map(
    (e) =>
      JSON.parse(bundle.materials.find((m) => m.id === e.materialId)!.content) as Record<
        string,
        unknown
      >
  );
}

describe('probability query through model transports', () => {
  it.each([true, false])(
    'Codex reuse=%s bills both turns and returns only the final choice',
    async (reuse) => {
      const f = await fixture();
      const execute = vi
        .fn<typeof executeCodexDecision>()
        .mockResolvedValueOnce({ text: query, usage })
        .mockResolvedValueOnce({ text: answer, usage });
      const client = new CodexAiBattleClient(
        config(reuse),
        'codex:gpt-5.6-luna',
        f.knowledge,
        f.traces,
        f.billing,
        execute,
        vi.fn(async () => {})
      );
      const outcome = await client.decide(f.input, new AbortController().signal, context);
      expect(outcome).toEqual({ kind: 'RESPONSE', text: answer });
      expect(execute).toHaveBeenCalledTimes(2);
      const [first, second] = execute.mock.calls;
      expect(first![3]).toEqual(second![3]); // Stable output schema, including across the query boundary.
      expect(first![2]).toContain('readOnlyQuery');
      expect(second![2]).toContain('"assumptionsVerified":false');
      expect(second![2]).toContain('"successProbability":1');
      expect(second![2].includes('FROZEN_RULES')).toBe(!reuse);
      expect(second![2].includes('本次决策；')).toBe(!reuse);
      expect(f.billing.view()).toMatchObject({
        attempts: 2,
        reportedAttempts: 2,
        usage: { inputTokens: 50, implicitCachedTokens: 150, outputTokens: 10 },
      });
      expect(evidence(f.traces, 'REQUEST').map((r) => r.queryRound)).toEqual([0, 1]);
      expect(evidence(f.traces, 'LIVE_PROBABILITY_RESULT')[0]).toMatchObject({
        scenarios: [{ assumptionNote: '测试假设，未支付费用' }],
      });
      expect(parseAiBattleResponse({ input: f.input }, answer).selection).toEqual({
        kind: 'CARDS',
        cardRefs: ['c1'],
      });
    }
  );

  it.each(['calls', 'tokens', 'unknown-usage'])(
    'Codex stops before continuation for %s protection',
    async (mode) => {
      const f = await fixture();
      const execute = vi
        .fn<typeof executeCodexDecision>()
        .mockResolvedValue({ text: query, usage: mode === 'unknown-usage' ? null : usage });
      const budget = mode === 'calls' ? { maxCalls: 1 } : { maxUncachedInputTokens: 25 };
      const client = new CodexAiBattleClient(
        { ...config(), budget },
        'codex:gpt-5.6-luna',
        f.knowledge,
        f.traces,
        f.billing,
        execute,
        vi.fn(async () => {})
      );
      expect((await client.decide(f.input, new AbortController().signal, context)).kind).toBe(
        'ADAPTER_ERROR'
      );
      expect(execute).toHaveBeenCalledTimes(1);
      expect(f.billing.view().attempts).toBe(1);
    }
  );

  it('Codex can rotate at the query boundary without losing the current observation or assumptions', async () => {
    const f = await fixture();
    const cfg = { ...config(), threadRotation: true };
    const decide = vi
      .spyOn(CodexBattleSession.prototype, 'decide')
      .mockResolvedValueOnce({ text: query, usage })
      .mockResolvedValueOnce({ text: answer, usage });
    vi.spyOn(CodexBattleSession.prototype, 'close').mockResolvedValue();
    vi.spyOn(CodexBattleSession.prototype, 'createSuccessor').mockImplementation(async function (
      this: CodexBattleSession
    ) {
      await this.close();
      return new CodexBattleSession(cfg, 'codex:gpt-5.6-luna');
    });
    vi.spyOn(CodexBattleSession.prototype, 'contextStatus', 'get').mockImplementation(() => ({
      lastContextTokens: decide.mock.calls.length === 1 ? 200 : null,
      stopAtTokens: 200,
      modelContextWindow: 250,
      completedTurns: decide.mock.calls.length,
      automaticCompaction: false,
      compactions: 0,
    }));
    const client = new CodexAiBattleClient(
      cfg,
      'codex:gpt-5.6-luna',
      f.knowledge,
      f.traces,
      f.billing,
      undefined,
      vi.fn(async () => {})
    );
    const input = {
      ...f.input,
      history: {
        selection: 'LAST_12_PUBLIC_EVENTS' as const,
        throughPublicSeq: 0,
        omittedEventCount: 0,
        events: [],
      },
    };
    expect(await client.decide(input, new AbortController().signal, context)).toEqual({
      kind: 'RESPONSE',
      text: answer,
    });
    const second = decide.mock.calls[1]![0];
    expect(second).toContain('FROZEN_RULES');
    expect(second).toContain('本次决策；');
    expect(second).toContain(query);
    expect(second).toContain('"successProbability":1');
    expect(evidence(f.traces, 'THREAD_ROTATION')).toHaveLength(1);
    expect(f.billing.view().attempts).toBe(2);
    await client.dispose();
  });

  const apiConfig = () =>
    createAiModelConfig(
      { baseUrl: 'https://example.test/v1', apiKey: 'test-secret' },
      'qwen3.8-max'
    );
  const response = (text: string, status = 200) =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: text }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 75 },
        },
      }),
      { status }
    );
  it('API preserves the request prefix, sends the assistant query and results, and records both bills', async () => {
    const f = await fixture('qwen3.8-max');
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(query))
      .mockResolvedValueOnce(response(answer));
    const client = new DashScopeAiBattleClient(
      apiConfig(),
      f.knowledge,
      f.traces,
      fetcher,
      Date.now,
      f.billing
    );
    expect(await client.decide(f.input, new AbortController().signal, context)).toEqual({
      kind: 'RESPONSE',
      text: answer,
      truncated: false,
    });
    const first = JSON.parse(fetcher.mock.calls[0]![1]!.body as string) as {
      messages: { role: string; content: string }[];
    };
    const second = JSON.parse(fetcher.mock.calls[1]![1]!.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(second.messages.slice(0, -2)).toEqual(first.messages);
    expect(second.messages.at(-2)).toEqual({ role: 'assistant', content: query });
    expect(second.messages.at(-1)!.content).toContain('"successProbability":1');
    expect(f.billing.view()).toMatchObject({
      attempts: 2,
      reportedAttempts: 2,
      usage: { inputTokens: 50, implicitCachedTokens: 150 },
    });
    expect(evidence(f.traces, 'REQUEST').map((r) => r.queryRound)).toEqual([0, 1]);
  });

  it('API continuation failure cannot trigger a fresh query batch via retry', async () => {
    const f = await fixture('qwen3.8-max');
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(query))
      .mockResolvedValueOnce(response('', 503));
    const client = new DashScopeAiBattleClient(
      apiConfig(),
      f.knowledge,
      f.traces,
      fetcher,
      Date.now,
      f.billing
    );
    expect(await client.decide(f.input, new AbortController().signal, context)).toMatchObject({
      kind: 'SERVICE_ERROR',
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(f.billing.view().attempts).toBe(2);
  });

  it('queries leave a real session untouched; only the final selection uses the existing command chain', async () => {
    const f = await fixture();
    const game = createLiveSetFixture();
    const current = decision(game.session);
    const before = globalThis.structuredClone(game.session.state);
    const randomBefore = game.randomCalls();
    const ref = current.input.space.candidates.find((c) => c.liveBaseBudget)!.ref;
    const first = JSON.parse(query) as { selection: { scenarios: { cardRefs: string[] }[] } };
    first.selection.scenarios[0]!.cardRefs = [ref];
    const final = JSON.stringify({
      selection: { kind: 'CARDS', cardRefs: [ref] },
      tradeoff: '最终选择',
    });
    const execute = vi.fn<typeof executeCodexDecision>().mockImplementation(() => {
      expect(game.session.state).toEqual(before);
      expect(game.randomCalls()).toBe(randomBefore);
      return Promise.resolve({
        text: execute.mock.calls.length === 1 ? JSON.stringify(first) : final,
        usage,
      });
    });
    const client = new CodexAiBattleClient(
      config(),
      'codex:gpt-5.6-luna',
      { ...f.knowledge, ownDeck: game.ownDeck },
      f.traces,
      f.billing,
      execute,
      vi.fn(async () => {})
    );
    const outcome = await client.decide(current.input, new AbortController().signal, context);
    expect(outcome.kind).toBe('RESPONSE');
    if (outcome.kind !== 'RESPONSE') throw new Error('Expected final response');
    submit(game.session, current, parseAiBattleResponse(current, outcome.text).selection);
    expect(game.session.state!.currentSubPhase).not.toEqual(before!.currentSubPhase);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
