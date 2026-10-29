import { describe, expect, it } from 'vitest';
import type { ActiveEffectViewState } from '@game/online/types';
import { getSerasInspectionPhase, getSerasRevealElapsed } from './serasInspection';
const effect = {
  abilityId: 'PL!HS-bp8-007:on-enter-look-top-five-purple-requirement-live',
  stepId: 'HS_BP8_007_SELECT_PURPLE_REQUIREMENT_LIVE',
} as ActiveEffectViewState;

describe('Seras inspection presentation boundary', () => {
  it('recognizes every print, but not a different member borrowing the ability', () => {
    for (const rare of ['SEC', 'R', 'P', 'P+'])
      expect(getSerasInspectionPhase(effect, `PL!HS-bp8-007-${rare}`, true)).toBe('inspection');
    expect(getSerasInspectionPhase(effect, 'PL!HS-bp8-004-SEC', true)).toBeNull();
    expect(getSerasInspectionPhase(effect, undefined, true)).toBeNull();
    expect(getSerasInspectionPhase(effect, 'PL!HS-bp8-007-SEC', false)).toBeNull();
  });
  it('only celebrates the existing timed public reveal, never a skip or another ability', () => {
    const reveal = {
      ...effect,
      stepId: 'COMMON_PUBLIC_REVEAL_DWELL',
      revealedObjectIds: ['obj_song'],
      publicRevealAutoAdvanceAt: 2000,
      publicRevealAutoAdvanceAfterMs: 2000,
      publicRevealGeneration: 'public-1',
    };
    expect(getSerasInspectionPhase(reveal, 'PL!HS-bp8-007-SEC', true)).toBe('reveal');
    expect(
      getSerasInspectionPhase({ ...reveal, revealedObjectIds: [] }, 'PL!HS-bp8-007-SEC', true)
    ).toBeNull();
    expect(
      getSerasInspectionPhase({ ...reveal, abilityId: 'other' }, 'PL!HS-bp8-007-SEC', true)
    ).toBeNull();
    expect(getSerasInspectionPhase(null, 'PL!HS-bp8-007-SEC', true)).toBeNull();
  });
  it('joins a resumed reveal at its current pose without replaying or extending the dwell', () => {
    expect(getSerasRevealElapsed(2000)).toBe(0);
    expect(getSerasRevealElapsed(1500)).toBe(500);
    expect(getSerasRevealElapsed(900)).toBe(800);
    expect(getSerasRevealElapsed(-10)).toBe(800);
  });
});
