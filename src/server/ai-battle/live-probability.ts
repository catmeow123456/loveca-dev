import { HeartPool } from '../../domain/value-objects/heart.js';
import { HeartColor } from '../../shared/types/enums.js';

export type ProbabilityHearts = Partial<Record<HeartColor, number>>;
export interface CheerGroup {
  readonly count: number;
  /** All printed HEART contributions on one card, kept together. DRAW is not another cheer. */
  readonly hearts: ProbabilityHearts;
}

export interface LiveProbabilityScenario {
  readonly deck: readonly CheerGroup[];
  readonly refreshPool: readonly CheerGroup[];
  /** Selected member covers enter the waiting room after replacement draws. */
  readonly discardedBeforeCheer?: readonly CheerGroup[];
  /** A caller may supply only a legally observed, still valid prefix. Included in deck counts. */
  readonly knownTop?: readonly ProbabilityHearts[];
  readonly preCheerDrawCount: number;
  readonly cheerCount: number;
  readonly stageHearts: ProbabilityHearts;
  readonly requirements: ProbabilityHearts;
  readonly totalRequired: number;
}

export type ProbabilityBudget = { remainingTransitions: number };
export type LiveProbabilityResult =
  | { status: 'UNAVAILABLE'; reason: string }
  | {
      status: 'READY';
      successProbability: number;
      /** Exclusive buckets: total shortage first, then color shortage with sufficient total. */
      totalInsufficientProbability: number;
      colorInsufficientProbability: number;
      refreshUsed: boolean;
    };

const colors = Object.values(HeartColor);
const countCards = (groups: readonly CheerGroup[]) => groups.reduce((n, g) => n + g.count, 0);
const totalHearts = (hearts: ProbabilityHearts) => Object.values(hearts).reduce((a, b) => a + b, 0);
const validCount = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 120;
const validHearts = (h: ProbabilityHearts) =>
  Object.entries(h).every(([c, n]) => colors.includes(c as HeartColor) && validCount(n));
export const cheerSignature = (hearts: ProbabilityHearts) =>
  colors.map((c) => hearts[c] ?? 0).join(',');

function choose(n: number, k: number): bigint {
  let value = 1n;
  for (let i = 1; i <= Math.min(k, n - k); i++) value = (value * BigInt(n - i + 1)) / BigInt(i);
  return value;
}

/**
 * Pure conditional probability. No game/registry, random generator, card-effect interpreter,
 * hidden order or mutations. Unspecified order is uniformly random within each pool.
 * Marginalizing pre-cheer draws is valid for those random pools, not arbitrary real deck order.
 */
