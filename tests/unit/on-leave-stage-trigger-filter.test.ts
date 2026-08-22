import { describe, expect, it } from 'vitest';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../../src/application/card-effects/ability-definition-types';
import { doesOnLeaveStageSourceMatchAbilityDefinition } from '../../src/application/card-effects/runtime/on-leave-stage-trigger-filter';
import {
  createCardInstance,
  createHeartIcon,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createGameState, registerCards } from '../../src/domain/entities/game';
import {
  CardType,
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(cardCode: string, cost: number, groupName: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    groupNames: [groupName],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: { totalRequired: 0, colorRequirements: new Map() },
  };
}

const DEFINITION: CardAbilityDefinition = {
  abilityId: 'test:auto-relay-replacement',
  baseCardCodes: ['TEST-source'],
  category: CardAbilityCategory.AUTO,
  sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
  triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
  triggerToZones: [ZoneType.WAITING_ROOM],
  onLeaveStageTriggerFilter: {
    relayReplacementMember: {
      groupAliases: ["μ's"],
      minPrintedCost: 15,
    },
  },
  queued: true,
  implemented: true,
  effectText: 'test',
};

function source(replacingCardId?: string, toZone: ZoneType = ZoneType.WAITING_ROOM) {
  return {
    cardId: 'source',
    controllerId: P1,
    sourceSlot: SlotPosition.CENTER,
    eventId: 'leave-event',
    toZone,
    replacingCardId,
  };
}

describe('definition-driven ON_LEAVE_STAGE trigger filter', () => {
  it('matches a MEMBER with a structured group alias at the minimum printed cost', () => {
    const replacement = createCardInstance(member('MUSE-15', 15, 'μ’s'), P1, 'replacement');
    const game = registerCards(createGameState('filter-match', P1, 'P1', P2, 'P2'), [replacement]);

    expect(
      doesOnLeaveStageSourceMatchAbilityDefinition(game, DEFINITION, source(replacement.instanceId))
    ).toBe(true);
  });

  it.each([
    { name: 'ordinary leave', replacement: undefined, toZone: ZoneType.WAITING_ROOM },
    {
      name: 'wrong destination',
      replacement: createCardInstance(member('MUSE-15-HAND', 15, "μ's"), P1, 'hand'),
      toZone: ZoneType.HAND,
    },
    {
      name: 'low printed cost',
      replacement: createCardInstance(member('MUSE-14', 14, "μ's"), P1, 'low'),
      toZone: ZoneType.WAITING_ROOM,
    },
    {
      name: 'wrong group',
      replacement: createCardInstance(member('AQOURS-15', 15, 'Aqours'), P1, 'wrong-group'),
      toZone: ZoneType.WAITING_ROOM,
    },
    {
      name: 'non-member replacement',
      replacement: createCardInstance(live('MUSE-LIVE'), P1, 'live'),
      toZone: ZoneType.WAITING_ROOM,
    },
  ])('rejects $name', ({ replacement, toZone }) => {
    const game = replacement
      ? registerCards(createGameState(`filter-${replacement.instanceId}`, P1, 'P1', P2, 'P2'), [
          replacement,
        ])
      : createGameState('filter-ordinary-leave', P1, 'P1', P2, 'P2');

    expect(
      doesOnLeaveStageSourceMatchAbilityDefinition(
        game,
        DEFINITION,
        source(replacement?.instanceId, toZone)
      )
    ).toBe(false);
  });

  it('uses the event controller context without rejecting an opponent-owned controlled replacement', () => {
    const replacement = createCardInstance(member('MUSE-15-P2', 15, "μ's"), P2, 'controlled');
    const game = registerCards(createGameState('filter-controlled', P1, 'P1', P2, 'P2'), [
      replacement,
    ]);

    expect(
      doesOnLeaveStageSourceMatchAbilityDefinition(game, DEFINITION, source(replacement.instanceId))
    ).toBe(true);
  });

  it('keeps definitions without the new filter on the existing generic path', () => {
    expect(
      doesOnLeaveStageSourceMatchAbilityDefinition(
        createGameState('filter-unconfigured', P1, 'P1', P2, 'P2'),
        { ...DEFINITION, triggerToZones: undefined, onLeaveStageTriggerFilter: undefined },
        source()
      )
    ).toBe(true);
  });
});
