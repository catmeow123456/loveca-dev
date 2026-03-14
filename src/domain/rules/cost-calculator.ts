/**
 * 费用计算器
 * 基于 detail_rules.md 第 9.6.2.3 章 - 成员卡费用支付
 */

import type { MemberCardData } from '../entities/card';
import { SlotPosition } from '../../shared/types/enums';

// ============================================
// 费用相关类型
// ============================================

/**
 * 费用支付方案
 */
export interface CostPaymentPlan {
  /** 需要支付的总费用 */
  readonly totalCost: number;
  /** 需要支付的能量（将变为等待状态的能量卡 ID） */
  readonly energyToTap: readonly string[];
  /** 换手的成员（将移动到休息室的成员卡 ID） */
  readonly memberToRelay: string | null;
  /** 换手减免的费用 */
  readonly relayDiscount: number;
  /** 实际需要支付的能量数量 */
  readonly actualEnergyCost: number;
  /** 是否发生换手 */
  readonly isRelay: boolean;
}

/**
 * 费用支付检查结果
 */
export interface CostCheckResult {
  /** 是否可以支付 */
  readonly canPay: boolean;
  /** 可用的支付方案（可能有多种） */
  readonly availablePlans: readonly CostPaymentPlan[];
  /** 无法支付的原因（如果不能支付） */
  readonly reason?: string;
}

/**
 * 舞台成员信息（用于换手计算）
 */
export interface StageMemberInfo {
  /** 成员卡 ID */
  readonly cardId: string;
  /** 成员卡数据 */
  readonly data: MemberCardData;
  /** 所在槽位 */
  readonly position: SlotPosition;
}

/**
 * 可用资源信息
 */
export interface AvailableResources {
  /** 可用（活跃状态）的能量卡 ID 列表 */
  readonly activeEnergyIds: readonly string[];
  /** 舞台上的成员信息（用于换手） */
  readonly stageMembers: readonly StageMemberInfo[];
}

// ============================================
// 费用计算器类
// ============================================

/**
 * 费用计算器
 * 处理成员卡播放时的费用计算和换手逻辑
 */
export class CostCalculator {
  /**
   * 计算播放成员卡的基础费用
   * 参考规则 9.6.2.3.1
   *
   * @param memberData 成员卡数据
   * @returns 基础费用
   */
  calculateBaseCost(memberData: MemberCardData): number {
    return memberData.cost;
  }

  /**
   * 计算换手可以减免的费用
   * 参考规则 9.6.2.3.2
   *
   * @param relayMemberData 被换手的成员卡数据
   * @returns 减免的费用（等于被换手成员的费用）
   */
  calculateRelayDiscount(relayMemberData: MemberCardData): number {
    return relayMemberData.cost;
  }

  /**
   * 检查是否可以支付费用
   * 包括直接支付和换手两种方式
   *
   * @param memberData 要播放的成员卡数据
   * @param targetPosition 目标槽位
   * @param resources 可用资源
   * @returns 费用检查结果
   */
  checkCanPayCost(
    memberData: MemberCardData,
    targetPosition: SlotPosition,
    resources: AvailableResources
  ): CostCheckResult {
    const baseCost = this.calculateBaseCost(memberData);
    const availableEnergy = resources.activeEnergyIds.length;
    const availablePlans: CostPaymentPlan[] = [];

    // 方案1：直接支付（不换手）
    if (availableEnergy >= baseCost) {
      availablePlans.push({
        totalCost: baseCost,
        energyToTap: resources.activeEnergyIds.slice(0, baseCost),
        memberToRelay: null,
        relayDiscount: 0,
        actualEnergyCost: baseCost,
        isRelay: false,
      });
    }

    // 方案2：换手支付
    // 查找目标槽位上的成员（如果有）
    const targetMember = resources.stageMembers.find((m) => m.position === targetPosition);

    if (targetMember) {
      const relayDiscount = this.calculateRelayDiscount(targetMember.data);
      const actualCost = Math.max(0, baseCost - relayDiscount);

      if (availableEnergy >= actualCost) {
        availablePlans.push({
          totalCost: baseCost,
          energyToTap: resources.activeEnergyIds.slice(0, actualCost),
          memberToRelay: targetMember.cardId,
          relayDiscount,
          actualEnergyCost: actualCost,
          isRelay: true,
        });
      }
    }

    if (availablePlans.length === 0) {
      return {
        canPay: false,
        availablePlans: [],
        reason: `费用不足：需要 ${baseCost} 能量，可用 ${availableEnergy} 能量`,
      };
    }

    return {
      canPay: true,
      availablePlans,
    };
  }

