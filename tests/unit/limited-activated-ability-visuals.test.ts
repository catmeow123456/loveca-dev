import { describe, expect, it } from 'vitest';
import { shouldShowLimitedActivatedAbilityHighlight } from '../../client/src/lib/limitedActivatedAbilityVisuals';
import { GamePhase, SubPhase } from '../../src/shared/types/enums';

const BASE_INPUT = {
  hasRemainingLimitedActivatedAbility: true,
  isOpponent: false,
  viewerSeat: 'FIRST' as const,
  playerSeat: 'FIRST' as const,
  activeSeat: 'FIRST' as const,
  currentPhase: GamePhase.MAIN_PHASE,
  currentSubPhase: SubPhase.NONE,
  canActivateAbilityCommand: true,
  hasActiveEffect: false,
};

describe('limited activated ability highlight visibility', () => {
  it('shows only for the active viewer-owned stage during an idle main-phase window', () => {
    expect(shouldShowLimitedActivatedAbilityHighlight(BASE_INPUT)).toBe(true);
    expect(
      shouldShowLimitedActivatedAbilityHighlight({
        ...BASE_INPUT,
        hasRemainingLimitedActivatedAbility: false,
      })
    ).toBe(false);
    expect(shouldShowLimitedActivatedAbilityHighlight({ ...BASE_INPUT, isOpponent: true })).toBe(
      false
    );
    expect(
      shouldShowLimitedActivatedAbilityHighlight({ ...BASE_INPUT, activeSeat: 'SECOND' })
    ).toBe(false);
    expect(
      shouldShowLimitedActivatedAbilityHighlight({
        ...BASE_INPUT,
        currentPhase: GamePhase.LIVE_SET_PHASE,
      })
    ).toBe(false);
    expect(
      shouldShowLimitedActivatedAbilityHighlight({
        ...BASE_INPUT,
        canActivateAbilityCommand: false,
      })
    ).toBe(false);
  });

  it('gives the active card-effect window priority over the persistent reminder', () => {
    expect(
      shouldShowLimitedActivatedAbilityHighlight({ ...BASE_INPUT, hasActiveEffect: true })
    ).toBe(false);
  });
});
