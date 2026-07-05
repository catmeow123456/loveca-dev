import { emitGameEvent, getPlayerById, updatePlayer, type GameState } from '../../../domain/entities/game.js';
import { addCardToZone, placeCardInSlot } from '../../../domain/entities/zone.js';
import {
  createEnterWaitingRoomEvent,
  type EnterWaitingRoomEvent,
} from '../../../domain/events/game-events.js';
import {
  FaceState,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../shared/types/enums.js';
import {
  clearInspectionCards,
  moveInspectedCardsToWaitingRoom,
  moveInspectedSelectionToHandRestToWaitingRoom,
} from '../../effects/look-top.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from './enter-waiting-room-triggers.js';

export interface MoveInspectedMultiSelectionResult {
  readonly gameState: GameState;
  readonly selectedCardIds: readonly string[];
  readonly waitingRoomCardIds: readonly string[];
}

export interface MoveInspectedDeckTopRestToWaitingRoomResult
  extends MoveInspectedMultiSelectionResult {
  readonly deckTopCardIds: readonly string[];
}

export interface MoveInspectedSelectionToStageResult {
  readonly gameState: GameState;
  readonly waitingRoomCardIds: readonly string[];
}

export function enqueueInspectionCardsEnteredWaitingRoom(
  game: GameState,
  playerId: string,
  movedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  if (movedCardIds.length === 0) {
    return game;
  }

  const enterWaitingRoomEvent = createInspectionEnterWaitingRoomEvent(playerId, movedCardIds);
  return enqueueTriggeredCardEffects(
    emitGameEvent(game, enterWaitingRoomEvent),
    [TriggerCondition.ON_ENTER_WAITING_ROOM],
    { enterWaitingRoomEvents: [enterWaitingRoomEvent] }
  );
}

export function moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): MoveInspectedMultiSelectionResult | null {
  const moveResult = moveInspectedCardsToWaitingRoom(game, playerId, inspectedCardIds);
  if (!moveResult) {
    return null;
  }

  return {
    gameState: enqueueInspectionCardsEnteredWaitingRoom(
      moveResult.gameState,
      playerId,
      moveResult.movedCardIds,
      enqueueTriggeredCardEffects
    ),
    selectedCardIds: [],
    waitingRoomCardIds: moveResult.movedCardIds,
  };
}

export function moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): MoveInspectedMultiSelectionResult | null {
  const moveResult = moveInspectedSelectionToHandRestToWaitingRoom(
    game,
    playerId,
    inspectedCardIds,
    selectedCardId
  );
  if (!moveResult) {
    return null;
  }

  return {
    gameState: enqueueInspectionCardsEnteredWaitingRoom(
      moveResult.gameState,
      playerId,
      moveResult.waitingRoomCardIds,
      enqueueTriggeredCardEffects
    ),
    selectedCardIds: moveResult.selectedCardId ? [moveResult.selectedCardId] : [],
    waitingRoomCardIds: moveResult.waitingRoomCardIds,
  };
}

export function moveInspectedCardsToHandRestToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  selectedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): MoveInspectedMultiSelectionResult | null {
  const player = getPlayerById(game, playerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    selectedCardIds.some((cardId) => !inspectedCardIds.includes(cardId))
  ) {
    return null;
  }

  const waitingRoomCardIds = inspectedCardIds.filter((cardId) => !selectedCardIds.includes(cardId));
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: selectedCardIds.reduce((hand, cardId) => addCardToZone(hand, cardId), currentPlayer.hand),
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...waitingRoomCardIds],
    },
  }));
  state = clearInspectionCards(state, inspectedCardIds);
  state = enqueueInspectionCardsEnteredWaitingRoom(
    state,
    player.id,
    waitingRoomCardIds,
    enqueueTriggeredCardEffects
  );

  return {
    gameState: state,
    selectedCardIds,
    waitingRoomCardIds,
  };
}

export function moveInspectedCardsToDeckTopRestToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  deckTopCardIds: readonly string[],
  waitingRoomCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): MoveInspectedDeckTopRestToWaitingRoomResult | null {
  const player = getPlayerById(game, playerId);
  const destinationCardIds = [...deckTopCardIds, ...waitingRoomCardIds];
  const uniqueDestinationCardIds = new Set(destinationCardIds);
  if (
    !player ||
    uniqueDestinationCardIds.size !== destinationCardIds.length ||
    uniqueDestinationCardIds.size !== inspectedCardIds.length ||
    destinationCardIds.some((cardId) => !inspectedCardIds.includes(cardId)) ||
    inspectedCardIds.some((cardId) => !game.inspectionZone.cardIds.includes(cardId))
  ) {
    return null;
  }

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck:
      deckTopCardIds.length > 0
        ? {
            ...currentPlayer.mainDeck,
            cardIds: [...deckTopCardIds, ...currentPlayer.mainDeck.cardIds],
          }
        : currentPlayer.mainDeck,
    waitingRoom:
      waitingRoomCardIds.length > 0
        ? {
            ...currentPlayer.waitingRoom,
            cardIds: [...currentPlayer.waitingRoom.cardIds, ...waitingRoomCardIds],
          }
        : currentPlayer.waitingRoom,
  }));
  state = clearInspectionCards(state, inspectedCardIds);
  state = enqueueInspectionCardsEnteredWaitingRoom(
    state,
    player.id,
    waitingRoomCardIds,
    enqueueTriggeredCardEffects
  );

  return {
    gameState: state,
    selectedCardIds: deckTopCardIds,
    waitingRoomCardIds,
    deckTopCardIds,
  };
}

export function moveInspectedSelectionToStageRestToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  selectedCardId: string,
  selectedSlot: SlotPosition,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): MoveInspectedSelectionToStageResult | null {
  const player = getPlayerById(game, playerId);
  if (
    !player ||
    player.memberSlots.slots[selectedSlot] !== null ||
    !inspectedCardIds.includes(selectedCardId) ||
    !game.inspectionZone.cardIds.includes(selectedCardId)
  ) {
    return null;
  }

  const waitingRoomCardIds = inspectedCardIds.filter((cardId) => cardId !== selectedCardId);
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...waitingRoomCardIds],
    },
    memberSlots: placeCardInSlot(currentPlayer.memberSlots, selectedSlot, selectedCardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    movedToStageThisTurn: [...currentPlayer.movedToStageThisTurn, selectedCardId],
  }));
  state = clearInspectionCards(state, inspectedCardIds);
  state = enqueueInspectionCardsEnteredWaitingRoom(
    state,
    player.id,
    waitingRoomCardIds,
    enqueueTriggeredCardEffects
  );

  return {
    gameState: state,
    waitingRoomCardIds,
  };
}

function createInspectionEnterWaitingRoomEvent(
  playerId: string,
  movedCardIds: readonly string[]
): EnterWaitingRoomEvent {
  return createEnterWaitingRoomEvent(movedCardIds, ZoneType.MAIN_DECK, playerId, playerId);
}
