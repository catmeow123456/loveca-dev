import { describe, expect, it } from 'vitest';
import { HeartPool } from '../../src/domain/value-objects/heart';
import { HeartColor as C } from '../../src/shared/types/enums';
import {
  calculateLiveProbability,
  type LiveProbabilityScenario,
  type ProbabilityHearts,
} from '../../src/server/ai-battle/live-probability';

const scenario = (patch: Partial<LiveProbabilityScenario> = {}): LiveProbabilityScenario => ({
  deck: [
    { count: 2, hearts: { PINK: 1 } },
    { count: 2, hearts: {} },
  ],
  refreshPool: [],
  preCheerDrawCount: 0,
  cheerCount: 1,
  stageHearts: {},
  requirements: { PINK: 1 },
  totalRequired: 1,
  ...patch,
});
const ready = (s: LiveProbabilityScenario) => {
  const result = calculateLiveProbability(s);
  expect(result.status).toBe('READY');
  if (result.status !== 'READY') throw new Error(result.reason);
  expect(
    result.successProbability +
      result.totalInsufficientProbability +
      result.colorInsufficientProbability
  ).toBeCloseTo(1, 12);
  return result;
};

function permutations<T>(items: readonly T[]): T[][] {
  if (!items.length) return [[]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  );
}

/** Independent ordered tiny-deck oracle: draws, then refresh, then existing HEART allocator. */
function brute(s: LiveProbabilityScenario) {
  const expand = (pool: LiveProbabilityScenario['deck']) =>
    pool.flatMap((g) => Array.from({ length: g.count }, () => g.hearts));
  const original = expand(s.deck);
  const prefix = [...(s.knownTop ?? [])];
  for (const card of prefix)
    original.splice(
      original.findIndex((c) => JSON.stringify(c) === JSON.stringify(card)),
      1
    );
  let success = 0,
    total = 0;
  for (const rest of permutations(original)) {
    const deck = [...prefix, ...rest];
    const refreshingBeforeDiscard = s.preCheerDrawCount >= deck.length;
    const pool = expand([
      ...s.refreshPool,
      ...(refreshingBeforeDiscard ? [] : (s.discardedBeforeCheer ?? [])),
    ]);
    for (const refresh of permutations(pool)) {
      const order = [...deck, ...refresh];
      const hearts = new Map(Object.entries(s.stageHearts) as [C, number][]);
      for (const card of order.slice(s.preCheerDrawCount, s.preCheerDrawCount + s.cheerCount))
        for (const [c, n] of Object.entries(card))
          hearts.set(c as C, (hearts.get(c as C) ?? 0) + n);
      if (
        new HeartPool(hearts).canSatisfy({
          colorRequirements: new Map(Object.entries(s.requirements) as [C, number][]),
          totalRequired: s.totalRequired,
        })
      )
        success++;
      total++;
    }
  }
  return success / total;
}

