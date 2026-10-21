import {
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import { isCardMoveEvent } from '../../../domain/events/game-events.js';
import { TriggerCondition, ZoneType } from '../../../shared/types/enums.js';
import { getPendingLeaveStageEvent } from './events.js';

/** The waiting-room object created by this exact leave event, before any subsequent move. */
export function isLeaveStageSourceStillInWaitingRoom(
  game: GameState,
  ability: PendingAbilityState
): boolean {
  const event = getPendingLeaveStageEvent(game, ability);
  const player = getPlayerById(game, ability.controllerId);
  if (
    !event ||
    event.cardInstanceId !== ability.sourceCardId ||
    event.fromZone !== ZoneType.MEMBER_SLOT ||
    event.toZone !== ZoneType.WAITING_ROOM ||
    event.controllerId !== ability.controllerId ||
    event.ownerId !== ability.controllerId ||
    !player?.waitingRoom.cardIds.includes(ability.sourceCardId)
  ) {
    return false;
  }

  const leaveIndex = game.eventLog.findIndex((entry) => entry.event.eventId === event.eventId);
  let sawCompanionWaitingRoomEntry = false;
  for (const { event: later } of game.eventLog.slice(leaveIndex + 1)) {
    if (
      later.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK &&
      'movedCardIds' in later &&
      later.movedCardIds.includes(ability.sourceCardId)
    ) {
      return false;
    }
    if (!isCardMoveEvent(later)) continue;
    const movedIds = 'cardInstanceIds' in later ? later.cardInstanceIds : undefined;
    if (
      later.cardInstanceId !== ability.sourceCardId &&
      !movedIds?.includes(ability.sourceCardId)
    ) {
      continue;
    }
    // Stage removal emits both LeaveStage and EnterWaitingRoom for the same move.
    if (
      !sawCompanionWaitingRoomEntry &&
      later.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
      later.fromZone === ZoneType.MEMBER_SLOT &&
      later.controllerId === event.controllerId &&
      later.ownerId === event.ownerId
    ) {
      sawCompanionWaitingRoomEntry = true;
      continue;
    }
    return false;
  }
  return true;
}
