/**
 * 阶段配置注册表
 * 单一数据源：所有主阶段的元数据集中定义
 */

import { GamePhase, SubPhase, TurnType, TriggerCondition } from '../types/enums';
import type { PhaseConfig, PhaseTransitionRule, PhaseAutoActionConfig } from './types';

// ============================================
// 阶段配置定义
// ============================================

/**
 * 所有阶段的配置
 * 使用 Record 确保 TypeScript 检查完整性
 */
const PHASE_CONFIG_MAP: Record<GamePhase, PhaseConfig> = {
  [GamePhase.SETUP]: {
    phase: GamePhase.SETUP,
    display: {
      name: '准备',
      fullName: '准备阶段',
      colorClass: 'bg-slate-500',
      icon: '⚙️',
    },
    behavior: {
      canPlayerEndPhase: false,
      isSharedPhase: true,
      activePlayerStrategy: 'USE_FIRST_PLAYER',
      transitions: [
        {
          nextPhase: GamePhase.MULLIGAN_PHASE,
          nextTurnType: TurnType.FIRST_PLAYER_TURN,
          nextActivePlayer: 'FIRST',
          isNewTurn: false,
        },
      ],
    },
  },

  [GamePhase.MULLIGAN_PHASE]: {
    phase: GamePhase.MULLIGAN_PHASE,
    display: {
      name: '换牌',
      fullName: '换牌阶段',
      colorClass: 'bg-indigo-500',
      icon: '🔄',
    },
    behavior: {
      canPlayerEndPhase: false,
      isSharedPhase: true,
      activePlayerStrategy: 'DERIVE_FROM_SUB_PHASE',
      initialSubPhase: SubPhase.MULLIGAN_FIRST_PLAYER,
      transitions: [
        // 换牌未完成时保持当前阶段
        {
          whenCondition: 'MULLIGAN_NOT_COMPLETED',
          nextPhase: GamePhase.MULLIGAN_PHASE,
          nextTurnType: TurnType.FIRST_PLAYER_TURN,
          nextActivePlayer: 'FIRST',
          isNewTurn: false,
        },
        // 换牌完成后进入活跃阶段
        {
          whenCondition: 'MULLIGAN_COMPLETED',
          nextPhase: GamePhase.ACTIVE_PHASE,
          nextTurnType: TurnType.FIRST_PLAYER_TURN,
          nextActivePlayer: 'FIRST',
          isNewTurn: true,
        },
      ],
      triggerConditions: [TriggerCondition.ON_GAME_START],
    },
  },

  [GamePhase.ACTIVE_PHASE]: {
    phase: GamePhase.ACTIVE_PHASE,
    display: {
      name: '活跃',
      fullName: '活跃阶段',
      colorClass: 'bg-green-500',
      icon: '⚡',
    },
    behavior: {
      canPlayerEndPhase: false,
      isSharedPhase: false,
      activePlayerStrategy: 'USE_ACTIVE_PLAYER_INDEX',
      transitions: [
        {
          nextPhase: GamePhase.ENERGY_PHASE,
          nextTurnType: 'SAME',
          nextActivePlayer: 'SAME',
          isNewTurn: false,
        },
      ],
      autoActions: [{ type: 'UNTAP_ALL' }],
      triggerConditions: [TriggerCondition.ON_TURN_START, TriggerCondition.ON_ACTIVE_PHASE_START],
    },
  },

  [GamePhase.ENERGY_PHASE]: {
    phase: GamePhase.ENERGY_PHASE,
    display: {
      name: '能量',
      fullName: '能量阶段',
      colorClass: 'bg-purple-500',
      icon: '🔋',
    },
    behavior: {
      canPlayerEndPhase: false,
      isSharedPhase: false,
      activePlayerStrategy: 'USE_ACTIVE_PLAYER_INDEX',
      transitions: [
        {
          nextPhase: GamePhase.DRAW_PHASE,
          nextTurnType: 'SAME',
          nextActivePlayer: 'SAME',
          isNewTurn: false,
        },
      ],
      autoActions: [{ type: 'DRAW_ENERGY' }],
      triggerConditions: [TriggerCondition.ON_ENERGY_PHASE_START],
    },
  },

  [GamePhase.DRAW_PHASE]: {
    phase: GamePhase.DRAW_PHASE,
    display: {
      name: '抽卡',
      fullName: '抽卡阶段',
      colorClass: 'bg-blue-500',
      icon: '🃏',
    },
    behavior: {
      canPlayerEndPhase: false,
      isSharedPhase: false,
      activePlayerStrategy: 'USE_ACTIVE_PLAYER_INDEX',
      transitions: [
        {
          nextPhase: GamePhase.MAIN_PHASE,
          nextTurnType: 'SAME',
          nextActivePlayer: 'SAME',
          isNewTurn: false,
        },
      ],
      autoActions: [{ type: 'DRAW_CARD', count: 1 }],
      triggerConditions: [TriggerCondition.ON_DRAW_PHASE_START],
    },
  },

  [GamePhase.MAIN_PHASE]: {
    phase: GamePhase.MAIN_PHASE,
    display: {
      name: '主要',
      fullName: '主要阶段',
      colorClass: 'bg-cyan-500',
      icon: '🎯',
    },
    behavior: {
      canPlayerEndPhase: true,
      isSharedPhase: false,
      activePlayerStrategy: 'USE_ACTIVE_PLAYER_INDEX',
      transitions: [
        // 先攻主要阶段结束 → 后攻活跃阶段
        {
          whenTurnType: TurnType.FIRST_PLAYER_TURN,
          nextPhase: GamePhase.ACTIVE_PHASE,
          nextTurnType: TurnType.SECOND_PLAYER_TURN,
          nextActivePlayer: 'SECOND',
          isNewTurn: false,
        },
        // 后攻主要阶段结束 → Live 设置阶段
        {
          whenTurnType: TurnType.SECOND_PLAYER_TURN,
          nextPhase: GamePhase.LIVE_SET_PHASE,
          nextTurnType: TurnType.LIVE_PHASE,
          nextActivePlayer: 'FIRST',
          isNewTurn: false,
        },
      ],
      triggerConditions: [TriggerCondition.ON_MAIN_PHASE_START],
    },
  },

  [GamePhase.LIVE_SET_PHASE]: {
    phase: GamePhase.LIVE_SET_PHASE,
    display: {
      name: 'Live放置',
      fullName: 'Live放置阶段',
      colorClass: 'bg-amber-500',
      icon: '🎴',
    },
    behavior: {
      canPlayerEndPhase: true,
      isSharedPhase: true,
      activePlayerStrategy: 'DERIVE_FROM_SUB_PHASE',
      initialSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      transitions: [
        // 先攻未完成 → 保持先攻
        {
          whenCondition: 'LIVE_SET_FIRST_DONE',
          nextPhase: GamePhase.LIVE_SET_PHASE,
          nextTurnType: TurnType.SECOND_PLAYER_TURN,
          nextActivePlayer: 'SECOND',
          isNewTurn: false,
        },
        // 双方都完成 → 进入演出阶段
        {
          whenCondition: 'LIVE_SET_BOTH_DONE',
          nextPhase: GamePhase.PERFORMANCE_PHASE,
          nextTurnType: TurnType.FIRST_PLAYER_TURN,
          nextActivePlayer: 'FIRST',
          isNewTurn: false,
        },
      ],
      triggerConditions: [
        TriggerCondition.ON_LIVE_PHASE_START,
        TriggerCondition.ON_LIVE_SET_PHASE_START,
      ],
    },
  },

  [GamePhase.PERFORMANCE_PHASE]: {
    phase: GamePhase.PERFORMANCE_PHASE,
    display: {
      name: '表演',
      fullName: '表演阶段',
      colorClass: 'bg-pink-500',
      icon: '🎤',
    },
    behavior: {
      canPlayerEndPhase: false,
      isSharedPhase: true,
      activePlayerStrategy: 'DERIVE_FROM_SUB_PHASE',
      initialSubPhase: SubPhase.PERFORMANCE_REVEAL,
      transitions: [
        // 先攻演出 → 后攻演出
        {
          whenTurnType: TurnType.FIRST_PLAYER_TURN,
          nextPhase: GamePhase.PERFORMANCE_PHASE,
          nextTurnType: TurnType.SECOND_PLAYER_TURN,
          nextActivePlayer: 'SECOND',
          isNewTurn: false,
        },
        // 后攻演出 → Live 结算
        {
          whenTurnType: TurnType.SECOND_PLAYER_TURN,
          nextPhase: GamePhase.LIVE_RESULT_PHASE,
          nextTurnType: TurnType.LIVE_PHASE,
          nextActivePlayer: 'FIRST',
          isNewTurn: false,
        },
      ],
      triggerConditions: [TriggerCondition.ON_PERFORMANCE_PHASE_START],
    },
  },

  [GamePhase.LIVE_RESULT_PHASE]: {
    phase: GamePhase.LIVE_RESULT_PHASE,
    display: {
      name: 'Live结算',
      fullName: 'Live结算阶段',
      colorClass: 'bg-rose-500',
      icon: '🏆',
    },
    behavior: {
      canPlayerEndPhase: false,
      isSharedPhase: true,
      activePlayerStrategy: 'DERIVE_FROM_SUB_PHASE',
      initialSubPhase: SubPhase.RESULT_SETTLEMENT,
      transitions: [
        // 结算完成 → 新回合活跃阶段
        {
          nextPhase: GamePhase.ACTIVE_PHASE,
          nextTurnType: TurnType.FIRST_PLAYER_TURN,
          nextActivePlayer: 'FIRST',
          isNewTurn: true,
        },
      ],
      triggerConditions: [TriggerCondition.ON_LIVE_RESULT_PHASE_START],
    },
  },

  [GamePhase.GAME_END]: {
    phase: GamePhase.GAME_END,
    display: {
      name: '结束',
      fullName: '游戏结束',
      colorClass: 'bg-slate-600',
      icon: '🏁',
    },
    behavior: {
      canPlayerEndPhase: false,
      isSharedPhase: true,
      activePlayerStrategy: 'BOTH_PLAYERS',
      transitions: [
        // 游戏结束，保持当前状态
        {
          nextPhase: GamePhase.GAME_END,
          nextTurnType: 'SAME',
          nextActivePlayer: 'SAME',
          isNewTurn: false,
        },
      ],
    },
  },
};

