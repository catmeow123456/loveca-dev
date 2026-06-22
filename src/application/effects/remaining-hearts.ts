import type { GameState } from '../../domain/entities/game.js';
import type { HeartColor } from '../../shared/types/enums.js';

export function getRemainingHeartCount(
  game: GameState,
  playerId: string,
  color?: HeartColor
): number {
  const hearts = game.liveResolution.playerRemainingHearts.get(playerId) ?? [];
  if (color === undefined) {
    return getRemainingHeartTotalCount(game, playerId);
  }

  return hearts
    .filter((heart) => heart.color === color)
    .reduce((total, heart) => total + heart.count, 0);
}

export function getRemainingHeartTotalCount(game: GameState, playerId: string): number {
  const hearts = game.liveResolution.playerRemainingHearts.get(playerId) ?? [];
  return hearts.reduce((total, heart) => total + heart.count, 0);
}

export function hasRemainingHearts(game: GameState, playerId: string, minCount = 1): boolean {
  return getRemainingHeartTotalCount(game, playerId) >= minCount;
}

export function hasRemainingHeartColor(
  game: GameState,
  playerId: string,
  color: HeartColor,
  minCount = 1
): boolean {
  return getRemainingHeartCount(game, playerId, color) >= minCount;
}

export function hasNoRemainingHearts(game: GameState, playerId: string): boolean {
  return getRemainingHeartTotalCount(game, playerId) === 0;
}
