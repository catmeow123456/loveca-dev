/**
 * Live 判定器
 * 基于 detail_rules.md 第 8 章 - Live 阶段
 */

import { HeartColor, BladeHeartEffect } from '../../shared/types/enums';
import type {
  HeartIcon,
  HeartRequirement,
  MemberCardData,
  LiveCardData,
  BladeHeartItem,
} from '../entities/card';
import { HeartPool, createHeartCountsFromIcons } from '../value-objects/heart';

// ============================================
// Live 判定相关类型
// ============================================

/**
 * 单张 Live 卡的判定结果
 */
export interface LiveCardJudgment {
  /** Live 卡 ID */
  readonly liveCardId: string;
  /** Live 卡数据 */
  readonly liveCardData: LiveCardData;
  /** 是否成功 */
  readonly isSuccess: boolean;
  /** 消耗的 Heart 分配（如果成功） */
  readonly heartAllocation: Map<HeartColor, { normal: number; rainbow: number }> | null;
}

/**
 * Cheer（应援）结果
 * 参考规则 8.3.11 - 8.3.12
 */
export interface CheerResult {
  /** 公开的卡牌 ID */
  readonly revealedCardIds: readonly string[];
  /** 从公开卡牌获得的 Blade Hearts */
  readonly bladeHearts: readonly BladeHeartItem[];
  /** 抽卡次数（来自 [卡牌+1] 效果） */
  readonly drawCount: number;
  /** 额外获得的 Heart */
  readonly bonusHearts: HeartPool;
}

/**
 * 演出阶段结果
 * 参考规则 8.3
 */
export interface PerformanceResult {
  /** 玩家 ID */
  readonly playerId: string;
  /** Cheer 结果 */
  readonly cheerResult: CheerResult;
  /** 所有 Heart（成员 + Cheer） */
  readonly totalHeartPool: HeartPool;
  /** 各 Live 卡判定结果 */
  readonly liveJudgments: readonly LiveCardJudgment[];
  /** 是否全部失败（所有 Live 卡都放入休息室） */
  readonly allFailed: boolean;
  /** 本次 Live 的总分数 */
  readonly totalScore: number;
  /** 应援带来的额外分数（[音符+1] 效果） */
  readonly bonusScore: number;
}

/**
 * Live 胜负判定结果
 * 参考规则 8.4
 */
export interface LiveResultJudgment {
  /** 先攻玩家 ID */
  readonly firstPlayerId: string;
  /** 后攻玩家 ID */
  readonly secondPlayerId: string;
  /** 先攻玩家分数 */
  readonly firstPlayerScore: number;
  /** 后攻玩家分数 */
  readonly secondPlayerScore: number;
  /** 获胜玩家 ID 列表（可能双方都获胜） */
  readonly winnerIds: readonly string[];
  /** 先攻玩家是否有 Live 卡 */
  readonly firstPlayerHasLiveCard: boolean;
  /** 后攻玩家是否有 Live 卡 */
  readonly secondPlayerHasLiveCard: boolean;
}

// ============================================
// Live 判定器类
// ============================================

/**
 * Live 判定器
 * 处理 Live 阶段的所有判定逻辑
 */
export class LiveResolver {
  /**
   * 收集成员卡提供的 Heart
   * 参考规则 8.3.14
   *
   * @param members 活跃状态的成员卡数据数组
   * @returns Heart 池
   */
  collectMemberHearts(members: readonly MemberCardData[]): HeartPool {
    const allHearts: HeartIcon[] = [];

    for (const member of members) {
      allHearts.push(...member.hearts);
    }

    return new HeartPool(createHeartCountsFromIcons(allHearts));
  }

  /**
   * 计算总光棒数
   * 参考规则 8.3.10
   *
   * @param members 活跃状态的成员卡数据数组
   * @returns 总光棒数
   */
  calculateTotalBlade(members: readonly MemberCardData[]): number {
    return members.reduce((total, member) => total + member.blade, 0);
  }

