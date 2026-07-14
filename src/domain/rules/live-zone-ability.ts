import { isLiveCardData } from '../entities/card.js';
import type { GameState } from '../entities/game.js';
import { getCardById, getPlayerById } from '../entities/game.js';

export function hasLiveWithoutLiveStartOrSuccessAbility(
  game: GameState,
  playerId: string
): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  return [...new Set(player.liveZone.cardIds)].some((liveCardId) => {
    const card = getCardById(game, liveCardId);
    return (
      card !== null &&
      card.ownerId === playerId &&
      isLiveCardData(card.data) &&
      !liveHasLiveStartOrSuccessAbility(card.data.cardText)
    );
  });
}

export function liveHasLiveStartOrSuccessAbility(cardText: string | undefined): boolean {
  if (!cardText) {
    return false;
  }

  return (
    cardText.includes('【LIVE开始时】') ||
    cardText.includes('【LIVE開始時】') ||
    cardText.includes('【LIVE成功时】') ||
    cardText.includes('【LIVE成功時】') ||
    cardText.includes('{{live_start.png|ライブ開始時}}') ||
    cardText.includes('{{live_success.png|ライブ成功時}}') ||
    cardText.includes('ライブ開始時') ||
    cardText.includes('ライブ成功時')
  );
}
