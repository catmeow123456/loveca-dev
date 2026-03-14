/**
 * 阶段配置类型定义
 * 单一数据源：集中管理所有阶段/子阶段的元数据
 */

import type { GamePhase, SubPhase, TurnType, TriggerCondition } from '../types/enums';

// ============================================
// 阶段显示配置
// ============================================

/**
 * 阶段显示配置
 */
export interface PhaseDisplayConfig {
  /** 阶段的短名称（如"换牌"） */
  readonly name: string;
  /** 阶段的完整名称（如"换牌阶段"） */
  readonly fullName: string;
  /** UI 主题色（Tailwind 类名） */
  readonly colorClass: string;
  /** 图标（emoji） */
  readonly icon: string;
}

/**
 * 子阶段显示配置
 */
export interface SubPhaseDisplayConfig {
  /** 子阶段名称 */
  readonly name: string;
  /** 图标（emoji） */
  readonly icon: string;
  /** 是否需要用户手动操作 */
  readonly requiresUserAction: boolean;
}

// ============================================
// 阶段行为配置
// ============================================

/**
 * 当前行动玩家判断策略
 */
export type ActivePlayerStrategy =
  /** 使用 game.activePlayerIndex */
  | 'USE_ACTIVE_PLAYER_INDEX'
  /** 根据子阶段推断 */
  | 'DERIVE_FROM_SUB_PHASE'
  /** 双方都可行动 */
  | 'BOTH_PLAYERS'
  /** 始终是先攻玩家 */
  | 'USE_FIRST_PLAYER';

/**
 * 阶段流转规则
 * 描述从当前阶段到下一个阶段的转换条件
 */
export interface PhaseTransitionRule {
  /** 条件：当前回合类型（可选，不指定则不检查） */
  readonly whenTurnType?: TurnType;
  /** 条件：特殊状态检查（可选） */
  readonly whenCondition?: PhaseTransitionCondition;
  /** 下一个阶段 */
  readonly nextPhase: GamePhase;
  /** 下一个回合类型（'SAME' 表示保持当前值） */
  readonly nextTurnType: TurnType | 'SAME';
  /** 下一个活跃玩家（'SAME' 保持，'FIRST' 先攻，'SECOND' 后攻，'SWITCH' 切换） */
  readonly nextActivePlayer: 'SAME' | 'FIRST' | 'SECOND' | 'SWITCH';
  /** 是否是新回合 */
  readonly isNewTurn: boolean;
}

/**
 * 阶段流转条件类型
 */
export type PhaseTransitionCondition =
  | 'MULLIGAN_COMPLETED' // 换牌完成
  | 'MULLIGAN_NOT_COMPLETED' // 换牌未完成
  | 'LIVE_SET_FIRST_DONE' // 先攻 Live 设置完成
  | 'LIVE_SET_SECOND_NOT_DONE' // 后攻 Live 设置未完成
  | 'LIVE_SET_BOTH_DONE'; // 双方 Live 设置都完成

/**
 * 阶段自动处理配置
 */
export type PhaseAutoActionConfig =
  | { readonly type: 'UNTAP_ALL' }
  | { readonly type: 'DRAW_ENERGY' }
  | { readonly type: 'DRAW_CARD'; readonly count: number };

/**
 * 阶段行为配置
 */
export interface PhaseBehaviorConfig {
  /** 玩家是否可以主动结束此阶段 */
  readonly canPlayerEndPhase: boolean;
  /** 此阶段是否为共享阶段（双方同时参与） */
  readonly isSharedPhase: boolean;
  /** 判断"当前行动玩家"的策略 */
  readonly activePlayerStrategy: ActivePlayerStrategy;
  /** 初始子阶段（如果有） */
  readonly initialSubPhase?: SubPhase;
  /** 阶段流转规则（按顺序检查，取第一个匹配的） */
  readonly transitions?: readonly PhaseTransitionRule[];
  /** 进入阶段时的自动处理 */
  readonly autoActions?: readonly PhaseAutoActionConfig[];
  /** 进入阶段时触发的条件 */
  readonly triggerConditions?: readonly TriggerCondition[];
}

/**
 * 子阶段中的活跃玩家类型
 */
export type SubPhaseActivePlayer =
  /** 先攻玩家 */
  | 'FIRST'
  /** 后攻玩家 */
  | 'SECOND'
  /** 当前活跃玩家（由 activePlayerIndex 决定） */
  | 'CURRENT_ACTIVE'
  /** 双方都可行动 */
  | 'BOTH';

/**
 * 子阶段行为配置
 */
export interface SubPhaseBehaviorConfig {
  /** 此子阶段的活跃玩家 */
  readonly activePlayer: SubPhaseActivePlayer;
  /** 是否是效果发动窗口 */
  readonly isEffectWindow: boolean;
  /** 下一个子阶段（可选，用于自动推进） */
  readonly nextSubPhase?: SubPhase;
}

// ============================================
// 完整配置接口
// ============================================

/**
 * 完整的阶段配置
 */
export interface PhaseConfig {
  readonly phase: GamePhase;
  readonly display: PhaseDisplayConfig;
  readonly behavior: PhaseBehaviorConfig;
}

/**
 * 完整的子阶段配置
 */
export interface SubPhaseConfig {
  readonly subPhase: SubPhase;
  readonly display: SubPhaseDisplayConfig;
  readonly behavior: SubPhaseBehaviorConfig;
}
