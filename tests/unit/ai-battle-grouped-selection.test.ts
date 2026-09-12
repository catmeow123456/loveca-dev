import { describe, expect, it } from 'vitest';
import {
  findAiCardSelection,
  validateSelection,
  responseSchema,
  type AiDecisionSpace,
} from '../../src/server/ai-battle/protocol';
import { isActiveEffectSelectionValid } from '../../src/application/card-effects/runtime/selection-query';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import type { AiDecision } from '../../src/server/ai-battle/decision';

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

  it('fails closed on infeasible overlapping groups instead of enumerating exponentially', () => {
    const pool = (prefix: string, size: number) =>
      Array.from({ length: size }, (_, i) => `${prefix}${i}`);
    const cardsSpace = (
      refs: string[],
      min: number,
      max: number,
      groups: { cardRefs: string[]; min: number; max: number }[]
    ): Extract<AiDecisionSpace, { kind: 'CARDS' }> => ({
      kind: 'CARDS',
      candidates: refs.map((ref) => ({ ref, description: ref })),
      min,
      max,
      ordered: false,
      groups,
    });
    // Small interaction-infeasible window: each disjoint pool demands 4 picks while the
    // overall limit allows 6, so no completion exists; the search must finish and report it.
    const poolA = pool('a', 6);
    const poolB = pool('b', 6);
    const small = cardsSpace([...poolA, ...poolB], 6, 6, [
      { cardRefs: poolA, min: 4, max: 4 },
      { cardRefs: poolB, min: 4, max: 4 },
    ]);
    expect(() => findAiCardSelection(small)).toThrow('No complete legal card selection');
    // A group whose own membership cannot reach its minimum fails through the cheap precheck.
    expect(() =>
      findAiCardSelection(cardsSpace(['x', 'y'], 1, 2, [{ cardRefs: ['x'], min: 2, max: 2 }]))
    ).toThrow('No complete legal card selection');
    // Scaled-up infeasible interaction: the node budget must cut the search off quickly.
    const bigA = pool('a', 16);
    const bigB = pool('b', 16);
    const big = cardsSpace([...bigA, ...bigB], 16, 16, [
      { cardRefs: bigA, min: 9, max: 9 },
      { cardRefs: bigB, min: 9, max: 9 },
    ]);
    expect(() => findAiCardSelection(big)).toThrow('node budget');
  });

  it('verifies mechanical EFFECT shortcuts against grouped constraints', () => {
    const effect = (
      space: AiDecisionSpace
    ): AiDecision =>
      ({
        input: { purpose: 'EFFECT', space },
        toCommand: () => {
          throw new Error('not used');
        },
      }) as AiDecision;
    const candidates = ['a', 'b', 'c'].map((ref) => ({ ref, description: ref }));
    // min === max === all candidates, but the group caps the selection below the full set.
    expect(
      getAiMechanicalSelection(
        effect({
          kind: 'CARDS',
          candidates,
          min: 3,
          max: 3,
          ordered: false,
          groups: [{ cardRefs: ['a', 'b', 'c'], min: 0, max: 2 }],
        })
      )
    ).toBeNull();
    // Empty-candidate shortcut must respect a group that demands at least one pick.
    expect(
      getAiMechanicalSelection(
        effect({
          kind: 'CARDS',
          candidates: [],
          min: 0,
          max: 0,
          ordered: false,
          groups: [{ cardRefs: [], min: 1, max: 1 }],
        })
      )
    ).toBeNull();
    // Without conflicting groups both shortcuts still apply.
    expect(
      getAiMechanicalSelection(
        effect({ kind: 'CARDS', candidates, min: 3, max: 3, ordered: false })
      )
    ).toEqual({ kind: 'CARDS', cardRefs: ['a', 'b', 'c'] });
    expect(
      getAiMechanicalSelection(
        effect({ kind: 'CARDS', candidates: [], min: 0, max: 0, ordered: false })
      )
    ).toEqual({ kind: 'CARDS', cardRefs: [] });
  });
});
