import { BladeHeartEffect, HeartColor } from '@game/shared/types/enums';
import { getCheerHeartContributionColor } from '@game/shared/utils/cheer-hearts';
import type { ViewBladeHeartItem } from '@game/online/types';

/** Keep effective marker colors for display and derive their separate judgment contribution. */
export function calculateCheerEffects(bladeHearts?: readonly ViewBladeHeartItem[]): {
  penLightHearts: { color: HeartColor; count: number }[];
  judgmentHearts: { color: HeartColor; count: number }[];
  drawBonus: number;
  scoreBonus: number;
} {
  const penLightHearts: { color: HeartColor; count: number }[] = [];
  const judgmentHearts: { color: HeartColor; count: number }[] = [];
  let drawBonus = 0;
  let scoreBonus = 0;
  for (const item of bladeHearts ?? []) {
    if (item.effect === BladeHeartEffect.DRAW) drawBonus += 1;
    if (item.effect === BladeHeartEffect.SCORE) scoreBonus += 1;
    if (item.effect === BladeHeartEffect.HEART && item.heartColor) {
      penLightHearts.push({ color: item.heartColor, count: 1 });
      judgmentHearts.push({ color: getCheerHeartContributionColor(item.heartColor), count: 1 });
    }
  }
  return { penLightHearts, judgmentHearts, drawBonus, scoreBonus };
}

/** Only cheer markers use the provisional ORANGE contribution rule; other Hearts keep their color. */
export function summarizeLiveHearts(
  memberHearts: ReadonlyMap<HeartColor, number>,
  cheers: readonly ReturnType<typeof calculateCheerEffects>[],
  bonusHearts: readonly { color: HeartColor; count: number }[] = []
): {
  bladeHearts: Map<HeartColor, number>;
  totalHearts: Map<HeartColor, number>;
  judgmentHearts: Map<HeartColor, number>;
} {
  const bladeHearts = new Map(Object.values(HeartColor).map((color) => [color, 0]));
  const judgmentHearts = new Map(
    Object.values(HeartColor).map((color) => [color, memberHearts.get(color) ?? 0])
  );
  for (const cheer of cheers) {
    for (const heart of cheer.penLightHearts) {
      bladeHearts.set(heart.color, (bladeHearts.get(heart.color) ?? 0) + heart.count);
    }
    for (const heart of cheer.judgmentHearts) {
      judgmentHearts.set(heart.color, (judgmentHearts.get(heart.color) ?? 0) + heart.count);
    }
  }
  for (const heart of bonusHearts) {
    bladeHearts.set(heart.color, (bladeHearts.get(heart.color) ?? 0) + heart.count);
    judgmentHearts.set(heart.color, (judgmentHearts.get(heart.color) ?? 0) + heart.count);
  }
  const totalHearts = new Map(
    Object.values(HeartColor).map((color) => [
      color,
      (memberHearts.get(color) ?? 0) + (bladeHearts.get(color) ?? 0),
    ])
  );
  return { bladeHearts, totalHearts, judgmentHearts };
}