  /**
   * 处理 Cheer（应援）效果
   * 参考规则 8.3.11 - 8.3.12
   *
   * @param revealedCards 从卡组公开的卡牌数据（带 bladeHearts）
   * @returns Cheer 结果
   */
  processCheer(
    revealedCards: readonly { cardId: string; bladeHearts?: readonly BladeHeartItem[] }[]
  ): CheerResult {
    let drawCount = 0;
    let scoreCount = 0;
    const bonusHearts: HeartIcon[] = [];
    const allBladeHearts: BladeHeartItem[] = [];

    for (const card of revealedCards) {
      if (card.bladeHearts) {
        for (const item of card.bladeHearts) {
          allBladeHearts.push(item);

          switch (item.effect) {
            case BladeHeartEffect.DRAW:
              // [卡牌+1] 效果 - 抽 1 张卡
              drawCount += 1;
              break;

            case BladeHeartEffect.SCORE:
              // [音符+1] 效果 - 加 1 分
              scoreCount += 1;
              break;

            case BladeHeartEffect.HEART:
              // 获得心效果
              if (item.heartColor) {
                bonusHearts.push({ color: item.heartColor, count: 1 });
              }
              break;
          }
        }
      }
    }

    return {
      revealedCardIds: revealedCards.map((c) => c.cardId),
      bladeHearts: allBladeHearts,
      drawCount,
      bonusHearts: new HeartPool(createHeartCountsFromIcons(bonusHearts)),
    };
  }

  /**
   * 计算 Cheer 带来的额外分数
   * 参考规则 8.4.2.1 - [音符+1] 效果
   *
   * @param bladeHearts Blade Heart 数组
   * @returns 额外分数
   */
  calculateCheerBonusScore(bladeHearts: readonly BladeHeartItem[]): number {
    let bonusScore = 0;
    for (const item of bladeHearts) {
      if (item.effect === BladeHeartEffect.SCORE) {
        bonusScore += 1;
      }
    }
    return bonusScore;
  }

  /**
   * 判定单张 Live 卡是否成功
   * 参考规则 8.3.15
   *
   * @param liveCardId Live 卡 ID
   * @param liveCardData Live 卡数据
   * @param heartPool 可用的 Heart 池
   * @returns 判定结果
   */
  judgeSingleLive(
    liveCardId: string,
    liveCardData: LiveCardData,
    heartPool: HeartPool
  ): LiveCardJudgment {
    const allocation = heartPool.allocateForRequirement(liveCardData.requirements);

    return {
      liveCardId,
      liveCardData,
      isSuccess: allocation !== null,
      heartAllocation: allocation,
    };
  }

  /**
   * 判定多张 Live 卡
   * 按顺序判定，成功的卡消耗 Heart
   * 参考规则 8.3.15 - 8.3.16
   *
   * @param liveCards Live 卡数据数组（按判定顺序）
   * @param heartPool 可用的 Heart 池
   * @returns 各 Live 卡的判定结果
   */
  judgeMultipleLives(
    liveCards: readonly { cardId: string; data: LiveCardData }[],
    heartPool: HeartPool
  ): { judgments: LiveCardJudgment[]; remainingPool: HeartPool } {
    const judgments: LiveCardJudgment[] = [];
    let currentPool = heartPool;

    for (const liveCard of liveCards) {
      const judgment = this.judgeSingleLive(liveCard.cardId, liveCard.data, currentPool);
      judgments.push(judgment);

      // 如果成功，消耗 Heart
      if (judgment.isSuccess) {
        const newPool = currentPool.consume(liveCard.data.requirements);
        if (newPool) {
          currentPool = newPool;
        }
      }
    }

    return {
      judgments,
      remainingPool: currentPool,
    };
  }

