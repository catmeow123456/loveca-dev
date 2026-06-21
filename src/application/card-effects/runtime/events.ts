import type {
  EnterStageEvent,
  LeaveStageEvent,
  MemberStateChangedEvent,
  MemberSlotMovedEvent,
} from '../../../domain/events/game-events.js';
import type { GameState } from '../../../domain/entities/game.js';
import { TriggerCondition } from '../../../shared/types/enums.js';

export function getNewEnterStageEvents(
  before: GameState,
  after: GameState
): readonly EnterStageEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is EnterStageEvent =>
        event.eventType === TriggerCondition.ON_ENTER_STAGE
    );
}

export function getNewLeaveStageEvents(
  before: GameState,
  after: GameState
): readonly LeaveStageEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is LeaveStageEvent =>
        event.eventType === TriggerCondition.ON_LEAVE_STAGE
    );
}

export function getNewMemberStateChangedEvents(
  before: GameState,
  after: GameState
): readonly MemberStateChangedEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberStateChangedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
    );
}

export function getNewMemberSlotMovedEvents(
  before: GameState,
  after: GameState
): readonly MemberSlotMovedEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberSlotMovedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
    );
}
