import { emitGameEvent, type GameState } from '../../../domain/entities/game.js';
import {
  type CardEffectCause,
  createEnterWaitingRoomEvent,
  type EnterWaitingRoomEvent,
} from '../../../domain/events/game-events.js';
import { TriggerCondition, ZoneType } from '../../../shared/types/enums.js';
import {
  moveTopDeckCardsToWaitingRoom,
  moveTopDeckCardsToWaitingRoomWithRefresh,
  moveBottomDeckCardsToWaitingRoomWithRefresh,
  type MoveCardsToWaitingRoomResult,
  type MoveTopDeckCardsToWaitingRoomWithRefreshResult,
} from '../../effects/look-top.js';
import { applyPendingRefreshForPlayer } from '../../effects/refresh.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from './enter-waiting-room-triggers.js';

export type PrepareMainDeckWaitingRoomGameState = (
  game: GameState,
  movedCardIds: readonly string[],
  refreshCount: number
) => GameState;

export interface MainDeckWaitingRoomTriggerOptions {
  readonly prepareGameStateBeforeEnqueue?: PrepareMainDeckWaitingRoomGameState;
  readonly cause?: CardEffectCause;
}

export interface PlayerMainDeckWaitingRoomMoveResult {
  readonly playerId: string;
  readonly movedCardIds: readonly string[];
  readonly refreshCount: number;
  readonly enterWaitingRoomEvent?: EnterWaitingRoomEvent;
}

export interface MultiPlayerMainDeckWaitingRoomMoveResult {
  readonly gameState: GameState;
  readonly playerResults: readonly PlayerMainDeckWaitingRoomMoveResult[];
}

export interface MultiPlayerMainDeckWaitingRoomTriggerOptions {
  readonly prepareGameStateBeforeEnqueue?: (
    game: GameState,
    playerResults: readonly PlayerMainDeckWaitingRoomMoveResult[]
  ) => GameState;
  readonly cause?: CardEffectCause;
}

export function enqueueMainDeckCardsEnteredWaitingRoom(
  game: GameState,
  playerId: string,
  movedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  cause?: CardEffectCause
): GameState {
  if (movedCardIds.length === 0) {
    return game;
  }

  const enterWaitingRoomEvent = createMainDeckEnterWaitingRoomEvent(playerId, movedCardIds, cause);
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
      enqueueTriggeredCardEffects,
      options.cause
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
    ) ?? moveResult.gameState;

  return {
    ...moveResult,
    gameState: enqueueMainDeckCardsEnteredWaitingRoom(
      preparedState,
      playerId,
      moveResult.movedCardIds,
      enqueueTriggeredCardEffects,
      options.cause
    ),
  };
}

/**
 * Pays an exact top-deck-to-waiting-room cost without using WithRefresh semantics.
 *
 * The current main deck must already contain the full count. A refresh is applied only
 * after the exact move has completed, preserving the grouped move event even when the
 * moved cards are immediately shuffled away by that rule action.
 */
export function moveExactTopDeckCardsToWaitingRoomAsCostAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  count: number,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: MainDeckWaitingRoomTriggerOptions = {}
): MoveTopDeckCardsToWaitingRoomWithRefreshResult | null {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player || !Number.isInteger(count) || count < 0 || player.mainDeck.cardIds.length < count) {
    return null;
  }

  const moveResult = moveTopDeckCardsToWaitingRoom(game, playerId, count);
  if (!moveResult || moveResult.movedCardIds.length !== count) {
    return null;
  }

  const refreshedState = applyPendingRefreshForPlayer(moveResult.gameState, playerId);
  const refreshCount = refreshedState === moveResult.gameState ? 0 : 1;
  const preparedState =
    options.prepareGameStateBeforeEnqueue?.(
      refreshedState,
      moveResult.movedCardIds,
      refreshCount
    ) ?? refreshedState;

  return {
    movedCardIds: moveResult.movedCardIds,
    refreshCount,
    gameState: enqueueMainDeckCardsEnteredWaitingRoom(
      preparedState,
      playerId,
      moveResult.movedCardIds,
      enqueueTriggeredCardEffects,
      options.cause
    ),
  };
}

/**
 * Resolves one refresh-aware direct-mill effect for multiple deck owners atomically.
 *
 * All owners finish moving first (active player first for rule-action ordering). Only
 * then are the independent grouped waiting-room events emitted and enqueued together.
 */
export function moveTopDeckCardsForPlayersWithRefreshAndEnqueueTriggers(
  game: GameState,
  playerIds: readonly string[],
  count: number,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: MultiPlayerMainDeckWaitingRoomTriggerOptions = {}
): MultiPlayerMainDeckWaitingRoomMoveResult | null {
  const uniquePlayerIds = [...new Set(playerIds)];
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    uniquePlayerIds.length !== playerIds.length ||
    uniquePlayerIds.some((playerId) => !game.players.some((player) => player.id === playerId))
  ) {
    return null;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id;
  const orderedPlayerIds =
    activePlayerId && uniquePlayerIds.includes(activePlayerId)
      ? [activePlayerId, ...uniquePlayerIds.filter((playerId) => playerId !== activePlayerId)]
      : uniquePlayerIds;
  let state = game;
  const playerResults: PlayerMainDeckWaitingRoomMoveResult[] = [];

  for (const playerId of orderedPlayerIds) {
    const moveResult = moveTopDeckCardsToWaitingRoomWithRefresh(state, playerId, count);
    if (!moveResult) {
      return null;
    }
    state = moveResult.gameState;
    playerResults.push({
      playerId,
      movedCardIds: moveResult.movedCardIds,
      refreshCount: moveResult.refreshCount,
      ...(moveResult.movedCardIds.length > 0
        ? {
            enterWaitingRoomEvent: createMainDeckEnterWaitingRoomEvent(
              playerId,
              moveResult.movedCardIds,
              options.cause
            ),
          }
        : {}),
    });
  }

  const enterWaitingRoomEvents = playerResults.flatMap((result) =>
    result.enterWaitingRoomEvent ? [result.enterWaitingRoomEvent] : []
  );
  for (const event of enterWaitingRoomEvents) {
    state = emitGameEvent(state, event);
  }
  state = options.prepareGameStateBeforeEnqueue?.(state, playerResults) ?? state;
  if (enterWaitingRoomEvents.length > 0) {
    state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
      enterWaitingRoomEvents,
    });
  }

  return { gameState: state, playerResults };
}

export function moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  count: number,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: MainDeckWaitingRoomTriggerOptions = {}
): MoveTopDeckCardsToWaitingRoomWithRefreshResult | null {
  const moveResult = moveBottomDeckCardsToWaitingRoomWithRefresh(game, playerId, count);
  if (!moveResult) {
    return null;
  }

  const preparedState =
    options.prepareGameStateBeforeEnqueue?.(
      moveResult.gameState,
      moveResult.movedCardIds,
      moveResult.refreshCount
    ) ?? moveResult.gameState;

  return {
    ...moveResult,
    gameState: enqueueMainDeckCardsEnteredWaitingRoom(
      preparedState,
      playerId,
      moveResult.movedCardIds,
      enqueueTriggeredCardEffects,
      options.cause
    ),
  };
}

function createMainDeckEnterWaitingRoomEvent(
  playerId: string,
  movedCardIds: readonly string[],
  cause?: CardEffectCause
): EnterWaitingRoomEvent {
  return createEnterWaitingRoomEvent(movedCardIds, ZoneType.MAIN_DECK, playerId, playerId, cause);
}
