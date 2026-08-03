import {
  emitGameEvent,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../domain/entities/game.js';
import { addCardToZone, placeCardInSlot } from '../../../domain/entities/zone.js';
import {
  type CardEffectCause,
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

export interface MoveInspectedDeckTopRestToWaitingRoomResult extends MoveInspectedMultiSelectionResult {
  readonly deckTopCardIds: readonly string[];
}

export interface MoveInspectedDeckBottomRestToWaitingRoomResult extends MoveInspectedMultiSelectionResult {
  readonly deckBottomCardIds: readonly string[];
}

export interface MoveInspectedCardsToDeckTopAndBottomResult {
  readonly gameState: GameState;
  readonly deckTopCardIds: readonly string[];
  readonly deckBottomCardIds: readonly string[];
}

export interface MoveInspectedCardToDeckPositionFromTopResult {
  readonly gameState: GameState;
  readonly movedCardId: string;
  readonly positionFromTop: number;
  readonly insertIndex: number;
}

export interface PartitionInspectedCardsResult extends MoveInspectedDeckTopRestToWaitingRoomResult {
  readonly handCardIds: readonly string[];
}

export interface MoveInspectedSelectionToStageResult {
  readonly gameState: GameState;
  readonly waitingRoomCardIds: readonly string[];
}

export interface InspectionWaitingRoomTriggerOptions {
  readonly cause?: CardEffectCause;
}

export function enqueueInspectionCardsEnteredWaitingRoom(
  game: GameState,
  playerId: string,
  movedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: InspectionWaitingRoomTriggerOptions = {}
): GameState {
  if (movedCardIds.length === 0) {
    return game;
  }

  const enterWaitingRoomEvent = createInspectionEnterWaitingRoomEvent(
    playerId,
    movedCardIds,
    options.cause
  );
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
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: InspectionWaitingRoomTriggerOptions = {}
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
      enqueueTriggeredCardEffects,
      options
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
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: InspectionWaitingRoomTriggerOptions = {}
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
      enqueueTriggeredCardEffects,
      options
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
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: InspectionWaitingRoomTriggerOptions = {}
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
    enqueueTriggeredCardEffects,
    options
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
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: InspectionWaitingRoomTriggerOptions = {}
): MoveInspectedDeckTopRestToWaitingRoomResult | null {
  const moveResult = moveInspectedCardsToDeckEdgeRestToWaitingRoomAndEnqueueTriggers(
    game,
    playerId,
    inspectedCardIds,
    deckTopCardIds,
    waitingRoomCardIds,
    'TOP',
    enqueueTriggeredCardEffects,
    options
  );
  return moveResult
    ? {
        ...moveResult,
        deckTopCardIds: moveResult.deckEdgeCardIds,
      }
    : null;
}

export function moveInspectedCardsToDeckBottomRestToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  deckBottomCardIds: readonly string[],
  waitingRoomCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: InspectionWaitingRoomTriggerOptions = {}
): MoveInspectedDeckBottomRestToWaitingRoomResult | null {
  const moveResult = moveInspectedCardsToDeckEdgeRestToWaitingRoomAndEnqueueTriggers(
    game,
    playerId,
    inspectedCardIds,
    deckBottomCardIds,
    waitingRoomCardIds,
    'BOTTOM',
    enqueueTriggeredCardEffects,
    options
  );
  return moveResult
    ? {
        ...moveResult,
        deckBottomCardIds: moveResult.deckEdgeCardIds,
      }
    : null;
}

export function moveInspectedCardsToDeckTopAndBottom(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  deckTopCardIds: readonly string[],
  deckBottomCardIds: readonly string[]
): MoveInspectedCardsToDeckTopAndBottomResult | null {
  const player = getPlayerById(game, playerId);
  const destinationCardIds = [...deckTopCardIds, ...deckBottomCardIds];
  const uniqueDestinationCardIds = new Set(destinationCardIds);
  if (
    !player ||
    game.inspectionContext?.ownerPlayerId !== playerId ||
    uniqueDestinationCardIds.size !== destinationCardIds.length ||
    uniqueDestinationCardIds.size !== inspectedCardIds.length ||
    destinationCardIds.some((cardId) => !inspectedCardIds.includes(cardId)) ||
    inspectedCardIds.some((cardId) => !game.inspectionZone.cardIds.includes(cardId))
  ) {
    return null;
  }

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: [
        ...deckTopCardIds,
        ...currentPlayer.mainDeck.cardIds,
        ...[...deckBottomCardIds].reverse(),
      ],
    },
  }));
  state = clearInspectionCards(state, inspectedCardIds);

  return {
    gameState: state,
    deckTopCardIds,
    deckBottomCardIds,
  };
}

