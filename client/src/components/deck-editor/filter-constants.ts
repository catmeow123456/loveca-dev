/**
 * filter-constants.ts - 卡牌筛选相关常量
 * 从 CardEditor 中提取的纯数据，无 React 依赖
 */

import { HeartColor, BladeHeartEffect } from '@game/shared/types/enums';
import { VALID_RARITIES } from '@game/shared/utils/card-code';

/** 稀有度选项 - 与后端 VALID_RARITIES 同步 */
export const RARITY_OPTIONS = VALID_RARITIES;

/** 作品名选项（原组合名已迁移为作品名） */
export const GROUP_OPTIONS = [
  'ラブライブ！',
  'ラブライブ！サンシャイン!!',
  'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
  'ラブライブ！スーパースター!!',
  '蓮ノ空女学院スクールアイドルクラブ',
  '其他'
] as const;

/** 作品名 -> 小组名映射 */
export const GROUP_UNIT_MAP: Record<string, readonly string[]> = {
  'ラブライブ！': ['「Printemps」', '「BiBi」', '「lilywhite」'],
  'ラブライブ！サンシャイン!!': ['「CYaRon！」', '「AZALEA」', '「GuiltyKiss」'],
  'ラブライブ！虹ヶ咲学園スクールアイドル同好会': ['「A・ZU・NA」', '「QU4RTZ」', '「DiverDiva」', '「R3BIRTH」'],
  'ラブライブ！スーパースター!!': ['「CatChu!」', '「KALEIDOSCORE」', '「5yncri5e!」'],
  '蓮ノ空女学院スクールアイドルクラブ': ['「スリーズブーケ」', '「DOLLCHESTRA」', '「みらくらぱーく！」', '「EdelNote」'],
  '其他': ['「AiScReam」', '「SaintSnow」', '「SunnyPassion」', '「A-RISE」']
};

/** 所有小组名选项（用于无组合筛选时） */
export const ALL_UNIT_OPTIONS = Object.values(GROUP_UNIT_MAP).flat();

/** 收录商品选项 */
export const PRODUCT_OPTIONS = [
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
  'ブースターパック　vol.1',
  'プレミアムブースターラブライブ！虹ヶ咲学園スクールアイドル同好会',
  'スタートデッキラブライブ！スーパースター!!',
  'PRカード'
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

/** 作品显示名（缩短长名称） */
export function getGroupDisplayName(group: string): string {
  if (group === 'ラブライブ！') return "ラブライブ！(μ's)";
  if (group === 'ラブライブ！サンシャイン!!') return 'サンシャイン!!';
  if (group === 'ラブライブ！虹ヶ咲学園スクールアイドル同好会') return '虹ヶ咲';
  if (group === 'ラブライブ！スーパースター!!') return 'スーパースター!!';
  if (group === '蓮ノ空女学院スクールアイドルクラブ') return '蓮ノ空';
  return group;
}

/** 心颜色枚举列表（用于表单 select） */
export const HEART_COLORS: HeartColor[] = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
  HeartColor.RAINBOW,
];

/** 心颜色筛选选项（带 UI 元数据） */
export const HEART_COLOR_OPTIONS = [
  { value: HeartColor.PINK, label: '粉', colorClass: 'bg-pink-400' },
  { value: HeartColor.RED, label: '红', colorClass: 'bg-red-400' },
  { value: HeartColor.YELLOW, label: '黄', colorClass: 'bg-yellow-400' },
  { value: HeartColor.GREEN, label: '绿', colorClass: 'bg-green-400' },
  { value: HeartColor.BLUE, label: '蓝', colorClass: 'bg-blue-400' },
  { value: HeartColor.PURPLE, label: '紫', colorClass: 'bg-purple-400' },
  { value: HeartColor.RAINBOW, label: '灰', colorClass: 'bg-gray-400' },
] as const;

/** 判心效果筛选选项（bladeHeart） */
export const BLADE_HEART_OPTIONS = [
  ...HEART_COLOR_OPTIONS.map(opt => ({
    value: `HEART:${opt.value}` as const,
    label: opt.value === HeartColor.RAINBOW ? 'All' : opt.label,
    colorClass: opt.value === HeartColor.RAINBOW ? 'bg-pink-400' : opt.colorClass,
    icon: '♥' as const,
  })),
  { value: 'SCORE' as const, label: '+1', colorClass: 'bg-amber-400', icon: '♪' as const },
  { value: 'DRAW' as const, label: '抽卡', colorClass: 'bg-cyan-400', icon: '🃏' as const },
];

/** 卡牌类型色彩主题 */
export const CARD_TYPE_COLORS = {
  MEMBER: {
    accent: 'orange',
    bg: 'bg-orange-500/20',
    border: 'border-orange-400/50',
    text: 'text-orange-300',
    dot: 'bg-orange-400',
  },
  LIVE: {
    accent: 'rose',
    bg: 'bg-rose-500/20',
    border: 'border-rose-400/50',
    text: 'text-rose-300',
    dot: 'bg-rose-400',
  },
  ENERGY: {
    accent: 'sky',
    bg: 'bg-sky-500/20',
    border: 'border-sky-400/50',
    text: 'text-sky-300',
    dot: 'bg-sky-400',
  },
} as const;
