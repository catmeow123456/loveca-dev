import { describe, expect, it } from 'vitest';
import { TriggerCondition } from '../../src/shared/types/enums';
import {
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  CARD_ABILITY_DEFINITIONS,
  CardAbilityCategory,
  CardAbilitySourceZone,
  getActivatedAbilityUiConfig,
  getCardAbilityDefinitions,
  HANAYO_ACTIVATED_ABILITY_ID,
  isSupportedActivatedAbilityForCard,
} from '../../src/application/card-effect-runner';

describe('card effect classification registry', () => {
  it('classifies current sample effects by rule timing and source zone', () => {
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
      implemented: false,
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
  });
});