/**
 * 阶段配置只读 Map（用于高效查询）
 */
export const PHASE_CONFIGS: ReadonlyMap<GamePhase, PhaseConfig> = new Map(
  Object.entries(PHASE_CONFIG_MAP).map(([, config]) => [config.phase, config])
);

// ============================================
// 查询辅助函数
// ============================================

/**
 * 获取阶段配置
 */
export function getPhaseConfig(phase: GamePhase): PhaseConfig | undefined {
  return PHASE_CONFIGS.get(phase);
}

/**
 * 获取阶段完整名称
 */
export function getPhaseName(phase: GamePhase): string {
  return PHASE_CONFIGS.get(phase)?.display.fullName ?? '未知阶段';
}

/**
 * 获取阶段短名称
 */
export function getPhaseShortName(phase: GamePhase): string {
  return PHASE_CONFIGS.get(phase)?.display.name ?? phase;
}

/**
 * 获取阶段颜色类名
 */
export function getPhaseColorClass(phase: GamePhase): string {
  return PHASE_CONFIGS.get(phase)?.display.colorClass ?? 'bg-slate-500';
}

/**
 * 获取阶段图标
 */
export function getPhaseIcon(phase: GamePhase): string {
  return PHASE_CONFIGS.get(phase)?.display.icon ?? '';
}

