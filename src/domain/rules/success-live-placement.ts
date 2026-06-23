import { isLiveCardData } from '../entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';

export function isLiveCardProhibitedFromSuccessZone(
  game: GameState,
  cardId: string
): boolean {
  const card = getCardById(game, cardId);
  return (
    card !== null &&
    isLiveCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!S-bp2-024')
  );
}

export function canLiveCardEnterSuccessZone(
  game: GameState,
  playerId: string,
  cardId: string
): boolean {
  const card = getCardById(game, cardId);
  if (!card || card.ownerId !== playerId || !isLiveCardData(card.data)) {
    return false;
  }
  return !isLiveCardProhibitedFromSuccessZone(game, cardId);
}

export function getSuccessLiveSelectionCandidateIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return [...game.liveResolution.liveResults.entries()]
    .filter(([, isSuccess]) => isSuccess === true)
    .map(([cardId]) => cardId)
    .filter(
      (cardId) =>
        player.liveZone.cardIds.includes(cardId) &&
        canLiveCardEnterSuccessZone(game, playerId, cardId)
    );
}

export function getCompletedSuccessLiveSettlementPlayerIds(game: GameState): readonly string[] {
  return [
    ...new Set([
      ...game.liveResolution.settlementConfirmedBy,
      ...game.liveResolution.successCardMovedBy,
    ]),
  ];
}

export function getCurrentSuccessLiveSettlementPlayerId(game: GameState): string | null {
  const completedPlayerIds = new Set(getCompletedSuccessLiveSettlementPlayerIds(game));
  return (
    game.liveResolution.liveWinnerIds.find((playerId) => !completedPlayerIds.has(playerId)) ?? null
  );
}

export function haveAllSuccessLiveSettlementsCompleted(game: GameState): boolean {
  if (game.liveResolution.liveWinnerIds.length === 0) {
    return true;
  }
  const completedPlayerIds = new Set(getCompletedSuccessLiveSettlementPlayerIds(game));
  return game.liveResolution.liveWinnerIds.every((playerId) => completedPlayerIds.has(playerId));
}

export function hasPendingSuccessLiveSelection(game: GameState, playerId: string): boolean {
  return (
    getCurrentSuccessLiveSettlementPlayerId(game) === playerId &&
    getSuccessLiveSelectionCandidateIds(game, playerId).length > 0
  );
}
