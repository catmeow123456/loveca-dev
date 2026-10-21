import { describe, expect, it } from 'vitest';
import { selectDifferentNamedCards } from '../../src/shared/utils/card-identity';

type Candidate = { name: string; key: string | number | null | undefined };

// Independent exhaustive oracle, deliberately limited to tiny graphs. Enumerate assignments
// in the public selector's preference order and keep the first largest valid assignment.
function exhaustiveAssignment(cards: readonly Candidate[], maxCount: number, excluded: string[]) {
  const assignments: { item: Candidate; name: string; normalizedName: string }[][] = [[]];
  const visit = (nextIndex: number, selected: (typeof assignments)[number]) => {
    if (selected.length === maxCount) return;
    for (let index = nextIndex; index < cards.length; index += 1) {
      const item = cards[index]!;
      if (
        item.key != null &&
        selected.some(
          ({ item: previous }) => previous.key != null && String(previous.key) === String(item.key)
        )
      )
        continue;
      for (const name of item.name.split('&')) {
        if (excluded.includes(name) || selected.some((match) => match.name === name)) continue;
        const next = [...selected, { item, name, normalizedName: name }];
        assignments.push(next);
        visit(index + 1, next);
      }
    }
  };
  visit(0, []);
  return assignments.reduce((best, assignment) =>
    assignment.length > best.length ? assignment : best
  );
}

describe('different-name maximum matching', () => {
  it('preserves the exact preferred assignment on all three-card graphs over three names', () => {
    const nameSets = ['A', 'B', 'C', 'A&B', 'A&C', 'B&C', 'A&B&C'];
    for (const first of nameSets)
      for (const second of nameSets)
        for (const third of nameSets) {
          for (const keys of [
            [null, null, null],
            [0, '0', 1],
            [undefined, 1, 1],
          ]) {
            const cards = [first, second, third].map((name, index) => ({ name, key: keys[index] }));
            for (const excluded of [[], ['A']])
              for (const maxCount of [0, 1, 2, 3]) {
                const expected = exhaustiveAssignment(cards, maxCount, excluded);
                expect(
                  selectDifferentNamedCards(cards, (card) => card, {
                    minCount: 0,
                    maxCount,
                    excludedNormalizedNames: excluded,
                    getSecondaryKey: (card) => card.key,
                  })
                ).toEqual(expected);
              }
          }
        }
  });

  it('can reassign a chain of combination cards to satisfy the final single-name card', () => {
    const cards = ['A&B', 'B&C', 'C&D', 'A'].map((name) => ({ name }));
    expect(selectDifferentNamedCards(cards, (card) => card).map((match) => match.name)).toEqual([
      'B',
      'C',
      'D',
      'A',
    ]);
  });

  it('retains minimum/maximum counts, missing-card filtering and default all-card requirements', () => {
    const cards = [{ name: 'A&B' }, null, { name: 'A' }, { name: 'B' }, { name: ' ' }];
    expect(selectDifferentNamedCards(cards, (card) => card)).toEqual([]);
    expect(selectDifferentNamedCards(cards, (card) => card, { minCount: 3 })).toEqual([]);
    expect(
      selectDifferentNamedCards(cards, (card) => card, { minCount: 2 }).map((m) => m.name)
    ).toEqual(['A', 'B']);
    expect(
      selectDifferentNamedCards(cards, (card) => card, { maxCount: 1 }).map((m) => m.name)
    ).toEqual(['A']);
  });
});
