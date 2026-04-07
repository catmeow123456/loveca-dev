/**
 * 游戏阶段管理器
 * 基于 detail_rules.md 第 7 章和第 8 章
 *
 * 游戏流程：
 * 1. 每个回合：先攻通常阶段 → 后攻通常阶段 → Live阶段
 * 2. 通常阶段：活跃阶段 → 能量阶段 → 抽卡阶段 → 主要阶段
 * 3. Live阶段：Live卡设置阶段 → 先攻演出阶段 → 后攻演出阶段 → Live胜败判定阶段
 *
 * 重构说明 (2025-01-20)：
 * - 阶段流转规则已移至 phase-config/phase-registry.ts 配置
 * - PhaseManager 现在是配置的执行器，不再包含硬编码的业务规则
 * - 子阶段流转使用 sub-phase-registry.ts 的 nextSubPhase 配置
 */

import {
  GamePhase,
  TurnType,
  TriggerCondition,
  SubPhase,
  EffectWindowType,
} from '../shared/types/enums.js';
import type { GameState } from '../domain/entities/game.js';
import {
  getPhaseConfig,
  getPhaseTransitions,
  getPhaseAutoActions,
  getPhaseTriggerConditions,
  getNextSubPhase,
  canPlayerEndPhase as canPlayerEndPhaseFromConfig,
  getSubPhaseConfig,
} from '../shared/phase-config/index.js';
import type { PhaseTransitionRule, PhaseAutoActionConfig } from '../shared/phase-config/index.js';

// ============================================
// 阶段转换结果
// ============================================

/**
 * 阶段转换结果
 */
export interface PhaseTransitionResult {
  /** 新的游戏阶段 */
  readonly newPhase: GamePhase;
  /** 新的回合类型 */
  readonly newTurnType: TurnType;
  /** 新的主动玩家索引 */
  readonly newActivePlayerIndex: number;
  /** 是否是新回合 */
  readonly isNewTurn: boolean;
  /** 触发的诱发条件列表 */
  readonly triggeredConditions: readonly TriggerCondition[];
  /** 阶段开始时需要执行的自动处理 */
  readonly autoActions: readonly PhaseAutoAction[];
}

/**
 * 阶段自动处理类型
 */
export type PhaseAutoAction =
  | { type: 'UNTAP_ALL'; playerId: string }
  | { type: 'DRAW_ENERGY'; playerId: string }
  | { type: 'DRAW_CARD'; playerId: string; count: number };

// ============================================
// 阶段管理器
// ============================================

/**
 * 阶段管理器
 * 负责管理游戏阶段的流转
 *
 * 设计原则：
 * - 从 phase-config 读取配置，不硬编码业务规则
 * - 只包含配置解释和状态计算逻辑
 */
export class PhaseManager {
  /**
   * 获取下一个阶段
   * 根据 phase-config 配置计算
   *
   * @param game 当前游戏状态
   * @returns 阶段转换结果
   */
  getNextPhase(game: GameState): PhaseTransitionResult {
    const { currentPhase, firstPlayerIndex } = game;
    const transitions = getPhaseTransitions(currentPhase);

    if (transitions.length === 0) {
      throw new Error(`阶段 ${currentPhase} 没有配置流转规则`);
    }

    // 查找匹配的流转规则
    const rule = this.findMatchingTransition(game, transitions);
    if (!rule) {
      // 默认使用第一条规则
      return this.buildTransitionResult(game, transitions[0], firstPlayerIndex);
    }

    return this.buildTransitionResult(game, rule, firstPlayerIndex);
  }

  /**
   * 查找匹配的流转规则
   */
  private findMatchingTransition(
    game: GameState,
    rules: readonly PhaseTransitionRule[]
  ): PhaseTransitionRule | null {
    for (const rule of rules) {
      // 检查回合类型条件
      if (rule.whenTurnType && rule.whenTurnType !== game.currentTurnType) {
        continue;
      }

      // 检查特殊条件
      if (rule.whenCondition && !this.checkCondition(game, rule.whenCondition)) {
        continue;
      }

      return rule;
    }
    return null;
  }

  /**
   * 检查特殊条件
   */
  private checkCondition(game: GameState, condition: string): boolean {
    const firstPlayerId = game.players[game.firstPlayerIndex].id;
    const secondPlayerId = game.players[game.firstPlayerIndex === 0 ? 1 : 0].id;

    switch (condition) {
      case 'MULLIGAN_COMPLETED':
        return game.mulliganCompletedPlayers.length >= 2;

      case 'MULLIGAN_NOT_COMPLETED':
        return game.mulliganCompletedPlayers.length < 2;

      case 'LIVE_SET_FIRST_DONE':
        return (
          game.liveSetCompletedPlayers.includes(firstPlayerId) &&
          !game.liveSetCompletedPlayers.includes(secondPlayerId)
        );

      case 'LIVE_SET_SECOND_NOT_DONE':
        return !game.liveSetCompletedPlayers.includes(secondPlayerId);

      case 'LIVE_SET_BOTH_DONE':
        return (
          game.liveSetCompletedPlayers.includes(firstPlayerId) &&
          game.liveSetCompletedPlayers.includes(secondPlayerId)
        );

      default:
        return true;
    }
  }