  /**
   * 选择最优支付方案
   * 优先选择消耗最少能量的方案
   *
   * @param plans 可用的支付方案
   * @returns 最优方案，如果没有可用方案则返回 null
   */
  selectOptimalPlan(plans: readonly CostPaymentPlan[]): CostPaymentPlan | null {
    if (plans.length === 0) {
      return null;
    }

    // 按实际能量消耗排序，选择最少的
    const sorted = [...plans].sort((a, b) => a.actualEnergyCost - b.actualEnergyCost);
    return sorted[0];
  }

  /**
   * 生成所有可能的支付方案
   * 用于让玩家选择
   *
   * @param memberData 要播放的成员卡数据
   * @param targetPosition 目标槽位
   * @param resources 可用资源
   * @returns 所有可能的支付方案
   */
  generateAllPaymentPlans(
    memberData: MemberCardData,
    targetPosition: SlotPosition,
    resources: AvailableResources
  ): CostPaymentPlan[] {
    const result = this.checkCanPayCost(memberData, targetPosition, resources);
    return [...result.availablePlans];
  }

  /**
   * 检查是否可以在指定槽位播放成员
   * 参考规则 9.6.2.1.2.1 - 不能在本回合已有成员移入的槽位播放
   *
   * @param targetPosition 目标槽位
   * @param movedToStageThisTurn 本回合已移动到舞台的卡牌 ID
   * @param stageMembers 当前舞台成员
   * @returns 是否可以播放
   */
  canPlayInSlot(
    targetPosition: SlotPosition,
    movedToStageThisTurn: readonly string[],
    stageMembers: readonly StageMemberInfo[]
  ): boolean {
    // 检查该槽位是否有本回合刚移入的成员
    const memberInSlot = stageMembers.find((m) => m.position === targetPosition);

    if (memberInSlot && movedToStageThisTurn.includes(memberInSlot.cardId)) {
      return false;
    }

    return true;
  }

  /**
   * 获取可以播放成员的槽位列表
   *
   * @param movedToStageThisTurn 本回合已移动到舞台的卡牌 ID
   * @param stageMembers 当前舞台成员
   * @returns 可用槽位列表
   */
  getAvailableSlots(
    movedToStageThisTurn: readonly string[],
    stageMembers: readonly StageMemberInfo[]
  ): SlotPosition[] {
    const allSlots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];

    return allSlots.filter((slot) => this.canPlayInSlot(slot, movedToStageThisTurn, stageMembers));
  }

  /**
   * 计算完整的播放成本信息
   * 包括基础费用、可用减免、最终费用等
   *
   * @param memberData 要播放的成员卡数据
   * @param targetPosition 目标槽位
   * @param resources 可用资源
   */
  calculatePlayCostInfo(
    memberData: MemberCardData,
    targetPosition: SlotPosition,
    resources: AvailableResources
  ): {
    baseCost: number;
    availableEnergy: number;
    targetSlotMember: StageMemberInfo | null;
    possibleRelayDiscount: number;
    canPayWithoutRelay: boolean;
    canPayWithRelay: boolean;
  } {
    const baseCost = this.calculateBaseCost(memberData);
    const availableEnergy = resources.activeEnergyIds.length;
    const targetSlotMember =
      resources.stageMembers.find((m) => m.position === targetPosition) ?? null;
    const possibleRelayDiscount = targetSlotMember
      ? this.calculateRelayDiscount(targetSlotMember.data)
      : 0;

    return {
      baseCost,
      availableEnergy,
      targetSlotMember,
      possibleRelayDiscount,
      canPayWithoutRelay: availableEnergy >= baseCost,
      canPayWithRelay:
        targetSlotMember !== null &&
        availableEnergy >= Math.max(0, baseCost - possibleRelayDiscount),
    };
  }
}

// ============================================
// 导出单例实例
// ============================================

/**
 * 费用计算器单例
 */
export const costCalculator = new CostCalculator();
