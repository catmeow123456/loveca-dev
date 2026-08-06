import { describe, expect, it } from 'vitest';
import {
  S_BP7_011_ACTIVATED_WAIT_SELF_MILL_BOTTOM_TWO_ALL_AQOURS_MEMBERS_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
  S_BP7_012_ON_ENTER_ONLY_AQOURS_OR_SAINT_SNOW_STAGE_FORMATION_CHANGE_SAINT_SNOW_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
  S_BP7_017_ON_ENTER_MILL_BOTTOM_ONE_COST_TEN_MEMBER_GAIN_RED_BLUE_HEART_ABILITY_ID,
  SP_BP7_012_ON_ENTER_BOTTOM_CATCHU_KALEIDOSCORE_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
  SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  findCardAbilityDefinitionById,
  getCardAbilityDefinitionsForCardCode,
} from '../../src/application/card-effects/definitions/lookup';
import { OrientationState, TriggerCondition } from '../../src/shared/types/enums';

const S_BP7_011_TEXT =
  '【起动】【1回合1次】将此成员变为待机状态：将自己的卡组底的2张卡片放置入休息室。那些全部为『Aqours』的成员卡的场合，将此成员变为活跃状态，LIVE结束时为止，获得[ブレード][ブレード]。';
const S_BP7_012_TEXT =
  '【登场】自己的舞台上仅存在『Aqours』或『Saint Snow』的成员的场合，可以进行队列变换。因该效果将『Saint Snow』的成员移动的场合，LIVE结束时为止，获得[ブレード][ブレード]。';
const S_BP7_017_TEXT =
  '【登场】将自己的卡组底的卡片放置入休息室。那张卡片是费用大于等于10的成员卡的场合，LIVE结束时为止，获得[赤ハート][青ハート]。';
const SP_BP7_012_TEXT =
  '【登场】可以从自己的休息室，选择『CatChu!』和『KALEIDOSCORE』和『5yncri5e!』的卡片各1张，将那些卡片按任意顺序放置于卡组底。如此做时，抽1张卡。';
const SP_BP7_022_TEXT =
  '【起动】【1回合1次】将存在于能量区的1张能量放置于能量卡组：将此成员站位变换。(将此成员移动至当前区域以外的区域。该区域存在成员的场合，将该成员移动至此成员曾存在的区域。)';

describe('third-batch central definition contracts', () => {
  it.each([
    {
      baseCardCode: 'PL!S-bp7-011',
      abilityId:
        S_BP7_011_ACTIVATED_WAIT_SELF_MILL_BOTTOM_TWO_ALL_AQOURS_MEMBERS_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
      effectText: S_BP7_011_TEXT,
      title: '将此成员变为待机状态，检查卡组底2张',
      requiredSourceOrientation: OrientationState.ACTIVE,
    },
    {
      baseCardCode: 'PL!SP-bp7-022',
      abilityId: SP_BP7_022_ACTIVATED_RETURN_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      effectText: SP_BP7_022_TEXT,
      title: '将1张能量放回能量卡组，站位变换自身',
      requiredSourceOrientation: undefined,
    },
  ])('$abilityId uses the full activated text and base coverage', (row) => {
    const definition = findCardAbilityDefinitionById(row.abilityId);
    expect(definition).toMatchObject({
      abilityId: row.abilityId,
      baseCardCodes: [row.baseCardCode],
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
      perTurnLimit: 1,
      effectText: row.effectText,
      activatedUi: {
        abilityId: row.abilityId,
        title: row.title,
        text: row.effectText,
      },
    });
    expect(definition?.requiredSourceOrientation).toBe(row.requiredSourceOrientation);
    expect(definition?.cardCodes).toBeUndefined();
    expect(getCardAbilityDefinitionsForCardCode(`${row.baseCardCode}-UNSEEN`)).toContainEqual(
      definition
    );
  });

  it.each([
    {
      baseCardCode: 'PL!S-bp7-012',
      abilityId:
        S_BP7_012_ON_ENTER_ONLY_AQOURS_OR_SAINT_SNOW_STAGE_FORMATION_CHANGE_SAINT_SNOW_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
      effectText: S_BP7_012_TEXT,
      delegation: { decision: 'DENY', reason: 'SOURCE_SLOT_REQUIRED' },
    },
    {
      baseCardCode: 'PL!S-bp7-017',
      abilityId: S_BP7_017_ON_ENTER_MILL_BOTTOM_ONE_COST_TEN_MEMBER_GAIN_RED_BLUE_HEART_ABILITY_ID,
      effectText: S_BP7_017_TEXT,
      delegation: { decision: 'DENY', reason: 'SOURCE_SLOT_REQUIRED' },
    },
    {
      baseCardCode: 'PL!SP-bp7-012',
      abilityId: SP_BP7_012_ON_ENTER_BOTTOM_CATCHU_KALEIDOSCORE_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
      effectText: SP_BP7_012_TEXT,
      delegation: { decision: 'ALLOW', reason: 'SOURCE_INDEPENDENT' },
    },
  ])('$abilityId uses the full queued text and base coverage', (row) => {
    const definition = findCardAbilityDefinitionById(row.abilityId);
    expect(definition).toMatchObject({
      abilityId: row.abilityId,
      baseCardCodes: [row.baseCardCode],
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
      effectText: row.effectText,
      delegatedOnEnterFromWaitingRoomPolicy: row.delegation,
    });
    expect(definition?.cardCodes).toBeUndefined();
    expect(getCardAbilityDefinitionsForCardCode(`${row.baseCardCode}-UNSEEN`)).toContainEqual(
      definition
    );
  });

  it('keeps exactly one independent ability definition per third-batch base card', () => {
    for (const baseCardCode of [
      'PL!S-bp7-011',
      'PL!S-bp7-012',
      'PL!S-bp7-017',
      'PL!SP-bp7-012',
      'PL!SP-bp7-022',
    ]) {
      expect(getCardAbilityDefinitionsForCardCode(`${baseCardCode}-N`)).toHaveLength(1);
    }
  });
});