  /**
   * 执行完整的演出阶段
   * 参考规则 8.3
   *
   * @param playerId 玩家 ID
   * @param activeMembers 活跃状态的成员卡数据
   * @param liveCards Live 卡数据
   * @param cheerRevealedCards Cheer 公开的卡牌
   * @returns 演出阶段结果
   */
  performLive(
    playerId: string,
    activeMembers: readonly MemberCardData[],
    liveCards: readonly { cardId: string; data: LiveCardData }[],
    cheerRevealedCards: readonly { cardId: string; bladeHearts?: readonly BladeHeartItem[] }[]
  ): PerformanceResult {
    // 1. 收集成员 Heart
    const memberHeartPool = this.collectMemberHearts(activeMembers);

    // 2. 处理 Cheer 效果
    const cheerResult = this.processCheer(cheerRevealedCards);

    // 3. 合并所有 Heart
    const totalHeartPool = memberHeartPool.merge(cheerResult.bonusHearts);

    // 4. 判定 Live 卡
    const { judgments } = this.judgeMultipleLives(liveCards, totalHeartPool);

    // 5. 检查是否全部失败
    const allFailed = judgments.every((j) => !j.isSuccess);

    // 6. 计算分数（只有成功的 Live 卡计入分数）
    let totalScore = 0;
    for (const judgment of judgments) {
      if (judgment.isSuccess) {
        totalScore += judgment.liveCardData.score;
      }
    }

    // 7. 计算 Cheer 额外分数
    const bonusScore = this.calculateCheerBonusScore(cheerResult.bladeHearts);
    totalScore += bonusScore;

    return {
      playerId,
      cheerResult,
      totalHeartPool,
      liveJudgments: judgments,
      allFailed,
      totalScore,
      bonusScore,
    };
  }

  /**
   * 判定 Live 胜负
   * 参考规则 8.4.3 - 8.4.6
   *
   * @param firstPlayerResult 先攻玩家演出结果
   * @param secondPlayerResult 后攻玩家演出结果
   * @returns 胜负判定结果
   */
  judgeLiveResult(
    firstPlayerResult: PerformanceResult,
    secondPlayerResult: PerformanceResult
  ): LiveResultJudgment {
    const firstHasLive = !firstPlayerResult.allFailed;
    const secondHasLive = !secondPlayerResult.allFailed;

    const firstScore = firstPlayerResult.totalScore;
    const secondScore = secondPlayerResult.totalScore;

    const winnerIds: string[] = [];

    // 规则 8.4.3 - 8.4.6
    if (!firstHasLive && !secondHasLive) {
      // 8.4.3.1 / 8.4.6.1: 双方都没有 Live 卡，无人获胜
      // winnerIds 保持为空
    } else if (firstHasLive && !secondHasLive) {
      // 8.4.3.2: 先攻有卡，后攻无卡，先攻获胜
      winnerIds.push(firstPlayerResult.playerId);
    } else if (!firstHasLive && secondHasLive) {
      // 8.4.3.2: 后攻有卡，先攻无卡，后攻获胜
      winnerIds.push(secondPlayerResult.playerId);
    } else {
      // 8.4.3.3 / 8.4.6.2: 双方都有卡，比较分数
      if (firstScore > secondScore) {
        winnerIds.push(firstPlayerResult.playerId);
      } else if (secondScore > firstScore) {
        winnerIds.push(secondPlayerResult.playerId);
      } else {
        // 分数相等，双方都获胜
        winnerIds.push(firstPlayerResult.playerId);
        winnerIds.push(secondPlayerResult.playerId);
      }
    }

    return {
      firstPlayerId: firstPlayerResult.playerId,
      secondPlayerId: secondPlayerResult.playerId,
      firstPlayerScore: firstScore,
      secondPlayerScore: secondScore,
      winnerIds,
      firstPlayerHasLiveCard: firstHasLive,
      secondPlayerHasLiveCard: secondHasLive,
    };
  }

  /**
   * 检查 Heart 需求是否满足（静态辅助方法）
   * 参考规则 2.11.3
   *
   * @param heartPool Heart 池
   * @param requirement Heart 需求
   * @returns 是否满足
   */
  static canSatisfyRequirement(heartPool: HeartPool, requirement: HeartRequirement): boolean {
    return heartPool.canSatisfy(requirement);
  }
}

// ============================================
// 导出单例实例
// ============================================

/**
 * Live 判定器单例
 */
export const liveResolver = new LiveResolver();
