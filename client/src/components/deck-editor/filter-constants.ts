/**
 * filter-constants.ts - 卡牌筛选相关常量
 * 从 CardEditor 中提取的纯数据，无 React 依赖
 */

import type { BladeHearts } from '@game/domain/entities/card';
import { HeartColor, BladeHeartEffect } from '@game/shared/types/enums';
import { VALID_RARITIES } from '@game/shared/utils/card-code';

/** 稀有度选项 - 与后端 VALID_RARITIES 同步 */
export const RARITY_OPTIONS = VALID_RARITIES;

/** 真实团体选项（使用修正后的 Excel `真实团体`，不使用官方 `作品名`） */
export const GROUP_OPTIONS = [
  'μ’s',
  'Aqours',
  '虹ヶ咲',
  'Liella!',
  '蓮ノ空',
  'Saint Snow',
  'Sunny Passion',
  'A-RISE',
  'いきづらい部！',
] as const;

/** 真实团体 -> 小队名映射 */
export const GROUP_UNIT_MAP: Record<string, readonly string[]> = {
  'μ’s': ['「Printemps」', '「BiBi」', '「lilywhite」'],
  Aqours: ['「CYaRon！」', '「AZALEA」', '「GuiltyKiss」'],
  虹ヶ咲: ['「A・ZU・NA」', '「QU4RTZ」', '「DiverDiva」', '「R3BIRTH」'],
  'Liella!': ['「CatChu!」', '「KALEIDOSCORE」', '「5yncri5e!」'],
  蓮ノ空: ['「スリーズブーケ」', '「DOLLCHESTRA」', '「みらくらぱーく！」', '「EdelNote」'],
  'Saint Snow': ['「SaintSnow」'],
  'Sunny Passion': ['「SunnyPassion」'],
  'A-RISE': ['「A-RISE」'],
  'いきづらい部！': [],
};

/** 所有小组名选项（用于无真实团体筛选时） */
export const ALL_UNIT_OPTIONS = Object.values(GROUP_UNIT_MAP).flat();

/** 收录商品选项 */
export const PRODUCT_OPTIONS = [
  'スタートデッキラブライブ！スーパースター!!cheer',
  'コレクションクリアポケットラブライブ！蓮ノ空女学院スクールアイドルクラブ',
  'ブースターパック Royal Holiday',
  'プレミアムブースター蓮ノ空女学院スクールアイドルクラブ',
  'ブースターパック Anniversary 2026',
  'スタートデッキラブライブ！蓮ノ空女学院スクールアイドルクラブ',
  'スタートデッキラブライブ！サンシャイン!!',
  'スタートデッキラブライブ！虹ヶ咲学園スクールアイドル同好会',
  'ブースターパック SAPPHIRE MOON',
  'プレミアムブースター ラブライブ！',
  'ブースターパック夏、はじまる。',
  'スタートデッキラブライブ！',
  'プレミアムブースター ラブライブ！サンシャイン!!',
  'ブースターパック NEXT STEP',
  'プレミアムブースターラブライブ！スーパースター!!',
  'プレミアムブースターラブライブ！スーパースター!!DUO',
  'ブースターパック　vol.1',
  'プレミアムブースターラブライブ！虹ヶ咲学園スクールアイドル同好会',
  'スタートデッキラブライブ！スーパースター!!',
  'PRカード',
] as const;

/** 商品显示名（缩短长名称） */
export function getProductDisplayName(product: string): string {
  return product;
}

/** 费用范围 */
export const COST_MIN = 0;
export const COST_MAX = 22;

/** Live 分数范围 */
export const SCORE_MIN = 0;
export const SCORE_MAX = 9;

/** 团体显示名 */
export function getGroupDisplayName(group: string): string {
  return group;
}

/** 六种指定 Heart 颜色（带 UI 元数据）。 */
const STANDARD_HEART_COLOR_OPTIONS = [
  { value: HeartColor.PINK, label: '粉', colorClass: 'bg-pink-400' },
  { value: HeartColor.RED, label: '红', colorClass: 'bg-red-400' },
  { value: HeartColor.YELLOW, label: '黄', colorClass: 'bg-yellow-400' },
  { value: HeartColor.GREEN, label: '绿', colorClass: 'bg-green-400' },
  { value: HeartColor.BLUE, label: '蓝', colorClass: 'bg-blue-400' },
  { value: HeartColor.PURPLE, label: '紫', colorClass: 'bg-purple-400' },
] as const;

