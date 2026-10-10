import type { GameState } from '../../../domain/entities/game.js';
import type { LeaveStageEvent } from '../../../domain/events/game-events.js';
import { removeStageMemberBoundLiveModifiers } from '../../../domain/rules/live-modifiers.js';
import { removeMemberActivePhaseSkipsForMembers } from '../../../domain/rules/member-active-skips.js';
import { TriggerCondition, ZoneType } from '../../../shared/types/enums.js';

/**
 * Applies the standard lifetime rule for temporary modifiers granted to a
 * concrete member: moving slots keeps them, leaving the stage removes them.
 * SOURCE_MEMBER HEART/BLADE binds through sourceCardId; TARGET_MEMBER
 * HEART/BLADE binds through targetMemberCardId while sourceCardId remains the
 * true ability source. PLAYER HEART/BLADE is not member-bound and is therefore
 * preserved here.
 */
export function removeTargetMemberBoundLiveModifiersForLeaveStageEvents(
  game: GameState,
  leaveStageEvents: readonly LeaveStageEvent[]
): GameState {
  const state = removeStageMemberBoundLiveModifiers(
    game,
    leaveStageEvents.map((event) => event.cardInstanceId)
  );
  // A later check can revisit the same leave event after a new object entered and gained a marker.
  // Entry clears the previous marker; do not apply the old leave event to that new object.
  const leavingIds = leaveStageEvents
    .filter((event) => {
      const leaveSequence = game.eventLog.find(
        (record) => record.event.eventId === event.eventId
      )?.sequence;
      return (
        leaveSequence === undefined ||
        !game.eventLog.some(
          (record) =>
            record.sequence > leaveSequence &&
            record.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
            record.event.cardInstanceId === event.cardInstanceId &&
            record.event.fromZone !== ZoneType.MEMBER_SLOT
        )
      );
    })
    .map((event) => event.cardInstanceId);
  return removeMemberActivePhaseSkipsForMembers(state, leavingIds);
}
