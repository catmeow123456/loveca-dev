import type { GameState } from '../../domain/entities/game.js';
import type { HeartIcon } from '../../domain/entities/card.js';
import { updateLiveResolution } from '../../domain/entities/game.js';
import { HeartColor } from '../../shared/types/enums.js';

export interface RebalanceRemainingHeartColorForPlayerResult {
  readonly gameState: GameState;
  readonly rebalancedCount: number;
  readonly remainingColorCountBefore: number;
  readonly remainingColorCountAfter: number;
  readonly remainingRainbowCountBefore: number;
}

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

export function rebalanceRemainingHeartColorForPlayer(
  game: GameState,
  playerId: string,
  color: HeartColor,
  minCount = 1
): RebalanceRemainingHeartColorForPlayerResult {
  const remainingHearts = game.liveResolution.playerRemainingHearts.get(playerId) ?? [];
  const remainingColorCountBefore = countHeartsByColor(remainingHearts, color);
  const remainingRainbowCountBefore = countHeartsByColor(remainingHearts, HeartColor.RAINBOW);
  const neededColorCount = Math.max(0, minCount - remainingColorCountBefore);
  if (neededColorCount === 0 || remainingRainbowCountBefore === 0 || color === HeartColor.RAINBOW) {
    return {
      gameState: game,
      rebalancedCount: 0,
      remainingColorCountBefore,
      remainingColorCountAfter: remainingColorCountBefore,
      remainingRainbowCountBefore,
    };
  }

  const liveJudgmentHearts = game.liveResolution.playerLiveJudgmentHearts.get(playerId) ?? [];
  const liveJudgmentColorCount = countHeartsByColor(liveJudgmentHearts, color);
  const consumedColorCount = Math.max(0, liveJudgmentColorCount - remainingColorCountBefore);
  const rebalancedCount = Math.min(
    neededColorCount,
    remainingRainbowCountBefore,
    consumedColorCount
  );
  if (rebalancedCount <= 0) {
    return {
      gameState: game,
      rebalancedCount: 0,
      remainingColorCountBefore,
      remainingColorCountAfter: remainingColorCountBefore,
      remainingRainbowCountBefore,
    };
  }

  const nextRemainingHearts = addHeartCount(
    addHeartCount(remainingHearts, HeartColor.RAINBOW, -rebalancedCount),
    color,
    rebalancedCount
  );
  const playerRemainingHearts = new Map(game.liveResolution.playerRemainingHearts);
  playerRemainingHearts.set(playerId, nextRemainingHearts);

  return {
    gameState: updateLiveResolution(game, (liveResolution) => ({
      ...liveResolution,
      playerRemainingHearts,
    })),
    rebalancedCount,
    remainingColorCountBefore,
    remainingColorCountAfter: remainingColorCountBefore + rebalancedCount,
    remainingRainbowCountBefore,
  };
}

function countHeartsByColor(hearts: readonly HeartIcon[], color: HeartColor): number {
  return hearts
    .filter((heart) => heart.color === color)
    .reduce((total, heart) => total + heart.count, 0);
}

function addHeartCount(
  hearts: readonly HeartIcon[],
  color: HeartColor,
  countDelta: number
): readonly HeartIcon[] {
  const counts = new Map<HeartColor, number>();
  for (const heart of hearts) {
    counts.set(heart.color, (counts.get(heart.color) ?? 0) + heart.count);
  }
  counts.set(color, (counts.get(color) ?? 0) + countDelta);

  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([heartColor, count]) => ({ color: heartColor, count }));
}
