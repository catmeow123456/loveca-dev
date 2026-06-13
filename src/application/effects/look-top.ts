import type { CardInstance } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import { getCardById, getPlayerById, updatePlayer } from '../../domain/entities/game.js';
import { addCardToZone } from '../../domain/entities/zone.js';
import { ZoneType } from '../../shared/types/enums.js';

export type InspectionCardPredicate = (card: CardInstance) => boolean;

export interface InspectTopCardsConfig {
  readonly count: number;
  readonly reveal?: boolean;
  readonly selectablePredicate?: InspectionCardPredicate;
}

export interface InspectTopCardsResult {
  readonly gameState: GameState;
  readonly inspectedCardIds: readonly string[];
  readonly selectableCardIds: readonly string[];
}

export interface MoveInspectedSelectionResult {
  readonly gameState: GameState;
  readonly selectedCardId: string | null;
  readonly waitingRoomCardIds: readonly string[];
}

export interface MoveCardsToWaitingRoomResult {
  readonly gameState: GameState;
  readonly movedCardIds: readonly string[];
}

export function inspectTopCards(
  game: GameState,
  playerId: string,
  config: InspectTopCardsConfig
): InspectTopCardsResult | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  const inspectedCardIds = player.mainDeck.cardIds.slice(0, config.count);
  const selectableCardIds = config.selectablePredicate
    ? inspectedCardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && config.selectablePredicate?.(card) === true;
      })
    : inspectedCardIds;

  const state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: currentPlayer.mainDeck.cardIds.slice(inspectedCardIds.length),
    },
  }));

  return {
    gameState: {
      ...state,
      inspectionZone: {
        ...state.inspectionZone,
        cardIds: [...state.inspectionZone.cardIds, ...inspectedCardIds],
        revealedCardIds:
          config.reveal === true
            ? [...state.inspectionZone.revealedCardIds, ...inspectedCardIds]
            : state.inspectionZone.revealedCardIds,
      },
      inspectionContext: {
        ownerPlayerId: player.id,
        sourceZone: ZoneType.MAIN_DECK,
      },
    },
    inspectedCardIds,
    selectableCardIds,
  };
}

export function moveInspectedSelectionToHandRestToWaitingRoom(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  selectedCardId: string | null
): MoveInspectedSelectionResult | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  if (selectedCardId !== null && !inspectedCardIds.includes(selectedCardId)) {
    return null;
  }

  const waitingRoomCardIds = inspectedCardIds.filter((cardId) => cardId !== selectedCardId);
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: selectedCardId ? addCardToZone(currentPlayer.hand, selectedCardId) : currentPlayer.hand,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...waitingRoomCardIds],
    },
  }));

  state = clearInspectionCards(state, inspectedCardIds);

  return {
    gameState: state,
    selectedCardId,
    waitingRoomCardIds,
  };
}

export function moveInspectedCardsToWaitingRoom(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[]
): MoveCardsToWaitingRoomResult | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...inspectedCardIds],
    },
  }));

  state = clearInspectionCards(state, inspectedCardIds);

  return {
    gameState: state,
    movedCardIds: inspectedCardIds,
  };
}

export function moveTopDeckCardsToWaitingRoom(
  game: GameState,
  playerId: string,
  count: number
): MoveCardsToWaitingRoomResult | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  const movedCardIds = player.mainDeck.cardIds.slice(0, count);
  const state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: currentPlayer.mainDeck.cardIds.slice(movedCardIds.length),
    },
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...movedCardIds],
    },
  }));

  return {
    gameState: state,
    movedCardIds,
  };
}

export function clearInspectionCards(game: GameState, cardIds: readonly string[]): GameState {
  return {
    ...game,
    inspectionZone: {
      ...game.inspectionZone,
      cardIds: game.inspectionZone.cardIds.filter((cardId) => !cardIds.includes(cardId)),
      revealedCardIds: game.inspectionZone.revealedCardIds.filter(
        (cardId) => !cardIds.includes(cardId)
      ),
    },
    inspectionContext: game.inspectionZone.cardIds.some((cardId) => !cardIds.includes(cardId))
      ? game.inspectionContext
      : null,
  };
}
