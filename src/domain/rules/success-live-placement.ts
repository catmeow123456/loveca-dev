import { isLiveCardData } from '../entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';

export interface LiveScoreTieState {
  readonly firstPlayerId: string;
  readonly secondPlayerId: string;
  readonly firstScore: number;
  readonly secondScore: number;
  readonly scoresTied: boolean;
}

export interface AddSuccessLivePlacementRestrictionOptions {
  readonly playerId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
}

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
  if (isSuccessLivePlacementRestrictedByTiedScore(game)) {
    return false;
  }
  return !isLiveCardProhibitedFromSuccessZone(game, cardId);
}

export function addSuccessLivePlacementRestrictionUntilLiveEnd(
  game: GameState,
  options: AddSuccessLivePlacementRestrictionOptions
): GameState {
  const alreadyRegistered = game.liveResolution.successLivePlacementRestrictions.some(
    (restriction) =>
      restriction.sourceCardId === options.sourceCardId &&
      restriction.abilityId === options.abilityId
  );
  if (alreadyRegistered) {
    return game;
  }

  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      successLivePlacementRestrictions: [
        ...game.liveResolution.successLivePlacementRestrictions,
        {
          playerId: options.playerId,
          sourceCardId: options.sourceCardId,
          abilityId: options.abilityId,
          appliesWhen: 'TIED_LIVE_SCORE',
          expiresAt: 'LIVE_END',
        },
      ],
    },
  };
}

export function getLiveScoreTieState(game: GameState): LiveScoreTieState | null {
  const [firstPlayer, secondPlayer] = game.players;
  if (!firstPlayer || !secondPlayer) {
    return null;
  }
  const firstScore = game.liveResolution.playerScores.get(firstPlayer.id) ?? 0;
  const secondScore = game.liveResolution.playerScores.get(secondPlayer.id) ?? 0;
  return {
    firstPlayerId: firstPlayer.id,
    secondPlayerId: secondPlayer.id,
    firstScore,
    secondScore,
    scoresTied: firstScore === secondScore,
  };
}

export function isSuccessLivePlacementRestrictedByTiedScore(game: GameState): boolean {
  const tieState = getLiveScoreTieState(game);
  return (
    tieState?.scoresTied === true &&
    (game.liveResolution.successLivePlacementRestrictions ?? []).some(
      (restriction) =>
        restriction.appliesWhen === 'TIED_LIVE_SCORE' && restriction.expiresAt === 'LIVE_END'
    )
  );
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
