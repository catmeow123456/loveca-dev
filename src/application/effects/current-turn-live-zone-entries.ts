import type { GameState } from '../../domain/entities/game.js';
import { TriggerCondition, ZoneType } from '../../shared/types/enums.js';

/** Entry occurrences, including cards that later left by an effect; SET cancellation is exact. */
export function getCurrentTurnLiveZoneEntries(game: GameState, playerId: string) {
  let boundary = 0;
  for (const entry of game.eventLog) {
    if (
      entry.event.eventType === TriggerCondition.ON_TURN_START ||
      entry.event.eventType === TriggerCondition.ON_TURN_END
    )
      boundary = entry.sequence;
  }
  const cancelled = new Set(
    game.actionHistory
      .filter((action) => action.type === 'UNSET_LIVE_CARD' && action.playerId === playerId)
      .map((action) => action.payload.entryEventId)
  );
  return game.eventLog.filter(
    ({ sequence, event }) =>
      sequence > boundary &&
      event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE &&
      event.fromZone !== ZoneType.LIVE_ZONE &&
      event.ownerId === playerId &&
      event.controllerId === playerId &&
      !cancelled.has(event.eventId)
  );
}

/** Only the latest cross-zone object may cancel its own causally linked normal SET. */
export function getCurrentTurnSetLiveEntryEventId(
  game: GameState,
  playerId: string,
  cardId: string
): string | null {
  const latest = [...game.eventLog]
    .reverse()
    .find(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE &&
        event.cardInstanceId === cardId &&
        event.fromZone !== ZoneType.LIVE_ZONE
    );
  if (!latest || !getCurrentTurnLiveZoneEntries(game, playerId).includes(latest)) return null;
  const action = game.actionHistory.find((candidate) => candidate.id === latest.causedByActionId);
  return action?.type === 'SET_LIVE_CARD' &&
    action.playerId === playerId &&
    action.payload.cardId === cardId
    ? latest.event.eventId
    : null;
}
