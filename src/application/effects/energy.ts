import type { GameState } from '../../domain/entities/game.js';
import { getPlayerById, updatePlayer } from '../../domain/entities/game.js';
import {
  addCardToStatefulZone,
  addCardToZone,
  removeCardFromStatefulZone,
} from '../../domain/entities/zone.js';
import { FaceState, OrientationState } from '../../shared/types/enums.js';

export interface PlaceEnergyFromDeckResult {
  readonly gameState: GameState;
  readonly placedEnergyCardIds: readonly string[];
}

export interface EnergyOrientationChange {
  readonly cardId: string;
  readonly orientation: OrientationState;
}

export interface SetEnergyOrientationResult {
  readonly gameState: GameState;
  readonly updatedEnergyCardIds: readonly string[];
  readonly previousOrientations: readonly EnergyOrientationChange[];
  readonly nextOrientation: OrientationState;
}

export interface MoveEnergyZoneCardsToEnergyDeckResult {
  readonly gameState: GameState;
  readonly movedEnergyCardIds: readonly string[];
}

export function getEnergyCardIdsByOrientation(
  game: GameState,
  playerId: string,
  orientation: OrientationState
): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === orientation
  );
}

export function placeEnergyFromDeckToZone(
  game: GameState,
  playerId: string,
  count: number,
  orientation: OrientationState
): PlaceEnergyFromDeckResult | null {
  const player = getPlayerById(game, playerId);
  if (!player || count <= 0) {
    return null;
  }

  const placedEnergyCardIds = player.energyDeck.cardIds.slice(0, count);
  if (placedEnergyCardIds.length === 0) {
    return {
      gameState: game,
      placedEnergyCardIds: [],
    };
  }

  const gameState = updatePlayer(game, playerId, (currentPlayer) => ({
    ...currentPlayer,
    energyDeck: {
      ...currentPlayer.energyDeck,
      cardIds: currentPlayer.energyDeck.cardIds.slice(placedEnergyCardIds.length),
    },
    energyZone: placedEnergyCardIds.reduce(
      (energyZone, cardId) =>
        addCardToStatefulZone(energyZone, cardId, {
          orientation,
          face: FaceState.FACE_UP,
        }),
      currentPlayer.energyZone
    ),
  }));

  return {
    gameState,
    placedEnergyCardIds,
  };
}

export function moveEnergyZoneCardsToEnergyDeck(
  game: GameState,
  playerId: string,
  selectedEnergyCardIds: readonly string[],
  options: { readonly exactCount?: number } = {}
): MoveEnergyZoneCardsToEnergyDeckResult | null {
  const player = getPlayerById(game, playerId);
  const exactCount = options.exactCount ?? selectedEnergyCardIds.length;
  const uniqueEnergyCardIds = [...new Set(selectedEnergyCardIds)];
  if (
    !player ||
    !Number.isInteger(exactCount) ||
    exactCount < 0 ||
    uniqueEnergyCardIds.length !== selectedEnergyCardIds.length ||
    selectedEnergyCardIds.length !== exactCount ||
    selectedEnergyCardIds.some((cardId) => !player.energyZone.cardIds.includes(cardId))
  ) {
    return null;
  }

  if (selectedEnergyCardIds.length === 0) {
    return { gameState: game, movedEnergyCardIds: [] };
  }

  const gameState = updatePlayer(game, playerId, (currentPlayer) => {
    let energyZone = currentPlayer.energyZone;
    let energyDeck = currentPlayer.energyDeck;
    for (const energyCardId of selectedEnergyCardIds) {
      energyZone = removeCardFromStatefulZone(energyZone, energyCardId);
      energyDeck = addCardToZone(energyDeck, energyCardId);
    }
    return {
      ...currentPlayer,
      energyZone,
      energyDeck,
    };
  });

  return {
    gameState,
    movedEnergyCardIds: selectedEnergyCardIds,
  };
}

export function setEnergyOrientation(
  game: GameState,
  playerId: string,
  cardIds: readonly string[],
  orientation: OrientationState
): SetEnergyOrientationResult | null {
  const player = getPlayerById(game, playerId);
  const uniqueCardIds = [...new Set(cardIds)];
  if (!player || uniqueCardIds.length !== cardIds.length) {
    return null;
  }

  const previousOrientations: EnergyOrientationChange[] = [];
  for (const cardId of uniqueCardIds) {
    if (!player.energyZone.cardIds.includes(cardId)) {
      return null;
    }
    const cardState = player.energyZone.cardStates.get(cardId);
    if (!cardState) {
      return null;
    }
    previousOrientations.push({ cardId, orientation: cardState.orientation });
  }

  if (uniqueCardIds.length === 0) {
    return {
      gameState: game,
      updatedEnergyCardIds: [],
      previousOrientations: [],
      nextOrientation: orientation,
    };
  }

  const gameState = updatePlayer(game, playerId, (currentPlayer) => {
    const cardStates = new Map(currentPlayer.energyZone.cardStates);
    for (const cardId of uniqueCardIds) {
      const cardState = cardStates.get(cardId);
      if (cardState) {
        cardStates.set(cardId, {
          ...cardState,
          orientation,
        });
      }
    }

    return {
      ...currentPlayer,
      energyZone: {
        ...currentPlayer.energyZone,
        cardStates,
      },
    };
  });

  return {
    gameState,
    updatedEnergyCardIds: uniqueCardIds,
    previousOrientations,
    nextOrientation: orientation,
  };
}

export function setFirstEnergyCardsOrientation(
  game: GameState,
  playerId: string,
  count: number,
  orientation: OrientationState,
  options: { readonly fromOrientation?: OrientationState } = {}
): SetEnergyOrientationResult | null {
  const player = getPlayerById(game, playerId);
  if (!player || count <= 0) {
    return null;
  }

  const cardIds = player.energyZone.cardIds
    .filter((cardId) => {
      const cardState = player.energyZone.cardStates.get(cardId);
      return (
        cardState !== undefined &&
        (options.fromOrientation === undefined ||
          cardState.orientation === options.fromOrientation)
      );
    })
    .slice(0, count);

  return setEnergyOrientation(game, playerId, cardIds, orientation);
}
