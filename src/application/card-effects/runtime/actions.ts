import { getPlayerById, updatePlayer, type GameState } from '../../../domain/entities/game.js';
import { paySelectedDiscardHandCost } from '../../effects/effect-costs.js';
import { drawCardsFromMainDeckToHand, type DrawCardsResult } from '../../effects/draw.js';

export interface DrawCardsForEachPlayerResult {
  readonly gameState: GameState;
  readonly drawnCardIdsByPlayer: Readonly<Record<string, readonly string[]>>;
}

export interface DiscardHandCardsToWaitingRoomOptions {
  readonly count: number;
  readonly candidateCardIds?: readonly string[];
}

export interface DiscardOneHandCardToWaitingRoomOptions {
  readonly candidateCardIds?: readonly string[];
}

export interface DiscardHandCardsToWaitingRoomResult {
  readonly gameState: GameState;
  readonly discardedCardIds: readonly string[];
}

export type RecoverCardsFromWaitingRoomToHandOptions =
  | {
      readonly candidateCardIds: readonly string[];
      readonly exactCount: number;
      readonly minCount?: never;
      readonly maxCount?: never;
    }
  | {
      readonly candidateCardIds: readonly string[];
      readonly exactCount?: never;
      readonly minCount: number;
      readonly maxCount: number;
    };

export interface RecoverCardsFromWaitingRoomToHandResult {
  readonly gameState: GameState;
  readonly movedCardIds: readonly string[];
  readonly selectedCardIds: readonly string[];
  readonly remainingCandidateIds: readonly string[];
}

export function drawCardsForPlayer(
  game: GameState,
  playerId: string,
  count: number
): DrawCardsResult | null {
  return drawCardsFromMainDeckToHand(game, playerId, count);
}

export function drawCardsForEachPlayer(
  game: GameState,
  playerIds: readonly string[],
  count: number
): DrawCardsForEachPlayerResult | null {
  let state = game;
  const drawnCardIdsByPlayer: Record<string, readonly string[]> = {};

  for (const playerId of playerIds) {
    const drawResult = drawCardsForPlayer(state, playerId, count);
    if (!drawResult) {
      return null;
    }
    state = drawResult.gameState;
    drawnCardIdsByPlayer[playerId] = drawResult.drawnCardIds;
  }

  return {
    gameState: state,
    drawnCardIdsByPlayer,
  };
}

export function discardHandCardsToWaitingRoomForPlayer(
  game: GameState,
  playerId: string,
  selectedCardIds: readonly string[],
  options: DiscardHandCardsToWaitingRoomOptions
): DiscardHandCardsToWaitingRoomResult | null {
  const exactCount = Math.floor(options.count);
  if (exactCount < 0) {
    return null;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const candidateCardIds = options.candidateCardIds;
  if (
    selectedCardIds.length !== exactCount ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    (candidateCardIds &&
      uniqueSelectedCardIds.some((cardId) => !candidateCardIds.includes(cardId)))
  ) {
    return null;
  }

  if (exactCount === 0) {
    return {
      gameState: game,
      discardedCardIds: [],
    };
  }

  const discardResult = paySelectedDiscardHandCost(game, playerId, uniqueSelectedCardIds);
  if (!discardResult) {
    return null;
  }

  return {
    gameState: discardResult.gameState,
    discardedCardIds: discardResult.discardedHandCardIds,
  };
}

export function discardOneHandCardToWaitingRoomForPlayer(
  game: GameState,
  playerId: string,
  selectedCardId: string,
  options: DiscardOneHandCardToWaitingRoomOptions = {}
): DiscardHandCardsToWaitingRoomResult | null {
  return discardHandCardsToWaitingRoomForPlayer(game, playerId, [selectedCardId], {
    count: 1,
    candidateCardIds: options.candidateCardIds,
  });
}

export function recoverCardsFromWaitingRoomToHandForPlayer(
  game: GameState,
  playerId: string,
  selectedCardIds: readonly string[],
  options: RecoverCardsFromWaitingRoomToHandOptions
): RecoverCardsFromWaitingRoomToHandResult | null {
  const hasExactCount = options.exactCount !== undefined;
  const hasRangeCount = options.minCount !== undefined || options.maxCount !== undefined;
  if (hasExactCount === hasRangeCount) {
    return null;
  }

  const minCount = hasExactCount ? options.exactCount : options.minCount;
  const maxCount = hasExactCount ? options.exactCount : options.maxCount;
  if (
    !Number.isInteger(minCount) ||
    !Number.isInteger(maxCount) ||
    minCount < 0 ||
    maxCount < minCount
  ) {
    return null;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    selectedCardIds.length < minCount ||
    selectedCardIds.length > maxCount ||
    selectedCardIds.some((cardId) => !options.candidateCardIds.includes(cardId))
  ) {
    return null;
  }

  const player = getPlayerById(game, playerId);
  if (!player || selectedCardIds.some((cardId) => !player.waitingRoom.cardIds.includes(cardId))) {
    return null;
  }

  const remainingCandidateIds = options.candidateCardIds.filter(
    (cardId) => !selectedCardIds.includes(cardId)
  );
  if (selectedCardIds.length === 0) {
    return {
      gameState: game,
      movedCardIds: [],
      selectedCardIds,
      remainingCandidateIds,
    };
  }

  const gameState = updatePlayer(game, playerId, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: currentPlayer.waitingRoom.cardIds.filter(
        (cardId) => !selectedCardIds.includes(cardId)
      ),
    },
    hand: {
      ...currentPlayer.hand,
      cardIds: [...currentPlayer.hand.cardIds, ...selectedCardIds],
    },
  }));

  return {
    gameState,
    movedCardIds: selectedCardIds,
    selectedCardIds,
    remainingCandidateIds,
  };
}
