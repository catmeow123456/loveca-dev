import { describe, expect, it } from 'vitest';
import { SlotPosition, TriggerCondition } from '../../src/shared/types/enums';
import {
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  BP4_002_CONTINUOUS_LIVE_WITHOUT_TIMING_PURPLE_HEART_ABILITY_ID,
  BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
  BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  BP4_008_CONTINUOUS_SUCCESS_SCORE_STAGE_COST_ABILITY_ID,
  BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
  BP5_003_CONTINUOUS_THREE_DIFFERENT_NAMES_YELLOW_HEART_ABILITY_ID,
  BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID,
  BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID,
  BP5_008_CONTINUOUS_SUCCESS_SCORE_YELLOW_HEART_ABILITY_ID,
  PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
  BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
  BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID,
  BP6_022_CONTINUOUS_SUCCESS_ZONE_MUSE_LIVE_REQUIREMENT_ABILITY_ID,
  BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
  CARD_ABILITY_DEFINITIONS,
  CardAbilityCategory,
  CardAbilitySourceZone,
  BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
  CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID,
  EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
  HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
  HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
  HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID,
  HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID,
  HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
  HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
  HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
  HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
  HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
  HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  BP4_003_ACTIVATED_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
  PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
  PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID,
  SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
  HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
  HS_BP1_003_CONTINUOUS_THREE_DIFFERENT_HASUNOSORA_SCORE_ABILITY_ID,
  HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID,
  SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID,
  SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID,
  SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
  SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
  SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID,
  SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
  HS_BP2_014_ON_ENTER_DRAW_CANNOT_LIVE_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
  PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
  PL_BP3_026_LIVE_SUCCESS_HIGHER_STAGE_HEART_TOTAL_THIS_LIVE_SCORE_ABILITY_ID,
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
  HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
  HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
  HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
  HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
  HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
  HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
  HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
  HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID,
  HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID,
  HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID,
  HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
  HS_PB1_014_CONTINUOUS_FRONT_HIGH_COST_PINK_HEART_ABILITY_ID,
  HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID,
  HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID,
  HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
  N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
  SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
  SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID,
  SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
  PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID,
  S_PR_013_LIVE_START_PAY_TWO_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
  HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
  getActivatedAbilityUiConfig,
  getCardAbilityDefinitions,
  RIN_ACTIVATED_ABILITY_ID,
  HANAYO_ACTIVATED_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
  isSupportedActivatedAbilityForCard,
  KARIN_LIVE_START_ABILITY_ID,
  KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID,
  LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
  LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
  GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID,
  SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
  SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
  SP_BP5_012_CONTINUOUS_LIELLA_LIVE_REQUIREMENT_EIGHT_YELLOW_HEART_ABILITY_ID,
  SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
  SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID,
  SP_SD2_025_LIVE_START_MOVED_LIELLA_MEMBERS_GAIN_BLADE_ABILITY_ID,
  YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
} from '../../src/application/card-effect-runner';

const PB1_019_LIKE_MEMBER_ACTIVATION_CARD_CODES = [
  'PL!-pb1-019-N',
  'PL!-pb1-025-N',
  'PL!HS-PR-014-PR',
  'PL!HS-pb1-019-N',
  'PL!HS-sd1-015-SD',
  'PL!N-bp4-017-N',
  'PL!N-bp4-020-N',
  'PL!N-sd1-006-SD',
  'PL!S-PR-025-PR',
  'PL!S-PR-027-PR',
  'PL!S-bp2-016-N',
  'PL!S-bp6-014-N',
  'PL!S-sd1-008-SD',
  'PL!SP-bp4-015-N',
  'PL!SP-bp4-019-N',
  'PL!SP-pb1-021-N',
  'PL!SP-sd2-014-SD2',
] as const;

const GENERIC_DISCARD_LOOK_TOP_CARD_CODES = [
  'PL!-pb1-016-P＋',
  'PL!-pb1-016-R',
  'PL!HS-PR-002-PR',
  'PL!HS-PR-005-PR',
  'PL!HS-bp1-009-P',
  'PL!HS-bp1-009-R',
  'PL!HS-bp2-010-N',
  'PL!HS-cl1-007-CL',
  'PL!HS-pb1-011-R',
  'PL!HS-pb1-018-N',
  'PL!N-PR-004-PR',
  'PL!N-PR-006-PR',
  'PL!N-PR-013-PR',
  'PL!N-pb1-028-N',
  'PL!N-pb1-035-N',
  'PL!S-PR-013-PR',
  'PL!S-PR-019-PR',
  'PL!S-bp3-004-P',
  'PL!S-bp3-004-R',
  'PL!SP-bp1-005-P',
  'PL!SP-bp1-005-R',
  'PL!SP-pb1-015-N',
  'PL!SP-pb1-016-N',
  'PL!SP-pb1-017-N',
  'PL!N-bp1-007-R',
  'PL!N-bp1-010-R',
  'PL!N-sd1-002-SD',
  'PL!N-sd1-003-SD',
] as const;

const PL_BP3_014_LOOK_TOP_TWO_ON_ENTER_CARD_CODES = [
  'PL!-bp3-014-N',
  'PL!-bp3-017-N',
  'PL!-bp3-018-N',
  'PL!N-bp3-022-N',
  'PL!N-bp4-016-N',
  'PL!S-bp6-018-N',
] as const;

const BP3_010_TOP_FIVE_LIVE_CARD_CODES = [
  'PL!-bp3-010-N',
  'PL!HS-bp1-011-N',
  'PL!HS-bp6-022-N',
] as const;

const HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_CARD_CODES = [
  'PL!HS-bp1-010',
  'PL!HS-bp1-014',
  'PL!HS-bp6-020',
  'PL!N-bp1-014',
  'PL!N-bp1-015',
  'PL!N-bp1-019',
  'PL!N-sd1-013',
  'PL!N-sd1-021',
  'PL!N-sd1-022',
] as const;

const MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_CARD_CODES = [
  'PL!N-PR-005-PR',
  'PL!N-PR-007-PR',
  'PL!N-PR-011-PR',
  'PL!N-bp3-024-N',
  'PL!S-bp2-010-N',
] as const;

