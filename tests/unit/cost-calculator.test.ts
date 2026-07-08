/**
 * 费用计算器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CardType, OrientationState, SlotPosition } from '../../src/shared/types/enums';
import {
  canMemberBeRelayedAway,
  CostCalculator,
  StageMemberInfo,
  AvailableResources,
} from '../../src/domain/rules/cost-calculator';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';

// ============================================
// 测试辅助函数
// ============================================

function createMockMemberData(
  cost: number,
  name: string = 'Test Member',
  cardCode: string = 'TEST-001',
  options: {
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly cardText?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: options.groupNames,
    unitName: options.unitName,
    cardText: options.cardText,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
  };
}

function createMockLiveData(
  score: number,
  name: string = 'Test Live',
  cardCode: string = 'TEST-LIVE',
  options: {
    readonly groupNames?: readonly string[];
    readonly cardText?: string;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: options.groupNames,
    cardText: options.cardText,
    cardType: CardType.LIVE,
    score,
    requirements: {
      colorRequirements: new Map(),
      totalRequired: 0,
    },
  };
}

function createStageMemberInfo(
  cardId: string,
  cost: number,
  position: SlotPosition,
  options: {
    readonly orientation?: OrientationState;
    readonly cardCode?: string;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly cardText?: string;
    readonly effectiveCost?: number;
    readonly positionMovedThisTurn?: boolean;
  } = {}
): StageMemberInfo {
  return {
    cardId,
    data: createMockMemberData(cost, 'Stage Member', options.cardCode, {
      groupNames: options.groupNames,
      unitName: options.unitName,
      cardText: options.cardText,
    }),
    effectiveCost: options.effectiveCost,
    position,
    orientation: options.orientation ?? OrientationState.ACTIVE,
    positionMovedThisTurn: options.positionMovedThisTurn,
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
      expect(relayPlan?.relayReplacements).toEqual([
        { cardId: 'member-1', slot: SlotPosition.CENTER, effectiveCost: 3 },
      ]);
    });

    it('应该使用舞台成员有效费用计算换手减免', () => {
      const memberData = createMockMemberData(11);
      const resources: AvailableResources = {
        activeEnergyIds: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'],
        stageMembers: [
          createStageMemberInfo('effective-cost-member', 4, SlotPosition.CENTER, {
            cardCode: 'PL!-bp4-008-P',
            effectiveCost: 7,
          }),
        ],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      const relayPlan = result.availablePlans.find((plan) => plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan).toBeUndefined();
      expect(relayPlan?.relayDiscount).toBe(7);
      expect(relayPlan?.actualEnergyCost).toBe(4);
      expect(relayPlan?.memberToRelay).toBe('effective-cost-member');
      expect(relayPlan?.relayReplacements).toEqual([
        {
          cardId: 'effective-cost-member',
          slot: SlotPosition.CENTER,
          effectiveCost: 7,
        },
      ]);
    });

    it('allows explicit double relay only for PL!SP-bp4-004 and sums effective costs', () => {
      const memberData = createMockMemberData(22, '平安名すみれ', 'PL!SP-bp4-004-P');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 9 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('center-member', 4, SlotPosition.CENTER, { effectiveCost: 9 }),
          createStageMemberInfo('left-member', 4, SlotPosition.LEFT, { effectiveCost: 4 }),
        ],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources, {
        relayMode: 'DOUBLE',
        relayReplacementSlots: [SlotPosition.LEFT, SlotPosition.CENTER],
      });

      expect(result.canPay).toBe(true);
      expect(result.availablePlans).toHaveLength(1);
      expect(result.availablePlans[0]).toMatchObject({
        memberToRelay: 'center-member',
        relayDiscount: 13,
        actualEnergyCost: 9,
        isRelay: true,
      });
      expect(result.availablePlans[0]?.relayReplacements).toEqual([
        { cardId: 'center-member', slot: SlotPosition.CENTER, effectiveCost: 9 },
        { cardId: 'left-member', slot: SlotPosition.LEFT, effectiveCost: 4 },
      ]);
    });

    it('rejects explicit double relay for non PL!SP-bp4-004 members', () => {
      const memberData = createMockMemberData(22, 'Other Member', 'PL!SP-bp4-005-P');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 20 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('center-member', 4, SlotPosition.CENTER),
          createStageMemberInfo('left-member', 4, SlotPosition.LEFT),
        ],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources, {
        relayMode: 'DOUBLE',
        relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.LEFT],
      });

      expect(result.canPay).toBe(false);
      expect(result.reason).toContain('PL!SP-bp4-004');
    });

    it('rejects invalid explicit double relay slot selections', () => {
      const memberData = createMockMemberData(22, '平安名すみれ', 'PL!SP-bp4-004-P');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 20 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('center-member', 4, SlotPosition.CENTER),
          createStageMemberInfo('left-member', 4, SlotPosition.LEFT),
        ],
      };

      expect(
        calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources, {
          relayMode: 'DOUBLE',
          relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.CENTER],
        }).canPay
      ).toBe(false);
      expect(
        calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources, {
          relayMode: 'DOUBLE',
          relayReplacementSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
        }).canPay
      ).toBe(false);
      expect(
        calculator.checkCanPayCost(memberData, SlotPosition.RIGHT, resources, {
          relayMode: 'DOUBLE',
          relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.LEFT],
        }).canPay
      ).toBe(false);
    });

    it('rejects double relay when a selected member cannot be relayed away', () => {
      const memberData = createMockMemberData(22, '平安名すみれ', 'PL!SP-bp4-004-P');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 20 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('center-member', 4, SlotPosition.CENTER),
          createStageMemberInfo('protected-member', 4, SlotPosition.LEFT, {
            cardCode: 'LL-bp2-001-R+',
          }),
        ],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources, {
        relayMode: 'DOUBLE',
        relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.LEFT],
      });

      expect(result.canPay).toBe(false);
      expect(result.reason).toContain('无法因换手');
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

    it('不应该生成将 LL-bp2-001-R+ 换手放置入休息室的支付方案', () => {
      const memberData = createMockMemberData(10, 'Incoming Member', 'TEST-INCOMING');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 9 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('protected-member', 20, SlotPosition.CENTER, {
            cardCode: 'LL-bp2-001-R+',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      expect(result.canPay).toBe(false);
      expect(result.availablePlans.some((plan) => plan.isRelay)).toBe(false);
    });

    it('应该在没有待机虹咲成员时不减少 PL!N-pb1-008-P+ 的费用', () => {
      const memberData = createMockMemberData(17, '艾玛·维尔德', 'PL!N-pb1-008-P+');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('active-nijigasaki', 4, SlotPosition.LEFT, {
            orientation: OrientationState.ACTIVE,
            groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
          }),
          createStageMemberInfo('waiting-other', 4, SlotPosition.CENTER, {
            orientation: OrientationState.WAITING,
            groupNames: ['ラブライブ！スーパースター!!'],
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
            groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
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

    it('应该只通过结构化虹咲 groupNames 识别待机成员', () => {
      const memberData = createMockMemberData(17, '艾玛·维尔德', 'PL!N-pb1-008-P+');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('waiting-nijigasaki-alias', 4, SlotPosition.LEFT, {
            orientation: OrientationState.WAITING,
            groupNames: ['虹咲学園スクールアイドル同好会'],
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
      expect(directPlan?.costModifiers[0]?.id).toBe(
        'PL!N-pb1-008-P+:hand-self-cost-minus-if-waiting-nijigasaki-member'
      );
    });

    it('不应该用文本或 PL!N- 卡号前缀识别虹咲待机成员', () => {
      const legacyIdentityCases = [
        createStageMemberInfo('waiting-nijigasaki-text', 4, SlotPosition.LEFT, {
          orientation: OrientationState.WAITING,
          cardText: 'Nijigasaki のメンバー。',
        }),
        createStageMemberInfo('waiting-nijigasaki-code', 4, SlotPosition.LEFT, {
          orientation: OrientationState.WAITING,
          cardCode: 'PL!N-test-member',
        }),
      ];

      for (const stageMember of legacyIdentityCases) {
        const memberData = createMockMemberData(17, '艾玛·维尔德', 'PL!N-pb1-008-P+');
        const resources: AvailableResources = {
          activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
          stageMembers: [stageMember],
          sourceCardId: 'source-card',
          handCardIds: ['source-card'],
        };

        const result = calculator.checkCanPayCost(memberData, SlotPosition.RIGHT, resources);

        expect(result.canPay).toBe(false);
        expect(result.reason).toContain('需要 17 能量');
      }
    });

    it('应该让 PL!N-pb1-008-R 同编号罕度同样获得虹咲待机减费', () => {
      const memberData = createMockMemberData(17, '艾玛·维尔德', 'PL!N-pb1-008-R');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('waiting-nijigasaki', 4, SlotPosition.LEFT, {
            orientation: OrientationState.WAITING,
            groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
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

    it('不应该让非待机虹咲成员触发 PL!N-pb1-008-P+ 减费', () => {
      const memberData = createMockMemberData(17, '艾玛·维尔德', 'PL!N-pb1-008-P+');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('active-nijigasaki-code', 4, SlotPosition.LEFT, {
            orientation: OrientationState.ACTIVE,
            cardCode: 'PL!N-test-member',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.RIGHT, resources);

      expect(result.canPay).toBe(false);
      expect(result.reason).toContain('需要 17 能量');
    });

    it('应该让舞台上的 PL!SP-bp5-003-AR 使10费Liella!成员费用减少2', () => {
      const memberData = createMockMemberData(10, '10费Liella!成员', 'PL!SP-test-cost10', {
        groupNames: ['Liella!'],
      });
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 8 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chisato-source', 17, SlotPosition.LEFT, {
            cardCode: 'PL!SP-bp5-003-AR',
            groupNames: ['ラブライブ！スーパースター!!'],
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

    it('应该让舞台上的 PL!S-bp5-001 只使手牌中严格无能力成员登场费用减少1', () => {
      const memberData = createMockMemberData(5, '无能力成员', 'PL!S-test-no-ability');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 4 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chika-source', 10, SlotPosition.LEFT, {
            cardCode: 'PL!S-bp5-001-SEC',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan?.modifiedCost).toBe(4);
      expect(directPlan?.costModifierAmount).toBe(1);
      expect(directPlan?.costModifiers[0]).toMatchObject({
        id: 'PL!S-bp5-001-SEC:stage-source-cost-minus-no-ability-member',
        sourceCardId: 'chika-source',
      });
    });

    it('PL!S-bp5-001 应该把中文卡表的 "-" 占位符视为无能力成员文本', () => {
      const memberData = createMockMemberData(4, '渡辺 曜', 'PL!S-bp2-014-N', {
        cardText: '-',
      });
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 3 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chika-source', 10, SlotPosition.LEFT, {
            cardCode: 'PL!S-bp5-001-P',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan?.modifiedCost).toBe(3);
      expect(directPlan?.costModifierAmount).toBe(1);
    });

    it('PL!S-bp5-001 不应该减少常时或登场能力成员的手牌登场费用', () => {
      const abilityTargets = [
        createMockMemberData(5, '常时成员', 'PL!S-test-continuous', {
          cardText: '【常时】此成员获得[BLADE]。',
        }),
        createMockMemberData(5, '登场成员', 'PL!S-test-on-enter', {
          cardText: '【登场】抽1张卡。',
        }),
      ];
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 4 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chika-source', 10, SlotPosition.LEFT, {
            cardCode: 'PL!S-bp5-001-P',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      for (const memberData of abilityTargets) {
        const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

        expect(result.canPay).toBe(false);
        expect(result.reason).toContain('需要 5 能量');
      }
    });

    it('PL!S-bp5-001 减费必须来自舞台且目标必须从手牌登场', () => {
      const memberData = createMockMemberData(5, '无能力成员', 'PL!S-test-no-ability');
      const sourceLeftStage: AvailableResources = {
        activeEnergyIds: Array.from({ length: 4 }, (_, index) => `e${index}`),
        stageMembers: [],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };
      const notFromHand: AvailableResources = {
        activeEnergyIds: Array.from({ length: 4 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chika-source', 10, SlotPosition.LEFT, {
            cardCode: 'PL!S-bp5-001-R＋',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: [],
      };

      for (const resources of [sourceLeftStage, notFromHand]) {
        const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

        expect(result.canPay).toBe(false);
        expect(result.reason).toContain('需要 5 能量');
      }
    });

    it('当前 PL!S-bp5-001 多来源按既有 cost modifier 规则叠加', () => {
      const memberData = createMockMemberData(5, '无能力成员', 'PL!S-test-no-ability');
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 3 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chika-source-a', 10, SlotPosition.LEFT, {
            cardCode: 'PL!S-bp5-001-AR',
          }),
          createStageMemberInfo('chika-source-b', 10, SlotPosition.RIGHT, {
            cardCode: 'PL!S-bp5-001-P',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);
      expect(result.canPay).toBe(true);
      expect(directPlan?.modifiedCost).toBe(3);
      expect(directPlan?.costModifierAmount).toBe(2);
      expect(directPlan?.costModifiers.map((modifier) => modifier.sourceCardId)).toEqual([
        'chika-source-a',
        'chika-source-b',
      ]);
    });

    it('应该让 PL!SP-bp5-003-SEC 同编号罕度同样作为舞台来源减费', () => {
      const memberData = createMockMemberData(10, '10费Liella!成员', 'PL!SP-test-cost10', {
        groupNames: ['Liella!'],
      });
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 8 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chisato-source', 17, SlotPosition.LEFT, {
            cardCode: 'PL!SP-bp5-003-SEC',
            groupNames: ['ラブライブ！スーパースター!!'],
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

    it('应该只通过结构化 Liella! groupNames 识别10费目标成员', () => {
      const memberData = createMockMemberData(10, '10费Liella alias成员', 'OTHER-LIELLA-ALIAS', {
        groupNames: ['Liella'],
      });
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 8 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chisato-source', 17, SlotPosition.LEFT, {
            cardCode: 'PL!SP-bp5-003-AR',
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
      expect(directPlan?.costModifiers[0]?.id).toBe(
        'PL!SP-bp5-003-AR:stage-source-cost-minus-cost10-liella'
      );
    });

    it('不应该用文本或 PL!SP- 卡号前缀识别10费 Liella! 目标成员', () => {
      const legacyIdentityTargets = [
        createMockMemberData(10, '10费Liella text成员', 'OTHER-LIELLA-TEXT', {
          cardText: '『スーパースター』のメンバー。',
        }),
        createMockMemberData(10, '10费Liella prefix成员', 'PL!SP-test-cost10'),
      ];
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 8 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chisato-source', 17, SlotPosition.LEFT, {
            cardCode: 'PL!SP-bp5-003-AR',
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      for (const memberData of legacyIdentityTargets) {
        const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);

        expect(result.canPay).toBe(false);
        expect(result.reason).toContain('需要 10 能量');
      }
    });

    it('应该要求 PL!SP-bp5-003-AR 的目标是10费Liella!成员才减少费用', () => {
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 8 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('chisato-source', 17, SlotPosition.LEFT, {
            cardCode: 'PL!SP-bp5-003-AR',
            groupNames: ['ラブライブ！スーパースター!!'],
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
      };

      const cost9Liella = createMockMemberData(9, '9费Liella!成员', 'PL!SP-test-cost9', {
        groupNames: ['Liella!'],
      });
      const cost10Other = createMockMemberData(10, '10费非Liella!成员', 'PL!N-test-cost10', {
        groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
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
      const memberData = createMockMemberData(10, '10费Liella!成员', 'PL!SP-test-cost10', {
        groupNames: ['Liella!'],
      });
      const resources: AvailableResources = {
        activeEnergyIds: ['e1'],
        stageMembers: [
          createStageMemberInfo('chisato-source', 7, SlotPosition.CENTER, {
            cardCode: 'PL!SP-bp5-003-AR',
            groupNames: ['ラブライブ！スーパースター!!'],
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

    it('reduces PL!SP-bp5-017 hand self play cost from 9 to 7 when a stage Liella member moved this turn', () => {
      const memberData = createMockMemberData(9, '桜小路きな子', 'PL!SP-bp5-017-N');
      const info = calculator.calculateModifiedPlayCost(memberData, {
        activeEnergyIds: Array.from({ length: 9 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('moved-liella', 4, SlotPosition.CENTER, {
            groupNames: ['Liella!'],
            positionMovedThisTurn: true,
          }),
        ],
        sourceCardId: 'kinako-hand',
        handCardIds: ['kinako-hand'],
      });

      expect(info.baseCost).toBe(9);
      expect(info.modifiedCost).toBe(7);
      expect(info.modifierAmount).toBe(2);
      expect(info.modifiers[0]).toMatchObject({
        id: 'PL!SP-bp5-017:hand-self-cost-minus-if-moved-liella-stage-member',
        sourceCardId: 'kinako-hand',
        amount: 2,
      });
    });

    it('does not reduce PL!SP-bp5-017 cost without a moved stage member', () => {
      const memberData = createMockMemberData(9, '桜小路きな子', 'PL!SP-bp5-017-N');
      const info = calculator.calculateModifiedPlayCost(memberData, {
        activeEnergyIds: Array.from({ length: 9 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('still-liella', 4, SlotPosition.CENTER, {
            groupNames: ['Liella!'],
          }),
        ],
        sourceCardId: 'kinako-hand',
        handCardIds: ['kinako-hand'],
      });

      expect(info.modifiedCost).toBe(9);
      expect(info.modifierAmount).toBe(0);
    });

    it('does not reduce PL!SP-bp5-017 cost for a moved non-Liella stage member', () => {
      const memberData = createMockMemberData(9, '桜小路きな子', 'PL!SP-bp5-017-N');
      const info = calculator.calculateModifiedPlayCost(memberData, {
        activeEnergyIds: Array.from({ length: 9 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('moved-non-liella', 4, SlotPosition.CENTER, {
            groupNames: ['Aqours'],
            positionMovedThisTurn: true,
          }),
        ],
        sourceCardId: 'kinako-hand',
        handCardIds: ['kinako-hand'],
      });

      expect(info.modifiedCost).toBe(9);
      expect(info.modifierAmount).toBe(0);
    });

    it('does not reduce PL!SP-bp5-017 cost when the moved Liella member is no longer on stage', () => {
      const memberData = createMockMemberData(9, '桜小路きな子', 'PL!SP-bp5-017-N');
      const info = calculator.calculateModifiedPlayCost(memberData, {
        activeEnergyIds: Array.from({ length: 9 }, (_, index) => `e${index}`),
        stageMembers: [],
        sourceCardId: 'kinako-hand',
        handCardIds: ['kinako-hand'],
      });

      expect(info.modifiedCost).toBe(9);
      expect(info.modifierAmount).toBe(0);
    });

    it("reduces printed cost 17 or higher μ's members from hand by 2 when own success zone has PL!-bp6-019-L", () => {
      const memberData = createMockMemberData(17, '高坂穗乃果', 'PL!-test-muse-cost17', {
        groupNames: ["μ's"],
      });
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
        stageMembers: [],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
        successLiveCards: [
          {
            cardId: 'music-start',
            data: createMockLiveData(2, 'Music S.T.A.R.T!!', 'PL!-bp6-019-L', {
              groupNames: ["μ's"],
            }),
          },
        ],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);
      const directPlan = result.availablePlans.find((plan) => !plan.isRelay);

      expect(result.canPay).toBe(true);
      expect(directPlan?.totalCost).toBe(17);
      expect(directPlan?.modifiedCost).toBe(15);
      expect(directPlan?.costModifierAmount).toBe(2);
      expect(directPlan?.actualEnergyCost).toBe(15);
      expect(directPlan?.costModifiers[0]).toMatchObject({
        id: 'PL!-bp6-019-L:success-zone-high-cost-muse-play-cost-minus-two',
        sourceCardId: 'music-start',
      });
    });

    it("does not reduce cost 16 or non-μ's members for PL!-bp6-019-L", () => {
      const successLiveCards = [
        {
          cardId: 'music-start',
          data: createMockLiveData(2, 'Music S.T.A.R.T!!', 'PL!-bp6-019-L', {
            groupNames: ["μ's"],
          }),
        },
      ];
      const cost16Muse = createMockMemberData(16, '16费μ成员', 'PL!-test-muse-cost16', {
        groupNames: ["μ's"],
      });
      const cost17Other = createMockMemberData(17, '17费非μ成员', 'PL!N-test-cost17', {
        groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
      });

      for (const memberData of [cost16Muse, cost17Other]) {
        const info = calculator.calculateModifiedPlayCost(memberData, {
          activeEnergyIds: Array.from({ length: 17 }, (_, index) => `e${index}`),
          stageMembers: [],
          sourceCardId: 'source-card',
          handCardIds: ['source-card'],
          successLiveCards,
        });

        expect(info.modifiedCost).toBe(memberData.cost);
        expect(info.modifierAmount).toBe(0);
      }
    });

    it('does not apply PL!-bp6-019-L when only the opponent success zone has it', () => {
      const memberData = createMockMemberData(17, '高坂穗乃果', 'PL!-test-muse-cost17', {
        groupNames: ["μ's"],
      });
      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, {
        activeEnergyIds: Array.from({ length: 15 }, (_, index) => `e${index}`),
        stageMembers: [],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
        successLiveCards: [],
      });

      expect(result.canPay).toBe(false);
      expect(result.reason).toContain('需要 17 能量');
    });

    it('does not stack multiple PL!-bp6-019-L success zone cost reducers', () => {
      const memberData = createMockMemberData(17, '高坂穗乃果', 'PL!-test-muse-cost17', {
        groupNames: ["μ's"],
      });
      const info = calculator.calculateModifiedPlayCost(memberData, {
        activeEnergyIds: Array.from({ length: 17 }, (_, index) => `e${index}`),
        stageMembers: [],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
        successLiveCards: [
          {
            cardId: 'music-start-1',
            data: createMockLiveData(2, 'Music S.T.A.R.T!!', 'PL!-bp6-019-L'),
          },
          {
            cardId: 'music-start-2',
            data: createMockLiveData(2, 'Music S.T.A.R.T!!', 'PL!-bp6-019-L'),
          },
        ],
      });

      expect(info.modifiedCost).toBe(15);
      expect(info.modifierAmount).toBe(2);
      expect(info.modifiers).toHaveLength(1);
    });

    it('uses printed member cost for PL!-bp6-019-L instead of other modified cost values', () => {
      const memberData = createMockMemberData(16, '16费μ成员', 'PL!-test-muse-cost16', {
        groupNames: ["μ's"],
      });
      const info = calculator.calculateModifiedPlayCost(memberData, {
        activeEnergyIds: Array.from({ length: 17 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('unrelated-stage-source', 20, SlotPosition.LEFT, {
            effectiveCost: 17,
          }),
        ],
        sourceCardId: 'source-card',
        handCardIds: ['source-card'],
        successLiveCards: [
          {
            cardId: 'music-start',
            data: createMockLiveData(2, 'Music S.T.A.R.T!!', 'PL!-bp6-019-L'),
          },
        ],
      });

      expect(info.modifiedCost).toBe(16);
      expect(info.modifierAmount).toBe(0);
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

  describe('PL!HS-bp6-006 cost reduction and relay restriction', () => {
    it.each([
      { miraCraCount: 0, expectedModifiedCost: 20 },
      { miraCraCount: 1, expectedModifiedCost: 18 },
      { miraCraCount: 2, expectedModifiedCost: 16 },
      { miraCraCount: 3, expectedModifiedCost: 14 },
    ])(
      'reduces hand cost by 2 per own Mira-Cra stage member: $miraCraCount members',
      ({ miraCraCount, expectedModifiedCost }) => {
        const memberData = createMockMemberData(20, '安養寺 姫芽', 'PL!HS-bp6-006-SEC', {
          unitName: 'みらくらぱーく！',
        });
        const stageMembers = Array.from({ length: miraCraCount }, (_, index) =>
          createStageMemberInfo(`miracra-${index}`, 4, Object.values(SlotPosition)[index], {
            unitName: 'みらくらぱーく！',
          })
        );
        const resources: AvailableResources = {
          activeEnergyIds: Array.from({ length: 20 }, (_, index) => `e${index}`),
          stageMembers,
          sourceCardId: 'hime-source',
          handCardIds: ['hime-source'],
        };

        const info = calculator.calculateModifiedPlayCost(memberData, resources);

        expect(info.modifiedCost).toBe(expectedModifiedCost);
        expect(info.modifierAmount).toBe(20 - expectedModifiedCost);
      }
    );

    it('applies the Mira-Cra cost reduction before relay discount for Q249', () => {
      const memberData = createMockMemberData(20, '安養寺 姫芽', 'PL!HS-bp6-006-SEC', {
        unitName: 'みらくらぱーく！',
      });
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 14 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('relay-target', 4, SlotPosition.CENTER, {
            unitName: 'みらくらぱーく！',
          }),
          createStageMemberInfo('miracra-left', 4, SlotPosition.LEFT, {
            unitName: 'みらくらぱーく！',
          }),
          createStageMemberInfo('miracra-right', 4, SlotPosition.RIGHT, {
            unitName: 'みらくらぱーく！',
          }),
        ],
        sourceCardId: 'hime-source',
        handCardIds: ['hime-source'],
      };

      const result = calculator.checkCanPayCost(memberData, SlotPosition.CENTER, resources);
      const relayPlan = result.availablePlans.find((plan) => plan.isRelay);

      expect(result.canPay).toBe(true);
      expect(relayPlan).toBeDefined();
      expect(relayPlan?.modifiedCost).toBe(14);
      expect(relayPlan?.costModifierAmount).toBe(6);
      expect(relayPlan?.relayDiscount).toBe(4);
      expect(relayPlan?.actualEnergyCost).toBe(10);
    });

    it('counts only own stage Mira-Cra members supplied in resources', () => {
      const memberData = createMockMemberData(20, '安養寺 姫芽', 'PL!HS-bp6-006-P', {
        unitName: 'みらくらぱーく！',
      });
      const resources: AvailableResources = {
        activeEnergyIds: Array.from({ length: 20 }, (_, index) => `e${index}`),
        stageMembers: [
          createStageMemberInfo('own-miracra', 4, SlotPosition.CENTER, {
            unitName: 'みらくらぱーく！',
          }),
          createStageMemberInfo('own-cerise', 4, SlotPosition.LEFT, {
            unitName: 'スリーズブーケ',
          }),
        ],
      };

      const info = calculator.calculateModifiedPlayCost(memberData, resources);

      expect(info.modifiedCost).toBe(18);
      expect(info.modifierAmount).toBe(2);
    });

    it('allows PL!HS-bp6-006 to be relayed away only by Mira-Cra members', () => {
      const protectedMember = createMockMemberData(20, '安養寺 姫芽', 'PL!HS-bp6-006-R＋', {
        unitName: 'みらくらぱーく！',
      });
      const miraCraIncoming = createMockMemberData(4, '大沢瑠璃乃', 'PL!HS-test-miracra', {
        unitName: 'みらくらぱーく！',
      });
      const nonMiraCraIncoming = createMockMemberData(4, '日野下花帆', 'PL!HS-test-cerise', {
        unitName: 'スリーズブーケ',
      });

      expect(canMemberBeRelayedAway(protectedMember, nonMiraCraIncoming)).toBe(false);
      expect(canMemberBeRelayedAway(protectedMember, miraCraIncoming)).toBe(true);
    });

    it('keeps LL-bp2-001 relay prohibition unchanged', () => {
      const protectedMember = createMockMemberData(20, 'LL member', 'LL-bp2-001-R+');
      const incoming = createMockMemberData(4, 'Incoming', 'PL!HS-test-miracra', {
        unitName: 'みらくらぱーく！',
      });

      expect(canMemberBeRelayedAway(protectedMember, incoming)).toBe(false);
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