export function calculateLiveProbability(
  scenario: LiveProbabilityScenario,
  budget: ProbabilityBudget = { remainingTransitions: 150_000 }
): LiveProbabilityResult {
  const unavailable = (reason: string): LiveProbabilityResult => ({
    status: 'UNAVAILABLE',
    reason,
  });
  const pools = [scenario.deck, scenario.refreshPool, scenario.discardedBeforeCheer ?? []];
  if (
    ![scenario.preCheerDrawCount, scenario.cheerCount, scenario.totalRequired].every(validCount) ||
    !validHearts(scenario.stageHearts) ||
    !validHearts(scenario.requirements) ||
    totalHearts(scenario.requirements) > scenario.totalRequired ||
    pools.some(
      (pool) =>
        countCards(pool) > 120 || pool.some((g) => !validCount(g.count) || !validHearts(g.hearts))
    ) ||
    (scenario.knownTop ?? []).some((h) => !validHearts(h))
  )
    return unavailable('INVALID_NUMERIC_INPUT');

  const remaining = scenario.deck.map((g) => ({ count: g.count, hearts: g.hearts }));
  const prefix = scenario.knownTop ?? [];
  // Remove the known prefix by contribution, never by hidden card identity.
  for (const hearts of prefix) {
    const group = remaining.find(
      (g) => g.count > 0 && cheerSignature(g.hearts) === cheerSignature(hearts)
    );
    if (!group) return unavailable('KNOWN_PREFIX_NOT_IN_POOL');
    group.count--;
  }

  const deckCount = countCards(scenario.deck);
  const preDraw = scenario.preCheerDrawCount;
  const fixedHearts = { ...scenario.stageHearts };
  const samples: { groups: readonly CheerGroup[]; take: number }[] = [];
  const knownCheers = prefix.slice(preDraw, preDraw + scenario.cheerCount);
  for (const hearts of knownCheers)
    for (const color of colors)
      fixedHearts[color] = (fixedHearts[color] ?? 0) + (hearts[color] ?? 0);

  const oldCheers = Math.min(scenario.cheerCount, Math.max(0, deckCount - preDraw));
  samples.push({ groups: remaining, take: oldCheers - knownCheers.length });
  const newCheers = scenario.cheerCount - oldCheers;
  // Refresh is immediate on exhaustion, including the final pre-cheer draw. Covers have
  // not been revealed/discarded at that point, so they cannot be part of that refresh pool.
  const refreshBeforeDiscard = preDraw >= deckCount;
  const refreshPool = refreshBeforeDiscard
    ? scenario.refreshPool
    : [...scenario.refreshPool, ...(scenario.discardedBeforeCheer ?? [])];
  const refreshedPreDraws = Math.max(0, preDraw - deckCount);
  if (refreshedPreDraws + newCheers > countCards(refreshPool))
    return unavailable('INSUFFICIENT_CARDS_WITH_ONE_REFRESH');
  samples.push({ groups: refreshPool, take: newCheers });

  const specific = colors.filter(
    (c) => c !== HeartColor.RAINBOW && c !== HeartColor.GRAY && (scenario.requirements[c] ?? 0) > 0
  );
  const caps = [
    scenario.totalRequired,
    ...specific.map((c) => scenario.requirements[c]!),
    specific.reduce((n, c) => n + scenario.requirements[c]!, 0),
  ];
  const vector = (hearts: ProbabilityHearts) => [
    totalHearts(hearts),
    ...specific.map((c) => hearts[c] ?? 0),
    hearts[HeartColor.RAINBOW] ?? 0,
  ];
  const add = (a: number[], b: number[], copies: number) =>
    a.map((n, i) => Math.min(caps[i]!, n + b[i]! * copies));
  type State = { values: number[]; weight: bigint; drawn: number };
  let states = new Map<string, State>();
  const initial = vector(fixedHearts).map((n, i) => Math.min(n, caps[i]!));
  states.set(initial.join(','), { values: initial, weight: 1n, drawn: 0 });
  let denominator = 1n;

  for (const { groups, take } of samples) {
    if (take < 0 || take > countCards(groups)) return unavailable('INVALID_DRAW_COUNT');
    if (!take) continue;
    // Group cards with identical relevant contributions before the hypergeometric DP.
    const grouped = new Map<string, { count: number; values: number[] }>();
    for (const group of groups) {
      if (!group.count) continue;
      const values = vector(group.hearts).map((n, i) => Math.min(n, caps[i]!));
      const key = values.join(',');
      const entry = grouped.get(key) ?? { count: 0, values };
      entry.count += group.count;
      grouped.set(key, entry);
    }
    for (const state of states.values()) state.drawn = 0;
    let cardsLeft = countCards(groups);
    for (const group of grouped.values()) {
      cardsLeft -= group.count;
      const next = new Map<string, State>();
      const weights = Array.from({ length: Math.min(take, group.count) + 1 }, (_, n) =>
        choose(group.count, n)
      );
      for (const state of states.values()) {
        for (
          let n = Math.max(0, take - state.drawn - cardsLeft);
          n <= Math.min(group.count, take - state.drawn);
          n++
        ) {
          if (--budget.remainingTransitions < 0) return unavailable('COMPUTATION_LIMIT');
          const values = add(state.values, group.values, n);
          const drawn = state.drawn + n;
          const key = `${drawn}:${values.join(',')}`;
          const weight = state.weight * weights[n]!;
          const existing = next.get(key);
          if (existing) existing.weight += weight;
          else next.set(key, { values, weight, drawn });
        }
      }
      states = next;
    }
    denominator *= choose(countCards(groups), take);
  }

  let success = 0n;
  let totalFailure = 0n;
  let colorFailure = 0n;
  const requirements = {
    colorRequirements: new Map(Object.entries(scenario.requirements) as [HeartColor, number][]),
    totalRequired: scenario.totalRequired,
  };
  for (const state of states.values()) {
    if (state.values[0]! < scenario.totalRequired) {
      totalFailure += state.weight;
      continue;
    }
    // Reuse the authority's pure HEART allocator. Reconstruct irrelevant colors as GRAY;
    // they can satisfy only total demand. Capped surplus is immaterial to this judgment.
    const hearts = new Map<HeartColor, number>();
    specific.forEach((c, i) => hearts.set(c, state.values[i + 1]!));
    hearts.set(HeartColor.RAINBOW, state.values.at(-1)!);
    const tracked = [...hearts.values()].reduce((a, b) => a + b, 0);
    hearts.set(HeartColor.GRAY, Math.max(0, state.values[0]! - tracked));
    if (new HeartPool(hearts).canSatisfy(requirements)) success += state.weight;
    else colorFailure += state.weight;
  }
  if (success + totalFailure + colorFailure !== denominator)
    return unavailable('COUNTING_INVARIANT');
  return {
    status: 'READY',
    successProbability: Number(success) / Number(denominator),
    totalInsufficientProbability: Number(totalFailure) / Number(denominator),
    colorInsufficientProbability: Number(colorFailure) / Number(denominator),
    refreshUsed: preDraw + scenario.cheerCount >= deckCount,
  };
}
