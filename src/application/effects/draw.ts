import type { GameState } from '../../domain/entities/game.js';
import { getPlayerById, updatePlayer } from '../../domain/entities/game.js';
import { addCardToZone } from '../../domain/entities/zone.js';
import { applyPendingRefreshForPlayer } from './refresh.js';

export interface DrawCardsResult {
  readonly gameState: GameState;
  readonly drawnCardIds: readonly string[];
}

export function drawCardsFromMainDeckToHand(
  game: GameState,
  playerId: string,
  count: number
): DrawCardsResult | null {
  if (count <= 0) {
    return null;
  }

  let state = game;
  const drawnCardIds: string[] = [];

  while (drawnCardIds.length < count) {
    state = applyPendingRefreshForPlayer(state, playerId);

    const player = getPlayerById(state, playerId);
    if (!player) {
      return null;
    }
    const cardId = player.mainDeck.cardIds[0];
    if (!cardId) {
      break;
    }

    state = updatePlayer(state, playerId, (currentPlayer) => ({
      ...currentPlayer,
      mainDeck: {
        ...currentPlayer.mainDeck,
        cardIds: currentPlayer.mainDeck.cardIds.slice(1),
      },
      hand: addCardToZone(currentPlayer.hand, cardId),
    }));
    drawnCardIds.push(cardId);
    state = applyPendingRefreshForPlayer(state, playerId);
  }

  return {
    gameState: state,
    drawnCardIds,
  };
}
