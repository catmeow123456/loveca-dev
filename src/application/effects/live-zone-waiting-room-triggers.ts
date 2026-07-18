import {
  emitGameEvent,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../domain/entities/game.js';
import { createEnterWaitingRoomEvent } from '../../domain/events/game-events.js';
import { TriggerCondition, ZoneType } from '../../shared/types/enums.js';
import { enqueueTriggeredCardEffects, resolvePendingCardEffects } from '../card-effect-runner.js';

interface LiveZoneWaitingRoomBatch {
  readonly ownerId: string;
  readonly controllerId: string;
  readonly cardIds: readonly string[];
}

export function resolveLiveZoneToWaitingRoomTriggers(
  game: GameState,
  movedCardIds: readonly string[]
): GameState {
  const batches = createLiveZoneToWaitingRoomBatches(game, movedCardIds);
  if (batches.length === 0) {
    return game;
  }

  const enterWaitingRoomEvents = batches.map((batch) =>
    createEnterWaitingRoomEvent(
      batch.cardIds,
      ZoneType.LIVE_ZONE,
      batch.ownerId,
      batch.controllerId
    )
  );
  const stateWithEvents = enterWaitingRoomEvents.reduce(
    (state, event) => emitGameEvent(state, event),
    game
  );
  const stateWithTriggers = enqueueTriggeredCardEffects(
    stateWithEvents,
    [TriggerCondition.ON_ENTER_WAITING_ROOM],
    { enterWaitingRoomEvents }
  );
  return resolvePendingCardEffects(stateWithTriggers).gameState;
}

function createLiveZoneToWaitingRoomBatches(
  game: GameState,
  movedCardIds: readonly string[]
): readonly LiveZoneWaitingRoomBatch[] {
  const orderedBatches: LiveZoneWaitingRoomBatch[] = [];
  const batchIndexes = new Map<string, number>();

  for (const cardId of [...new Set(movedCardIds)]) {
    const card = getCardById(game, cardId);
    if (!card) {
      continue;
    }
    const controllerId = card.ownerId;
    const controller = getPlayerById(game, controllerId);
    if (!controller?.waitingRoom.cardIds.includes(cardId)) {
      continue;
    }

    const batchKey = `${card.ownerId}:${controllerId}`;
    const existingIndex = batchIndexes.get(batchKey);
    if (existingIndex !== undefined) {
      const existingBatch = orderedBatches[existingIndex];
      orderedBatches[existingIndex] = {
        ...existingBatch,
        cardIds: [...existingBatch.cardIds, cardId],
      };
      continue;
    }

    batchIndexes.set(batchKey, orderedBatches.length);
    orderedBatches.push({
      ownerId: card.ownerId,
      controllerId,
      cardIds: [cardId],
    });
  }

  return orderedBatches;
}
