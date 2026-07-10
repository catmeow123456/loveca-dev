import type { GameState } from '../../../domain/entities/game.js';
import type { CheerEvent } from '../../../domain/events/game-events.js';
import { TriggerCondition } from '../../../shared/types/enums.js';

/**
 * Returns the latest logged normal CheerEvent for one player within the caller's event scope.
 */
export function getLatestOwnNormalCheerEventByIds(
  game: GameState,
  playerId: string,
  eventIds: readonly string[]
): CheerEvent | null {
  const eventIdSet = new Set(eventIds);
  let latestEvent: CheerEvent | null = null;

  for (const { event } of game.eventLog) {
    if (
      isOwnNormalCheerEvent(event) &&
      event.playerId === playerId &&
      eventIdSet.has(event.eventId)
    ) {
      latestEvent = event;
    }
  }

  return latestEvent;
}

function isOwnNormalCheerEvent(
  event: GameState['eventLog'][number]['event']
): event is CheerEvent {
  return (
    event.eventType === TriggerCondition.ON_CHEER &&
    'playerId' in event &&
    event.additional !== true
  );
}
