import { getPlayerById, type GameState } from '../entities/game.js';

/** Returns whether the player has refreshed their own main deck during this turn. */
export function hasPlayerRefreshedDeckThisTurn(game: GameState, playerId: string): boolean {
  return getPlayerById(game, playerId)?.lastDeckRefreshTurnCount === game.turnCount;
}
