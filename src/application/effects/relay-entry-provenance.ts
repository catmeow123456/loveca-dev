import type { GameState } from '../../domain/entities/game.js';
import type { EnterStageEvent } from '../../domain/events/game-events.js';
import { TriggerCondition, ZoneType } from '../../shared/types/enums.js';

/** Recover the source rules object at the triggering event, rather than a later re-entry. */
export function getStageMemberEntryAtTriggerThisTurn(
  game: GameState,
  sourceCardId: string,
  controllerId: string,
  referenceEventIds: readonly string[] | undefined
): EnterStageEvent | null {
  if (!referenceEventIds?.length) return null;
  const referenceIds = new Set(referenceEventIds);
  const referenceEntries = game.eventLog.filter(({ event }) => referenceIds.has(event.eventId));
  if (referenceEntries.length !== referenceIds.size) return null;
  const cutoff = Math.min(...referenceEntries.map(({ sequence }) => sequence));
  const entries = game.eventLog.filter(({ sequence }) => sequence <= cutoff);
  let turnBoundary = 0;
  let entry: EnterStageEvent | null = null;
  for (const { sequence, event } of entries) {
    if (
      event.eventType === TriggerCondition.ON_TURN_START ||
      event.eventType === TriggerCondition.ON_TURN_END
    ) {
      turnBoundary = sequence;
      entry = null;
      continue;
    }
    if (
      event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
      event.cardInstanceId === sourceCardId
    ) {
      entry = null;
    } else if (
      event.eventType === TriggerCondition.ON_ENTER_STAGE &&
      event.cardInstanceId === sourceCardId &&
      event.fromZone !== ZoneType.MEMBER_SLOT
    ) {
      entry =
        sequence > turnBoundary &&
        event.controllerId === controllerId &&
        event.ownerId === controllerId
          ? (event as EnterStageEvent)
          : null;
    }
  }
  return entry;
}