describe('card effect classification registry', () => {
  it('keeps ability definitions addressable with visible effect text', () => {
    const definitionsByAbilityId = new Map<
      string,
      { readonly baseCardCodes?: readonly string[]; readonly effectText: string }
    >();

    for (const ability of CARD_ABILITY_DEFINITIONS) {
      expect(ability.abilityId.trim().length).toBeGreaterThan(0);
      expect(ability.effectText.trim().length).toBeGreaterThan(0);

      const existingDefinition = definitionsByAbilityId.get(ability.abilityId);
      if (existingDefinition) {
        expect(ability.effectText).toBe(existingDefinition.effectText);
        expect(ability.baseCardCodes ?? []).toEqual(existingDefinition.baseCardCodes ?? []);
      } else {
        definitionsByAbilityId.set(ability.abilityId, {
          baseCardCodes: ability.baseCardCodes,
          effectText: ability.effectText,
        });
      }

      if (ability.activatedUi) {
        expect(ability.activatedUi.abilityId).toBe(ability.abilityId);
        expect(ability.activatedUi.text.trim().length).toBeGreaterThan(0);
        expect(ability.activatedUi.title.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('classifies current sample effects by rule timing and source zone', () => {
    const hs006 = getCardAbilityDefinitions('PL!HS-bp1-006-P').find(
      (ability) => ability.abilityId === HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID
    );
    expect(hs006).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    for (const cardCode of HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_CARD_CODES) {
      const hs006Like = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID
      );
      expect(hs006Like).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });
    }

    for (const cardCode of MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_CARD_CODES) {
      const drawTwoDiscardTwo = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID
      );
      expect(drawTwoDiscardTwo).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });
    }

    const hs006LiveStart = getCardAbilityDefinitions('PL!HS-bp1-006-P').find(
      (ability) => ability.abilityId === HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID
    );
    expect(hs006LiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const hs004Activated = getCardAbilityDefinitions('PL!HS-bp1-004-P').find(
      (ability) => ability.abilityId === HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID
    );
    expect(hs004Activated).toMatchObject({
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
      perTurnLimit: 1,
    });

    const hs004LiveStart = getCardAbilityDefinitions('PL!HS-bp1-004-P').find(
      (ability) => ability.abilityId === HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    expect(hs004LiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const llBp1OnEnter = getCardAbilityDefinitions('LL-bp1-001-R+').find(
      (ability) => ability.abilityId === LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID
    );
    expect(llBp1OnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const llBp1LiveStart = getCardAbilityDefinitions('LL-bp1-001-R+').find(
      (ability) => ability.abilityId === LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID
    );
    expect(llBp1LiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const llBp2LiveStart = getCardAbilityDefinitions('LL-bp2-001-R+').find(
      (ability) => ability.abilityId === LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID
    );
    expect(llBp2LiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const hsPr001 = getCardAbilityDefinitions('PL!HS-PR-001-PR').find(
      (ability) => ability.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID
    );
    expect(hsPr001).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const hsPr001LiveStart = getCardAbilityDefinitions('PL!HS-PR-001-PR').find(
      (ability) => ability.abilityId === HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    expect(hsPr001LiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    for (const cardCode of ['PL!HS-PR-002-PR', 'PL!HS-PR-005-PR']) {
      const prOnEnter = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID
      );
      expect(prOnEnter).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });

      const prLiveStart = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID
      );
      expect(prLiveStart).toMatchObject({
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      });
    }

    for (const cardCode of ['PL!S-PR-013-PR', 'PL!S-PR-019-PR']) {
      const sPrOnEnter = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID
      );
      expect(sPrOnEnter).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });

      const sPrLiveStart = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === S_PR_013_LIVE_START_PAY_TWO_ENERGY_GAIN_TWO_BLADE_ABILITY_ID
      );
      expect(sPrLiveStart).toMatchObject({
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      });
    }

    const nSd1010OnEnter = getCardAbilityDefinitions('PL!N-sd1-010-SD').find(
      (ability) => ability.abilityId === HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID
    );
    expect(nSd1010OnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const nSd1010LiveStart = getCardAbilityDefinitions('PL!N-sd1-010-SD').find(
      (ability) =>
        ability.abilityId === N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID
    );
    expect(nSd1010LiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const spBp4012LiveStart = getCardAbilityDefinitions('PL!SP-bp4-012-N').find(
      (ability) => ability.abilityId === SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID
    );
    expect(spBp4012LiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    for (const cardCode of ['PL!SP-bp4-001-P', 'PL!SP-bp4-001-R']) {
      const spBp4001OnEnter = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId ===
          SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      );
      expect(spBp4001OnEnter).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });
    }

    for (const cardCode of [
      'PL!SP-bp4-004-P',
      'PL!SP-bp4-004-P+',
      'PL!SP-bp4-004-R+',
      'PL!SP-bp4-004-SEC',
    ]) {
      const spBp4004OnEnter = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId ===
          SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID
      );
    expect(spBp4004OnEnter).toMatchObject({
      abilityId: SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID,
      baseCardCodes: ['PL!SP-bp4-004'],
      category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      requiredSourceSlots: [SlotPosition.CENTER],
    });
  }

  for (const cardCode of [
    'PL!SP-bp5-002-P',
    'PL!SP-bp5-002-R+',
    'PL!SP-bp5-002-AR',
    'PL!SP-bp5-002-SEC',
  ]) {
    const spBp5002Activated = getCardAbilityDefinitions(cardCode).find(
      (ability) =>
        ability.abilityId ===
        SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID
    );
    expect(spBp5002Activated).toMatchObject({
      abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
      baseCardCodes: ['PL!SP-bp5-002'],
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
      perTurnLimit: 1,
      requiredSourceSlots: [SlotPosition.LEFT],
    });
    expect(spBp5002Activated?.activatedUi).toMatchObject({
      abilityId: SP_BP5_002_ACTIVATED_WAIT_DRAW_THREE_DISCARD_TWO_NO_BLADE_HEART_REWARD_ABILITY_ID,
    });
    expect(spBp5002Activated?.activatedUi?.text).toContain('左サイド');
    expect(spBp5002Activated?.activatedUi?.text).toContain('抽3张卡');
    expect(spBp5002Activated?.activatedUi?.text).toContain('将2张手牌放置入休息室');
    expect(spBp5002Activated?.activatedUi?.text).toContain('大于等于1张不持有BLADE HEART');
    expect(spBp5002Activated?.activatedUi?.text).toContain('将此成员变为活跃状态');
    expect(spBp5002Activated?.activatedUi?.text).toContain('存在2张');
    expect(spBp5002Activated?.activatedUi?.text).toContain('[BLADE][BLADE]');
  }

  for (const cardCode of ['PL!-pb1-018-R', 'PL!-pb1-018-P+']) {
    const plPb1018OnEnter = getCardAbilityDefinitions(cardCode).find(
      (ability) =>
        ability.abilityId ===
        PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID
    );
    expect(plPb1018OnEnter).toMatchObject({
      abilityId: PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID,
      baseCardCodes: ['PL!-pb1-018'],
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });
    expect(plPb1018OnEnter?.effectText).toContain('费用小于等于2的成员卡');
    expect(plPb1018OnEnter?.effectText).toContain('此回合不能登场成员');
  }

  const spBp5012Continuous = getCardAbilityDefinitions('PL!SP-bp5-012-N').find(
    (ability) =>
      ability.abilityId ===
      SP_BP5_012_CONTINUOUS_LIELLA_LIVE_REQUIREMENT_EIGHT_YELLOW_HEART_ABILITY_ID
    );
    expect(spBp5012Continuous).toMatchObject({
      category: CardAbilityCategory.CONTINUOUS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
  });

  const tinyStarsDefinitions = getCardAbilityDefinitions('PL!SP-bp1-024-L');
  expect(
    tinyStarsDefinitions.find(
      (ability) =>
        ability.abilityId ===
        SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID
    )
  ).toMatchObject({
    abilityId: SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp1-024'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
  });
  expect(
    tinyStarsDefinitions.find(
      (ability) =>
        ability.abilityId === SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID
    )
  ).toMatchObject({
    abilityId: SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp1-024'],
    category: CardAbilityCategory.LIVE_SUCCESS,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    queued: true,
    implemented: true,
  });

  const ohLovePeaceDefinitions = getCardAbilityDefinitions('PL!-bp3-026-L');
  expect(
    ohLovePeaceDefinitions.find(
      (ability) =>
        ability.abilityId ===
        PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID
    )
  ).toMatchObject({
    abilityId: PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!-bp3-026'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
  });
  expect(
    ohLovePeaceDefinitions.find(
      (ability) =>
        ability.abilityId ===
        PL_BP3_026_LIVE_SUCCESS_HIGHER_STAGE_HEART_TOTAL_THIS_LIVE_SCORE_ABILITY_ID
    )
  ).toMatchObject({
    abilityId: PL_BP3_026_LIVE_SUCCESS_HIGHER_STAGE_HEART_TOTAL_THIS_LIVE_SCORE_ABILITY_ID,
    baseCardCodes: ['PL!-bp3-026'],
    category: CardAbilityCategory.LIVE_SUCCESS,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    queued: true,
    implemented: true,
  });

  for (const cardCode of GENERIC_DISCARD_LOOK_TOP_CARD_CODES) {
    const hs001Like = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID
      );
      expect(hs001Like).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });
    }

    for (const cardCode of BP3_010_TOP_FIVE_LIVE_CARD_CODES) {
      const bp3TopLive = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID
      );
      expect(bp3TopLive).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });
    }

    const hsBp2Recover = getCardAbilityDefinitions('PL!HS-bp2-002-P').find(
      (ability) => ability.abilityId === HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID
    );
    expect(hsBp2Recover).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const bp5Rin = getCardAbilityDefinitions('PL!-bp5-005-AR').find(
      (ability) =>
        ability.abilityId === BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID
    );
    expect(bp5Rin).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    for (const cardCode of ['PL!-bp5-007-AR', 'PL!-bp5-007-P', 'PL!-bp5-007-R']) {
      const bp5007Nozomi = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID
      );
      expect(bp5007Nozomi).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
        baseCardCodes: ['PL!-bp5-007'],
      });
    }

    const bp5008Hanayo = getCardAbilityDefinitions('PL!-bp5-008-AR').find(
      (ability) => ability.abilityId === BP5_008_CONTINUOUS_SUCCESS_SCORE_YELLOW_HEART_ABILITY_ID
    );
    expect(bp5008Hanayo).toMatchObject({
      category: CardAbilityCategory.CONTINUOUS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
    });
    for (const cardCode of ['PL!-bp5-008-P', 'PL!-bp5-008-R']) {
      expect(
        getCardAbilityDefinitions(cardCode).some(
          (ability) =>
            ability.abilityId === BP5_008_CONTINUOUS_SUCCESS_SCORE_YELLOW_HEART_ABILITY_ID
        )
      ).toBe(true);
    }

    const bp5013Umi = getCardAbilityDefinitions('PL!-bp5-013-N').find(
      (ability) =>
        ability.abilityId === PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID
    );
    expect(bp5013Umi).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const spBp2Keke = getCardAbilityDefinitions('PL!SP-bp2-002-R').find(
      (ability) => ability.abilityId === SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID
    );
    expect(spBp2Keke).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const bp6002Eli = getCardAbilityDefinitions('PL!-bp6-002-P').find(
      (ability) =>
        ability.abilityId === BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID
    );
    expect(bp6002Eli).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });
    expect(
      getCardAbilityDefinitions('PL!-bp6-002-R').some(
        (ability) =>
          ability.abilityId === BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID
      )
    ).toBe(true);

    const pr018Nozomi = getCardAbilityDefinitions('PL!-PR-018-PR').find(
      (ability) => ability.abilityId === PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID
    );
    expect(pr018Nozomi).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const pr017Nico = getCardAbilityDefinitions('PL!-PR-017-PR').find(
      (ability) =>
        ability.abilityId === PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID
    );
    expect(pr017Nico).toMatchObject({
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
    });

    const bp4002Eli = getCardAbilityDefinitions('PL!-bp4-002-SEC').find(
      (ability) => ability.abilityId === BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
    );
    expect(bp4002Eli).toMatchObject({
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
      perTurnLimit: 1,
    });
    for (const cardCode of [
      'PL!-bp4-002-P',
      'PL!-bp4-002-P+',
      'PL!-bp4-002-R+',
      'PL!-bp4-002-SEC',
    ]) {
      expect(
        getCardAbilityDefinitions(cardCode).some(
          (ability) => ability.abilityId === BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
        )
      ).toBe(true);
      const continuous = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === BP4_002_CONTINUOUS_LIVE_WITHOUT_TIMING_PURPLE_HEART_ABILITY_ID
      );
      expect(continuous).toMatchObject({
        category: CardAbilityCategory.CONTINUOUS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
      });
    }

    const bp4008Hanayo = getCardAbilityDefinitions('PL!-bp4-008-P').find(
      (ability) => ability.abilityId === BP4_008_CONTINUOUS_SUCCESS_SCORE_STAGE_COST_ABILITY_ID
    );
    expect(bp4008Hanayo).toMatchObject({
      category: CardAbilityCategory.CONTINUOUS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
    });
    expect(
      getCardAbilityDefinitions('PL!-bp4-008-R').some(
        (ability) => ability.abilityId === BP4_008_CONTINUOUS_SUCCESS_SCORE_STAGE_COST_ABILITY_ID
      )
    ).toBe(true);

    for (const cardCode of [
      'PL!-bp5-003-AR',
      'PL!-bp5-003-P',
      'PL!-bp5-003-R+',
      'PL!-bp5-003-SEC',
    ]) {
      const activated = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      );
      expect(activated).toMatchObject({
        category: CardAbilityCategory.ACTIVATED,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
        perTurnLimit: 1,
      });

      const continuous = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === BP5_003_CONTINUOUS_THREE_DIFFERENT_NAMES_YELLOW_HEART_ABILITY_ID
      );
      expect(continuous).toMatchObject({
        category: CardAbilityCategory.CONTINUOUS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
      });
    }

    const bp4021Heartbeat = getCardAbilityDefinitions('PL!-bp4-021-L').find(
      (ability) =>
        ability.abilityId === BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID
    );
    expect(bp4021Heartbeat).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    for (const cardCode of [
      'PL!HS-bp5-003-AR',
      'PL!HS-bp5-003-P',
      'PL!HS-bp5-003-R+',
      'PL!HS-bp5-003-SEC',
    ]) {
      const leaveStage = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID
      );
      expect(leaveStage).toMatchObject({
        category: CardAbilityCategory.AUTO,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
        queued: true,
        implemented: true,
      });

      const liveStart = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID
      );
      expect(liveStart).toMatchObject({
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      });
    }

    for (const cardCode of ['PL!HS-bp5-006-AR', 'PL!HS-bp5-006-P', 'PL!HS-bp5-006-R']) {
      const liveStart = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId ===
          HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID
      );
      expect(liveStart).toMatchObject({
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      });
    }

    const bp6005Rin = getCardAbilityDefinitions('PL!-bp6-005-P').find(
      (ability) =>
        ability.abilityId === BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID
    );
    expect(bp6005Rin).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });
    expect(
      getCardAbilityDefinitions('PL!-bp6-005-R').some(
        (ability) =>
          ability.abilityId === BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID
      )
    ).toBe(true);

    const bp6022Dreamin = getCardAbilityDefinitions('PL!-bp6-022-L').find(
      (ability) =>
        ability.abilityId === BP6_022_CONTINUOUS_SUCCESS_ZONE_MUSE_LIVE_REQUIREMENT_ABILITY_ID
    );
    expect(bp6022Dreamin).toMatchObject({
      category: CardAbilityCategory.CONTINUOUS,
      sourceZone: CardAbilitySourceZone.SUCCESS_LIVE_CARD,
      queued: false,
      implemented: true,
    });

    const bp6024Crossroads = getCardAbilityDefinitions('PL!-bp6-024-L').find(
      (ability) => ability.abilityId === BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID
    );
    expect(bp6024Crossroads).toMatchObject({
      category: CardAbilityCategory.CONTINUOUS,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      queued: false,
      implemented: true,
    });

    const hsBp5KahoOnEnter = getCardAbilityDefinitions('PL!HS-bp5-001-SEC').find(
      (ability) => ability.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID
    );
    expect(hsBp5KahoOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const hsBp5KahoActivated = getCardAbilityDefinitions('PL!HS-bp5-001-SEC').find(
      (ability) =>
        ability.abilityId ===
        HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID
    );
    expect(hsBp5KahoActivated).toMatchObject({
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
      perTurnLimit: 1,
    });

    const hsBp1KosuzuActivated = getCardAbilityDefinitions('PL!HS-bp1-003-SEC').find(
      (ability) =>
        ability.abilityId === HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID
    );
    expect(hsBp1KosuzuActivated).toMatchObject({
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
      perTurnLimit: 1,
    });

    const hsBp1KosuzuContinuous = getCardAbilityDefinitions('PL!HS-bp1-003-SEC').find(
      (ability) =>
        ability.abilityId === HS_BP1_003_CONTINUOUS_THREE_DIFFERENT_HASUNOSORA_SCORE_ABILITY_ID
    );
    expect(hsBp1KosuzuContinuous).toMatchObject({
      category: CardAbilityCategory.CONTINUOUS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
    });

    const hsBp1SayakaActivated = getCardAbilityDefinitions('PL!HS-bp1-002-RM').find(
      (ability) =>
        ability.abilityId === HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID
    );
    expect(hsBp1SayakaActivated).toMatchObject({
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
    });

    const hsBp6KahoOnEnter = getCardAbilityDefinitions('PL!HS-bp6-001-R＋').find(
      (ability) => ability.abilityId === HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID
    );
    expect(hsBp6KahoOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    for (const cardCode of PL_BP3_014_LOOK_TOP_TWO_ON_ENTER_CARD_CODES) {
      const hp = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID
      );
      expect(hp).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });
    }
    const shiorikoBp3022 = getCardAbilityDefinitions('PL!N-bp3-022-N').find(
      (ability) => ability.abilityId === PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID
    );
    expect(shiorikoBp3022?.baseCardCodes).toContain('PL!N-bp3-022');

    const hsBp6KahoLiveSuccess = getCardAbilityDefinitions('PL!HS-bp6-001-R＋').find(
      (ability) => ability.abilityId === HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID
    );
    expect(hsBp6KahoLiveSuccess).toMatchObject({
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      queued: true,
      implemented: true,
    });

    const watercolorWorldLiveSuccess = getCardAbilityDefinitions('PL!HS-cl1-009-CL').find(
      (ability) => ability.abilityId === HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID
    );
    expect(watercolorWorldLiveSuccess).toMatchObject({
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      queued: true,
      implemented: true,
    });

    const tsukiyomiKurageOnCheer = getCardAbilityDefinitions('PL!HS-bp6-027-L').find(
      (ability) => ability.abilityId === HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID
    );
    expect(tsukiyomiKurageOnCheer).toMatchObject({
      category: CardAbilityCategory.AUTO,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_CHEER,
      queued: true,
      implemented: true,
      perTurnLimit: 1,
    });

    const pb1Activated = getCardAbilityDefinitions('PL!-pb1-019-N').find(
      (ability) => ability.abilityId === PB1_019_ACTIVATED_ABILITY_ID
    );
    expect(pb1Activated).toMatchObject({
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
    });

    const bp4Activated = getCardAbilityDefinitions('PL!-bp4-003-P').find(
      (ability) => ability.abilityId === BP4_003_ACTIVATED_ABILITY_ID
    );
    expect(bp4Activated).toMatchObject({
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
    });

    const bokuima = CARD_ABILITY_DEFINITIONS.find(
      (ability) => ability.abilityId === BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID
    );
    expect(bokuima).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const hanamusubi = getCardAbilityDefinitions('PL!HS-bp5-019-L').find(
      (ability) => ability.abilityId === HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID
    );
    expect(hanamusubi).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const aokuharuka = getCardAbilityDefinitions('PL!HS-bp2-022-L+').find(
      (ability) => ability.abilityId === HS_BP2_022_LIVE_START_SCORE_ABILITY_ID
    );
    expect(aokuharuka).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const himeOnEnter = getCardAbilityDefinitions('PL!HS-sd1-006-SD').find(
      (ability) => ability.abilityId === HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID
    );
    expect(himeOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const himeLiveStart = getCardAbilityDefinitions('PL!HS-sd1-006-SD').find(
      (ability) => ability.abilityId === HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    expect(himeLiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const bp4HonokaLiveStart = getCardAbilityDefinitions('PL!-bp4-010-N').find(
      (ability) => ability.abilityId === BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    expect(bp4HonokaLiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const izumi = getCardAbilityDefinitions('PL!HS-bp5-008-AR').find(
      (ability) => ability.abilityId === HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
    );
    expect(izumi).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const pb1Ginko = getCardAbilityDefinitions('PL!HS-pb1-004-P+').find(
      (ability) =>
        ability.abilityId ===
        HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID
    );
    expect(pb1Ginko).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const prGinko = getCardAbilityDefinitions('PL!HS-PR-019-RM').find(
      (ability) => ability.abilityId === HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID
    );
    expect(prGinko).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    for (const cardCode of ['PL!HS-PR-021-PR', 'PL!HS-PR-021-RM']) {
      const prHime = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID
      );
      expect(prHime).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });
    }

    for (const cardCode of ['PL!HS-bp6-003-P', 'PL!HS-bp6-003-R']) {
      const onEnter = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID
      );
      expect(onEnter).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });

      const liveStart = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID
      );
      expect(liveStart).toMatchObject({
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      });
    }

    for (const cardCode of [
      'PL!HS-bp6-006-R＋',
      'PL!HS-bp6-006-P',
      'PL!HS-bp6-006-P＋',
      'PL!HS-bp6-006-SEC',
    ]) {
      const liveSuccess = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID
      );
      expect(liveSuccess).toMatchObject({
        baseCardCodes: ['PL!HS-bp6-006'],
        category: CardAbilityCategory.LIVE_SUCCESS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
        queued: true,
        implemented: true,
      });
    }

    for (const cardCode of ['PL!HS-pb1-014-P+', 'PL!HS-pb1-014-R']) {
      const onEnter = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID
      );
      expect(onEnter).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });

      const continuous = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === HS_PB1_014_CONTINUOUS_FRONT_HIGH_COST_PINK_HEART_ABILITY_ID
      );
      expect(continuous).toMatchObject({
        category: CardAbilityCategory.CONTINUOUS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
      });
    }

    const zenhouiKyunLiveStart = getCardAbilityDefinitions('PL!HS-pb1-029-L').find(
      (ability) =>
        ability.abilityId ===
        HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID
    );
    expect(zenhouiKyunLiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const dododoLiveSuccess = getCardAbilityDefinitions('PL!HS-bp1-023-L').find(
      (ability) =>
        ability.abilityId === HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    expect(dododoLiveSuccess).toMatchObject({
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      queued: true,
      implemented: true,
    });

    for (const cardCode of ['PL!SP-bp2-024-L', 'PL!SP-bp2-024-SECL']) {
      const vitaminSummerLiveSuccess = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId ===
          SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID
      );
      expect(vitaminSummerLiveSuccess).toMatchObject({
        category: CardAbilityCategory.LIVE_SUCCESS,
        sourceZone: CardAbilitySourceZone.LIVE_CARD,
        triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
        queued: true,
        implemented: true,
      });
    }

    const nonfictionAbilities = getCardAbilityDefinitions('PL!SP-bp4-024-L').filter((ability) =>
      [
        SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID,
        SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID,
      ].includes(ability.abilityId)
    );
    expect(nonfictionAbilities).toHaveLength(2);
    expect(nonfictionAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID,
          category: CardAbilityCategory.LIVE_START,
          sourceZone: CardAbilitySourceZone.LIVE_CARD,
          triggerCondition: TriggerCondition.ON_LIVE_START,
          queued: true,
          implemented: true,
        }),
        expect.objectContaining({
          abilityId: SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID,
          category: CardAbilityCategory.LIVE_START,
          sourceZone: CardAbilitySourceZone.LIVE_CARD,
          triggerCondition: TriggerCondition.ON_LIVE_START,
          queued: true,
          implemented: true,
        }),
      ])
    );

    for (const cardCode of ['PL!SP-sd2-025-P', 'PL!SP-sd2-025-SD2']) {
      const aspireLiveStart = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId ===
          SP_SD2_025_LIVE_START_MOVED_LIELLA_MEMBERS_GAIN_BLADE_ABILITY_ID
      );
      expect(aspireLiveStart).toMatchObject({
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.LIVE_CARD,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      });
    }

    for (const cardCode of [
      'PL!SP-bp2-009-P',
      'PL!SP-bp2-009-P+',
      'PL!SP-bp2-009-R+',
      'PL!SP-bp2-009-SEC',
    ]) {
      const natsumiLiveStart = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID
      );
      expect(natsumiLiveStart).toMatchObject({
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      });

      const natsumiLiveSuccess = getCardAbilityDefinitions(cardCode).find(
        (ability) => ability.abilityId === SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID
      );
      expect(natsumiLiveSuccess).toMatchObject({
        category: CardAbilityCategory.LIVE_SUCCESS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
        queued: true,
        implemented: true,
      });
    }

    const bp2014OnEnter = getCardAbilityDefinitions('PL!HS-bp2-014-N').find(
      (ability) => ability.abilityId === HS_BP2_014_ON_ENTER_DRAW_CANNOT_LIVE_ABILITY_ID
    );
    expect(bp2014OnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    for (const cardCode of ['PL!HS-pb1-003-R', 'PL!HS-pb1-003-P＋']) {
      const onEnter = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID
      );
      expect(onEnter).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });

      const auto = getCardAbilityDefinitions(cardCode).find(
        (ability) =>
          ability.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      );
      expect(auto).toMatchObject({
        category: CardAbilityCategory.AUTO,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_WAITING_ROOM,
        queued: true,
        implemented: true,
        perTurnLimit: 2,
      });
    }

    const startDash = getCardAbilityDefinitions('PL!-sd1-019-SD')[0];
    expect(startDash).toMatchObject({
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      queued: true,
      implemented: true,
    });

    const honokaContinuous = getCardAbilityDefinitions('PL!-sd1-001-SD').find(
      (ability) => ability.category === CardAbilityCategory.CONTINUOUS
    );
    expect(honokaContinuous).toMatchObject({
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
    });

    const hanayoActivated = getCardAbilityDefinitions('PL!-sd1-008-SD').find(
      (ability) => ability.abilityId === HANAYO_ACTIVATED_ABILITY_ID
    );
    expect(hanayoActivated).toMatchObject({
      category: CardAbilityCategory.ACTIVATED,
      perTurnLimit: 1,
    });

    const kekeBaseCardCodes = [
      'PL!SP-PR-004',
      'PL!SP-PR-006',
      'PL!SP-PR-013',
      'PL!SP-bp1-021',
      'PL!SP-sd1-014',
      'PL!SP-sd1-016',
    ] as const;

    for (const baseCardCode of kekeBaseCardCodes) {
      const kekeOnEnter = getCardAbilityDefinitions(baseCardCode).find(
        (ability) => ability.abilityId === KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
      );
      expect(kekeOnEnter).toMatchObject({
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
      });
    }

    const shikiLeftOnEnter = getCardAbilityDefinitions('PL!SP-bp4-008-P').find(
      (ability) => ability.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID
    );
    expect(shikiLeftOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
      requiredSourceSlots: [SlotPosition.LEFT],
    });

    const shikiRightOnEnter = getCardAbilityDefinitions('PL!SP-bp4-008-P').find(
      (ability) => ability.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID
    );
    expect(shikiRightOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
      requiredSourceSlots: [SlotPosition.RIGHT],
    });

    const shikiLiveStart = getCardAbilityDefinitions('PL!SP-bp4-008-P').find(
      (ability) => ability.abilityId === SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID
    );
    expect(shikiLiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const kekeSelfPositionChange = getCardAbilityDefinitions('PL!SP-bp4-013-N').find(
      (ability) => ability.abilityId === GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID
    );
    expect(kekeSelfPositionChange).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const chisatoLiveStart = getCardAbilityDefinitions('PL!SP-bp5-003-AR').find(
      (ability) => ability.abilityId === CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID
    );
    expect(chisatoLiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
      requiredSourceSlots: [SlotPosition.CENTER],
    });

    const yoshikoOnEnter = getCardAbilityDefinitions('PL!S-bp2-006-P').find(
      (ability) => ability.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID
    );
    expect(yoshikoOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const emmaOnEnter = getCardAbilityDefinitions('PL!N-pb1-008-P+').find(
      (ability) => ability.abilityId === EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID
    );
    expect(emmaOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const kosuzuAuto = getCardAbilityDefinitions('PL!HS-bp2-012-N').find(
      (ability) => ability.abilityId === HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID
    );
    expect(kosuzuAuto).toMatchObject({
      category: CardAbilityCategory.AUTO,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
      queued: true,
      implemented: true,
    });

    const kahoAuto = getCardAbilityDefinitions('PL!HS-bp6-017-N').find(
      (ability) => ability.abilityId === HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID
    );
    expect(kahoAuto).toMatchObject({
      category: CardAbilityCategory.AUTO,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
      queued: true,
      implemented: true,
    });

    const relayKahoAuto = getCardAbilityDefinitions('PL!HS-sd1-001-SD').find(
      (ability) => ability.abilityId === HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID
    );
    expect(relayKahoAuto).toMatchObject({
      category: CardAbilityCategory.AUTO,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
      queued: true,
      implemented: true,
    });

    const hsPb1GinkoOnEnter = getCardAbilityDefinitions('PL!HS-pb1-020-N').find(
      (ability) =>
        ability.abilityId ===
        HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID
    );
    expect(hsPb1GinkoOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const hsPb1KahoAuto = getCardAbilityDefinitions('PL!HS-pb1-009-R').find(
      (ability) => ability.abilityId === HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID
    );
    expect(hsPb1KahoAuto).toMatchObject({
      category: CardAbilityCategory.AUTO,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
      requiredSourceSlots: [SlotPosition.CENTER],
      perTurnLimit: 2,
    });

    const hsPb1KahoLiveStart = getCardAbilityDefinitions('PL!HS-pb1-009-R').find(
      (ability) => ability.abilityId === HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID
    );
    expect(hsPb1KahoLiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const hsBp6GinkoOnEnter = getCardAbilityDefinitions('PL!HS-bp6-004-R').find(
      (ability) =>
        ability.abilityId === HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID
    );
    expect(hsBp6GinkoOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

    const hsBp6GinkoLiveStartWait = getCardAbilityDefinitions('PL!HS-bp6-004-R').find(
      (ability) =>
        ability.abilityId === HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID
    );
    expect(hsBp6GinkoLiveStartWait).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const hsBp6GinkoLiveStartDiscard = getCardAbilityDefinitions('PL!HS-bp6-004-R').find(
      (ability) => ability.abilityId === HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID
    );
    expect(hsBp6GinkoLiveStartDiscard).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const tomariAbilities = getCardAbilityDefinitions('PL!SP-bp4-011-P').filter(
      (ability) =>
        ability.abilityId === SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID
    );
    expect(tomariAbilities).toHaveLength(2);
    expect(tomariAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: CardAbilityCategory.ON_ENTER,
          sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
          triggerCondition: TriggerCondition.ON_ENTER_STAGE,
          queued: true,
          implemented: true,
        }),
        expect.objectContaining({
          category: CardAbilityCategory.AUTO,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          triggerCondition: TriggerCondition.ON_MEMBER_SLOT_MOVED,
          queued: true,
          implemented: true,
        }),
      ])
    );

    const spSd2012KanonAuto = getCardAbilityDefinitions('PL!SP-sd2-012-SD2').find(
      (ability) => ability.abilityId === SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID
    );
    expect(spSd2012KanonAuto).toMatchObject({
      category: CardAbilityCategory.AUTO,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      queued: true,
      implemented: true,
      perTurnLimit: 1,
    });

    const hsBp6031LiveStart = getCardAbilityDefinitions('PL!HS-bp6-031-L').find(
      (ability) =>
        ability.abilityId === HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID
    );
    expect(hsBp6031LiveStart).toMatchObject({
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });

    const hsPb1012OnEnter = getCardAbilityDefinitions('PL!HS-pb1-012-R').find(
      (ability) =>
        ability.abilityId === HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID
    );
    expect(hsPb1012OnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });
  });

  it('matches implemented abilities by base card code across rarities', () => {
    for (const cardCode of ['PL!HS-bp1-004-P+', 'PL!HS-bp1-004-R+', 'PL!HS-bp1-004-SEC']) {
      expect(
        getCardAbilityDefinitions(cardCode).some(
          (ability) => ability.abilityId === HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID
        )
      ).toBe(true);
      expect(
        getCardAbilityDefinitions(cardCode).some(
          (ability) => ability.abilityId === HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
        )
      ).toBe(true);
    }

    expect(
      getCardAbilityDefinitions('PL!HS-bp6-004-P').filter((ability) =>
        [
          HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
          HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
          HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
        ].includes(ability.abilityId)
      )
    ).toHaveLength(3);

    expect(
      getCardAbilityDefinitions('PL!HS-bp5-001-AR').some(
        (ability) => ability.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(true);
    expect(
      getCardAbilityDefinitions('PL!HS-bp5-001-AR').some(
        (ability) =>
          ability.abilityId ===
          HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID
      )
    ).toBe(true);
    for (const cardCode of [
      'PL!HS-bp5-003-AR',
      'PL!HS-bp5-003-P',
      'PL!HS-bp5-003-R+',
      'PL!HS-bp5-003-SEC',
    ]) {
      expect(
        getCardAbilityDefinitions(cardCode).filter((ability) =>
          [
            HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
            HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
          ].includes(ability.abilityId)
        )
      ).toHaveLength(2);
    }
    for (const cardCode of ['PL!HS-bp5-006-AR', 'PL!HS-bp5-006-P', 'PL!HS-bp5-006-R']) {
      expect(
        getCardAbilityDefinitions(cardCode).some(
          (ability) =>
            ability.abilityId ===
            HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID
        )
      ).toBe(true);
    }
    for (const cardCode of ['PL!HS-PR-021-PR', 'PL!HS-PR-021-RM']) {
      expect(
        getCardAbilityDefinitions(cardCode).some(
          (ability) => ability.abilityId === HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID
        )
      ).toBe(true);
    }
    for (const cardCode of ['PL!HS-bp6-003-P', 'PL!HS-bp6-003-R']) {
      expect(
        getCardAbilityDefinitions(cardCode).filter((ability) =>
          [
            HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID,
            HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID,
          ].includes(ability.abilityId)
        )
      ).toHaveLength(2);
    }
    for (const cardCode of [
      'PL!HS-bp6-006-R＋',
      'PL!HS-bp6-006-P',
      'PL!HS-bp6-006-P＋',
      'PL!HS-bp6-006-SEC',
    ]) {
      expect(
        getCardAbilityDefinitions(cardCode).filter(
          (ability) =>
            ability.abilityId === HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID
        )
      ).toHaveLength(1);
    }
    for (const cardCode of ['PL!HS-pb1-014-P＋', 'PL!HS-pb1-014-R']) {
      expect(
        getCardAbilityDefinitions(cardCode).filter((ability) =>
          [
            HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID,
            HS_PB1_014_CONTINUOUS_FRONT_HIGH_COST_PINK_HEART_ABILITY_ID,
          ].includes(ability.abilityId)
        )
      ).toHaveLength(2);
    }
    expect(
      getCardAbilityDefinitions('PL!HS-pb1-029-L').filter(
        (ability) =>
          ability.abilityId ===
          HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(
      getCardAbilityDefinitions('PL!HS-bp1-023-L').filter(
        (ability) =>
          ability.abilityId === HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(
      getCardAbilityDefinitions('PL!HS-bp2-014-N').filter(
        (ability) => ability.abilityId === HS_BP2_014_ON_ENTER_DRAW_CANNOT_LIVE_ABILITY_ID
      )
    ).toHaveLength(1);
    for (const cardCode of ['PL!HS-pb1-003-R', 'PL!HS-pb1-003-P＋']) {
      expect(
        getCardAbilityDefinitions(cardCode).filter((ability) =>
          [
            HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID,
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
          ].includes(ability.abilityId)
        )
      ).toHaveLength(2);
    }
    expect(
      getCardAbilityDefinitions('PL!HS-bp1-003-P+').filter((ability) =>
        [
          HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
          HS_BP1_003_CONTINUOUS_THREE_DIFFERENT_HASUNOSORA_SCORE_ABILITY_ID,
        ].includes(ability.abilityId)
      )
    ).toHaveLength(2);
    expect(
      getCardAbilityDefinitions('PL!HS-bp1-002-P').some(
        (ability) =>
          ability.abilityId ===
          HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID
      )
    ).toBe(true);
    expect(
      getCardAbilityDefinitions('PL!HS-bp6-001-R＋').filter((ability) =>
        [
          HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
          HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
        ].includes(ability.abilityId)
      )
    ).toHaveLength(2);

    expect(
      getCardAbilityDefinitions('PL!SP-bp4-008-SEC').filter((ability) =>
        [
          SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
          SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
          SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
        ].includes(ability.abilityId)
      )
    ).toHaveLength(3);
    expect(
      getCardAbilityDefinitions('PL!SP-bp4-011-SEC').filter(
        (ability) =>
          ability.abilityId === SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID
      )
    ).toHaveLength(2);
    expect(
      getCardAbilityDefinitions('PL!SP-sd2-012-SD2').filter(
        (ability) => ability.abilityId === SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(
      getCardAbilityDefinitions('PL!N-bp4-018-N').some(
        (ability) =>
          ability.abilityId === N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID &&
          ability.triggerCondition === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toBe(true);
    expect(
      getCardAbilityDefinitions('PL!-pb1-015-P＋').some(
        (ability) =>
          ability.abilityId === PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID &&
          ability.triggerCondition === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          ability.perTurnLimit === 1
      )
    ).toBe(true);

    expect(
      getCardAbilityDefinitions('PL!N-pb1-004-R').some(
        (ability) => ability.abilityId === KARIN_LIVE_START_ABILITY_ID
      )
    ).toBe(true);
    expect(
      getCardAbilityDefinitions('PL!-bp4-010-N').some(
        (ability) => ability.abilityId === BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(true);

    for (const cardCode of [
      'PL!HS-PR-018-RM',
      'PL!HS-cl1-005-CL',
      'PL!N-bp4-013-N',
      'PL!S-pb1-016-N',
      'PL!S-pb1-017-N',
      'PL!S-pb1-018-N',
      'PL!SP-bp1-006-P',
      'PL!SP-bp2-019-N',
      'PL!SP-bp2-022-N',
    ]) {
      expect(
        getCardAbilityDefinitions(cardCode).some(
          (ability) => ability.abilityId === BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
        )
      ).toBe(true);
    }

    for (const cardCode of ['PL!HS-pb1-012-R', 'PL!HS-pb1-012-P+']) {
      expect(
        getCardAbilityDefinitions(cardCode).some(
          (ability) =>
            ability.abilityId ===
            HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID
        )
      ).toBe(true);
    }
  });

  it('enforces common metadata for queued timing abilities and activated abilities', () => {
    for (const ability of CARD_ABILITY_DEFINITIONS) {
      if (ability.category === CardAbilityCategory.ON_ENTER) {
        expect(ability.sourceZone).toBe(CardAbilitySourceZone.PLAYED_MEMBER);
        expect(ability.triggerCondition).toBe(TriggerCondition.ON_ENTER_STAGE);
        expect(ability.queued).toBe(true);
      }

      if (ability.category === CardAbilityCategory.LIVE_START) {
        expect(ability.triggerCondition).toBe(TriggerCondition.ON_LIVE_START);
        expect(ability.queued).toBe(true);
      }

      if (ability.category === CardAbilityCategory.LIVE_SUCCESS) {
        expect(ability.triggerCondition).toBe(TriggerCondition.ON_LIVE_SUCCESS);
        expect([CardAbilitySourceZone.LIVE_CARD, CardAbilitySourceZone.STAGE_MEMBER]).toContain(
          ability.sourceZone
        );
        expect(ability.queued).toBe(true);
      }

      if (ability.category === CardAbilityCategory.AUTO) {
        expect([CardAbilitySourceZone.STAGE_MEMBER, CardAbilitySourceZone.LIVE_CARD]).toContain(
          ability.sourceZone
        );
        expect(ability.triggerCondition).toBeDefined();
        expect(ability.queued).toBe(true);
      }

      if (ability.category === CardAbilityCategory.ACTIVATED) {
        expect(ability.sourceZone).toBe(CardAbilitySourceZone.STAGE_MEMBER);
        expect(ability.queued).toBe(false);
        expect(ability.activatedUi).toBeTruthy();
      }
    }
  });

  it('uses the registry as the source of truth for activated abilities', () => {
    expect(getActivatedAbilityUiConfig('PL!-sd1-002-SD')?.abilityId).toBe(
      'PL!-sd1-002-SD:activated-send-self-to-waiting-room-add-member'
    );
    expect(
      isSupportedActivatedAbilityForCard(
        'PL!-sd1-005-SD:activated-send-self-to-waiting-room-add-live',
        'PL!-sd1-005-SD'
      )
    ).toBe(true);
    expect(
      isSupportedActivatedAbilityForCard(
        'PL!-sd1-005-SD:activated-send-self-to-waiting-room-add-live',
        'PL!-sd1-002-SD'
      )
    ).toBe(false);
    expect(getActivatedAbilityUiConfig('PL!-pb1-019-N')?.abilityId).toBe(
      PB1_019_ACTIVATED_ABILITY_ID
    );
    expect(getActivatedAbilityUiConfig('PL!-bp4-003-P')?.abilityId).toBe(
      BP4_003_ACTIVATED_ABILITY_ID
    );
    expect(getActivatedAbilityUiConfig('PL!-bp4-003-R')?.abilityId).toBe(
      BP4_003_ACTIVATED_ABILITY_ID
    );
    expect(isSupportedActivatedAbilityForCard(BP4_003_ACTIVATED_ABILITY_ID, 'PL!-bp4-003-R')).toBe(
      true
    );
    expect(getActivatedAbilityUiConfig('PL!HS-bp1-003-SEC')?.abilityId).toBe(
      HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID
    );
    expect(getActivatedAbilityUiConfig('PL!HS-bp1-002-RM')?.abilityId).toBe(
      HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID
    );
    expect(getActivatedAbilityUiConfig('PL!HS-bp5-001-SEC')?.abilityId).toBe(
      HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID
    );
    expect(getActivatedAbilityUiConfig('PL!-PR-017-PR')?.abilityId).toBe(
      PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID
    );
    for (const cardCode of [
      'PL!-bp4-002-P',
      'PL!-bp4-002-P+',
      'PL!-bp4-002-R+',
      'PL!-bp4-002-SEC',
    ]) {
      expect(getActivatedAbilityUiConfig(cardCode)?.abilityId).toBe(
        BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
      );
      expect(
        isSupportedActivatedAbilityForCard(
          BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
          cardCode
        )
      ).toBe(true);
    }
    for (const cardCode of [
      'PL!-bp5-003-AR',
      'PL!-bp5-003-P',
      'PL!-bp5-003-R+',
      'PL!-bp5-003-SEC',
    ]) {
      expect(getActivatedAbilityUiConfig(cardCode)?.abilityId).toBe(
        BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      );
      expect(
        isSupportedActivatedAbilityForCard(
          BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
          cardCode
        )
      ).toBe(true);
    }
    expect(
      isSupportedActivatedAbilityForCard(
        PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
        'PL!-PR-017-PR'
      )
    ).toBe(true);
    expect(
      isSupportedActivatedAbilityForCard(
        HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
        'PL!HS-bp1-002-P'
      )
    ).toBe(true);
    for (const cardCode of [
      'PL!-sd1-005-SD',
      'PL!-sd1-005-RM',
      'PL!-pb1-024-N',
      'PL!HS-PR-026-PR',
      'PL!HS-bp2-004-R',
      'PL!HS-bp2-004-P',
      'PL!HS-sd1-009-SD',
      'PL!N-PR-009-PR',
      'PL!N-PR-009-RM',
      'PL!N-PR-012-PR',
      'PL!N-PR-012-RM',
      'PL!N-PR-014-PR',
      'PL!N-PR-014-RM',
      'PL!N-PR-019-PR',
      'PL!N-sd1-011-SD',
      'PL!S-PR-026-PR',
      'PL!S-bp2-009-R',
      'PL!S-bp2-009-P',
      'PL!S-pb1-004-R',
      'PL!S-pb1-004-P+',
      'PL!S-sd1-015-SD',
      'PL!SP-bp1-011-R',
      'PL!SP-bp1-011-P',
      'PL!SP-pb1-018-N',
      'PL!SP-sd1-006-SD',
      'PL!SP-sd2-010-SD2',
    ]) {
      expect(isSupportedActivatedAbilityForCard(RIN_ACTIVATED_ABILITY_ID, cardCode)).toBe(true);
      expect(getActivatedAbilityUiConfig(cardCode)?.abilityId).toBe(RIN_ACTIVATED_ABILITY_ID);
    }
    for (const cardCode of PB1_019_LIKE_MEMBER_ACTIVATION_CARD_CODES) {
      expect(isSupportedActivatedAbilityForCard(PB1_019_ACTIVATED_ABILITY_ID, cardCode)).toBe(true);
      expect(getActivatedAbilityUiConfig(cardCode)?.abilityId).toBe(PB1_019_ACTIVATED_ABILITY_ID);
    }
    for (const cardCode of ['PL!S-PR-025-RM', 'PL!S-PR-027-RM']) {
      expect(isSupportedActivatedAbilityForCard(PB1_019_ACTIVATED_ABILITY_ID, cardCode)).toBe(true);
      expect(getActivatedAbilityUiConfig(cardCode)?.abilityId).toBe(PB1_019_ACTIVATED_ABILITY_ID);
    }
    expect(isSupportedActivatedAbilityForCard(RIN_ACTIVATED_ABILITY_ID, 'PL!HS-bp2-002-P')).toBe(
      false
    );
  });
});
