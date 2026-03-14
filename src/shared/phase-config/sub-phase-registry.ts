/**
 * 子阶段配置注册表
 * 单一数据源：所有子阶段的元数据集中定义
 */

import { SubPhase } from '../types/enums';
import type { SubPhaseConfig } from './types';

// ============================================
// 子阶段配置定义
// ============================================

/**
 * 所有子阶段的配置
 * 使用 Record 确保 TypeScript 检查完整性
 */
const SUB_PHASE_CONFIG_MAP: Record<SubPhase, SubPhaseConfig> = {
  // ---- 无子阶段 ----
  [SubPhase.NONE]: {
    subPhase: SubPhase.NONE,
    display: {
      name: '',
      icon: '',
      requiresUserAction: false,
    },
    behavior: {
      activePlayer: 'CURRENT_ACTIVE',
      isEffectWindow: false,
    },
  },

  // ---- 换牌阶段子阶段 ----
  [SubPhase.MULLIGAN_FIRST_PLAYER]: {
    subPhase: SubPhase.MULLIGAN_FIRST_PLAYER,
    display: {
      name: '先攻换牌',
      icon: '🔄',
      requiresUserAction: false, // 换牌有专门的 MulliganPanel 处理
    },
    behavior: {
      activePlayer: 'FIRST',
      isEffectWindow: false,
      nextSubPhase: SubPhase.MULLIGAN_SECOND_PLAYER,
    },
  },

  [SubPhase.MULLIGAN_SECOND_PLAYER]: {
    subPhase: SubPhase.MULLIGAN_SECOND_PLAYER,
    display: {
      name: '后攻换牌',
      icon: '🔄',
      requiresUserAction: false, // 换牌有专门的 MulliganPanel 处理
    },
    behavior: {
      activePlayer: 'SECOND',
      isEffectWindow: false,
      nextSubPhase: SubPhase.NONE,
    },
  },

  // ---- Live 设置阶段子阶段 ----
  [SubPhase.LIVE_SET_FIRST_PLAYER]: {
    subPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
    display: {
      name: '先攻盖牌',
      icon: '🎴',
      requiresUserAction: true,
    },
    behavior: {
      activePlayer: 'FIRST',
      isEffectWindow: false,
      nextSubPhase: SubPhase.LIVE_SET_FIRST_DRAW,
    },
  },

  [SubPhase.LIVE_SET_FIRST_DRAW]: {
    subPhase: SubPhase.LIVE_SET_FIRST_DRAW,
    display: {
      name: '先攻抽卡',
      icon: '📤',
      requiresUserAction: false,
    },
    behavior: {
      activePlayer: 'FIRST',
      isEffectWindow: false,
      nextSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
    },
  },

  [SubPhase.LIVE_SET_SECOND_PLAYER]: {
    subPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
    display: {
      name: '后攻盖牌',
      icon: '🎴',
      requiresUserAction: true,
    },
    behavior: {
      activePlayer: 'SECOND',
      isEffectWindow: false,
      nextSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
    },
  },

  [SubPhase.LIVE_SET_SECOND_DRAW]: {
    subPhase: SubPhase.LIVE_SET_SECOND_DRAW,
    display: {
      name: '后攻抽卡',
      icon: '📤',
      requiresUserAction: false,
    },
    behavior: {
      activePlayer: 'SECOND',
      isEffectWindow: false,
      nextSubPhase: SubPhase.NONE,
    },
  },

  // ---- 演出阶段子阶段 ----
  [SubPhase.PERFORMANCE_REVEAL]: {
    subPhase: SubPhase.PERFORMANCE_REVEAL,
    display: {
      name: '翻开 Live 卡',
      icon: '🔓',
      requiresUserAction: false,
    },
    behavior: {
      activePlayer: 'CURRENT_ACTIVE',
      isEffectWindow: false,
      nextSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    },
  },

  [SubPhase.PERFORMANCE_LIVE_START_EFFECTS]: {
    subPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    display: {
      name: 'Live开始时效果',
      icon: '⚡',
      requiresUserAction: true,
    },
    behavior: {
      activePlayer: 'CURRENT_ACTIVE',
      isEffectWindow: true,
      nextSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    },
  },

  [SubPhase.PERFORMANCE_JUDGMENT]: {
    subPhase: SubPhase.PERFORMANCE_JUDGMENT,
    display: {
      name: 'Live 判定',
      icon: '📊',
      requiresUserAction: true,
    },
    behavior: {
      activePlayer: 'CURRENT_ACTIVE',
      isEffectWindow: false,
      nextSubPhase: SubPhase.NONE,
    },
  },

  // ---- Live 胜败判定阶段子阶段 ----
  [SubPhase.RESULT_FIRST_SUCCESS_EFFECTS]: {
    subPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    display: {
      name: '先攻成功效果',
      icon: '⚡',
      requiresUserAction: true,
    },
    behavior: {
      activePlayer: 'FIRST',
      isEffectWindow: true,
      nextSubPhase: SubPhase.RESULT_SECOND_SUCCESS_EFFECTS,
    },
  },

  [SubPhase.RESULT_SECOND_SUCCESS_EFFECTS]: {
    subPhase: SubPhase.RESULT_SECOND_SUCCESS_EFFECTS,
    display: {
      name: '后攻成功效果',
      icon: '⚡',
      requiresUserAction: true,
    },
    behavior: {
      activePlayer: 'SECOND',
      isEffectWindow: true,
      nextSubPhase: SubPhase.RESULT_SETTLEMENT,
    },
  },

  [SubPhase.RESULT_SETTLEMENT]: {
    subPhase: SubPhase.RESULT_SETTLEMENT,
    display: {
      name: 'Live 结算',
      icon: '🏆',
      requiresUserAction: true,
    },
    behavior: {
      activePlayer: 'BOTH',
      isEffectWindow: false,
      nextSubPhase: SubPhase.RESULT_TURN_END,
    },
  },

  [SubPhase.RESULT_TURN_END]: {
    subPhase: SubPhase.RESULT_TURN_END,
    display: {
      name: '回合结束',
      icon: '⏭️',
      requiresUserAction: false,
    },
    behavior: {
      activePlayer: 'BOTH',
      isEffectWindow: false,
      nextSubPhase: SubPhase.NONE,
    },
  },

  // ---- 通用子阶段 ----
  [SubPhase.CHECK_TIMING]: {
    subPhase: SubPhase.CHECK_TIMING,
    display: {
      name: '检查时机',
      icon: '🔍',
      requiresUserAction: false,
    },
    behavior: {
      activePlayer: 'CURRENT_ACTIVE',
      isEffectWindow: false,
    },
  },

  [SubPhase.EFFECT_WINDOW]: {
    subPhase: SubPhase.EFFECT_WINDOW,
    display: {
      name: '效果发动窗口',
      icon: '⚡',
      requiresUserAction: true,
    },
    behavior: {
      activePlayer: 'CURRENT_ACTIVE',
      isEffectWindow: true,
    },
  },

  [SubPhase.FREE_ACTION]: {
    subPhase: SubPhase.FREE_ACTION,
    display: {
      name: '自由操作',
      icon: '🎮',
      requiresUserAction: true,
    },
    behavior: {
      activePlayer: 'CURRENT_ACTIVE',
      isEffectWindow: false,
    },
  },
};

