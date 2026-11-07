import type { HeartIcon } from '../entities/card.js';
import { HeartColor } from '../../shared/types/enums.js';

export const HEXTECH_RULES_VERSION = 'HEXTECH_V1' as const;
export type HextechRarity = 'SILVER' | 'GOLD' | 'PRISMATIC';
export const HEXTECH_RARITY_LABELS = { SILVER: '银', GOLD: '金', PRISMATIC: '彩' } as const;

export type HextechEffect =
  | { readonly kind: 'HEART'; readonly hearts: readonly HeartIcon[] }
  | { readonly kind: 'BLADE'; readonly count: number }
  | { readonly kind: 'SCORE'; readonly count: number }
  | { readonly kind: 'SUCCESS_ZONE_RAINBOW_HEART' }
  | { readonly kind: 'THREE_SAME_GROUP_BLADE'; readonly count: number }
  | { readonly kind: 'DECAYING_CHEER_COUNT'; readonly initialCount: number }
  | { readonly kind: 'PAINTER_LIVE_REQUIREMENTS' }
  | { readonly kind: 'CENTER_GROUP_BONUS' }
  | { readonly kind: 'COST_579_GRAY_BLADE_HEART' }
  | { readonly kind: 'PERFECT_CHEER_SCORE' }
  | { readonly kind: 'GROWING_BLADE' }
  | { readonly kind: 'ACQUIRE_AND_TURN_DRAW' }
  | { readonly kind: 'LIVE_CRITICAL_BLADE_HEART' }
  | { readonly kind: 'ACQUIRE_CLEAR_SUCCESS_ZONES' }
  | { readonly kind: 'ACQUIRE_DRAW'; readonly count: number };

export interface HextechDefinition {
  readonly id: string;
  readonly name: string;
  readonly rarity: HextechRarity;
  readonly rulesText: string;
  readonly effect: HextechEffect;
}

