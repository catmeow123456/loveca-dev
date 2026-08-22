import { describe, expect, it } from 'vitest';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
  SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
  SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_SIX_ABILITY_ID,
  SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getImplementedQueuedAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

describe('implemented queued ability definition query', () => {
  it('selects all matching definitions for the requested timing shape', () => {
    const definitions = getImplementedQueuedAbilityDefinitionsForCardCode('PL!SP-bp7-007-P', {
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      sourceSlot: SlotPosition.LEFT,
    });

    expect(definitions.map((definition) => definition.abilityId)).toEqual([
      SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
      SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_SIX_ABILITY_ID,
    ]);
  });

  it('honors required source slots and rejects other timing shapes', () => {
    const centerDefinitions = getImplementedQueuedAbilityDefinitionsForCardCode('PL!SP-bp7-006-L', {
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      sourceSlot: SlotPosition.CENTER,
    });
    const leftDefinitions = getImplementedQueuedAbilityDefinitionsForCardCode('PL!SP-bp7-006-L', {
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      sourceSlot: SlotPosition.LEFT,
    });
    const wrongTimingDefinitions = getImplementedQueuedAbilityDefinitionsForCardCode(
      'PL!SP-bp7-006-L',
      {
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        sourceSlot: SlotPosition.CENTER,
      }
    );

    expect(centerDefinitions.map((definition) => definition.abilityId)).toEqual([
      SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
    ]);
    expect(leftDefinitions).toEqual([]);
    expect(wrongTimingDefinitions).toEqual([]);
  });

  it('can inspect every matching ability regardless of its current source slot', () => {
    const definitions = getImplementedQueuedAbilityDefinitionsForCardCode('PL!SP-bp7-006-L', {
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      sourceSlot: SlotPosition.LEFT,
      ignoreRequiredSourceSlots: true,
    });

    expect(definitions.map((definition) => definition.abilityId)).toEqual([
      SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
    ]);
  });

  it('preserves the existing live-start inspection shape used by Kanon', () => {
    const definitions = getImplementedQueuedAbilityDefinitionsForCardCode('PL!SP-bp2-009-P', {
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      sourceSlot: SlotPosition.RIGHT,
    });

    expect(definitions.map((definition) => definition.abilityId)).toEqual([
      SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
    ]);
  });
});