  /**
   * 构建阶段转换结果
   */
  private buildTransitionResult(
    game: GameState,
    rule: PhaseTransitionRule,
    firstPlayerIndex: number
  ): PhaseTransitionResult {
    const secondPlayerIndex = firstPlayerIndex === 0 ? 1 : 0;

    // 计算新的回合类型
    const newTurnType = rule.nextTurnType === 'SAME' ? game.currentTurnType : rule.nextTurnType;

    // 计算新的活跃玩家索引
    let newActivePlayerIndex: number;
    switch (rule.nextActivePlayer) {
      case 'FIRST':
        newActivePlayerIndex = firstPlayerIndex;
        break;
      case 'SECOND':
        newActivePlayerIndex = secondPlayerIndex;
        break;
      case 'SWITCH':
        newActivePlayerIndex = game.activePlayerIndex === 0 ? 1 : 0;
        break;
      case 'SAME':
      default:
        newActivePlayerIndex = game.activePlayerIndex;
        break;
    }

    // 获取新阶段的配置
    const newPhaseConfig = getPhaseConfig(rule.nextPhase);
    const triggerConditions = getPhaseTriggerConditions(rule.nextPhase);
    const autoActionConfigs = getPhaseAutoActions(rule.nextPhase);

    // 转换自动处理配置为带 playerId 的格式
    const activePlayerId = game.players[newActivePlayerIndex].id;
    const autoActions: PhaseAutoAction[] = autoActionConfigs.map((config) =>
      this.convertAutoAction(config, activePlayerId)
    );

    return {
      newPhase: rule.nextPhase,
      newTurnType,
      newActivePlayerIndex,
      isNewTurn: rule.isNewTurn,
      triggeredConditions: triggerConditions,
      autoActions,
    };
  }

  /**
   * 转换自动处理配置
   */
  private convertAutoAction(config: PhaseAutoActionConfig, playerId: string): PhaseAutoAction {
    switch (config.type) {
      case 'UNTAP_ALL':
        return { type: 'UNTAP_ALL', playerId };
      case 'DRAW_ENERGY':
        return { type: 'DRAW_ENERGY', playerId };
      case 'DRAW_CARD':
        return { type: 'DRAW_CARD', playerId, count: config.count };
    }
  }

  /**
   * 检查是否可以结束当前阶段
   *
   * @param game 当前游戏状态
   * @returns 是否可以结束
   */
  canEndCurrentPhase(game: GameState): boolean {
    return canPlayerEndPhaseFromConfig(game.currentPhase);
  }

  /**
   * 获取当前阶段的活跃玩家
   * 根据规则 7.2
   *
   * @param game 当前游戏状态
   * @returns 活跃玩家索引
   */
  getActivePlayerIndex(game: GameState): number {
    const { currentPhase, currentTurnType, firstPlayerIndex } = game;

    // Live 阶段中没有指定回合玩家的阶段，先攻玩家为活跃玩家
    if (currentPhase === GamePhase.LIVE_SET_PHASE || currentPhase === GamePhase.LIVE_RESULT_PHASE) {
      return firstPlayerIndex;
    }

    // 指定了当前回合玩家的阶段
    if (currentTurnType === TurnType.FIRST_PLAYER_TURN) {
      return firstPlayerIndex;
    } else if (currentTurnType === TurnType.SECOND_PLAYER_TURN) {
      return firstPlayerIndex === 0 ? 1 : 0;
    }

    // 默认返回先攻玩家
    return firstPlayerIndex;
  }

  /**
   * 应用阶段转换到游戏状态
   *
   * @param game 当前游戏状态
   * @param transition 阶段转换结果
   * @returns 新的游戏状态
   */
  applyTransition(game: GameState, transition: PhaseTransitionResult): GameState {
    let newState: GameState = {
      ...game,
      currentPhase: transition.newPhase,
      currentTurnType: transition.newTurnType,
      activePlayerIndex: transition.newActivePlayerIndex,
    };

    // 如果是新回合，增加回合数
    if (transition.isNewTurn) {
      newState = {
        ...newState,
        turnCount: game.turnCount + 1,
      };
    }

    return newState;
  }

  // ============================================
  // 子阶段管理
  // ============================================

  /**
   * 获取下一个子阶段
   * 使用 sub-phase-registry 配置
   *
   * @param currentSubPhase 当前子阶段
   * @returns 下一个子阶段
   */
  getNextSubPhase(currentSubPhase: SubPhase): SubPhase {
    return getNextSubPhase(currentSubPhase);
  }

