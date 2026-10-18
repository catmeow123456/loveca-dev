import { describe, expect, it } from 'vitest';
import { hasDistinctGroupedCardAssignment } from '../../src/application/card-effects/runtime/grouped-selection';

describe('distinct grouped card selection', () => {
  it('assigns overlapping cards to one slot each and backtracks instead of counting every match', () => {
    const groups = [
      { candidateCardIds: ['both', 'score'], minCount: 0, maxCount: 1 },
      { candidateCardIds: ['both'], minCount: 0, maxCount: 1 },
    ];
    expect(hasDistinctGroupedCardAssignment(['both', 'score'], groups)).toBe(true);
    expect(hasDistinctGroupedCardAssignment(['both'], groups)).toBe(true);
    expect(hasDistinctGroupedCardAssignment([], groups)).toBe(true);
    expect(hasDistinctGroupedCardAssignment(['score', 'score'], groups)).toBe(false);
    expect(hasDistinctGroupedCardAssignment(['outside'], groups)).toBe(false);
  });

  it('keeps required slots distinct and supports feasibility with extra unused candidates', () => {
    const groups = [
      { candidateCardIds: ['both', 'a', 'extra'], minCount: 1, maxCount: 1 },
      { candidateCardIds: ['both'], minCount: 1, maxCount: 1 },
    ];
    expect(hasDistinctGroupedCardAssignment(['both'], groups)).toBe(false);
    expect(hasDistinctGroupedCardAssignment(['both', 'a'], groups)).toBe(true);
    expect(hasDistinctGroupedCardAssignment(['both', 'a', 'extra'], groups)).toBe(false);
    expect(
      hasDistinctGroupedCardAssignment(['both', 'a', 'extra'], groups, { allowUnusedCards: true })
    ).toBe(true);
    expect(
      hasDistinctGroupedCardAssignment(['a', 'extra'], groups, { allowUnusedCards: true })
    ).toBe(false);
  });

  it('treats repeated same-name groups as separate instance quotas and rejects invalid capacities', () => {
    const groups = Array.from({ length: 2 }, () => ({
      candidateCardIds: ['a', 'b', 'c'],
      minCount: 0,
      maxCount: 1,
    }));
    expect(hasDistinctGroupedCardAssignment(['a', 'b'], groups)).toBe(true);
    expect(hasDistinctGroupedCardAssignment(['a', 'b', 'c'], groups)).toBe(false);
    expect(
      hasDistinctGroupedCardAssignment([], [{ candidateCardIds: [], minCount: -1, maxCount: 1 }])
    ).toBe(false);
  });
});
