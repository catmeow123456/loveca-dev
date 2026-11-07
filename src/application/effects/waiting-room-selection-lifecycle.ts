import type { GameState } from '../../domain/entities/game.js';
import { TriggerCondition, ZoneType } from '../../shared/types/enums.js';

/** A selected waiting-room object cannot be replaced by the same physical card re-entering. */
export function hasWaitingRoomSelectionReenteredAfter(
  game: GameState,
  cardIds: readonly string[],
  sequence: unknown
): boolean {
  if (typeof sequence !== 'number' || !Number.isFinite(sequence)) return true;
  const selected = new Set(cardIds);
  return game.eventLog.some(
    ({ sequence: currentSequence, event }) =>
      currentSequence > sequence &&
      event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
      event.fromZone !== ZoneType.WAITING_ROOM &&
      (selected.has(event.cardInstanceId) ||
        ('cardInstanceIds' in event &&
          Array.isArray(event.cardInstanceIds) &&
          event.cardInstanceIds.some((id: string) => selected.has(id))))
  );
}
