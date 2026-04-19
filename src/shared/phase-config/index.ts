/**
 * 阶段配置模块导出入口
 *
 * 单一数据源：集中管理所有阶段/子阶段的元数据
 * 解决问题：
 * 1. 类型定义分散导致的级联修改
 * 2. "回合"概念在不同阶段含义不同
 */

// ============================================
// 类型导出
// ============================================

export type {
  PhaseDisplayConfig,
  SubPhaseDisplayConfig,
  ActivePlayerStrategy,
  PhaseBehaviorConfig,
  SubPhaseActivePlayer,
  SubPhaseBehaviorConfig,
  PhaseConfig,
  SubPhaseConfig,
  // 新增类型
  PhaseTransitionRule,
  PhaseTransitionCondition,
  PhaseAutoActionConfig,
} from './types.js';

// ============================================
// 阶段配置注册表
// ============================================

export {
  // 配置 Map
  PHASE_CONFIGS,
  // 查询函数
  getPhaseConfig,
  getPhaseName,
  getPhaseShortName,
  getPhaseColorClass,
  getPhaseIcon,
  canPlayerEndPhase,
  isSharedPhase,
  getInitialSubPhase,
  // 新增查询函数
  getPhaseTransitions,
  getPhaseAutoActions,
  getPhaseTriggerConditions,
} from './phase-registry.js';

// ============================================
// 子阶段配置注册表
// ============================================

export {
  // 配置 Map
  SUB_PHASE_CONFIGS,
  // 查询函数
  getSubPhaseConfig,
  getSubPhaseName,
  getSubPhaseIcon,
  isUserActionRequired,
  isEffectWindow,
  isSuccessEffectSubPhase,
  getNextSubPhase,
} from './sub-phase-registry.js';

// ============================================
// 行动玩家判断
// ============================================

export {
  isPlayerActive,
  getActivePlayerIds,
  getActivePlayerId,
  isCurrentlySharedPhase,
} from './active-player.js';
