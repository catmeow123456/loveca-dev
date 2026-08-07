import type { GameState } from '../../../domain/entities/game.js';
import type { LeaveStageEvent } from '../../../domain/events/game-events.js';
import { removeStageMemberBoundLiveModifiers } from '../../../domain/rules/live-modifiers.js';

/**
 * Applies the standard lifetime rule for temporary modifiers granted to a
 * concrete member: moving slots keeps them, leaving the stage removes them.
 * SOURCE_MEMBER BLADE binds through sourceCardId; TARGET_MEMBER BLADE binds
 * through targetMemberCardId while sourceCardId remains the true ability source.
 * PLAYER BLADE is not member-bound and is therefore preserved here.
 */
export function removeTargetMemberBoundLiveModifiersForLeaveStageEvents(
  game: GameState,
  leaveStageEvents: readonly LeaveStageEvent[]
): GameState {
  return removeStageMemberBoundLiveModifiers(
    game,
    leaveStageEvents.map((event) => event.cardInstanceId)
  );
}
