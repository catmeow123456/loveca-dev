import type { GameState } from '../../../domain/entities/game.js';
import type { EnterWaitingRoomEvent } from '../../../domain/events/game-events.js';
import { TriggerCondition } from '../../../shared/types/enums.js';
import {
  discardHandCardsToWaitingRoomForPlayer,
  discardOneHandCardToWaitingRoomForPlayer,
  type DiscardHandCardsToWaitingRoomOptions,
  type DiscardHandCardsToWaitingRoomResult,
  type DiscardOneHandCardToWaitingRoomOptions,
} from './actions.js';

export type EnqueueTriggeredCardEffectsForEnterWaitingRoom = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
  }
) => GameState;

export function enqueueEnterWaitingRoomTriggersFromDiscardResult(
  game: GameState,
  discardResult: Pick<DiscardHandCardsToWaitingRoomResult, 'enterWaitingRoomEvent'>,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const event = discardResult.enterWaitingRoomEvent;
  if (!event) {
    return game;
  }

  return enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
    enterWaitingRoomEvents: [event],
  });
}

export function discardHandCardsToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  selectedCardIds: readonly string[],
  options: DiscardHandCardsToWaitingRoomOptions,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): DiscardHandCardsToWaitingRoomResult | null {
  const result = discardHandCardsToWaitingRoomForPlayer(game, playerId, selectedCardIds, options);
  if (!result) {
    return null;
  }

  return {
    ...result,
    gameState: enqueueEnterWaitingRoomTriggersFromDiscardResult(
      result.gameState,
      result,
      enqueueTriggeredCardEffects
    ),
  };
}

export function discardOneHandCardToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  selectedCardId: string,
  options: DiscardOneHandCardToWaitingRoomOptions,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): DiscardHandCardsToWaitingRoomResult | null {
  const result = discardOneHandCardToWaitingRoomForPlayer(game, playerId, selectedCardId, options);
  if (!result) {
    return null;
  }

  return {
    ...result,
    gameState: enqueueEnterWaitingRoomTriggersFromDiscardResult(
      result.gameState,
      result,
      enqueueTriggeredCardEffects
    ),
  };
}
