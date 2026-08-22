import type { Seat } from '@game/online';
import { GamePhase, SubPhase } from '@game/shared/types/enums';

export function shouldShowLimitedActivatedAbilityHighlight({
  hasRemainingLimitedActivatedAbility,
  isOpponent,
  viewerSeat,
  playerSeat,
  activeSeat,
  currentPhase,
  currentSubPhase,
  canActivateAbilityCommand,
  hasActiveEffect,
}: {
  readonly hasRemainingLimitedActivatedAbility: boolean;
  readonly isOpponent: boolean;
  readonly viewerSeat: Seat | null;
  readonly playerSeat: Seat;
  readonly activeSeat: Seat | null;
  readonly currentPhase: GamePhase | null;
  readonly currentSubPhase: SubPhase;
  readonly canActivateAbilityCommand: boolean;
  readonly hasActiveEffect: boolean;
}): boolean {
  return (
    hasRemainingLimitedActivatedAbility &&
    !isOpponent &&
    viewerSeat === playerSeat &&
    activeSeat === viewerSeat &&
    currentPhase === GamePhase.MAIN_PHASE &&
    currentSubPhase === SubPhase.NONE &&
    canActivateAbilityCommand &&
    !hasActiveEffect
  );
}
