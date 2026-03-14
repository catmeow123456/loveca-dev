/**
 * 费用计算器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CardType, SlotPosition } from '../../src/shared/types/enums';
import {
  CostCalculator,
  StageMemberInfo,
  AvailableResources,
} from '../../src/domain/rules/cost-calculator';
import type { MemberCardData } from '../../src/domain/entities/card';

// ============================================
// 测试辅助函数
// ============================================

function createMockMemberData(cost: number, name: string = 'Test Member'): MemberCardData {
  return {
    cardCode: 'TEST-001',
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
  };
}

function createStageMemberInfo(
  cardId: string,
  cost: number,
  position: SlotPosition
): StageMemberInfo {
  return {
    cardId,
    data: createMockMemberData(cost),
    position,
  };
}

// ============================================
// CostCalculator 测试
// ============================================

describe('CostCalculator', () => {
  let calculator: CostCalculator;

  beforeEach(() => {
    calculator = new CostCalculator();
  });

  describe('calculateBaseCost', () => {
    it('应该返回成员卡的费用', () => {
      const memberData = createMockMemberData(3);
      expect(calculator.calculateBaseCost(memberData)).toBe(3);
    });

    it('应该处理零费用成员', () => {
      const memberData = createMockMemberData(0);
      expect(calculator.calculateBaseCost(memberData)).toBe(0);
    });
  });

  describe('calculateRelayDiscount', () => {
    it('应该返回被换手成员的费用作为减免', () => {
      const memberData = createMockMemberData(2);
      expect(calculator.calculateRelayDiscount(memberData)).toBe(2);
    });
  });

  describe('checkCanPayCost', () => {
    it('应该在能量充足时允许直接支付', () => {
      const memberData = createMockMemberData(3);
      const resources: AvailableResources = {
        activeEnergyIds: ['e1', 'e2', 'e3', 'e4'],
        stageMembers: [],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      expect(result.canPay).toBe(true);
      expect(result.availablePlans.length).toBeGreaterThan(0);

      const directPlan = result.availablePlans.find((p) => !p.isRelay);
      expect(directPlan).toBeDefined();
      expect(directPlan?.actualEnergyCost).toBe(3);
    });

    it('应该在能量不足时返回无法支付', () => {
      const memberData = createMockMemberData(5);
      const resources: AvailableResources = {
        activeEnergyIds: ['e1', 'e2'],
        stageMembers: [],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      expect(result.canPay).toBe(false);
      expect(result.reason).toContain('费用不足');
    });

    it('应该在有换手选项时提供换手方案', () => {
      const memberData = createMockMemberData(4);
      const resources: AvailableResources = {
        activeEnergyIds: ['e1', 'e2'],
        stageMembers: [createStageMemberInfo('member-1', 3, SlotPosition.CENTER)],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      expect(result.canPay).toBe(true);

      const relayPlan = result.availablePlans.find((p) => p.isRelay);
      expect(relayPlan).toBeDefined();
      expect(relayPlan?.relayDiscount).toBe(3);
      expect(relayPlan?.actualEnergyCost).toBe(1); // 4 - 3 = 1
      expect(relayPlan?.memberToRelay).toBe('member-1');
    });

    it('应该在换手后费用为负时设为0', () => {
      const memberData = createMockMemberData(2);
      const resources: AvailableResources = {
        activeEnergyIds: ['e1'],
        stageMembers: [createStageMemberInfo('member-1', 5, SlotPosition.CENTER)],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      expect(result.canPay).toBe(true);

      const relayPlan = result.availablePlans.find((p) => p.isRelay);
      expect(relayPlan?.actualEnergyCost).toBe(0); // max(0, 2 - 5) = 0
    });

    it('应该同时提供直接支付和换手两种方案', () => {
      const memberData = createMockMemberData(3);
      const resources: AvailableResources = {
        activeEnergyIds: ['e1', 'e2', 'e3', 'e4'],
        stageMembers: [createStageMemberInfo('member-1', 2, SlotPosition.CENTER)],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      expect(result.canPay).toBe(true);
      expect(result.availablePlans.length).toBe(2);

      const directPlan = result.availablePlans.find((p) => !p.isRelay);
      const relayPlan = result.availablePlans.find((p) => p.isRelay);

      expect(directPlan?.actualEnergyCost).toBe(3);
      expect(relayPlan?.actualEnergyCost).toBe(1);
    });
  });

  describe('selectOptimalPlan', () => {
    it('应该选择消耗最少能量的方案', () => {
      const memberData = createMockMemberData(4);
      const resources: AvailableResources = {
        activeEnergyIds: ['e1', 'e2', 'e3', 'e4'],
        stageMembers: [createStageMemberInfo('member-1', 2, SlotPosition.CENTER)],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);
      const optimal = calculator.selectOptimalPlan(result.availablePlans);

      expect(optimal).not.toBeNull();
      expect(optimal?.isRelay).toBe(true);
      expect(optimal?.actualEnergyCost).toBe(2); // 4 - 2 = 2
    });

    it('应该在没有方案时返回null', () => {
      const optimal = calculator.selectOptimalPlan([]);
      expect(optimal).toBeNull();
    });
  });

  describe('canPlayInSlot', () => {
    it('应该允许在空槽位播放', () => {
      const result = calculator.canPlayInSlot(SlotPosition.CENTER, [], []);
      expect(result).toBe(true);
    });

    it('应该允许在有成员但本回合未移动的槽位播放', () => {
      const stageMembers = [createStageMemberInfo('member-1', 2, SlotPosition.CENTER)];
      const result = calculator.canPlayInSlot(SlotPosition.CENTER, [], stageMembers);
      expect(result).toBe(true);
    });

    it('应该禁止在本回合已移动成员的槽位播放', () => {
      const stageMembers = [createStageMemberInfo('member-1', 2, SlotPosition.CENTER)];
      const result = calculator.canPlayInSlot(SlotPosition.CENTER, ['member-1'], stageMembers);
      expect(result).toBe(false);
    });
  });

  describe('getAvailableSlots', () => {
    it('应该返回所有可用槽位', () => {
      const result = calculator.getAvailableSlots([], []);
      expect(result).toContain(SlotPosition.LEFT);
      expect(result).toContain(SlotPosition.CENTER);
      expect(result).toContain(SlotPosition.RIGHT);
    });

    it('应该排除本回合已移动成员的槽位', () => {
      const stageMembers = [
        createStageMemberInfo('member-1', 2, SlotPosition.LEFT),
        createStageMemberInfo('member-2', 3, SlotPosition.CENTER),
      ];

      const result = calculator.getAvailableSlots(['member-1'], stageMembers);

      expect(result).not.toContain(SlotPosition.LEFT);
      expect(result).toContain(SlotPosition.CENTER);
      expect(result).toContain(SlotPosition.RIGHT);
    });
  });

  describe('calculatePlayCostInfo', () => {
    it('应该返回完整的费用信息', () => {
      const memberData = createMockMemberData(4);
      const resources: AvailableResources = {
        activeEnergyIds: ['e1', 'e2', 'e3'],
        stageMembers: [createStageMemberInfo('member-1', 2, SlotPosition.CENTER)],
      };

      const info = calculator.calculatePlayCostInfo(memberData, SlotPosition.CENTER, resources);

      expect(info.baseCost).toBe(4);
      expect(info.availableEnergy).toBe(3);
      expect(info.targetSlotMember).not.toBeNull();
      expect(info.possibleRelayDiscount).toBe(2);
      expect(info.canPayWithoutRelay).toBe(false);
      expect(info.canPayWithRelay).toBe(true);
    });
  });
});
