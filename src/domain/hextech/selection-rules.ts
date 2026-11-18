import type { HextechPool } from './catalog.js';

const EQUAL_RARITY_WEIGHTS = [1, 1, 1] as const;
const DARK_RARITY_WEIGHTS = {
  1: [55, 35, 10],
  3: [25, 50, 25],
} as const;

/** SILVER / GOLD / PRISMATIC; each round is independent of previous rarities. */
export function getHextechRarityWeights(
  pool: HextechPool,
  turn: number
): readonly [number, number, number] {
  return pool === 'DARK' && (turn === 1 || turn === 3)
    ? DARK_RARITY_WEIGHTS[turn]
    : EQUAL_RARITY_WEIGHTS;
}

export const HEXTECH_FIRST_ROUND_EXCLUSIONS: Record<HextechPool, readonly string[]> = {
  NORMAL: ['table-flip'],
  DARK: ['dark-position-mishap', 'dark-silent-column'],
};

/** Shared copy for the lobby and selection help, using the same weights as the draw. */
export function getHextechRarityRulesText(pool: HextechPool): string {
  if (pool === 'NORMAL') return '银／金／彩各1/3。';
  return `银／金／彩：第1回合${DARK_RARITY_WEIGHTS[1].join('%／')}%，第3回合${DARK_RARITY_WEIGHTS[3].join('%／')}%，第5回合各1/3。各轮独立抽取，可连续出彩。`;
}

export const DARK_HEXTECH_OFFER_RULES_TEXT =
  '候选与重抽均不重复、排除自己已持有的能力，并保留至少1项干扰和1项双刃剑。首轮不出现「站位事故」「突然断电」。';

export const NORMAL_HEXTECH_FIRST_ROUND_RULES_TEXT =
  '首轮初始候选和重抽不出现「掀桌」，第3、5回合恢复入池。';