/**
 * 子阶段配置只读 Map（用于高效查询）
 */
export const SUB_PHASE_CONFIGS: ReadonlyMap<SubPhase, SubPhaseConfig> = new Map(
  Object.entries(SUB_PHASE_CONFIG_MAP).map(([, config]) => [config.subPhase, config])
);

// ============================================
// 查询辅助函数
// ============================================

/**
 * 获取子阶段配置
 */
export function getSubPhaseConfig(subPhase: SubPhase): SubPhaseConfig | undefined {
  return SUB_PHASE_CONFIGS.get(subPhase);
}

/**
 * 获取子阶段名称
 */
export function getSubPhaseName(subPhase: SubPhase): string {
  return SUB_PHASE_CONFIGS.get(subPhase)?.display.name ?? '';
}

/**
 * 获取子阶段图标
 */
export function getSubPhaseIcon(subPhase: SubPhase): string {
  return SUB_PHASE_CONFIGS.get(subPhase)?.display.icon ?? '';
}

/**
 * 检查子阶段是否需要用户操作
 */
export function isUserActionRequired(subPhase: SubPhase): boolean {
  return SUB_PHASE_CONFIGS.get(subPhase)?.display.requiresUserAction ?? false;
}

/**
 * 检查子阶段是否为效果发动窗口
 */
export function isEffectWindow(subPhase: SubPhase): boolean {
  return SUB_PHASE_CONFIGS.get(subPhase)?.behavior.isEffectWindow ?? false;
}

/**
 * 获取下一个子阶段
 */
export function getNextSubPhase(subPhase: SubPhase): SubPhase {
  return SUB_PHASE_CONFIGS.get(subPhase)?.behavior.nextSubPhase ?? SubPhase.NONE;
}
