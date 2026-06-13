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
  BP4_003_ACTIVATED_ABILITY_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  getActivatedAbilityUiConfig,
  getCardAbilityDefinitions,
  HANAYO_ACTIVATED_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
  isSupportedActivatedAbilityForCard,
  KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
  SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
  SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
  YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
} from '../../src/application/card-effect-runner';

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
      (ability) =>
        ability.abilityId === CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID
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
  });
});
