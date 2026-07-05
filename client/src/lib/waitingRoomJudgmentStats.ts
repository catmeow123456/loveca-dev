import type { AnyCardData } from '@game/domain/entities/card';
import { BladeHeartEffect, HeartColor } from '@game/shared/types/enums';

export interface WaitingRoomJudgmentStats {
  readonly hearts: Record<HeartColor, number>;
  readonly totalHearts: number;
  readonly scoreBonus: number;
  readonly drawBonus: number;
  readonly noJudgmentCount: number;
}

function createEmptyWaitingRoomHeartCounts(): Record<HeartColor, number> {
  return {
    [HeartColor.RAINBOW]: 0,
    [HeartColor.PINK]: 0,
    [HeartColor.RED]: 0,
    [HeartColor.YELLOW]: 0,
    [HeartColor.GREEN]: 0,
    [HeartColor.BLUE]: 0,
    [HeartColor.PURPLE]: 0,
  };
}

function addWaitingRoomHeart(
  stats: { hearts: Record<HeartColor, number>; totalHearts: number },
  color: HeartColor,
  count: number
): void {
  if (count <= 0) return;
  stats.hearts[color] = (stats.hearts[color] ?? 0) + count;
  stats.totalHearts += count;
}

function hasEffectiveBladeHeart(cardData: AnyCardData): boolean {
  if (!('bladeHearts' in cardData) || !cardData.bladeHearts) return false;

  return cardData.bladeHearts.some((bladeHeart) => {
    switch (bladeHeart.effect) {
      case BladeHeartEffect.HEART:
        return bladeHeart.heartColor !== undefined;
      case BladeHeartEffect.SCORE:
      case BladeHeartEffect.DRAW:
        return true;
    }
  });
}

export function collectWaitingRoomJudgmentStats(
  cardDataList: readonly AnyCardData[]
): WaitingRoomJudgmentStats {
  const stats = {
    hearts: createEmptyWaitingRoomHeartCounts(),
    totalHearts: 0,
    scoreBonus: 0,
    drawBonus: 0,
    noJudgmentCount: 0,
  };

  for (const cardData of cardDataList) {
    if (!hasEffectiveBladeHeart(cardData)) {
      stats.noJudgmentCount += 1;
      continue;
    }

    if (!('bladeHearts' in cardData) || !cardData.bladeHearts) continue;

    for (const bladeHeart of cardData.bladeHearts) {
      switch (bladeHeart.effect) {
        case BladeHeartEffect.HEART:
          if (bladeHeart.heartColor) {
            addWaitingRoomHeart(stats, bladeHeart.heartColor, 1);
          }
          break;
        case BladeHeartEffect.SCORE:
          stats.scoreBonus += 1;
          break;
        case BladeHeartEffect.DRAW:
          stats.drawBonus += 1;
          break;
      }
    }
  }

  return stats;
}

export function hasWaitingRoomJudgmentStats(stats: WaitingRoomJudgmentStats): boolean {
  return (
    stats.totalHearts > 0 ||
    stats.scoreBonus > 0 ||
    stats.drawBonus > 0 ||
    stats.noJudgmentCount > 0
  );
}
