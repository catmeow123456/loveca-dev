/**
 * Loveca 能力系统定义
 * 基于 detail_rules.md 第 9.1-9.12 章
 */

import {
  AbilityType,
  EffectType,
  EffectDuration,
  TriggerCondition,
  HeartColor,
  SlotPosition,
  ZoneType,
} from '../../shared/types/enums';

// ============================================
// 费用定义
// ============================================

/**
 * 费用类型
 * 参考规则 9.4
 */
export enum CostType {
  /** 支付门票（能量变为等待状态） - 规则 9.4.3 */
  TICKET = 'TICKET',
  /** 将自身变为等待状态 */
  REST_SELF = 'REST_SELF',
  /** 将指定卡牌放到休息室 */
  DISCARD = 'DISCARD',
  /** 支付手牌 */
  HAND_COST = 'HAND_COST',
}

/**
 * 单个费用项
 * 参考规则 9.4 - 费用是"执行费用表明的行动"
 *
 * 设计说明：
 * - type: 费用的基本类型
 * - value: 费用数值（如门票数量、卡牌张数等）
 * - target: 可选的目标选择器，用于指定费用作用的对象
 *
 * 例如：
 * - 支付2门票: { type: TICKET, value: 2 }
 * - 将自身横置: { type: REST_SELF, value: 1 }
 * - 将1张手牌送入休息室: { type: DISCARD, value: 1, target: { type: ZONE_CARD, ... } }
 */
export interface CostItem {
  /** 费用类型 */
  readonly type: CostType;
  /** 费用数值（例如门票数量、卡牌张数） */
  readonly value: number;
  /** 目标选择器（用于指定费用作用的对象，如"将指定成员送入休息室"） */
  readonly target?: TargetSelector;
}

/**
 * 能力费用
 * 参考规则 9.4
 */
export interface AbilityCost {
  /** 费用项列表（按顺序执行） */
  readonly items: readonly CostItem[];
}

// ============================================
// 效果目标定义
// ============================================

/**
 * 目标类型
 */
export enum TargetType {
  /** 自身（能力所属卡牌） */
  SELF = 'SELF',
  /** 指定成员 */
  MEMBER = 'MEMBER',
  /** 指定玩家 */
  PLAYER = 'PLAYER',
  /** 指定区域的卡牌 */
  ZONE_CARD = 'ZONE_CARD',
  /** 所有符合条件的对象 */
  ALL_MATCHING = 'ALL_MATCHING',
}

/**
 * 目标选择器
 * 参考规则 9.6.3
 */
export interface TargetSelector {
  /** 目标类型 */
  readonly type: TargetType;
  /** 选择数量（"最多"用负数表示） */
  readonly count: number;
  /** 是否必须选择（false 表示"最多"语义） */
  readonly required: boolean;
  /** 目标条件 */
  readonly condition?: TargetCondition;
}

/**
 * 目标条件
 */
export interface TargetCondition {
  /** 控制者（自己/对手/任意） */
  readonly controller?: 'self' | 'opponent' | 'any';
  /** 区域限制 */
  readonly zone?: ZoneType;
  /** 槽位限制 */
  readonly slotPosition?: SlotPosition;
  /** 卡牌名称包含 */
  readonly nameContains?: string;
  /** 团体名限制 */
  readonly groupName?: string;
  /** 状态限制（活跃/等待） */
  readonly orientationState?: 'active' | 'waiting';
  /** 心颜色限制 */
  readonly heartColor?: HeartColor;
}

// ============================================
// 效果定义
// ============================================

/**
 * 效果动作类型
 */
export enum EffectActionType {
  // ---- 卡牌移动 ----
  /** 抽卡 */
  DRAW = 'DRAW',
  /** 移动卡牌到指定区域 */
  MOVE_CARD = 'MOVE_CARD',
  /** 将卡牌放到卡组顶/底 */
  RETURN_TO_DECK = 'RETURN_TO_DECK',

  // ---- 状态修改 ----
  /** 变为活跃状态 */
  SET_ACTIVE = 'SET_ACTIVE',
  /** 变为等待状态 */
  SET_WAITING = 'SET_WAITING',

  // ---- 数值修改 ----
  /** 修改心数 */
  MODIFY_HEART = 'MODIFY_HEART',
  /** 修改光棒数 */
  MODIFY_BLADE = 'MODIFY_BLADE',
  /** 修改费用 */
  MODIFY_COST = 'MODIFY_COST',
  /** 修改分数 */
  MODIFY_SCORE = 'MODIFY_SCORE',

  // ---- 能力相关 ----
  /** 赋予能力 */
  GRANT_ABILITY = 'GRANT_ABILITY',
  /** 失去能力 */
  REMOVE_ABILITY = 'REMOVE_ABILITY',

  // ---- 特殊效果 ----
  /** 检视卡组 */
  LOOK_AT_DECK = 'LOOK_AT_DECK',
  /** 搜索卡组 */
  SEARCH_DECK = 'SEARCH_DECK',
  /** 额外 Cheer */
  EXTRA_CHEER = 'EXTRA_CHEER',