describe('conditional LIVE probability, no card effects', () => {
  it('uses without-replacement counts, not independent per-card hit rates', () => {
    expect(ready(scenario({ cheerCount: 2 })).successProbability).toBeCloseTo(5 / 6, 12);
  });
  it('does not spend the same ALL heart on two missing colors', () => {
    const s = scenario({
      deck: [{ count: 1, hearts: { RAINBOW: 1 } }],
      stageHearts: { GRAY: 1 },
      requirements: { PINK: 1, YELLOW: 1 },
      totalRequired: 2,
    });
    expect(ready(s)).toMatchObject({ successProbability: 0, colorInsufficientProbability: 1 });
  });
  it('keeps multiple HEART contributions on the same card correlated', () => {
    const s = scenario({
      deck: [
        { count: 1, hearts: { PINK: 1, YELLOW: 1 } },
        { count: 1, hearts: {} },
      ],
      requirements: { PINK: 1, YELLOW: 1 },
      totalRequired: 2,
    });
    expect(ready(s).successProbability).toBe(0.5);
  });
  it('consumes known top during cover draws rather than granting it to cheer', () => {
    const base = scenario({ knownTop: [{ PINK: 1 }] });
    expect(ready(base).successProbability).toBe(1);
    expect(ready({ ...base, preCheerDrawCount: 1 }).successProbability).toBeCloseTo(1 / 3, 12);
  });
  it.each([0, 1, 2, 3])(
    'matches a tiny-deck ordered oracle with %i pre-cheer draws',
    (preCheerDrawCount) => {
      const s = scenario({
        deck: [
          { count: 1, hearts: { PINK: 1 } },
          { count: 1, hearts: { RAINBOW: 1 } },
          { count: 1, hearts: {} },
        ],
        refreshPool: [
          { count: 1, hearts: { YELLOW: 1 } },
          { count: 1, hearts: {} },
        ],
        discardedBeforeCheer: [{ count: 1, hearts: { PINK: 1 } }],
        preCheerDrawCount,
        cheerCount: 2,
        requirements: { PINK: 1, YELLOW: 1 },
        totalRequired: 2,
      });
      expect(ready(s).successProbability).toBeCloseTo(brute(s), 12);
    }
  );
  it('excludes covered members from a refresh already triggered by replacement draws', () => {
    const s = scenario({
      deck: [{ count: 1, hearts: {} }],
      preCheerDrawCount: 1,
      refreshPool: [{ count: 1, hearts: {} }],
      discardedBeforeCheer: [{ count: 1, hearts: { PINK: 1 } }],
    });
    expect(ready(s).successProbability).toBe(0);
    expect(ready({ ...s, preCheerDrawCount: 0, cheerCount: 2 }).successProbability).toBe(0.5);
  });
  it('matches exhaustive correlated-color draws with a known prefix', () => {
    const cards: ProbabilityHearts[] = [
      { PINK: 1 },
      { GRAY: 1 },
      { PINK: 1, YELLOW: 1 },
      { RAINBOW: 1 },
      {},
    ];
    for (const preCheerDrawCount of [0, 1, 2])
      for (const cheerCount of [1, 2, 3]) {
        const s = scenario({
          deck: cards.map((hearts) => ({ count: 1, hearts })),
          knownTop: [cards[0]!],
          preCheerDrawCount,
          cheerCount,
          requirements: { PINK: 1, YELLOW: 1, RAINBOW: 1 },
          totalRequired: 3,
        });
        expect(ready(s).successProbability).toBeCloseTo(brute(s), 12);
      }
  });
  it('returns unavailable rather than partial probabilities or a forced game decision', () => {
    expect(calculateLiveProbability(scenario(), { remainingTransitions: 0 })).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'COMPUTATION_LIMIT',
    });
    expect(calculateLiveProbability(scenario({ knownTop: [{ BLUE: 1 }] }))).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'KNOWN_PREFIX_NOT_IN_POOL',
    });
    expect(calculateLiveProbability(scenario({ cheerCount: 5 }))).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_CARDS_WITH_ONE_REFRESH',
    });
    expect(calculateLiveProbability(scenario({ preCheerDrawCount: -1 }))).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'INVALID_NUMERIC_INPUT',
    });
  });
  it('reproduces the audited T4 uniform-reference calculations, without claiming real deck order', () => {
    const deck = Object.entries({ PINK: 9, YELLOW: 9, BLUE: 3, GREEN: 3, RAINBOW: 2 }).map(
      ([c, count]) => ({ count, hearts: { [c]: 1 } })
    );
    deck.push({ count: 7, hearts: {} });
    const base = scenario({
      deck,
      preCheerDrawCount: 3,
      cheerCount: 11,
      stageHearts: { PINK: 3, RED: 2, YELLOW: 1, BLUE: 1, PURPLE: 3 },
    });
    const cases = [
      [{ PINK: 5, RAINBOW: 7 }, 12, 0.9596017851289409],
      [{ PINK: 5, YELLOW: 1, RAINBOW: 9 }, 15, 0.9595574524565674],
      [{ PINK: 5, YELLOW: 2, RAINBOW: 11 }, 18, 0.8273107294574383],
    ] as const;
    for (const [requirements, totalRequired, expected] of cases)
      expect(ready({ ...base, requirements, totalRequired }).successProbability).toBeCloseTo(
        expected,
        12
      );
  });
});
