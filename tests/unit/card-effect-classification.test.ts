import { describe, expect, it } from 'vitest';
import { SlotPosition, TriggerCondition } from '../../src/shared/types/enums';
import {
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
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
  HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
  HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
  BP4_003_ACTIVATED_ABILITY_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
  HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
  HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  getActivatedAbilityUiConfig,
  getCardAbilityDefinitions,
  RIN_ACTIVATED_ABILITY_ID,
  HANAYO_ACTIVATED_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
  isSupportedActivatedAbilityForCard,
  KARIN_LIVE_START_ABILITY_ID,
  KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
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
      (ability) =>
        ability.abilityId === HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID
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

    const kekeOnEnter = getCardAbilityDefinitions('PL!SP-PR-004-PR').find(
      (ability) => ability.abilityId === KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    expect(kekeOnEnter).toMatchObject({
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });

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
  });

  it('matches implemented abilities by base card code across rarities', () => {
    for (const cardCode of [
      'PL!HS-bp1-004-P+',
      'PL!HS-bp1-004-R+',
      'PL!HS-bp1-004-SEC',
    ]) {
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
        expect(ability.sourceZone).toBe(CardAbilitySourceZone.LIVE_CARD);
        expect(ability.queued).toBe(true);
      }

      if (ability.category === CardAbilityCategory.AUTO) {
        expect(ability.sourceZone).toBe(CardAbilitySourceZone.STAGE_MEMBER);
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
    expect(
      isSupportedActivatedAbilityForCard(BP4_003_ACTIVATED_ABILITY_ID, 'PL!-bp4-003-R')
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
    expect(
      isSupportedActivatedAbilityForCard(
        RIN_ACTIVATED_ABILITY_ID,
        'PL!HS-bp2-002-P'
      )
    ).toBe(false);
  });
});
