import { createHash } from 'node:crypto';

export interface ThemeDeckChoiceMatchup {
  readonly firstDeckVersionId: string;
  readonly secondDeckVersionId: string;
}

export interface ThemeDeckCandidateIds {
  readonly first: readonly string[];
  readonly second: readonly string[];
}

export function buildThemeDeckCandidateIds(
  reservationId: string,
  requestedCount: number,
  matchups: readonly ThemeDeckChoiceMatchup[]
): ThemeDeckCandidateIds {
  const target = Math.max(1, requestedCount);
  const pairs = uniqueMatchups(matchups);
  if (pairs.length === 0) return { first: [], second: [] };

  const compatible = new Set(
    pairs.map((pair) => matchupKey(pair.firstDeckVersionId, pair.secondDeckVersionId))
  );
  const deckIds = [
    ...new Set(pairs.flatMap((pair) => [pair.firstDeckVersionId, pair.secondDeckVersionId])),
  ];
  const firstOrder = stableOrder(deckIds, `${reservationId}:FIRST`);
  const secondOrder = stableOrder(deckIds, `${reservationId}:SECOND`);
  const anchors = stableOrder(
    pairs.flatMap((pair) => [
      [pair.firstDeckVersionId, pair.secondDeckVersionId] as const,
      [pair.secondDeckVersionId, pair.firstDeckVersionId] as const,
    ]),
    `${reservationId}:ANCHOR`
  );

  let best: ThemeDeckCandidateIds = { first: [], second: [] };
  for (const [firstAnchor, secondAnchor] of anchors) {
    const first = [firstAnchor];
    const second = [secondAnchor];
    let changed = true;
    while (changed && (first.length < target || second.length < target)) {
      changed = false;
      const nextFirst = firstOrder.find(
        (deckId) =>
          !first.includes(deckId) &&
          second.every((opponentDeckId) => compatible.has(matchupKey(deckId, opponentDeckId)))
      );
      if (nextFirst && first.length < target) {
        first.push(nextFirst);
        changed = true;
      }
      const nextSecond = secondOrder.find(
        (deckId) =>
          !second.includes(deckId) &&
          first.every((opponentDeckId) => compatible.has(matchupKey(deckId, opponentDeckId)))
      );
      if (nextSecond && second.length < target) {
        second.push(nextSecond);
        changed = true;
      }
    }
    const candidate = { first, second };
    if (candidateScore(candidate) > candidateScore(best)) best = candidate;
    if (first.length === target && second.length === target) break;
  }
  return best;
}

function uniqueMatchups(matchups: readonly ThemeDeckChoiceMatchup[]) {
  const seen = new Set<string>();
  return matchups.filter((pair) => {
    const key = matchupKey(pair.firstDeckVersionId, pair.secondDeckVersionId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableOrder<T>(values: readonly T[], seed: string): T[] {
  return [...values].sort((left, right) =>
    stableHash(`${seed}:${JSON.stringify(left)}`).localeCompare(
      stableHash(`${seed}:${JSON.stringify(right)}`)
    )
  );
}

function matchupKey(firstDeckId: string, secondDeckId: string): string {
  return firstDeckId < secondDeckId
    ? `${firstDeckId}:${secondDeckId}`
    : `${secondDeckId}:${firstDeckId}`;
}

function candidateScore(candidate: ThemeDeckCandidateIds): number {
  return (
    Math.min(candidate.first.length, candidate.second.length) * 10_000 +
    candidate.first.length +
    candidate.second.length
  );
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
