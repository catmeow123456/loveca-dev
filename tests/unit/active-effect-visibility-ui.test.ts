import { describe, expect, it } from 'vitest';
import { getActiveEffectVisibilityLabel } from '../../client/src/lib/activeEffectVisibilityUi';

describe('active effect card visibility summary', () => {
  it('omits empty counts and describes a private inspection', () => {
    expect(getActiveEffectVisibilityLabel(null, {})).toBeNull();
    expect(
      getActiveEffectVisibilityLabel({ inspectionObjectIds: [], revealedObjectIds: [] }, {})
    ).toBeNull();
    expect(getActiveEffectVisibilityLabel({ inspectionObjectIds: ['a', 'b'] }, {})).toBe(
      '检视 2 张'
    );
  });

  it('describes the same public cards consistently regardless of inspection bookkeeping', () => {
    expect(getActiveEffectVisibilityLabel({ revealedObjectIds: ['a', 'b'] }, {})).toBe('公开 2 张');
    expect(
      getActiveEffectVisibilityLabel(
        {
          inspectionObjectIds: ['b', 'a'],
          revealedObjectIds: ['a', 'b'],
        },
        {}
      )
    ).toBe('公开 2 张');
  });

  it('separates private and public cards without counting their overlap twice', () => {
    expect(
      getActiveEffectVisibilityLabel(
        {
          inspectionObjectIds: ['a', 'b', 'c'],
          revealedObjectIds: ['a'],
        },
        {}
      )
    ).toBe('未公开 2 张 · 公开 1 张');
    expect(
      getActiveEffectVisibilityLabel(
        {
          inspectionObjectIds: ['a', 'b'],
          revealedObjectIds: ['x', 'y'],
        },
        {}
      )
    ).toBe('未公开 2 张 · 公开 2 张');
    expect(
      getActiveEffectVisibilityLabel(
        {
          inspectionObjectIds: ['a', 'b', 'c'],
          revealedObjectIds: ['a', 'x'],
        },
        {}
      )
    ).toBe('未公开 2 张 · 公开 2 张');
  });

  it('includes other public cards and respects the projected visibility of inspected cards', () => {
    expect(
      getActiveEffectVisibilityLabel(
        {
          inspectionObjectIds: ['a'],
          revealedObjectIds: ['a', 'x'],
        },
        {}
      )
    ).toBe('公开 2 张');
    expect(
      getActiveEffectVisibilityLabel(
        { inspectionObjectIds: ['a', 'b', 'c'] },
        {
          a: { publiclyRevealed: true },
          b: { publiclyRevealed: true },
          c: { publiclyRevealed: false },
        }
      )
    ).toBe('未公开 1 张 · 公开 2 张');
  });
});
