import { describe, expect, it } from 'vitest';
import {
  N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID,
  N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID,
  N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID,
  N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
  N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
  N_SD2_010_ON_ENTER_DRAW_TWO_ABILITY_ID,
  S_BP7_013_ON_ENTER_CHOOSE_PLAYER_BOTTOM_UP_TO_TWO_WAITING_MEMBERS_ABILITY_ID,
  S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID,
  SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID,
  SP_BP7_016_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
  SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  findCardAbilityDefinitionById,
  getCardAbilityDefinitionsForCardCode,
} from '../../src/application/card-effects/definitions/lookup';
import { TriggerCondition } from '../../src/shared/types/enums';

const CASES = [
  {
    baseCardCode: 'PL!N-bp7-012',
    abilityId: N_BP7_012_LIVE_START_WAIT_NIJIGASAKI_MEMBER_CHOOSE_HEART_ABILITY_ID,
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    effectText:
      '【LIVE开始时】可以将1名『虹咲』的成员变为待机状态：指定1个任意HEART的颜色。LIVE结束时为止，获得1个指定颜色的HEART。',
  },
  {
    baseCardCode: 'PL!N-bp7-017',
    abilityId: N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID,
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    effectText:
      '【登场】可以从自己的能量卡组，将1张能量卡放置于存在于自己的舞台的『虹咲』的成员的下方。',
  },
  {
    baseCardCode: 'PL!N-bp7-020',
    abilityId: N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID,
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    effectText:
      '【登场】将自己的卡组顶的3张卡片放置入休息室。那些成员卡中存在大于等于2种BLADE HEART的颜色的场合，LIVE结束时为止，获得[緑ハート]。',
  },
  {
    baseCardCode: 'PL!N-bp7-022',
    abilityId: N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_MEMBER_STATE_CHANGED,
    perTurnLimit: 1,
    effectText:
      '【自动】【1回合1次】LIVE阶段中，存在于自己的舞台的1名『虹咲』的成员变为待机状态时，可以将1张手牌放置入休息室。如此做时，将该成员变为活跃状态。',
  },
  {
    baseCardCode: 'PL!N-sd2-010',
    abilityId: N_SD2_010_ON_ENTER_DRAW_TWO_ABILITY_ID,
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    effectText: '【登场】抽2张卡。',
  },
  {
    baseCardCode: 'PL!N-sd2-010',
    abilityId: N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_MEMBER_STATE_CHANGED,
    perTurnLimit: 1,
    effectText:
      '【自动】【1回合1次】存在于自己的舞台的1名『虹咲』的成员变为待机状态时，可以将1张手牌放置入休息室。如此做时，将该成员变为活跃状态，LIVE结束时为止，该成员获得[ブレード][ブレード]。',
  },
  {
    baseCardCode: 'PL!S-bp7-013',
    abilityId: S_BP7_013_ON_ENTER_CHOOSE_PLAYER_BOTTOM_UP_TO_TWO_WAITING_MEMBERS_ABILITY_ID,
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    effectText:
      '【登场】选择自己或对方。自己将存在于该玩家的休息室的至多2张成员卡按任意顺序放置于卡组底。',
  },
  {
    baseCardCode: 'PL!S-bp7-018',
    abilityId: S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID,
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    effectText: '【登场】将存在于自己的舞台的1名成员站位变换到中央区域。',
  },
  {
    baseCardCode: 'PL!SP-bp7-015',
    abilityId: SP_BP7_015_LIVE_START_PAY_ENERGY_THREE_CATCHU_DRAW_ONE_ABILITY_ID,
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    effectText: '【LIVE开始时】可以支付[E]：自己的舞台上存在3名『CatChu!』的成员的场合，抽1张卡。',
  },
  {
    baseCardCode: 'PL!SP-bp7-016',
    abilityId: SP_BP7_016_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
    perTurnLimit: 1,
    effectText:
      '【自动】【1回合1次】因为自己的卡片的效果，将能量放置于自己的能量区时，LIVE结束时为止，获得[ブレード]。',
  },
  {
    baseCardCode: 'PL!SP-bp7-017',
    abilityId: SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    effectText:
      '【登场】从自己的能量卡组，将1张能量以待机状态放置于能量区。该能量卡，在下回合的活跃阶段不会变为活跃状态。',
  },
] as const;

describe('second-batch central definition contracts', () => {
  it.each(CASES)('$abilityId uses the full authorized player text and base coverage', (row) => {
    const definition = findCardAbilityDefinitionById(row.abilityId);
    expect(definition).toMatchObject({
      abilityId: row.abilityId,
      baseCardCodes: [row.baseCardCode],
      category: row.category,
      sourceZone: row.sourceZone,
      triggerCondition: row.triggerCondition,
      queued: true,
      implemented: true,
      effectText: row.effectText,
      ...('perTurnLimit' in row ? { perTurnLimit: row.perTurnLimit } : {}),
    });
    expect(definition?.cardCodes).toBeUndefined();
    expect(getCardAbilityDefinitionsForCardCode(`${row.baseCardCode}-UNSEEN`)).toContainEqual(
      definition
    );
  });

  it('splits PL!N-sd2-010 into exactly two independent definitions with numeric text', () => {
    expect(
      getCardAbilityDefinitionsForCardCode('PL!N-sd2-010-SD2').map(
        (definition) => definition.abilityId
      )
    ).toEqual([
      N_SD2_010_ON_ENTER_DRAW_TWO_ABILITY_ID,
      N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID,
    ]);
  });

  it('explicitly allows the low-cost Nijigasaki ON_ENTER source-independent delegation', () => {
    expect(
      findCardAbilityDefinitionById(
        N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID
      )?.delegatedOnEnterFromWaitingRoomPolicy
    ).toEqual({ decision: 'ALLOW', reason: 'SOURCE_INDEPENDENT' });
    expect(
      findCardAbilityDefinitionById(SP_BP7_017_ON_ENTER_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID)
        ?.delegatedOnEnterFromWaitingRoomPolicy
    ).toEqual({ decision: 'ALLOW', reason: 'SOURCE_INDEPENDENT' });
  });

  it('marks the custom member-state observer family as observer-only', () => {
    expect(
      findCardAbilityDefinitionById(
        N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID
      )?.observerOnly
    ).toBe(true);
    expect(
      findCardAbilityDefinitionById(
        N_SD2_010_AUTO_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID
      )?.observerOnly
    ).toBe(true);
  });
});
