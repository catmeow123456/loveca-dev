import { isMemberCardData } from '../../../domain/entities/card.js';
import {
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
  type LiveModifierState,
} from '../../../domain/entities/game.js';
import { addLiveModifier } from '../../../domain/rules/live-modifiers.js';
import { OrientationState } from '../../../shared/types/enums.js';
import { paySelectedDiscardHandCost } from '../../effects/effect-costs.js';
import { drawCardsFromMainDeckToHand, type DrawCardsResult } from '../../effects/draw.js';
import { shuffleZone } from '../../../domain/entities/zone.js';
import {
  setFirstEnergyCardsOrientation,
  type EnergyOrientationChange,
} from '../../effects/energy.js';

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

export interface ActivateWaitingEnergyCardsForPlayerResult {
  readonly gameState: GameState;
  readonly activatedEnergyCardIds: readonly string[];
  readonly previousOrientations: readonly EnergyOrientationChange[];
  readonly nextOrientation: OrientationState;
}

export interface AddBladeLiveModifierForSourceMemberOptions {
  readonly playerId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly amount: number;
}

export interface AddBladeLiveModifierForSourceMemberResult {
  readonly gameState: GameState;
  readonly modifier: Extract<LiveModifierState, { readonly kind: 'BLADE' }>;
  readonly bladeBonus: number;
}

export interface ShuffleWaitingRoomCardsToDeckBottomForPlayerResult {
  readonly gameState: GameState;
  readonly movedCardIds: readonly string[];
  readonly originalCardIds: readonly string[];
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

export function activateWaitingEnergyCardsForPlayer(
  game: GameState,
  playerId: string,
  count: number
): ActivateWaitingEnergyCardsForPlayerResult | null {
  if (!Number.isInteger(count) || count < 0) {
    return null;
  }

  if (count === 0) {
    const player = getPlayerById(game, playerId);
    return player
      ? {
          gameState: game,
          activatedEnergyCardIds: [],
          previousOrientations: [],
          nextOrientation: OrientationState.ACTIVE,
        }
      : null;
  }

  const orientationResult = setFirstEnergyCardsOrientation(
    game,
    playerId,
    count,
    OrientationState.ACTIVE,
    { fromOrientation: OrientationState.WAITING }
  );
  if (!orientationResult || orientationResult.updatedEnergyCardIds.length !== count) {
    return null;
  }

  return {
    gameState: orientationResult.gameState,
    activatedEnergyCardIds: orientationResult.updatedEnergyCardIds,
    previousOrientations: orientationResult.previousOrientations,
    nextOrientation: orientationResult.nextOrientation,
  };
}

export function addBladeLiveModifierForSourceMember(
  game: GameState,
  options: AddBladeLiveModifierForSourceMemberOptions
): AddBladeLiveModifierForSourceMemberResult | null {
  const { playerId, sourceCardId, abilityId, amount } = options;
  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data)
  ) {
    return null;
  }

  const modifier: Extract<LiveModifierState, { readonly kind: 'BLADE' }> = {
    kind: 'BLADE',
    playerId,
    countDelta: amount,
    sourceCardId,
    abilityId,
  };

  return {
    gameState: addLiveModifier(game, modifier),
    modifier,
    bladeBonus: amount,
  };
}

export function shuffleWaitingRoomCardsToDeckBottomForPlayer(
  game: GameState,
  playerId: string,
  cardIds: readonly string[]
): ShuffleWaitingRoomCardsToDeckBottomForPlayerResult | null {
  const player = getPlayerById(game, playerId);
  const uniqueCardIds = new Set(cardIds);
  if (!player || uniqueCardIds.size !== cardIds.length) {
    return null;
  }

  if (cardIds.some((cardId) => !player.waitingRoom.cardIds.includes(cardId))) {
    return null;
  }

  if (cardIds.length === 0) {
    return {
      gameState: game,
      movedCardIds: [],
      originalCardIds: [],
    };
  }

  const shuffledCardIds = shuffleZone({
    ...player.waitingRoom,
    cardIds: [...cardIds],
  }).cardIds;
  const selectedCardIdSet = new Set(cardIds);
  const gameState = updatePlayer(game, playerId, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: currentPlayer.waitingRoom.cardIds.filter(
        (cardId) => !selectedCardIdSet.has(cardId)
      ),
    },
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: [...currentPlayer.mainDeck.cardIds, ...shuffledCardIds],
    },
  }));

  return {
    gameState,
    movedCardIds: shuffledCardIds,
    originalCardIds: cardIds,
  };
}
