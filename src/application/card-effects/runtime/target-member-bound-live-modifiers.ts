import type { GameState } from '../../../domain/entities/game.js';
import type { LeaveStageEvent } from '../../../domain/events/game-events.js';
import { removeStageMemberBoundLiveModifiers } from '../../../domain/rules/live-modifiers.js';

/**
 * Applies the standard lifetime rule for temporary modifiers granted to a
 * concrete member: moving slots keeps them, leaving the stage removes them.
 * BLADE modifiers use sourceCardId as their member-instance binding.
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
