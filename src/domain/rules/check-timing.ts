/**
 * 检查时机处理器
 * 基于 detail_rules.md 第 9.5 章 - 检查时机和 play 时机
 */

import type { GameState } from '../entities/game';
import type { PlayerState } from '../entities/player';
import { CardType } from '../../shared/types/enums';
import {
  RuleActionProcessor,
  RuleActionResult,
  RuleActionType,
  ruleActionProcessor,
} from './rule-actions';

// ============================================
// 检查时机相关类型
// ============================================

/**
 * 待机中的自动能力
 * 参考规则 9.7.2
 */
export interface PendingAutoAbility {
  /** 能力唯一标识 */
  readonly abilityId: string;
  /** 能力所属卡牌 ID */
  readonly sourceCardId: string;
  /** 能力掌控者（玩家 ID） */
  readonly controllerId: string;
  /** 待机次数（同一能力可能触发多次） */
  readonly pendingCount: number;
  /** 触发时间戳（用于排序） */
  readonly triggeredAt: number;
}

/**
 * 检查时机处理结果
 */
export interface CheckTimingResult {
  /** 是否执行了任何处理 */
  readonly hasProcessed: boolean;
  /** 执行的规则处理 */
  readonly ruleActions: readonly RuleActionResult[];
  /** 处理的自动能力 */
  readonly processedAbilities: readonly PendingAutoAbility[];
  /** 是否导致游戏结束 */
  readonly causesGameEnd: boolean;
  /** 获胜玩家 ID（如果导致游戏结束） */
  readonly winnerId: string | null;
  /** 是否需要继续处理 */
  readonly needsContinue: boolean;
}

/**
 * Play 时机处理结果
 */
export interface PlayTimingResult {
  /** 是否可以执行行动 */
  readonly canAct: boolean;
  /** 等待输入的玩家 ID */
  readonly waitingPlayerId: string;
  /** 可用的行动类型 */
  readonly availableActions: readonly PlayActionType[];
}

/**
 * Play 行动类型
 */
export enum PlayActionType {
  /** 播放成员卡 */
  PLAY_MEMBER = 'PLAY_MEMBER',
  /** 播放起动能力 */
  PLAY_ACTIVATED_ABILITY = 'PLAY_ACTIVATED_ABILITY',
  /** 结束阶段 */
  END_PHASE = 'END_PHASE',
}

// ============================================
// 检查时机处理器类
// ============================================

/**
 * 检查时机处理器
 * 实现规则 9.5.3 的检查时机循环
 */
export class CheckTimingHandler {
  private readonly ruleProcessor: RuleActionProcessor;

  constructor(ruleProcessor: RuleActionProcessor = ruleActionProcessor) {
    this.ruleProcessor = ruleProcessor;
  }