/**
 * 检查玩家是否可以结束当前阶段
 */
export function canPlayerEndPhase(phase: GamePhase): boolean {
  return PHASE_CONFIGS.get(phase)?.behavior.canPlayerEndPhase ?? false;
}

/**
 * 检查阶段是否为共享阶段
 */
export function isSharedPhase(phase: GamePhase): boolean {
  return PHASE_CONFIGS.get(phase)?.behavior.isSharedPhase ?? false;
}

/**
 * 获取阶段的初始子阶段
 */
export function getInitialSubPhase(phase: GamePhase): SubPhase | undefined {
  return PHASE_CONFIGS.get(phase)?.behavior.initialSubPhase;
}

/**
 * 获取阶段的流转规则
 */
export function getPhaseTransitions(phase: GamePhase): readonly PhaseTransitionRule[] {
  return PHASE_CONFIGS.get(phase)?.behavior.transitions ?? [];
}

/**
 * 获取阶段的自动处理配置
 */
export function getPhaseAutoActions(phase: GamePhase): readonly PhaseAutoActionConfig[] {
  return PHASE_CONFIGS.get(phase)?.behavior.autoActions ?? [];
}

/**
 * 获取阶段的触发条件
 */
export function getPhaseTriggerConditions(phase: GamePhase): readonly TriggerCondition[] {
  return PHASE_CONFIGS.get(phase)?.behavior.triggerConditions ?? [];
}
