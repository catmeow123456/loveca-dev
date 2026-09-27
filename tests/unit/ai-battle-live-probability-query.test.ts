import { describe, expect, it, vi } from 'vitest';
import { createProbabilityFixture } from '../helpers/ai-live-probability-fixture';
import { parseAiBattleResponse } from '../../src/server/ai-battle/protocol';
import type { AiModelOutcome } from '../../src/server/ai-battle/runtime';
import {
  withLiveProbabilityQuery,
  type LiveProbabilityExchange,
} from '../../src/server/ai-battle/live-probability-query';

const scenario = (id = 'base') => ({
  id,
  cardRefs: ['c1'],
  additionalHearts: [] as { color: string; count: number }[],
  additionalCheer: 0,
  assumptionNote: '',
});
const query = (scenarios = [scenario()]): AiModelOutcome => ({
  kind: 'RESPONSE',
  text: JSON.stringify({
    selection: { kind: 'LIVE_PROBABILITY_QUERY', scenarios },
    tradeoff: '比较条件',
  }),
});
const answer: AiModelOutcome = {
  kind: 'RESPONSE',
  text: JSON.stringify({ selection: { kind: 'CARDS', cardRefs: ['c1'] }, tradeoff: '最终选择' }),
};
function fixture() {
  const { input, ownDeck } = createProbabilityFixture();
  const knowledge = { rules: ownDeck, tutorial: ownDeck, handbook: ownDeck, ownDeck };
  const controller = new AbortController();
  const capture = vi.fn<(stage: string, payload: Record<string, unknown>) => void>();
  const request = vi
    .fn<(exchange?: LiveProbabilityExchange) => Promise<AiModelOutcome>>()
    .mockResolvedValueOnce(query())
    .mockResolvedValueOnce(answer);
  return {
    input,
    knowledge,
    controller,
    capture,
    request,
    run: () => withLiveProbabilityQuery(input, knowledge, controller.signal, request, capture),
  };
}