/** Only complete, supported effects belong here. IDs are independent of display names. */
export const HEXTECH_DEFINITIONS = [
  {
    id: 'strawberry-cherry-ice-cream',
    name: '草莓樱桃冰淇淋',
    rarity: 'SILVER',
    rulesText: '粉心+1，红心+1',
    effect: {
      kind: 'HEART',
      hearts: [
        { color: HeartColor.PINK, count: 1 },
        { color: HeartColor.RED, count: 1 },
      ],
    },
  },
  {
    id: 'mango-blueberry-ice-cream',
    name: '芒果蓝莓冰淇淋',
    rarity: 'SILVER',
    rulesText: '黄心+1，蓝心+1',
    effect: {
      kind: 'HEART',
      hearts: [
        { color: HeartColor.YELLOW, count: 1 },
        { color: HeartColor.BLUE, count: 1 },
      ],
    },
  },
  {
    id: 'green-grape-purple-grape-ice-cream',
    name: '青提葡萄冰淇淋',
    rarity: 'SILVER',
    rulesText: '绿心+1，紫心+1',
    effect: {
      kind: 'HEART',
      hearts: [
        { color: HeartColor.GREEN, count: 1 },
        { color: HeartColor.PURPLE, count: 1 },
      ],
    },
  },
  {
    id: 'ice-cream-mystery-box',
    name: '冰淇淋盲盒',
    rarity: 'SILVER',
    rulesText: '棒+2',
    effect: { kind: 'BLADE', count: 2 },
  },
  {
    id: 'original-ice-cream',
    name: '原味冰淇淋',
    rarity: 'GOLD',
    rulesText: '+1分',
    effect: { kind: 'SCORE', count: 1 },
  },
  {
    id: 'pot-of-greed',
    name: '强欲之壶',
    rarity: 'SILVER',
    rulesText: '抽2张牌',
    effect: { kind: 'ACQUIRE_DRAW', count: 2 },
  },
  {
    id: 'pot-of-greater-greed',
    name: '强强欲之壶',
    rarity: 'GOLD',
    rulesText: '抽3张牌',
    effect: { kind: 'ACQUIRE_DRAW', count: 3 },
  },
  {
    id: 'pot-of-greatest-greed',
    name: '强强强欲之壶',
    rarity: 'PRISMATIC',
    rulesText: '抽4张牌',
    effect: { kind: 'ACQUIRE_DRAW', count: 4 },
  },
  {
    id: 'you-are-also-a-zone',
    name: '你也是区',
    rarity: 'SILVER',
    rulesText: '成功区每有1张卡，获得1个万能心',
    effect: { kind: 'SUCCESS_ZONE_RAINBOW_HEART' },
  },
  {
    id: 'group-spirit',
    name: '团魂',
    rarity: 'GOLD',
    rulesText: '场上3名成员团体相同时，棒+3',
    effect: { kind: 'THREE_SAME_GROUP_BLADE', count: 3 },
  },
  {
    id: 'perception-bias',
    name: '偏差认知',
    rarity: 'GOLD',
    rulesText: '声援数量+4，每过1回合-1',
    effect: { kind: 'DECAYING_CHEER_COUNT', initialCount: 4 },
  },
  {
    id: 'little-painter',
    name: '小画家',
    rarity: 'PRISMATIC',
    rulesText: '三色以上LIVE所需灰心清零；每张LIVE已需的每种颜色心+1',
    effect: { kind: 'PAINTER_LIVE_REQUIREMENTS' },
  },
  {
    id: 'flexible-solo-fan',
    name: '灵活单推',
    rarity: 'PRISMATIC',
    rulesText:
      '中央成员为μ’s：粉黄紫心各+1；Aqours：红绿蓝心各+1；Liella!：红黄紫心各+1；蓮ノ空：粉绿蓝心各+1；虹ヶ咲：棒+4',
    effect: { kind: 'CENTER_GROUP_BONUS' },
  },
  {
    id: 'refuse-to-gamble',
    name: '拒绝赌博',
    rarity: 'SILVER',
    rulesText: '己方印刷费用为5、7、9的成员，其判定视为1个灰心',
    effect: { kind: 'COST_579_GRAY_BLADE_HEART' },
  },
  {
    id: 'not-a-single-miss',
    name: '压根没漏儿',
    rarity: 'GOLD',
    rulesText: '本次声援公开的牌全部持有判定时，每公开5张，成功LIVE的合计分数+1',
    effect: { kind: 'PERFECT_CHEER_SCORE' },
  },
  {
    id: 'demon-form',
    name: '恶魔形态',
    rarity: 'PRISMATIC',
    rulesText: '取得时按第1／2／3轮获得1／2／3棒；此后每过1回合再获得1棒',
    effect: { kind: 'GROWING_BLADE' },
  },
  {
    id: 'incoming-wealth',
    name: '来财',
    rarity: 'PRISMATIC',
    rulesText: '取得时按第1／2／3轮抽1／2／3张；从下一回合起，自己的抽牌阶段额外抽1张',
    effect: { kind: 'ACQUIRE_AND_TURN_DRAW' },
  },
  {
    id: 'critical-hit',
    name: '关键暴击',
    rarity: 'PRISMATIC',
    rulesText: '己方持有判定的LIVE，其判定整体变为加2分',
    effect: { kind: 'LIVE_CRITICAL_BLADE_HEART' },
  },
  {
    id: 'table-flip',
    name: '掀桌',
    rarity: 'PRISMATIC',
    rulesText: '取得时，将双方成功区的所有LIVE放入各自休息室',
    effect: { kind: 'ACQUIRE_CLEAR_SUCCESS_ZONES' },
  },
] as const satisfies readonly HextechDefinition[];

export type HextechId = (typeof HEXTECH_DEFINITIONS)[number]['id'];

const definitionsById = new Map<string, HextechDefinition>(
  HEXTECH_DEFINITIONS.map((definition) => [definition.id, definition])
);

export function getHextechDefinition(id: string): HextechDefinition | undefined {
  return definitionsById.get(id);
}
