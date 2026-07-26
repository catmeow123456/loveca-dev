import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import type {
  CardEffectCause,
  WaitingRoomCardsMovedToMainDeckEvent,
} from '../../../domain/events/game-events.js';
import { SlotPosition, TriggerCondition } from '../../../shared/types/enums.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { hasAbilityInstance } from './ability-instance.js';
import {
  moveWaitingRoomCardsToDeckBottomForPlayer,
  moveWaitingRoomCardsToDeckTopForPlayer,
  moveWaitingRoomCardToDeckPositionForPlayer,
  shuffleWaitingRoomCardsToDeckBottomForPlayer,
  type MoveWaitingRoomCardsToDeckBottomForPlayerOptions,
  type MoveWaitingRoomCardsToDeckBottomForPlayerResult,
  type MoveWaitingRoomCardsToDeckTopForPlayerOptions,
  type MoveWaitingRoomCardsToDeckTopForPlayerResult,
  type MoveWaitingRoomCardToDeckPositionForPlayerOptions,
  type MoveWaitingRoomCardToDeckPositionForPlayerResult,
  type ShuffleWaitingRoomCardsToDeckBottomForPlayerResult,
} from './actions.js';
import { canUseAbilityThisTurn } from './ability-turn-limit.js';

const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export type EnqueueTriggeredCardEffectsForWaitingRoomToMainDeck = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly waitingRoomCardsMovedToMainDeckEvents?: readonly WaitingRoomCardsMovedToMainDeckEvent[];
  }
) => GameState;

export function getWaitingRoomCardsMovedToMainDeckEventsFromLog(
  game: GameState,
  eventLogStartIndex: number = 0
): readonly WaitingRoomCardsMovedToMainDeckEvent[] {
  return game.eventLog
    .slice(eventLogStartIndex)
    .map((entry) => entry.event)
    .filter(
      (event): event is WaitingRoomCardsMovedToMainDeckEvent =>
        event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}

export function enqueueUntriggeredWaitingRoomCardsMovedToMainDeckCardEffects(
  game: GameState
): GameState {
  const alreadyTriggeredEventIds = getDispatchedEventIds(game);
  return enqueueWaitingRoomCardsMovedToMainDeckCardEffects(
    game,
    getWaitingRoomCardsMovedToMainDeckEventsFromLog(game).filter(
      (event) => !alreadyTriggeredEventIds.has(event.eventId)
    )
  );
}

export function enqueueWaitingRoomCardsMovedToMainDeckCardEffects(
  game: GameState,
  events: readonly WaitingRoomCardsMovedToMainDeckEvent[]
): GameState {
  let state = game;
  const dispatchedEventIds = getDispatchedEventIds(game);
  for (const event of events) {
    if (dispatchedEventIds.has(event.eventId)) {
      continue;
    }
    const player = getPlayerById(state, event.playerId);
    if (!player || event.movedCardIds.length === 0) {
      state = markEventDispatched(state, event);
      dispatchedEventIds.add(event.eventId);
      continue;
    }

    for (const sourceSlot of MEMBER_SLOTS) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      const sourceCard = sourceCardId ? getCardById(state, sourceCardId) : null;
      if (!sourceCardId || !sourceCard) {
        continue;
      }

      const definitions = getCardAbilityDefinitionsForCardCode(sourceCard.data.cardCode).filter(
        (definition) =>
          definition.category === CardAbilityCategory.AUTO &&
          definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
          definition.queued &&
          definition.implemented &&
          definition.triggerCondition ===
            TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK &&
          (!definition.requiredSourceSlots || definition.requiredSourceSlots.includes(sourceSlot))
      );

      for (const definition of definitions) {
        if (
          definition.skipQueueWhenTurnLimitReached === true &&
          !canUseAbilityThisTurn(state, player.id, definition.abilityId, sourceCardId)
        ) {
          continue;
        }
        const pendingAbilityId = `${definition.abilityId}:${sourceCardId}:${event.eventId}`;
        if (hasAbilityInstance(state, pendingAbilityId)) {
          continue;
        }

        const pending: PendingAbilityState = {
          id: pendingAbilityId,
          abilityId: definition.abilityId,
          sourceCardId,
          controllerId: player.id,
          mandatory: true,
          timingId: TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK,
          eventIds: [event.eventId],
          sourceSlot,
          metadata: {
            triggerKind: 'WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK',
            eventId: event.eventId,
            playerId: event.playerId,
            controllerId: event.controllerId,
            movedCardIds: event.movedCardIds,
            destination: event.destination,
            cause: event.cause,
          },
        };
        state = addAction(
          { ...state, pendingAbilities: [...state.pendingAbilities, pending] },
          'TRIGGER_ABILITY',
          player.id,
          {
            pendingAbilityId,
            abilityId: definition.abilityId,
            sourceCardId,
            eventId: event.eventId,
            movedCardIds: event.movedCardIds,
            destination: event.destination,
          }
        );
      }
    }
    state = markEventDispatched(state, event);
    dispatchedEventIds.add(event.eventId);
  }
  return state;
}