describe('bounded read-only LIVE probability query', () => {
  it('compares chosen colors and additional cheers in one batch without modifying the observation', async () => {
    const f = fixture();
    const before = globalThis.structuredClone(f.input);
    f.request
      .mockReset()
      .mockResolvedValueOnce(
        query([
          scenario(),
          { ...scenario('pink'), additionalHearts: [{ color: 'PINK', count: 1 }] },
          { ...scenario('blue'), additionalHearts: [{ color: 'BLUE', count: 1 }] },
          { ...scenario('cheer'), additionalCheer: 1 },
          { ...scenario('all'), additionalHearts: [{ color: 'RAINBOW', count: 1 }] },
        ])
      )
      .mockResolvedValueOnce(answer);
    expect(await f.run()).toEqual(answer);
    expect(f.request).toHaveBeenCalledTimes(2);
    const result = JSON.parse(f.request.mock.calls[1]![0]!.resultText) as {
      assumptionsVerified: boolean;
      scenarios: {
        result: {
          status: string;
          successProbability: number;
          assumptions: { additionalHearts: Record<string, number> };
        };
      }[];
    };
    const probabilities = result.scenarios.map(
      (s: { result: { successProbability: number } }) => s.result.successProbability
    );
    expect(probabilities).toEqual([0.8, 1, 0.8, 0.95, 1]);
    expect(result.assumptionsVerified).toBe(false);
    expect(result.scenarios[1].result.assumptions.additionalHearts).toEqual({ PINK: 1 });
    expect(f.input).toEqual(before);
    expect(f.capture.mock.calls.map(([stage]) => stage)).toEqual([
      'LIVE_PROBABILITY_QUERY',
      'LIVE_PROBABILITY_RESULT',
    ]);
  });

  it('keeps an invalid reference separate from valid scenarios and preserves the final authority check', async () => {
    const f = fixture();
    f.request
      .mockReset()
      .mockResolvedValueOnce(query([{ ...scenario('stale'), cardRefs: ['old-ref'] }, scenario()]))
      .mockResolvedValueOnce({
        kind: 'RESPONSE',
        text: JSON.stringify({ selection: { kind: 'CARDS', cardRefs: ['old-ref'] } }),
      });
    const outcome = await f.run();
    const result = JSON.parse(f.request.mock.calls[1]![0]!.resultText) as {
      assumptionsVerified: boolean;
      scenarios: {
        result: {
          status: string;
          successProbability: number;
          assumptions: { additionalHearts: Record<string, number> };
        };
      }[];
    };
    expect(result.scenarios[0].result).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'INVALID_FINAL_SET',
    });
    expect(result.scenarios[1].result.status).toBe('READY');
    expect(outcome.kind).toBe('RESPONSE');
    if (outcome.kind === 'RESPONSE')
      expect(() => parseAiBattleResponse({ input: f.input }, outcome.text)).toThrow();
  });

  it.each([
    [Array.from({ length: 9 }, (_, i) => scenario(`s${i}`)), 'INVALID_QUERY_SHAPE'],
    [[{ ...scenario(), additionalCheer: -1 }], 'INVALID_QUERY_SHAPE'],
    [[{ ...scenario(), additionalCheer: 1.5 }], 'INVALID_QUERY_SHAPE'],
    [[{ ...scenario(), additionalHearts: [{ color: 'PINK', count: -1 }] }], 'INVALID_QUERY_SHAPE'],
    [[{ ...scenario(), additionalHearts: [{ color: 'PINK', count: 121 }] }], 'INVALID_QUERY_SHAPE'],
    [
      [{ ...scenario(), additionalHearts: [{ color: 'UNKNOWN', count: 1 }] }],
      'INVALID_QUERY_SHAPE',
    ],
    [
      [
        {
          ...scenario(),
          additionalHearts: [
            { color: 'PINK', count: 1 },
            { color: 'PINK', count: 1 },
          ],
        },
      ],
      'DUPLICATE_ID_OR_COLOR',
    ],
    [[scenario(), scenario()], 'DUPLICATE_ID_OR_COLOR'],
  ])(
    'rejects invalid numeric/shape input %# and allows only a final answer',
    async (scenarios, reason) => {
      const f = fixture();
      f.request
        .mockReset()
        .mockResolvedValueOnce(query(scenarios as ReturnType<typeof scenario>[]))
        .mockResolvedValueOnce(answer);
      expect(await f.run()).toEqual(answer);
      expect(JSON.parse(f.request.mock.calls[1]![0]!.resultText)).toEqual({
        status: 'INVALID_QUERY',
        reason,
      });
      expect(f.request).toHaveBeenCalledTimes(2);
    }
  );

  it('never opens another model turn for direct answers, truncated queries or another phase', async () => {
    for (const mode of ['direct', 'truncated', 'main']) {
      const f = fixture();
      const first =
        mode === 'direct'
          ? answer
          : { ...query(), ...(mode === 'truncated' ? { truncated: true } : {}) };
      f.request.mockReset().mockResolvedValue(first);
      if (mode === 'main') Object.assign(f.input, { purpose: 'MAIN' });
      const result = await f.run();
      expect(f.request).toHaveBeenCalledTimes(1);
      if (mode === 'main') expect(result).toEqual({ kind: 'RESPONSE', text: '' });
      else expect(result).toEqual(first);
    }
  });

  it('blocks a second query and cannot interpret it as an action', async () => {
    const f = fixture();
    f.request.mockReset().mockResolvedValue(query());
    expect(await f.run()).toEqual({ kind: 'RESPONSE', text: '' });
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.capture).toHaveBeenLastCalledWith('LIVE_PROBABILITY_REJECTED', {
      reason: 'QUERY_ALREADY_USED',
    });
  });

  it.each(['before-result', 'after-result', 'late-final'])(
    'honors cancellation %s',
    async (when) => {
      const f = fixture();
      f.request
        .mockReset()
        .mockImplementationOnce(() => {
          if (when === 'before-result') f.controller.abort();
          return Promise.resolve(query());
        })
        .mockImplementationOnce(() => {
          f.controller.abort();
          return Promise.resolve(answer);
        });
      if (when === 'after-result') f.capture.mockImplementation(() => f.controller.abort());
      expect(await f.run()).toMatchObject({ kind: 'SERVICE_ERROR', retryable: false });
      expect(f.request).toHaveBeenCalledTimes(when === 'late-final' ? 2 : 1);
    }
  );

  it('does not restart a completed query batch after a transient continuation failure', async () => {
    const f = fixture();
    f.request
      .mockReset()
      .mockResolvedValueOnce(query())
      .mockResolvedValueOnce({ kind: 'SERVICE_ERROR', retryable: true, message: 'HTTP 503' });
    expect(await f.run()).toMatchObject({ kind: 'SERVICE_ERROR', retryable: false });
  });
});