  // ---- 游戏状态 ----
  /** 禁止行动 */
  PREVENT_ACTION = 'PREVENT_ACTION',
  /** 强制行动 */
  FORCE_ACTION = 'FORCE_ACTION',
}

/**
 * 效果动作参数
 */
export interface EffectActionParams {
  /** 数值参数 */
  readonly value?: number;
  /** 颜色参数 */
  readonly color?: HeartColor;
  /** 目标区域 */
  readonly targetZone?: ZoneType;
  /** 放置位置（顶/底） */
  readonly position?: 'top' | 'bottom';
  /** 额外条件 */
  readonly condition?: TargetCondition;
}

/**
 * 效果动作
 */
export interface EffectAction {
  /** 动作类型 */
  readonly actionType: EffectActionType;
  /** 目标选择器 */
  readonly target?: TargetSelector;
  /** 动作参数 */
  readonly params?: EffectActionParams;
}

/**
 * 一次性效果
 * 参考规则 9.2.1.1
 */
export interface OneTimeEffect {
  readonly effectType: EffectType.ONE_TIME;
  /** 效果动作序列 */
  readonly actions: readonly EffectAction[];
}

/**
 * 持续效果
 * 参考规则 9.2.1.2
 */
export interface ContinuousEffect {
  readonly effectType: EffectType.CONTINUOUS;
  /** 效果持续时间 */
  readonly duration: EffectDuration;
  /** 效果动作 */
  readonly actions: readonly EffectAction[];
  /** 效果适用条件 */
  readonly condition?: TargetCondition;
}

/**
 * 置换效果
 * 参考规则 9.2.1.3
 */
export interface ReplacementEffect {
  readonly effectType: EffectType.REPLACEMENT;
  /** 被置换的事件类型 */
  readonly replacedEvent: TriggerCondition;
  /** 置换后的动作 */
  readonly replacementActions: readonly EffectAction[];
  /** 是否为选择型置换（"可以改为"） */
  readonly isOptional: boolean;
}

/**
 * 效果联合类型
 */
export type Effect = OneTimeEffect | ContinuousEffect | ReplacementEffect;

// ============================================
// 能力定义
// ============================================

/**
 * 能力基础接口
 */
export interface BaseAbility {
  /** 能力唯一 ID */
  readonly abilityId: string;
  /** 能力类型 */
  readonly abilityType: AbilityType;
  /** 能力描述文本（用于显示） */
  readonly description: string;
  /** 关键词标签（如 "1回合1次"、"C位" 等） */
  readonly keywords: readonly AbilityKeyword[];
}

/**
 * 能力关键词
 * 参考规则第 11 章
 */
export enum AbilityKeyword {
  /** 1回合1次 */
  ONCE_PER_TURN = 'ONCE_PER_TURN',
  /** 登场 */
  ON_ENTER = 'ON_ENTER',
  /** Live 开始时 */
  ON_LIVE_START = 'ON_LIVE_START',
  /** Live 成功时 */
  ON_LIVE_SUCCESS = 'ON_LIVE_SUCCESS',
  /** C位 */
  CENTER_ONLY = 'CENTER_ONLY',
}

/**
 * 起动能力
 * 参考规则 9.1.1.1
 */
export interface ActivatedAbility extends BaseAbility {
  readonly abilityType: AbilityType.ACTIVATED;
  /** 能力费用 */
  readonly cost: AbilityCost;
  /** 能力效果 */
  readonly effect: Effect;
  /** 使用条件（如阶段限制） */
  readonly useCondition?: AbilityUseCondition;
}

/**
 * 能力使用条件
 */
export interface AbilityUseCondition {
  /** 阶段限制 */
  readonly phaseRestriction?: readonly string[];
  /** 区域限制 */
  readonly zoneRestriction?: ZoneType;
  /** 槽位限制（如 C 位） */
  readonly slotRestriction?: SlotPosition;
  /** 其他条件（自定义逻辑 ID） */
  readonly customConditionId?: string;
}

/**
 * 自动能力
 * 参考规则 9.1.1.2
 */
export interface AutoAbility extends BaseAbility {
  readonly abilityType: AbilityType.AUTO;
  /** 诱发条件 */
  readonly triggerCondition: TriggerCondition;
  /** 诱发条件的额外参数 */
  readonly triggerParams?: TriggerParams;
  /** 能力费用（可选） */
  readonly cost?: AbilityCost;
  /** 能力效果 */
  readonly effect: Effect;
}

/**
 * 诱发条件参数
 */
export interface TriggerParams {
  /** 区域移动：来源区域 */
  readonly fromZone?: ZoneType;
  /** 区域移动：目标区域 */
  readonly toZone?: ZoneType;
  /** 触发卡牌条件 */
  readonly cardCondition?: TargetCondition;
  /** 是否只在自己的回合触发 */
  readonly onlyOnOwnTurn?: boolean;
}

/**
 * 常驻能力
 * 参考规则 9.1.1.3
 */
export interface StaticAbility extends BaseAbility {
  readonly abilityType: AbilityType.STATIC;
  /** 持续效果 */
  readonly effect: ContinuousEffect | ReplacementEffect;
  /** 生效条件 */
  readonly activeCondition?: AbilityUseCondition;
}