/** 成员印刷 Heart：GRAY 是无色，RAINBOW 是可代替指定颜色的 All Heart。 */
export const MEMBER_HEART_COLOR_OPTIONS = [
  ...STANDARD_HEART_COLOR_OPTIONS,
  { value: HeartColor.GRAY, label: '无色', colorClass: 'bg-gray-400' },
  { value: HeartColor.RAINBOW, label: 'All', colorClass: 'bg-pink-400' },
] as const;

/** LIVE 必要 Heart：RAINBOW 是不限颜色的通用需求，在 UI 中显示为无色。 */
export const REQUIREMENT_HEART_COLOR_OPTIONS = [
  ...STANDARD_HEART_COLOR_OPTIONS,
  { value: HeartColor.RAINBOW, label: '无色', colorClass: 'bg-gray-400' },
] as const;

/** 判心 Heart 颜色选项；GRAY 是无色判心，RAINBOW 是可代替任意颜色的 All Heart。 */
export const BLADE_HEART_COLOR_OPTIONS = [
  ...STANDARD_HEART_COLOR_OPTIONS,
  { value: HeartColor.GRAY, label: '无色', colorClass: 'bg-gray-400' },
  { value: HeartColor.RAINBOW, label: 'All', colorClass: 'bg-pink-400' },
] as const;

/** 判心效果筛选选项（bladeHeart） */
export const BLADE_HEART_OPTIONS = [
  ...BLADE_HEART_COLOR_OPTIONS.map((opt) => ({
    value: `HEART:${opt.value}` as const,
    label: opt.label,
    colorClass: opt.colorClass,
    icon: '♥' as const,
  })),
  { value: 'SCORE' as const, label: '+1', colorClass: 'bg-amber-400', icon: '♪' as const },
  { value: 'DRAW' as const, label: '抽卡', colorClass: 'bg-cyan-400', icon: '抽' as const },
];

export function matchesBladeHeartFilter(
  bladeHearts: BladeHearts | undefined,
  selectedBladeHeart: string | null
): boolean {
  if (!selectedBladeHeart) return true;
  if (!bladeHearts || bladeHearts.length === 0) return false;
  if (selectedBladeHeart === BladeHeartEffect.SCORE) {
    return bladeHearts.some((item) => item.effect === BladeHeartEffect.SCORE);
  }
  if (selectedBladeHeart === BladeHeartEffect.DRAW) {
    return bladeHearts.some((item) => item.effect === BladeHeartEffect.DRAW);
  }
  if (!selectedBladeHeart.startsWith('HEART:')) return false;

  const color = selectedBladeHeart.slice('HEART:'.length) as HeartColor;
  return bladeHearts.some(
    (item) => item.effect === BladeHeartEffect.HEART && item.heartColor === color
  );
}

/**
 * LIVE 通用必要 Heart 的权威存储值是 RAINBOW；同时接受已有 GRAY 投影，
 * 避免数据管理或历史数据中的无色需求被筛选器遗漏。
 */
export function matchesRequirementHeartColor(
  colorRequirements: ReadonlyMap<HeartColor, number>,
  selectedColor: HeartColor
): boolean {
  if (selectedColor === HeartColor.RAINBOW) {
    return colorRequirements.has(HeartColor.RAINBOW) || colorRequirements.has(HeartColor.GRAY);
  }
  return colorRequirements.has(selectedColor);
}

/** 卡牌类型色彩主题 */
export const CARD_TYPE_COLORS = {
  MEMBER: {
    accent: 'orange',
    bg: 'bg-[color:color-mix(in_srgb,var(--accent-secondary)_14%,transparent)]',
    border: 'border-[color:color-mix(in_srgb,var(--accent-secondary)_34%,transparent)]',
    text: 'text-[var(--accent-secondary)]',
    dot: 'bg-[var(--accent-secondary)]',
  },
  LIVE: {
    accent: 'rose',
    bg: 'bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,transparent)]',
    border: 'border-[color:color-mix(in_srgb,var(--accent-primary)_34%,transparent)]',
    text: 'text-[var(--accent-primary)]',
    dot: 'bg-[var(--accent-primary)]',
  },
  ENERGY: {
    accent: 'sky',
    bg: 'bg-[color:color-mix(in_srgb,var(--semantic-info)_14%,transparent)]',
    border: 'border-[color:color-mix(in_srgb,var(--semantic-info)_34%,transparent)]',
    text: 'text-[var(--semantic-info)]',
    dot: 'bg-[var(--semantic-info)]',
  },
} as const;