  /**
   * 执行检查时机
   * 参考规则 9.5.3
   *
   * 流程：
   * 1. 执行所有规则处理（9.5.3.1）
   * 2. 活跃玩家选择并处理一个待机自动能力（9.5.3.2）
   * 3. 非活跃玩家选择并处理一个待机自动能力（9.5.3.3）
   * 4. 如果有新的规则处理或自动能力，返回步骤 1
   * 5. 检查时机结束（9.5.3.4）
   *
   * @param game 游戏状态
   * @param activePlayerId 活跃玩家 ID
   * @param nonActivePlayerId 非活跃玩家 ID
   * @param pendingAbilities 待机中的自动能力
   * @param getCardType 获取卡牌类型的函数
   * @returns 检查时机处理结果
   */
  processCheckTiming(
    game: GameState,
    activePlayerId: string,
    nonActivePlayerId: string,
    pendingAbilities: readonly PendingAutoAbility[],
    getCardType: (cardId: string) => CardType | null
  ): CheckTimingResult {
    const processedRuleActions: RuleActionResult[] = [];
    const processedAbilities: PendingAutoAbility[] = [];
    let causesGameEnd = false;
    let winnerId: string | null = null;

    // 步骤 1: 执行所有规则处理
    const ruleActions = this.ruleProcessor.collectPendingRuleActions(game, getCardType);

    for (const action of ruleActions) {
      processedRuleActions.push(action);

      // 检查是否导致游戏结束
      if (action.causesGameEnd) {
        causesGameEnd = true;
        winnerId = action.winnerId ?? null;
      }
    }

    // 如果游戏结束，直接返回
    if (causesGameEnd) {
      return {
        hasProcessed: true,
        ruleActions: processedRuleActions,
        processedAbilities: [],
        causesGameEnd: true,
        winnerId,
        needsContinue: false,
      };
    }

    // 步骤 2: 活跃玩家处理自动能力
    const activePlayerAbilities = pendingAbilities.filter((a) => a.controllerId === activePlayerId);

    if (activePlayerAbilities.length > 0) {
      // 选择第一个待机能力（实际游戏中由玩家选择）
      const abilityToProcess = activePlayerAbilities[0];
      processedAbilities.push(abilityToProcess);

      // 返回需要继续处理（处理能力后需要重新检查）
      return {
        hasProcessed: true,
        ruleActions: processedRuleActions,
        processedAbilities,
        causesGameEnd: false,
        winnerId: null,
        needsContinue: true,
      };
    }

    // 步骤 3: 非活跃玩家处理自动能力
    const nonActivePlayerAbilities = pendingAbilities.filter(
      (a) => a.controllerId === nonActivePlayerId
    );

    if (nonActivePlayerAbilities.length > 0) {
      // 选择第一个待机能力（实际游戏中由玩家选择）
      const abilityToProcess = nonActivePlayerAbilities[0];
      processedAbilities.push(abilityToProcess);

      // 返回需要继续处理
      return {
        hasProcessed: true,
        ruleActions: processedRuleActions,
        processedAbilities,
        causesGameEnd: false,
        winnerId: null,
        needsContinue: true,
      };
    }

    // 步骤 4: 检查时机结束
    return {
      hasProcessed: processedRuleActions.length > 0,
      ruleActions: processedRuleActions,
      processedAbilities: [],
      causesGameEnd: false,
      winnerId: null,
      needsContinue: false,
    };
  }

  /**
   * 执行完整的检查时机循环
   * 持续处理直到没有新的规则处理或自动能力
   *
   * @param game 游戏状态
   * @param activePlayerId 活跃玩家 ID
   * @param nonActivePlayerId 非活跃玩家 ID
   * @param getPendingAbilities 获取待机自动能力的函数
   * @param getCardType 获取卡牌类型的函数
   * @param onAbilityProcessed 能力处理回调
   * @param maxIterations 最大迭代次数（防止无限循环）
   * @returns 完整的检查时机处理结果
   */
  processFullCheckTiming(
    game: GameState,
    activePlayerId: string,
    nonActivePlayerId: string,
    getPendingAbilities: () => readonly PendingAutoAbility[],
    getCardType: (cardId: string) => CardType | null,
    onAbilityProcessed?: (ability: PendingAutoAbility) => void,
    maxIterations: number = 1000
  ): CheckTimingResult {
    const allRuleActions: RuleActionResult[] = [];
    const allProcessedAbilities: PendingAutoAbility[] = [];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      const pendingAbilities = getPendingAbilities();
      const result = this.processCheckTiming(
        game,
        activePlayerId,
        nonActivePlayerId,
        pendingAbilities,
        getCardType
      );

      // 收集结果
      allRuleActions.push(...result.ruleActions);
      allProcessedAbilities.push(...result.processedAbilities);

      // 处理能力回调
      for (const ability of result.processedAbilities) {
        onAbilityProcessed?.(ability);
      }

      // 检查是否游戏结束
      if (result.causesGameEnd) {
        return {
          hasProcessed: true,
          ruleActions: allRuleActions,
          processedAbilities: allProcessedAbilities,
          causesGameEnd: true,
          winnerId: result.winnerId,
          needsContinue: false,
        };
      }

      // 检查是否需要继续
      if (!result.needsContinue) {
        break;
      }
    }