/**
 * 将从主卡组检视的单1张卡放置到卡组顶数第 N 张的可达位置。
 *
 * 当剩余卡组不足 `positionFromTop - 1` 张时，放置到卡组底。
 * 本 helper 仅完成 inspection -> MAIN_DECK 的窄移动，不创建事件、action、
 * activeEffect 或 pending ability。
 */
export function moveInspectedCardToDeckPositionFromTop(
  game: GameState,
  playerId: string,
  inspectedCardId: string,
  positionFromTop: number
): MoveInspectedCardToDeckPositionFromTopResult | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, inspectedCardId);
  if (
    !player ||
    !card ||
    card.ownerId !== player.id ||
    game.inspectionContext?.ownerPlayerId !== player.id ||
    game.inspectionContext.sourceZone !== ZoneType.MAIN_DECK ||
    game.inspectionZone.cardIds.length !== 1 ||
    game.inspectionZone.cardIds[0] !== inspectedCardId ||
    player.mainDeck.cardIds.includes(inspectedCardId) ||
    !Number.isInteger(positionFromTop) ||
    positionFromTop <= 0
  ) {
    return null;
  }

  const insertIndex = Math.min(positionFromTop - 1, player.mainDeck.cardIds.length);
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: [
        ...currentPlayer.mainDeck.cardIds.slice(0, insertIndex),
        inspectedCardId,
        ...currentPlayer.mainDeck.cardIds.slice(insertIndex),
      ],
    },
  }));
  state = clearInspectionCards(state, [inspectedCardId]);

  return {
    gameState: state,
    movedCardId: inspectedCardId,
    positionFromTop,
    insertIndex,
  };
}

function moveInspectedCardsToDeckEdgeRestToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  deckEdgeCardIds: readonly string[],
  waitingRoomCardIds: readonly string[],
  deckEdge: 'TOP' | 'BOTTOM',
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: InspectionWaitingRoomTriggerOptions
):
  | (MoveInspectedMultiSelectionResult & {
      readonly deckEdgeCardIds: readonly string[];
    })
  | null {
  const player = getPlayerById(game, playerId);
  const destinationCardIds = [...deckEdgeCardIds, ...waitingRoomCardIds];
  const uniqueDestinationCardIds = new Set(destinationCardIds);
  if (
    !player ||
    game.inspectionContext?.ownerPlayerId !== playerId ||
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
      deckEdgeCardIds.length > 0
        ? {
            ...currentPlayer.mainDeck,
            cardIds:
              deckEdge === 'TOP'
                ? [...deckEdgeCardIds, ...currentPlayer.mainDeck.cardIds]
                : [...currentPlayer.mainDeck.cardIds, ...[...deckEdgeCardIds].reverse()],
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
    enqueueTriggeredCardEffects,
    options
  );

  return {
    gameState: state,
    selectedCardIds: deckEdgeCardIds,
    waitingRoomCardIds,
    deckEdgeCardIds,
  };
}

export function partitionInspectedCardsToHandDeckTopWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  handCardIds: readonly string[],
  deckTopCardIds: readonly string[],
  waitingRoomCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: InspectionWaitingRoomTriggerOptions = {}
): PartitionInspectedCardsResult | null {
  const player = getPlayerById(game, playerId);
  const destinationCardIds = [...handCardIds, ...deckTopCardIds, ...waitingRoomCardIds];
  const uniqueDestinationCardIds = new Set(destinationCardIds);
  if (
    !player ||
    game.inspectionContext?.ownerPlayerId !== playerId ||
    uniqueDestinationCardIds.size !== destinationCardIds.length ||
    uniqueDestinationCardIds.size !== inspectedCardIds.length ||
    destinationCardIds.some((cardId) => !inspectedCardIds.includes(cardId)) ||
    inspectedCardIds.some((cardId) => !game.inspectionZone.cardIds.includes(cardId))
  ) {
    return null;
  }

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: handCardIds.reduce((hand, cardId) => addCardToZone(hand, cardId), currentPlayer.hand),
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: [...deckTopCardIds, ...currentPlayer.mainDeck.cardIds],
    },
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
    enqueueTriggeredCardEffects,
    options
  );

  return {
    gameState: state,
    selectedCardIds: [...handCardIds, ...deckTopCardIds],
    waitingRoomCardIds,
    deckTopCardIds,
    handCardIds,
  };
}

export function moveInspectedSelectionToStageRestToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  selectedCardId: string,
  selectedSlot: SlotPosition,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  options: InspectionWaitingRoomTriggerOptions = {}
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
    enqueueTriggeredCardEffects,
    options
  );

  return {
    gameState: state,
    waitingRoomCardIds,
  };
}

function createInspectionEnterWaitingRoomEvent(
  playerId: string,
  movedCardIds: readonly string[],
  cause?: CardEffectCause
): EnterWaitingRoomEvent {
  return createEnterWaitingRoomEvent(movedCardIds, ZoneType.MAIN_DECK, playerId, playerId, cause);
}