/**
 * 能力联合类型
 */
export type Ability = ActivatedAbility | AutoAbility | StaticAbility;

// ============================================
// 类型守卫
// ============================================

/**
 * 判断是否为起动能力
 */
export function isActivatedAbility(ability: Ability): ability is ActivatedAbility {
  return ability.abilityType === AbilityType.ACTIVATED;
}

/**
 * 判断是否为自动能力
 */
export function isAutoAbility(ability: Ability): ability is AutoAbility {
  return ability.abilityType === AbilityType.AUTO;
}

/**
 * 判断是否为常驻能力
 */
export function isStaticAbility(ability: Ability): ability is StaticAbility {
  return ability.abilityType === AbilityType.STATIC;
}

/**
 * 判断是否为一次性效果
 */
export function isOneTimeEffect(effect: Effect): effect is OneTimeEffect {
  return effect.effectType === EffectType.ONE_TIME;
}

/**
 * 判断是否为持续效果
 */
export function isContinuousEffect(effect: Effect): effect is ContinuousEffect {
  return effect.effectType === EffectType.CONTINUOUS;
}

/**
 * 判断是否为置换效果
 */
export function isReplacementEffect(effect: Effect): effect is ReplacementEffect {
  return effect.effectType === EffectType.REPLACEMENT;
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建门票费用
 */
export function createTicketCost(count: number): AbilityCost {
  return {
    items: [{ type: CostType.TICKET, value: count }],
  };
}

/**
 * 创建自身变为等待状态的费用
 */
export function createRestSelfCost(): AbilityCost {
  return {
    items: [{ type: CostType.REST_SELF, value: 1 }],
  };
}

/**
 * 创建无费用
 */
export function createNoCost(): AbilityCost {
  return { items: [] };
}

/**
 * 创建抽卡效果动作
 */
export function createDrawAction(count: number): EffectAction {
  return {
    actionType: EffectActionType.DRAW,
    params: { value: count },
  };
}

/**
 * 创建一次性效果
 */
export function createOneTimeEffect(actions: readonly EffectAction[]): OneTimeEffect {
  return {
    effectType: EffectType.ONE_TIME,
    actions,
  };
}

/**
 * 创建持续效果
 */
export function createContinuousEffect(
  duration: EffectDuration,
  actions: readonly EffectAction[],
  condition?: TargetCondition
): ContinuousEffect {
  return {
    effectType: EffectType.CONTINUOUS,
    duration,
    actions,
    condition,
  };
}

/**
 * 创建简单的登场自动能力
 */
export function createOnEnterAbility(
  abilityId: string,
  description: string,
  effect: Effect,
  cost?: AbilityCost
): AutoAbility {
  return {
    abilityId,
    abilityType: AbilityType.AUTO,
    description,
    keywords: [AbilityKeyword.ON_ENTER],
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    cost,
    effect,
  };
}

/**
 * 创建简单的 Live 成功时自动能力
 */
export function createOnLiveSuccessAbility(
  abilityId: string,
  description: string,
  effect: Effect,
  cost?: AbilityCost
): AutoAbility {
  return {
    abilityId,
    abilityType: AbilityType.AUTO,
    description,
    keywords: [AbilityKeyword.ON_LIVE_SUCCESS],
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    cost,
    effect,
  };
}

// ============================================
// 能力实例状态（运行时）
// ============================================

/**
 * 能力运行时状态
 */
export interface AbilityRuntimeState {
  /** 能力 ID */
  readonly abilityId: string;
  /** 来源卡牌实例 ID */
  readonly sourceCardInstanceId: string;
  /** 本回合是否已使用（用于 1回合1次 检查） */
  readonly usedThisTurn: boolean;
  /** 本场游戏是否已使用（用于 1游戏1次 检查） */
  readonly usedThisGame: boolean;
  /** 当前待机次数（自动能力） */
  readonly pendingCount: number;
}

/**
 * 创建能力运行时状态
 */
export function createAbilityRuntimeState(
  abilityId: string,
  sourceCardInstanceId: string
): AbilityRuntimeState {
  return {
    abilityId,
    sourceCardInstanceId,
    usedThisTurn: false,
    usedThisGame: false,
    pendingCount: 0,
  };
}

/**
 * 标记能力已使用
 */
export function markAbilityUsed(state: AbilityRuntimeState): AbilityRuntimeState {
  return {
    ...state,
    usedThisTurn: true,
    usedThisGame: true,
  };
}

/**
 * 重置回合使用状态
 */
export function resetTurnUsage(state: AbilityRuntimeState): AbilityRuntimeState {
  return {
    ...state,
    usedThisTurn: false,
  };
}

/**
 * 增加待机次数
 */
export function incrementPendingCount(
  state: AbilityRuntimeState,
  count: number = 1
): AbilityRuntimeState {
  return {
    ...state,
    pendingCount: state.pendingCount + count,
  };
}

/**
 * 减少待机次数
 */
export function decrementPendingCount(state: AbilityRuntimeState): AbilityRuntimeState {
  return {
    ...state,
    pendingCount: Math.max(0, state.pendingCount - 1),
  };
}
