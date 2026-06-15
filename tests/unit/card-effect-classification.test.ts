import { describe, expect, it } from 'vitest';
import { SlotPosition, TriggerCondition } from '../../src/shared/types/enums';
import {
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
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
  HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID,
  HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
  HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
  HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
  HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
  HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
  HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
  BP4_003_ACTIVATED_ABILITY_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
  HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
  HS_BP1_003_CONTINUOUS_THREE_DIFFERENT_HASUNOSORA_SCORE_ABILITY_ID,
  HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
  PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
  HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
  HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
  HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
  HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
  HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
  HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
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
  SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
  SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
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
  'PL!HS-cl1-007-CL',
  'PL!HS-pb1-011-R',
  'PL!N-PR-004-PR',
  'PL!N-PR-006-PR',
  'PL!N-PR-013-PR',
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

describe('card effect classification registry', () => {
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

    const bp3TopLive = getCardAbilityDefinitions('PL!-bp3-010-N').find(
      (ability) => ability.abilityId === BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID
    );
    expect(bp3TopLive).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

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
        ability.abilityId ===
        HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID
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
