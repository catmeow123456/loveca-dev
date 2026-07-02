import { emitGameEvent, type GameState } from '../../../domain/entities/game.js';
import {
  createEnterWaitingRoomEvent,
  type EnterWaitingRoomEvent,
} from '../../../domain/events/game-events.js';
import { TriggerCondition, ZoneType } from '../../../shared/types/enums.js';
import {
  moveTopDeckCardsToWaitingRoom,
  moveTopDeckCardsToWaitingRoomWithRefresh,
  type MoveCardsToWaitingRoomResult,
  type MoveTopDeckCardsToWaitingRoomWithRefreshResult,
} from '../../effects/look-top.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from './enter-waiting-room-triggers.js';

export type PrepareMainDeckWaitingRoomGameState = (
  game: GameState,
  movedCardIds: readonly string[],
  refreshCount: number
) => GameState;

export interface MainDeckWaitingRoomTriggerOptions {
  readonly prepareGameStateBeforeEnqueue?: PrepareMainDeckWaitingRoomGameState;
}

export function enqueueMainDeckCardsEnteredWaitingRoom(
  game: GameState,
  playerId: string,
  movedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  if (movedCardIds.length === 0) {
    return game;
  }

  const enterWaitingRoomEvent = createMainDeckEnterWaitingRoomEvent(playerId, movedCardIds);
  return enqueueTriggeredCardEffects(
    emitGameEvent(game, enterWaitingRoomEvent),
    [TriggerCondition.ON_ENTER_WAITING_ROOM],
    { enterWaitingRoomEvents: [enterWaitingRoomEvent] }
  );
}

export function moveTopDeckCardsToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  count: number,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: MainDeckWaitingRoomTriggerOptions = {}
): MoveCardsToWaitingRoomResult | null {
  const moveResult = moveTopDeckCardsToWaitingRoom(game, playerId, count);
  if (!moveResult) {
    return null;
  }

  const preparedState =
    options.prepareGameStateBeforeEnqueue?.(moveResult.gameState, moveResult.movedCardIds, 0) ??
    moveResult.gameState;

  return {
    ...moveResult,
    gameState: enqueueMainDeckCardsEnteredWaitingRoom(
      preparedState,
      playerId,
      moveResult.movedCardIds,
      enqueueTriggeredCardEffects
    ),
  };
}

export function moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  count: number,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: MainDeckWaitingRoomTriggerOptions = {}
): MoveTopDeckCardsToWaitingRoomWithRefreshResult | null {
  const moveResult = moveTopDeckCardsToWaitingRoomWithRefresh(game, playerId, count);
  if (!moveResult) {
    return null;
  }

  const preparedState =
    options.prepareGameStateBeforeEnqueue?.(
      moveResult.gameState,
      moveResult.movedCardIds,
      moveResult.refreshCount
    ) ??
    moveResult.gameState;

  return {
    ...moveResult,
    gameState: enqueueMainDeckCardsEnteredWaitingRoom(
      preparedState,
      playerId,
      moveResult.movedCardIds,
      enqueueTriggeredCardEffects
    ),
  };
}

function createMainDeckEnterWaitingRoomEvent(
  playerId: string,
  movedCardIds: readonly string[]
): EnterWaitingRoomEvent {
  return createEnterWaitingRoomEvent(movedCardIds, ZoneType.MAIN_DECK, playerId, playerId);
}
