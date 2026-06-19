import type { GameState } from '../../../domain/entities/game.js';
import type { EnterWaitingRoomEvent } from '../../../domain/events/game-events.js';
import { TriggerCondition } from '../../../shared/types/enums.js';
import type { DiscardHandCardsToWaitingRoomResult } from './actions.js';

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