  /**
   * 推进到下一个子阶段
   *
   * @param game 当前游戏状态
   * @returns 子阶段推进结果
   */
  advanceToNextSubPhase(game: GameState): SubPhaseTransitionResult {
    const currentSubPhase = game.currentSubPhase;
    const nextSubPhase = this.getNextSubPhase(currentSubPhase);

    // 如果下一个子阶段是 NONE，说明当前主阶段的所有子阶段都完成了
    if (nextSubPhase === SubPhase.NONE) {
      return {
        newSubPhase: SubPhase.NONE,
        shouldAdvancePhase: true,
        autoActions: [],
      };
    }

    // 获取下一个子阶段需要执行的自动处理
    const autoActions = this.getSubPhaseAutoActions(game, nextSubPhase);

    return {
      newSubPhase: nextSubPhase,
      shouldAdvancePhase: false,
      autoActions,
    };
  }

  /**
   * 获取子阶段的自动处理
   *
   * @param game 当前游戏状态
   * @param subPhase 目标子阶段
   * @returns 自动处理列表
   */
  private getSubPhaseAutoActions(game: GameState, subPhase: SubPhase): SubPhaseAutoAction[] {
    const activePlayerId = game.players[game.activePlayerIndex].id;
    const firstPlayerId = game.players[game.firstPlayerIndex].id;
    const secondPlayerId = game.players[game.firstPlayerIndex === 0 ? 1 : 0].id;

    switch (subPhase) {
      // Live 设置阶段的抽卡子阶段
      case SubPhase.LIVE_SET_FIRST_DRAW:
        return [{ type: 'DRAW_CARDS_FOR_LIVE_SET', playerId: firstPlayerId }];

      case SubPhase.LIVE_SET_SECOND_DRAW:
        return [{ type: 'DRAW_CARDS_FOR_LIVE_SET', playerId: secondPlayerId }];

      // 演出阶段的翻开 Live 卡
      case SubPhase.PERFORMANCE_REVEAL:
        return [{ type: 'REVEAL_LIVE_CARDS', playerId: activePlayerId }];

      // Live 结算阶段的回合结束
      case SubPhase.RESULT_TURN_END:
        return [{ type: 'FINALIZE_LIVE_RESULT' }];

      default:
        return [];
    }
  }

  /**
   * 应用子阶段转换到游戏状态
   *
   * @param game 当前游戏状态
   * @param result 子阶段推进结果
   * @returns 新的游戏状态
   */
  applySubPhaseTransition(game: GameState, result: SubPhaseTransitionResult): GameState {
    const newState = {
      ...game,
      currentSubPhase: result.newSubPhase,
    };

    // 根据子阶段配置同步 activePlayerIndex
    const subConfig = getSubPhaseConfig(result.newSubPhase);
    if (subConfig) {
      const secondPlayerIndex = game.firstPlayerIndex === 0 ? 1 : 0;
      switch (subConfig.behavior.activePlayer) {
        case 'FIRST':
          newState.activePlayerIndex = game.firstPlayerIndex;
          break;
        case 'SECOND':
          newState.activePlayerIndex = secondPlayerIndex;
          break;
        // 'BOTH' and 'CURRENT_ACTIVE' keep current activePlayerIndex
      }
    }

    return newState;
  }

  /**
   * 获取效果窗口类型
   */
  getEffectWindowType(subPhase: SubPhase): EffectWindowType {
    switch (subPhase) {
      case SubPhase.PERFORMANCE_LIVE_START_EFFECTS:
        return EffectWindowType.LIVE_START;
      case SubPhase.RESULT_FIRST_SUCCESS_EFFECTS:
      case SubPhase.RESULT_SECOND_SUCCESS_EFFECTS:
        return EffectWindowType.LIVE_SUCCESS;
      default:
        return EffectWindowType.NONE;
    }
  }
}

// ============================================
// 子阶段转换结果类型
// ============================================

/**
 * 子阶段转换结果
 */
export interface SubPhaseTransitionResult {
  /** 新的子阶段 */
  readonly newSubPhase: SubPhase;
  /** 是否应该推进主阶段 */
  readonly shouldAdvancePhase: boolean;
  /** 子阶段开始时需要执行的自动处理 */
  readonly autoActions: readonly SubPhaseAutoAction[];
}

/**
 * 子阶段自动处理类型
 */
export type SubPhaseAutoAction =
  | { type: 'DRAW_CARDS_FOR_LIVE_SET'; playerId: string }
  | { type: 'REVEAL_LIVE_CARDS'; playerId: string }
  | { type: 'FINALIZE_LIVE_RESULT' };

/**
 * 阶段管理器单例
 */
export const phaseManager = new PhaseManager();
