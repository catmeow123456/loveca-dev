import type { GameState } from '../../domain/entities/game.js';
import type {
  GameEvent,
  LiveStartEvent,
  LiveSuccessEvent,
  TurnEndEvent,
  TurnStartEvent,
} from '../../domain/events/game-events.js';
import { TriggerCondition } from '../../shared/types/enums.js';

export interface PreviousCompletedTurnLiveResult {
  readonly turnNumber: number;
  readonly playerId: string;
  readonly startSequence: number | null;
  readonly endSequence: number;
  readonly performedLive: boolean;
  readonly succeededLive: boolean;
}

/**
 * Reads one player's LIVE result from the most recent completed turn interval in the rule event
 * log. The first real turn currently has no ON_TURN_START event, so ON_TURN_END (and the previous
 * ON_TURN_END when one exists) is the authoritative fallback boundary.
 *
 * Turn boundary currentPlayerId identifies the engine's round boundary owner; it does not limit
 * which player may have performed a LIVE inside that shared round. A newer, still-open turn does
 * not hide the preceding completed turn.
 */
export function getPreviousCompletedTurnLiveResult(
  game: GameState,
  playerId: string
): PreviousCompletedTurnLiveResult | null {
  const endIndex = findLatestTurnEndIndex(game);
  if (endIndex < 0) return null;

  const endEntry = game.eventLog[endIndex]!;
  const endEvent = endEntry.event;
  if (!isTurnEndEvent(endEvent)) return null;

  let previousEndIndex = -1;
  let startIndex = -1;
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const entry = game.eventLog[index]!;
    const event = entry.event;
    if (isTurnEndEvent(event)) {
      previousEndIndex = index;
      break;
    }
    if (!isTurnStartEvent(event)) continue;
    if (
      event.turnNumber !== endEvent.turnNumber ||
      event.currentPlayerId !== endEvent.currentPlayerId
    ) {
      return null;
    }
    startIndex = index;
    break;
  }

  const turnEntries = game.eventLog.slice(
    startIndex >= 0 ? startIndex + 1 : previousEndIndex + 1,
    endIndex
  );
  return {
    turnNumber: endEvent.turnNumber,
    playerId,
    startSequence: startIndex >= 0 ? game.eventLog[startIndex]!.sequence : null,
    endSequence: endEntry.sequence,
    performedLive: turnEntries.some(
      (candidate) => isLiveStartEvent(candidate.event) && candidate.event.performerId === playerId
    ),
    succeededLive: turnEntries.some(
      (candidate) => isLiveSuccessEvent(candidate.event) && candidate.event.playerId === playerId
    ),
  };
}

export function didPlayerPerformAndFailLiveInPreviousCompletedTurn(
  game: GameState,
  playerId: string
): boolean {
  const result = getPreviousCompletedTurnLiveResult(game, playerId);
  return result?.performedLive === true && result.succeededLive === false;
}

function findLatestTurnEndIndex(game: GameState): number {
  for (let index = game.eventLog.length - 1; index >= 0; index -= 1) {
    const event = game.eventLog[index]?.event;
    if (event && isTurnEndEvent(event)) return index;
  }
  return -1;
}

function isTurnStartEvent(event: GameEvent): event is TurnStartEvent {
  return (
    event.eventType === TriggerCondition.ON_TURN_START &&
    'turnNumber' in event &&
    'currentPlayerId' in event
  );
}

function isTurnEndEvent(event: GameEvent): event is TurnEndEvent {
  return (
    event.eventType === TriggerCondition.ON_TURN_END &&
    'turnNumber' in event &&
    'currentPlayerId' in event
  );
}

function isLiveStartEvent(event: GameEvent): event is LiveStartEvent {
  return event.eventType === TriggerCondition.ON_LIVE_START && 'performerId' in event;
}

function isLiveSuccessEvent(event: GameEvent): event is LiveSuccessEvent {
  return event.eventType === TriggerCondition.ON_LIVE_SUCCESS && 'playerId' in event;
}
