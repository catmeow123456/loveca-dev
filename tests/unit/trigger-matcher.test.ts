import { describe, expect, it } from 'vitest';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../../src/application/card-effects/ability-definition-types';
import {
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
  SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { CARD_ABILITY_DEFINITIONS } from '../../src/application/card-effects/definitions';
import {
  doesTriggerEventMatchAbility,
  type TriggerMatcherRequirements,
  type TriggerMatcherSource,
} from '../../src/application/effects/trigger-matcher';
import {
  createCheerEvent,
  createEnterStageEvent,
  createLeaveStageEvent,
  createLiveStartEvent,
  createLiveSuccessEvent,
  createMemberSlotMovedEvent,
  createMemberStateChangedEvent,
} from '../../src/domain/events/game-events';
import {
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const BASE_SOURCE: TriggerMatcherSource = {
  cardId: 'source-card',
  cardCode: 'PL!SP-bp4-011-R+',
  controllerId: 'p1',
  category: CardAbilityCategory.ON_ENTER,
  sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
  sourceSlot: SlotPosition.CENTER,
};

function findAbility(
  abilityId: string,
  triggerCondition: TriggerCondition
): CardAbilityDefinition {
  const ability = CARD_ABILITY_DEFINITIONS.find(
    (candidate) =>
      candidate.abilityId === abilityId && candidate.triggerCondition === triggerCondition
  );
  if (!ability) {
    throw new Error(`Missing fixture ability: ${abilityId} ${triggerCondition}`);
  }
  return ability;
}

function fixtureAbility(
  overrides: Partial<CardAbilityDefinition> = {}
): CardAbilityDefinition {
  return {
    abilityId: 'fixture-ability',
    cardCodes: ['PL!FIX-bp1-001-N'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: 'fixture',
    ...overrides,
  };
}

function source(overrides: Partial<TriggerMatcherSource> = {}): TriggerMatcherSource {
  return {
    ...BASE_SOURCE,
    ...overrides,
  };
}

function expectMatch(
  ability: CardAbilityDefinition,
  event: Parameters<typeof doesTriggerEventMatchAbility>[0]['event'],
  sourceOverrides: Partial<TriggerMatcherSource>,
  requirements: TriggerMatcherRequirements = {}
): boolean {
  return doesTriggerEventMatchAbility({
    ability,
    event,
    source: source(sourceOverrides),
    requirements,
  });
}

describe('trigger matcher', () => {
  it('matches PL!SP-bp4-011-R+ cost 7 Onitsuka Tomari on-enter trigger without requiring a target', () => {
    const ability = findAbility(
      SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE
    );
    const event = createEnterStageEvent(
      'source-card',
      ZoneType.HAND,
      SlotPosition.CENTER,
      'p1',
      'p1'
    );

    expect(
      expectMatch(
        ability,
        event,
        {},
        {
          sourceCard: 'event-subject',
          controller: 'same-controller',
          sourceSlot: 'event-to-slot',
        }
      )
    ).toBe(true);
  });

  it('matches PL!SP-bp4-011-R+ cost 7 Onitsuka Tomari member-slot movement trigger', () => {
    const ability = findAbility(
      SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
      TriggerCondition.ON_MEMBER_SLOT_MOVED
    );
    const event = createMemberSlotMovedEvent(
      'source-card',
      'p1',
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
      'swapped-card'
    );

    expect(
      expectMatch(
        ability,
        event,
        {
          category: CardAbilityCategory.AUTO,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          sourceSlot: SlotPosition.RIGHT,
        },
        {
          sourceCard: 'event-subject',
          controller: 'same-controller',
          sourceSlot: 'event-to-slot',
        }
      )
    ).toBe(true);
  });

  it('does not match when triggerCondition differs', () => {
    const ability = findAbility(
      SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE
    );
    const event = createMemberSlotMovedEvent(
      'source-card',
      'p1',
      SlotPosition.LEFT,
      SlotPosition.RIGHT
    );

    expect(expectMatch(ability, event, {})).toBe(false);
  });

  it('does not match when sourceZone differs', () => {
    const ability = findAbility(
      SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE
    );
    const event = createEnterStageEvent(
      'source-card',
      ZoneType.HAND,
      SlotPosition.CENTER,
      'p1',
      'p1'
    );

    expect(
      expectMatch(ability, event, {
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      })
    ).toBe(false);
  });

  it('checks requiredSourceSlots against the source slot', () => {
    const ability = findAbility(
      SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE
    );
    const event = createEnterStageEvent(
      'source-card',
      ZoneType.HAND,
      SlotPosition.RIGHT,
      'p1',
      'p1'
    );

    expect(
      expectMatch(
        ability,
        event,
        {
          cardCode: 'PL!SP-bp4-008-P',
          sourceSlot: SlotPosition.RIGHT,
        },
        {
          sourceCard: 'event-subject',
          controller: 'same-controller',
          sourceSlot: 'event-to-slot',
        }
      )
    ).toBe(false);
  });

  it('does not match an unknown or missing source card', () => {
    const ability = findAbility(
      SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE
    );
    const event = createEnterStageEvent(
      'source-card',
      ZoneType.HAND,
      SlotPosition.CENTER,
      'p1',
      'p1'
    );

    expect(
      expectMatch(ability, event, {
        cardCode: null,
      })
    ).toBe(false);
    expect(
      expectMatch(ability, event, {
        cardId: null,
      })
    ).toBe(false);
    expect(
      expectMatch(ability, event, {
        cardCode: 'PL!SP-bp4-999-N',
      })
    ).toBe(false);
  });

  it('expresses sampled live-start, live-success, and cheer trigger shapes with fixture abilities', () => {
    const liveStartAbility = fixtureAbility({
      abilityId: 'fixture-live-start-live-card',
      cardCodes: ['PL!FIX-bp1-010-L'],
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_START,
    });
    const liveSuccessAbility = fixtureAbility({
      abilityId: 'fixture-live-success-stage-member',
      cardCodes: ['PL!FIX-bp1-011-N'],
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    });
    const cheerAbility = fixtureAbility({
      abilityId: 'fixture-cheer-live-card',
      cardCodes: ['PL!FIX-bp1-012-L'],
      category: CardAbilityCategory.AUTO,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_CHEER,
    });

    expect(
      expectMatch(
        liveStartAbility,
        createLiveStartEvent('p1', ['source-card']),
        {
          cardCode: 'PL!FIX-bp1-010-L',
          category: CardAbilityCategory.LIVE_START,
          sourceZone: CardAbilitySourceZone.LIVE_CARD,
          sourceSlot: null,
        },
        {
          sourceCard: 'event-card-list',
          controller: 'same-controller',
        }
      )
    ).toBe(true);
    expect(
      expectMatch(
        liveSuccessAbility,
        createLiveSuccessEvent('p1', ['live-card'], 5),
        {
          cardCode: 'PL!FIX-bp1-011-N',
          category: CardAbilityCategory.LIVE_SUCCESS,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          sourceSlot: SlotPosition.LEFT,
        },
        {
          controller: 'same-controller',
        }
      )
    ).toBe(true);
    expect(
      expectMatch(
        cheerAbility,
        createCheerEvent('p1', ['cheer-revealed-card'], 2),
        {
          cardCode: 'PL!FIX-bp1-012-L',
          category: CardAbilityCategory.AUTO,
          sourceZone: CardAbilitySourceZone.LIVE_CARD,
          sourceSlot: null,
        },
        {
          controller: 'same-controller',
        }
      )
    ).toBe(true);
  });

  it('expresses sampled leave-stage and state-change trigger shapes with fixture abilities', () => {
    const leaveStageAbility = fixtureAbility({
      abilityId: 'fixture-leave-stage',
      cardCodes: ['PL!FIX-bp1-020-N'],
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
    });
    const stateChangeAbility = fixtureAbility({
      abilityId: 'fixture-member-state-change',
      cardCodes: ['PL!FIX-bp1-021-N'],
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_MEMBER_STATE_CHANGED,
    });

    expect(
      expectMatch(
        leaveStageAbility,
        createLeaveStageEvent(
          'source-card',
          SlotPosition.LEFT,
          ZoneType.WAITING_ROOM,
          'p1',
          'p1',
          'replacing-card'
        ),
        {
          cardCode: 'PL!FIX-bp1-020-N',
          category: CardAbilityCategory.AUTO,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          sourceSlot: SlotPosition.LEFT,
        },
        {
          sourceCard: 'event-subject',
          controller: 'same-controller',
          sourceSlot: 'event-from-slot',
        }
      )
    ).toBe(true);
    expect(
      expectMatch(
        stateChangeAbility,
        createMemberStateChangedEvent(
          'source-card',
          'p1',
          SlotPosition.CENTER,
          OrientationState.ACTIVE,
          OrientationState.WAITING
        ),
        {
          cardCode: 'PL!FIX-bp1-021-N',
          category: CardAbilityCategory.AUTO,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          sourceSlot: SlotPosition.CENTER,
        },
        {
          sourceCard: 'event-subject',
          controller: 'same-controller',
          sourceSlot: 'event-current-slot',
          memberStateTransition: {
            from: OrientationState.ACTIVE,
            to: OrientationState.WAITING,
          },
        }
      )
    ).toBe(true);
  });

  it('keeps fixture expectations aligned with an implemented live-success source sample', () => {
    const ability = findAbility(
      HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
      TriggerCondition.ON_LIVE_SUCCESS
    );

    expect(
      expectMatch(
        ability,
        createLiveSuccessEvent('p1', ['successful-live-card'], 3),
        {
          cardCode: 'PL!HS-bp6-001-R+',
          category: CardAbilityCategory.LIVE_SUCCESS,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          sourceSlot: SlotPosition.CENTER,
        },
        {
          controller: 'same-controller',
        }
      )
    ).toBe(true);
  });
});
