import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import {
  CostCalculator,
  type AvailableResources,
  type StageMemberInfo,
} from '../../src/domain/rules/cost-calculator';
import { CardType, OrientationState, SlotPosition } from '../../src/shared/types/enums';

const calculator = new CostCalculator();
const member = (cardCode: string, cost = 4, groupNames = ['μ’s']): MemberCardData => ({
  cardCode,
  name: cardCode,
  cardType: CardType.MEMBER,
  cost,
  blade: 1,
  hearts: [],
  groupNames,
});
const stage = (
  cardId: string,
  position: SlotPosition,
  options: Partial<StageMemberInfo> = {}
): StageMemberInfo => ({
  cardId,
  position,
  data: member(cardId),
  orientation: OrientationState.WAITING,
  ...options,
});
const source = (rarity = 'SEC') =>
  stage('kotori', SlotPosition.LEFT, {
    data: member(`PL!-bp8-003-${rarity}`),
    orientation: OrientationState.ACTIVE,
  });
const resources = (stageMembers: readonly StageMemberInfo[]): AvailableResources => ({
  stageMembers,
  activeEnergyIds: Array.from({ length: 30 }, (_, index) => `e${index}`),
});

describe('PL!-bp8-003 费用4「南小鸟」换手减免值替换', () => {
  it.each(['SEC', 'R', 'UNSEEN'])(
    'covers %s sources through all plan and preview queries',
    (rarity) => {
      const incoming = member('incoming', 10, ["μ's"]);
      const available = resources([
        source(rarity),
        stage('relay', SlotPosition.CENTER, { effectiveCost: 6 }),
      ]);
      for (const plan of [
        calculator.checkCanPayCost(incoming, SlotPosition.CENTER, available, {
          relayMode: 'SINGLE',
        }).availablePlans[0],
        calculator.generateAllPaymentPlans(incoming, SlotPosition.CENTER, available, {
          relayMode: 'SINGLE',
        })[0],
      ]) {
        expect(plan).toMatchObject({ modifiedCost: 10, relayDiscount: 7, actualEnergyCost: 3 });
        expect(plan?.relayReplacements).toEqual([
          { cardId: 'relay', slot: SlotPosition.CENTER, effectiveCost: 6 },
        ]);
      }
      expect(
        calculator.calculatePlayCostInfo(incoming, SlotPosition.CENTER, available)
      ).toMatchObject({ possibleRelayDiscount: 7 });
      expect(
        calculator.checkCanPayCost(incoming, SlotPosition.CENTER, available, { relayMode: 'NONE' })
          .availablePlans[0]
      ).toMatchObject({ relayDiscount: 0, actualEnergyCost: 10 });
    }
  );

  it.each([-3, -1, 0, 7])(
    'replaces a reduction based on effective cost %s, including negative values',
    (effectiveCost) => {
      const available = resources([
        source(),
        stage('relay', SlotPosition.CENTER, { effectiveCost }),
      ]);
      const plan = calculator.checkCanPayCost(
        member('incoming', 10),
        SlotPosition.CENTER,
        available,
        { relayMode: 'SINGLE' }
      ).availablePlans[0];
      expect(plan).toMatchObject({
        relayDiscount: effectiveCost + 1,
        actualEnergyCost: 9 - effectiveCost,
      });
      expect(plan?.relayReplacements[0]?.effectiveCost).toBe(effectiveCost);
    }
  );

  it('grants the source itself and does not stack multiple identical replacements', () => {
    const kotori = {
      ...source(),
      position: SlotPosition.CENTER,
      orientation: OrientationState.WAITING,
    };
    const first = calculator.checkCanPayCost(
      member('incoming', 10),
      SlotPosition.CENTER,
      resources([kotori]),
      { relayMode: 'SINGLE' }
    );
    const second = calculator.checkCanPayCost(
      member('incoming', 10),
      SlotPosition.CENTER,
      resources([kotori, { ...source('P'), cardId: 'second', position: SlotPosition.LEFT }]),
      { relayMode: 'SINGLE' }
    );
    expect(first.availablePlans[0]?.relayDiscount).toBe(5);
    expect(second.availablePlans[0]?.relayDiscount).toBe(5);
  });

  it.each(['active', 'outgoing-group', 'incoming-group', 'source-left'] as const)(
    'requires all current conditions: %s',
    (change) => {
      const outgoing = stage('relay', SlotPosition.CENTER, {
        orientation: change === 'active' ? OrientationState.ACTIVE : OrientationState.WAITING,
        data: member('relay', 4, change === 'outgoing-group' ? ['Liella!'] : ['μ’s']),
      });
      const available = resources(change === 'source-left' ? [outgoing] : [source(), outgoing]);
      const incoming = member('incoming', 10, change === 'incoming-group' ? ['Aqours'] : ['μ’s']);
      expect(
        calculator.checkCanPayCost(incoming, SlotPosition.CENTER, available, {
          relayMode: 'SINGLE',
        }).availablePlans[0]
      ).toMatchObject({ relayDiscount: 4, actualEnergyCost: 6 });
      expect(
        calculator.calculatePlayCostInfo(incoming, SlotPosition.CENTER, available)
          .possibleRelayDiscount
      ).toBe(4);
    }
  );

  it('applies independently to both qualifying double-relay members without altering their cost snapshots', () => {
    const available = resources([
      source(),
      stage('first', SlotPosition.CENTER, { effectiveCost: -2 }),
      stage('second', SlotPosition.RIGHT, { effectiveCost: 7 }),
    ]);
    const plan = calculator.checkCanPayCost(
      member('PL!-pb2-000-UNSEEN', 15),
      SlotPosition.CENTER,
      available,
      {
        relayMode: 'DOUBLE',
        relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
      }
    ).availablePlans[0];
    expect(plan).toMatchObject({ relayDiscount: 7, actualEnergyCost: 8 });
    expect(plan?.relayReplacements.map((replacement) => replacement.effectiveCost)).toEqual([
      -2, 7,
    ]);
    const mixed = {
      ...available,
      stageMembers: available.stageMembers.map((entry) =>
        entry.cardId === 'second' ? { ...entry, orientation: OrientationState.ACTIVE } : entry
      ),
    };
    expect(
      calculator.checkCanPayCost(member('PL!-pb2-000-SEC', 15), SlotPosition.CENTER, mixed, {
        relayMode: 'DOUBLE',
        relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
      }).availablePlans[0]?.relayDiscount
    ).toBe(6);
  });
});
