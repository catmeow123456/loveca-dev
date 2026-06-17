import { isLiveCardData } from '../entities/card.js';
import type { GameState } from '../entities/game.js';
import { getCardById, getPlayerById } from '../entities/game.js';

export function sumSuccessfulLiveScore(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return player.successZone.cardIds.reduce((sum, cardId) => {
    const card = getCardById(game, cardId);
    if (!card || !isLiveCardData(card.data)) {
      return sum;
    }
    return sum + card.data.score;
  }, 0);
}

export function successLiveScoreAtLeast(
  game: GameState,
  playerId: string,
  minScore: number
): boolean {
  return sumSuccessfulLiveScore(game, playerId) >= minScore;
}
