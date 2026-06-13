import type { GameState } from '../../domain/entities/game.js';
import { getPlayerById, updatePlayer } from '../../domain/entities/game.js';
import { addCardToZone } from '../../domain/entities/zone.js';

export interface DrawCardsResult {
  readonly gameState: GameState;
  readonly drawnCardIds: readonly string[];
}

export function drawCardsFromMainDeckToHand(
  game: GameState,
  playerId: string,
  count: number
): DrawCardsResult | null {
  const player = getPlayerById(game, playerId);
  if (!player || count <= 0) {
    return null;
  }

  const drawnCardIds = player.mainDeck.cardIds.slice(0, count);
  if (drawnCardIds.length === 0) {
    return {
      gameState: game,
      drawnCardIds: [],
    };
  }

  const gameState = updatePlayer(game, playerId, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: currentPlayer.mainDeck.cardIds.slice(drawnCardIds.length),
    },
    hand: drawnCardIds.reduce((hand, cardId) => addCardToZone(hand, cardId), currentPlayer.hand),
  }));

  return {
    gameState,
    drawnCardIds,
  };
}
