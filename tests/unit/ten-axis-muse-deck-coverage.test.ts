import { describe, expect, it } from 'vitest';
import {
  BP4_008_CONTINUOUS_SUCCESS_SCORE_STAGE_COST_ABILITY_ID,
  BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID,
  BP6_022_CONTINUOUS_SUCCESS_ZONE_MUSE_LIVE_REQUIREMENT_ABILITY_ID,
  BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
  HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
  HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
  getCardAbilityDefinitions,
} from '../../src/application/card-effect-runner';

const TEN_AXIS_MUSE_EFFECT_CARD_CODES = [
  'PL!-PR-017-PR',
  'PL!-bp5-008-AR',
  'PL!-PR-018-PR',
  'PL!-bp6-002-P',
  'PL!SP-bp2-019-N',
  'PL!-bp4-008-P',
  'PL!-bp5-005-AR',
  'PL!-bp5-003-AR',
  'PL!-bp6-005-P',
  'PL!-sd1-004-SD',
  'PL!-bp4-002-SEC',
  'PL!SP-bp2-002-R',
  'PL!-pb1-025-N',
  'PL!-sd1-009-SD',
  'PL!HS-bp5-003-SEC',
  'PL!-bp5-007-AR',
  'PL!-bp4-021-L',
  'PL!-bp6-024-L',
  'PL!-bp6-022-L',
] as const;

describe('10-axis Muse deck card effect coverage', () => {
  it('has implemented definitions for every deck card with an effect', () => {
    for (const cardCode of TEN_AXIS_MUSE_EFFECT_CARD_CODES) {
      expect(
        getCardAbilityDefinitions(cardCode).some((definition) => definition.implemented),
        cardCode
      ).toBe(true);
    }
  });

  it('keeps no-effect member and energy cards outside card effect coverage', () => {
    expect(getCardAbilityDefinitions('PL!SP-sd1-019-SD')).toEqual([]);
    expect(getCardAbilityDefinitions('PL!-bp1-000-LLE')).toEqual([]);
  });

  it('covers key deck rarities through exact or base-card definitions', () => {
    expect(
      getCardAbilityDefinitions('PL!-bp5-007-AR').some(
        (definition) =>
          definition.abilityId === BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID
      )
    ).toBe(true);
    expect(
      getCardAbilityDefinitions('PL!-bp6-024-L').some(
        (definition) =>
          definition.abilityId === BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID
      )
    ).toBe(true);
    expect(
      getCardAbilityDefinitions('PL!HS-bp5-003-SEC')
        .filter((definition) =>
          [
            HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
            HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
          ].includes(definition.abilityId)
        )
        .map((definition) => definition.abilityId)
    ).toEqual([
      HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
      HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
    ]);
    expect(
      getCardAbilityDefinitions('PL!-bp4-008-P').some(
        (definition) =>
          definition.abilityId === BP4_008_CONTINUOUS_SUCCESS_SCORE_STAGE_COST_ABILITY_ID
      )
    ).toBe(true);
    expect(
      getCardAbilityDefinitions('PL!-bp6-022-L').some(
        (definition) =>
          definition.abilityId === BP6_022_CONTINUOUS_SUCCESS_ZONE_MUSE_LIVE_REQUIREMENT_ABILITY_ID
      )
    ).toBe(true);
  });
});
