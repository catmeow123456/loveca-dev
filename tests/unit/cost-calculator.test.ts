/**
 * 费用计算器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CardType, OrientationState, SlotPosition } from '../../src/shared/types/enums';
import {
  CostCalculator,
  StageMemberInfo,
  AvailableResources,
} from '../../src/domain/rules/cost-calculator';
import type { MemberCardData } from '../../src/domain/entities/card';

// ============================================
// 测试辅助函数
// ============================================

function createMockMemberData(
  cost: number,
  name: string = 'Test Member',
  cardCode: string = 'TEST-001',
  options: {
    readonly groupName?: string;
    readonly cardText?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupName: options.groupName,
    cardText: options.cardText,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
  };
}

function createStageMemberInfo(
  cardId: string,
  cost: number,
  position: SlotPosition,
  options: {
    readonly orientation?: OrientationState;
    readonly cardCode?: string;
    readonly groupName?: string;
    readonly cardText?: string;
  } = {}
): StageMemberInfo {
  return {
    cardId,
    data: createMockMemberData(cost, 'Stage Member', options.cardCode, {
      groupName: options.groupName,
      cardText: options.cardText,
    }),
    position,
    orientation: options.orientation ?? OrientationState.ACTIVE,
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

    it('应该让 LL-bp2-001-R+ 只按其他手牌数量减少费用，不计算自身', () => {
      const memberData = createMockMemberData(
        20,
        '渡边 曜&鬼冢夏美&大泽瑠璃乃',
        'LL-bp2-001-R+'
      );
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 19 }, (_, index) => `e${index}`),
        stageMembers: [],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      expect(result.canPay).toBe(false);
      expect(result.reason).toContain('需要 20 能量');
    });

    it('应该按 LL-bp2-001-R+ 以外的手牌每张减少1点费用', () => {
      const memberData = createMockMemberData(
        20,
        '渡边 曜&鬼冢夏美&大泽瑠璃乃',
        'LL-bp2-001-R+'
      );
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 18 }, (_, index) => `e${index}`),
        stageMembers: [],
        sourceCardId: 'source-card',
        handCardIds: ['source-card', 'other-1', 'other-2'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan?.totalCost).toBe(20);
      expect(directPlan?.modifiedCost).toBe(18);
      expect(directPlan?.costModifierAmount).toBe(2);
      expect(directPlan?.actualEnergyCost).toBe(18);
    });

    it('应该允许 LL-bp2-001-R+ 的手牌减费将费用降到0但不低于0', () => {
      const memberData = createMockMemberData(
        20,
        '渡边 曜&鬼冢夏美&大泽瑠璃乃',
        'LL-bp2-001-R+'
      );
      const resources: AvailableResources = {
        activeEnergyIds: [],
        stageMembers: [],
        sourceCardId: 'source-card',
        handCardIds: [
          'source-card',
          ...Array.from({ length: 25 }, (_, index) => `other-${index}`),
        ],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan?.modifiedCost).toBe(0);
      expect(directPlan?.costModifierAmount).toBe(20);
      expect(directPlan?.actualEnergyCost).toBe(0);
    });

    it('应该先应用 LL-bp2-001-R+ 手牌减费，再计算换手减免', () => {
      const memberData = createMockMemberData(
        20,
        '渡边 曜&鬼冢夏美&大泽瑠璃乃',
        'LL-bp2-001-R+'
      );
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 13 }, (_, index) => `e${index}`),
        stageMembers: [createStageMemberInfo('member-1', 3, SlotPosition.CENTER)],
        sourceCardId: 'source-card',
        handCardIds: ['source-card', 'other-1', 'other-2', 'other-3', 'other-4'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      const relayPlan = result.availablePlans.find((plan) => plan.isRelay);
      expect(directPlan).toBeUndefined();
      expect(relayPlan?.modifiedCost).toBe(16);
      expect(relayPlan?.costModifierAmount).toBe(4);
      expect(relayPlan?.relayDiscount).toBe(3);
      expect(relayPlan?.actualEnergyCost).toBe(13);
    });

    it('应该在没有待机虹咲成员时不减少 PL!N-pb1-008-P+ 的费用', () => {
      const memberData = createMockMemberData(17, '艾玛·维尔德', 'PL!N-pb1-008-P+');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('active-nijigasaki', 4, SlotPosition.LEFT, {
            orientation: OrientationState.ACTIVE,
            groupName: 'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
          }),
          createStageMemberInfo('waiting-other', 4, SlotPosition.CENTER, {
            orientation: OrientationState.WAITING,
            groupName: 'ラブライブ！スーパースター!!',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.RIGHT, resources);

      expect(result.canPay).toBe(false);
      expect(result.reason).toContain('需要 17 能量');
    });

    it('应该在存在待机虹咲成员时让 PL!N-pb1-008-P+ 费用减少2', () => {
      const memberData = createMockMemberData(17, '艾玛·维尔德', 'PL!N-pb1-008-P+');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('waiting-nijigasaki', 4, SlotPosition.LEFT, {
            orientation: OrientationState.WAITING,
            groupName: 'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.RIGHT, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan?.totalCost).toBe(17);
      expect(directPlan?.modifiedCost).toBe(15);
      expect(directPlan?.costModifierAmount).toBe(2);
      expect(directPlan?.actualEnergyCost).toBe(15);
    });

    it('应该让 PL!N-pb1-008-R 同编号罕度同样获得虹咲待机减费', () => {
      const memberData = createMockMemberData(17, '艾玛·维尔德', 'PL!N-pb1-008-R');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('waiting-nijigasaki', 4, SlotPosition.LEFT, {
            orientation: OrientationState.WAITING,
            groupName: 'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.RIGHT, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan?.modifiedCost).toBe(15);
      expect(directPlan?.costModifierAmount).toBe(2);
    });

    it('应该让舞台上的 PL!SP-bp5-003-AR 使10费Liella!成员费用减少2', () => {
      const memberData = createMockMemberData(10, '10费Liella!成员', 'PL!SP-test-cost10');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 8 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chisato-source', 17, SlotPosition.LEFT, {
            cardCode: 'PL!SP-bp5-003-AR',
            groupName: 'ラブライブ！スーパースター!!',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan?.totalCost).toBe(10);
      expect(directPlan?.modifiedCost).toBe(8);
      expect(directPlan?.costModifierAmount).toBe(2);
      expect(directPlan?.costModifiers[0]?.sourceCardId).toBe('chisato-source');
      expect(directPlan?.actualEnergyCost).toBe(8);
    });

    it('应该让 PL!SP-bp5-003-SEC 同编号罕度同样作为舞台来源减费', () => {
      const memberData = createMockMemberData(10, '10费Liella!成员', 'PL!SP-test-cost10');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 8 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chisato-source', 17, SlotPosition.LEFT, {
            cardCode: 'PL!SP-bp5-003-SEC',
            groupName: 'ラブライブ！スーパースター!!',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan?.modifiedCost).toBe(8);
      expect(directPlan?.costModifierAmount).toBe(2);
    });

    it('应该要求 PL!SP-bp5-003-AR 的目标是10费Liella!成员才减少费用', () => {
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 8 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chisato-source', 17, SlotPosition.LEFT, {
            cardCode: 'PL!SP-bp5-003-AR',
            groupName: 'ラブライブ！スーパースター!!',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const cost9Liella = createMockMemberData(9, '9费Liella!成员', 'PL!SP-test-cost9');
      const cost10Other = createMockMemberData(10, '10费非Liella!成员', 'PL!N-test-cost10', {
        groupName: 'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
      });

      const cost9Result = calculator.checkCanPayCost(cost9Liella, SlotPosition.CENTER, resources);
      const cost10OtherResult = calculator.checkCanPayCost(
        cost10Other,
        SlotPosition.CENTER,
        resources
      );

      expect(cost9Result.canPay).toBe(false);
      expect(cost9Result.reason).toContain('需要 9 能量');
      expect(cost10OtherResult.canPay).toBe(false);
      expect(cost10OtherResult.reason).toContain('需要 10 能量');
    });

    it('应该先应用 PL!SP-bp5-003-AR 舞台来源减费，再计算换手减免', () => {
      const memberData = createMockMemberData(10, '10费Liella!成员', 'PL!SP-test-cost10');
      const resources: AvailableResources = {
        activeEnergyIds: ['e1'],
        stageMembers: [
          createStageMemberInfo('chisato-source', 7, SlotPosition.CENTER, {
            cardCode: 'PL!SP-bp5-003-AR',
            groupName: 'ラブライブ！スーパースター!!',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const relayPlan = result.availablePlans.find((plan) => plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(relayPlan?.modifiedCost).toBe(8);
      expect(relayPlan?.costModifierAmount).toBe(2);
      expect(relayPlan?.relayDiscount).toBe(7);
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
      expect(info.modifiedCost).toBe(4);
      expect(info.costModifierAmount).toBe(0);
      expect(info.availableEnergy).toBe(3);
      expect(info.targetSlotMember).not.toBeNull();
      expect(info.possibleRelayDiscount).toBe(2);
      expect(info.canPayWithoutRelay).toBe(false);
      expect(info.canPayWithRelay).toBe(true);
    });
  });
});
