import type { GameState } from '../../../domain/entities/game.js';
import type { LeaveStageEvent } from '../../../domain/events/game-events.js';
import { removeTargetMemberBoundLiveModifiers } from '../../../domain/rules/live-modifiers.js';

/**
 * Applies the standard lifetime rule for temporary modifiers granted to a
 * concrete member: moving slots keeps them, leaving the stage removes them.
 */
export function removeTargetMemberBoundLiveModifiersForLeaveStageEvents(
  game: GameState,
  leaveStageEvents: readonly LeaveStageEvent[]
): GameState {
  return removeTargetMemberBoundLiveModifiers(
    game,
    leaveStageEvents.map((event) => event.cardInstanceId)
  );
}