function getDispatchedEventIds(game: GameState): Set<string> {
  return new Set(
    game.actionHistory
      .filter(
        (action) =>
          action.type === 'DISPATCH_TRIGGER_EVENT' &&
          action.payload.triggerCondition ===
            TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
      .map((action) => action.payload.eventId)
      .filter((eventId): eventId is string => typeof eventId === 'string')
  );
}

function markEventDispatched(
  game: GameState,
  event: WaitingRoomCardsMovedToMainDeckEvent
): GameState {
  return addAction(game, 'DISPATCH_TRIGGER_EVENT', event.playerId, {
    eventId: event.eventId,
    triggerCondition: TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK,
  });
}

function enqueueMovementEvent<T extends { readonly gameState: GameState }>(
  result: T,
  event: WaitingRoomCardsMovedToMainDeckEvent | undefined
): T {
  if (!event) {
    return result;
  }
  return {
    ...result,
    gameState: enqueueWaitingRoomCardsMovedToMainDeckCardEffects(result.gameState, [event]),
  };
}

export function shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  cardIds: readonly string[],
  cause: CardEffectCause
): ShuffleWaitingRoomCardsToDeckBottomForPlayerResult | null {
  const result = shuffleWaitingRoomCardsToDeckBottomForPlayer(game, playerId, cardIds, cause);
  return result ? enqueueMovementEvent(result, result.waitingRoomCardsMovedToMainDeckEvent) : null;
}

export function moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  selectedCardIds: readonly string[],
  options: MoveWaitingRoomCardsToDeckBottomForPlayerOptions
): MoveWaitingRoomCardsToDeckBottomForPlayerResult | null {
  const result = moveWaitingRoomCardsToDeckBottomForPlayer(
    game,
    playerId,
    selectedCardIds,
    options
  );
  return result ? enqueueMovementEvent(result, result.waitingRoomCardsMovedToMainDeckEvent) : null;
}

export function moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  selectedCardIds: readonly string[],
  options: MoveWaitingRoomCardsToDeckTopForPlayerOptions
): MoveWaitingRoomCardsToDeckTopForPlayerResult | null {
  const result = moveWaitingRoomCardsToDeckTopForPlayer(game, playerId, selectedCardIds, options);
  return result ? enqueueMovementEvent(result, result.waitingRoomCardsMovedToMainDeckEvent) : null;
}

export function moveWaitingRoomCardToDeckPositionAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  selectedCardId: string,
  options: MoveWaitingRoomCardToDeckPositionForPlayerOptions
): MoveWaitingRoomCardToDeckPositionForPlayerResult | null {
  const result = moveWaitingRoomCardToDeckPositionForPlayer(
    game,
    playerId,
    selectedCardId,
    options
  );
  return result ? enqueueMovementEvent(result, result.waitingRoomCardsMovedToMainDeckEvent) : null;
}
