import { describe, expect, it } from 'vitest';
import { buildThemeDeckCandidateIds } from '../../src/server/services/theme-table-deck-choice';

const MATCHUPS = [
  { firstDeckVersionId: 'deck-a', secondDeckVersionId: 'deck-d' },
  { firstDeckVersionId: 'deck-a', secondDeckVersionId: 'deck-e' },
  { firstDeckVersionId: 'deck-a', secondDeckVersionId: 'deck-f' },
  { firstDeckVersionId: 'deck-b', secondDeckVersionId: 'deck-d' },
  { firstDeckVersionId: 'deck-b', secondDeckVersionId: 'deck-e' },
  { firstDeckVersionId: 'deck-b', secondDeckVersionId: 'deck-f' },
  { firstDeckVersionId: 'deck-c', secondDeckVersionId: 'deck-d' },
  { firstDeckVersionId: 'deck-c', secondDeckVersionId: 'deck-e' },
  { firstDeckVersionId: 'deck-c', secondDeckVersionId: 'deck-f' },
];

describe('buildThemeDeckCandidateIds', () => {
  it('keeps both candidate sets stable for the same matched reservation', () => {
    const first = buildThemeDeckCandidateIds('reservation-1', 3, MATCHUPS);
    const refreshed = buildThemeDeckCandidateIds('reservation-1', 3, MATCHUPS);

    expect(refreshed).toEqual(first);
    expect(first.first).toHaveLength(3);
    expect(first.second).toHaveLength(3);
  });

  it('returns one compatible deck per player when X is 1', () => {
    const choice = buildThemeDeckCandidateIds('reservation-2', 1, MATCHUPS);
    const pair = [choice.first[0], choice.second[0]].sort().join(':');
    const enabledPairs = MATCHUPS.map((matchup) =>
      [matchup.firstDeckVersionId, matchup.secondDeckVersionId].sort().join(':')
    );

    expect(choice.first).toHaveLength(1);
    expect(choice.second).toHaveLength(1);
    expect(enabledPairs).toContain(pair);
  });
});