    // 检测无限循环
    if (iterations >= maxIterations) {
      console.warn('检查时机处理达到最大迭代次数，可能存在无限循环');
    }

    return {
      hasProcessed: allRuleActions.length > 0 || allProcessedAbilities.length > 0,
      ruleActions: allRuleActions,
      processedAbilities: allProcessedAbilities,
      causesGameEnd: false,
      winnerId: null,
      needsContinue: false,
    };
  }

  /**
   * 处理 Play 时机
   * 参考规则 9.5.4
   *
   * @param game 游戏状态
   * @param playerId 获得 Play 时机的玩家 ID
   * @returns Play 时机处理结果
   */
  processPlayTiming(game: GameState, playerId: string): PlayTimingResult {
    const availableActions: PlayActionType[] = [];

    // 检查可用行动
    // 1. 播放成员卡（需要检查手牌和费用）
    // 2. 播放起动能力（需要检查可用能力）
    // 3. 结束阶段（始终可用）

    // 简化实现：始终可以选择结束阶段
    availableActions.push(PlayActionType.END_PHASE);

    // TODO: 实际实现需要检查：
    // - 手牌中是否有可播放的成员卡
    // - 是否有可用的起动能力
    // - 当前阶段是否允许这些行动

    return {
      canAct: true,
      waitingPlayerId: playerId,
      availableActions,
    };
  }

  /**
   * 检查是否需要执行刷新
   * 参考规则 10.2
   * 注意：刷新不受检查时机限制，在任意时点检查
   *
   * @param player 玩家状态
   * @param checkTopCount 检视卡组顶部的张数（可选）
   * @returns 是否需要刷新
   */
  checkRefreshNeeded(player: PlayerState, checkTopCount?: number): boolean {
    return this.ruleProcessor.checkRefreshNeeded(player, checkTopCount).needsRefresh;
  }

  /**
   * 获取待机中的自动能力（按处理顺序排序）
   *
   * @param abilities 所有待机能力
   * @param activePlayerId 活跃玩家 ID
   * @returns 排序后的待机能力
   */
  sortPendingAbilities(
    abilities: readonly PendingAutoAbility[],
    activePlayerId: string
  ): PendingAutoAbility[] {
    // 排序规则：
    // 1. 活跃玩家的能力优先
    // 2. 同一玩家的能力按触发时间排序

    return [...abilities].sort((a, b) => {
      // 活跃玩家优先
      if (a.controllerId === activePlayerId && b.controllerId !== activePlayerId) {
        return -1;
      }
      if (a.controllerId !== activePlayerId && b.controllerId === activePlayerId) {
        return 1;
      }

      // 同一玩家按触发时间排序
      return a.triggeredAt - b.triggeredAt;
    });
  }

  /**
   * 创建待机自动能力
   *
   * @param abilityId 能力 ID
   * @param sourceCardId 来源卡牌 ID
   * @param controllerId 掌控者玩家 ID
   * @param pendingCount 待机次数
   * @returns 待机自动能力对象
   */
  createPendingAbility(
    abilityId: string,
    sourceCardId: string,
    controllerId: string,
    pendingCount: number = 1
  ): PendingAutoAbility {
    return {
      abilityId,
      sourceCardId,
      controllerId,
      pendingCount,
      triggeredAt: Date.now(),
    };
  }

  /**
   * 减少待机能力的待机次数
   *
   * @param ability 待机能力
   * @returns 更新后的待机能力（如果待机次数为 0 则返回 null）
   */
  decrementPendingCount(ability: PendingAutoAbility): PendingAutoAbility | null {
    const newCount = ability.pendingCount - 1;

    if (newCount <= 0) {
      return null;
    }

    return {
      ...ability,
      pendingCount: newCount,
    };
  }
}

// ============================================
// 导出单例实例
// ============================================

/**
 * 检查时机处理器单例
 */
export const checkTimingHandler = new CheckTimingHandler();
