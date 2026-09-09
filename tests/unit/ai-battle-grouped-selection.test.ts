import { describe, expect, it } from 'vitest';
import {
  findAiCardSelection,
  validateSelection,
  responseSchema,
  type AiDecisionSpace,
} from '../../src/server/ai-battle/protocol';
import { isActiveEffectSelectionValid } from '../../src/application/card-effects/runtime/selection-query';

function space(): Extract<AiDecisionSpace, { kind: 'CARDS' }> {
  return {
    kind: 'CARDS',
    candidates: ['a', 'b', 'c', 'd'].map((ref) => ({ ref, description: ref })),
    min: 2,
    max: 2,
    ordered: false,
    canSkip: false,
    groups: [
      { cardRefs: ['a', 'b', 'c'], min: 1, max: 1 },
      { cardRefs: ['c', 'd'], min: 1, max: 1 },
    ],
  };
}

describe('AI grouped subset constraints', () => {
  it('enumerates the full legal subsets including overlapping membership consistently with authority', () => {
    const input = space();
    const legal: string[][] = [];
    for (let mask = 0; mask < 16; mask++) {
      const refs = input.candidates
        .filter((_, index) => (mask & (1 << index)) !== 0)
        .map((c) => c.ref);
      let accepted = true;
      try {
        validateSelection(input, { kind: 'CARDS', cardRefs: refs });
      } catch {
        accepted = false;
      }
      const authoritative = isActiveEffectSelectionValid(
        {
          kind: 'CARDS',
          mode: 'ORDERED_MULTI',
          cardIds: input.candidates.map((c) => c.ref),
          min: 2,
          max: 2,
          canSkip: false,
          groups: input.groups!.map((group) => ({
            cardIds: group.cardRefs,
            min: group.min,
            max: group.max,
          })),
        },
        { selectedCardIds: refs }
      );
      expect(accepted).toBe(authoritative);
      if (accepted) legal.push(refs);
    }
    expect(legal).toEqual([
      ['a', 'd'],
      ['b', 'd'],
    ]);
    expect(findAiCardSelection(input)).toEqual({ kind: 'CARDS', cardRefs: ['a', 'd'] });
    expect(findAiCardSelection({ ...input, min: 1, max: 1 })).toEqual({
      kind: 'CARDS',
      cardRefs: ['c'],
    });
  });

  it('allows explicit decline, rejects duplicates and extra fields, and reports impossible required subsets', () => {
    const input = space();
    expect(findAiCardSelection({ ...input, canSkip: true })).toEqual({
      kind: 'CARDS',
      cardRefs: [],
    });
    expect(() =>
      validateSelection({ ...input, canSkip: true }, { kind: 'CARDS', cardRefs: [] })
    ).not.toThrow();
    for (const selection of [
      { kind: 'CARDS', cardRefs: ['a', 'a'] },
      { kind: 'CARDS', cardRefs: ['a', 'unknown'] },
      { kind: 'CARDS', cardRefs: ['a', 'd'], selectedCardIds: ['private'] },
    ])
      expect(() => validateSelection(input, selection)).toThrow();
    expect(() =>
      findAiCardSelection({ ...input, candidates: input.candidates.slice(0, 2) })
    ).toThrow('No complete');
    expect(JSON.stringify(responseSchema(input))).toContain('minContains');
  });
});
