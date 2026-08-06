import { describe, expect, it } from 'vitest';
import {
  N_BP7_013_ON_ENTER_THREE_AZUNA_DRAW_ONE_ABILITY_ID,
  N_BP7_014_AUTO_LEAVE_STAGE_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  N_BP7_015_ACTIVATED_SELF_SACRIFICE_RECOVER_MEMBER_ABILITY_ID,
  N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
  N_BP7_018_ON_ENTER_DISCARD_LOOK_TOP_FIVE_NO_BLADE_NIJIGASAKI_MEMBER_ABILITY_ID,
  N_BP7_021_ACTIVATED_SELF_SACRIFICE_RECOVER_LIVE_ABILITY_ID,
  N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  N_BP7_024_ON_ENTER_THREE_R3BIRTH_GAIN_PINK_HEART_ABILITY_ID,
  N_SD2_003_CONTINUOUS_SUCCESS_NIJIGASAKI_LIVE_COST_MINUS_TWO_ABILITY_ID,
  N_SD2_009_ON_ENTER_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
  N_SD2_011_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  N_SD2_012_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
  N_SD2_014_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
  S_BP7_014_CONTINUOUS_OPPONENT_MORE_ENERGY_GAIN_RED_HEART_ABILITY_ID,
  SP_BP7_018_ON_ENTER_DISCARD_LIVE_LOOK_TOP_FIVE_TAKE_ONE_ABILITY_ID,
  SP_BP7_019_ON_ENTER_THREE_FIVEYNCRISE_RECOVER_LIVE_ABILITY_ID,
  SP_BP7_020_CONTINUOUS_MORE_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
  SP_BP7_021_CONTINUOUS_MORE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  findCardAbilityDefinitionById,
  getCardAbilityDefinitionsForCardCode,
} from '../../src/application/card-effects/definitions/lookup';

const CASES = [
  {
    baseCardCode: 'PL!N-bp7-013',
    abilityId: N_BP7_013_ON_ENTER_THREE_AZUNA_DRAW_ONE_ABILITY_ID,
    effectText: '【登场】自己的舞台上存在3名『A・ZU・NA』的成员的场合，抽1张卡。',
  },
  {
    baseCardCode: 'PL!N-bp7-014',
    abilityId: N_BP7_014_AUTO_LEAVE_STAGE_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    effectText: '【自动】此成员从舞台被放置入休息室时，从自己的休息室将1张『虹咲』的LIVE加入手牌。',
  },
  {
    baseCardCode: 'PL!N-bp7-015',
    abilityId: N_BP7_015_ACTIVATED_SELF_SACRIFICE_RECOVER_MEMBER_ABILITY_ID,
    activated: true,
    effectText: '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。',
  },
  {
    baseCardCode: 'PL!N-bp7-016',
    abilityId: N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
    effectText:
      '【LIVE开始时】可以支付[E]：指定1个任意HEART的颜色。LIVE结束时为止，获得1个指定颜色的HEART。',
  },
  {
    baseCardCode: 'PL!N-bp7-018',
    abilityId: N_BP7_018_ON_ENTER_DISCARD_LOOK_TOP_FIVE_NO_BLADE_NIJIGASAKI_MEMBER_ABILITY_ID,
    effectText:
      '【登场】可以将1张手牌放置入休息室：检视自己的卡组顶的5张卡片。可以从其中将1张不持有BLADE HEART的『虹咲』的成员卡公开并加入手牌。其余的放置入休息室。',
  },
  {
    baseCardCode: 'PL!N-bp7-021',
    abilityId: N_BP7_021_ACTIVATED_SELF_SACRIFICE_RECOVER_LIVE_ABILITY_ID,
    activated: true,
    effectText: '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。',
  },
  {
    baseCardCode: 'PL!N-bp7-023',
    abilityId: N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
    activated: true,
    effectText: '【起动】【1回合1次】将此成员变为待机状态：抽2张卡，将2张手牌放置入休息室。',
  },
  {
    baseCardCode: 'PL!N-bp7-024',
    abilityId: N_BP7_024_ON_ENTER_THREE_R3BIRTH_GAIN_PINK_HEART_ABILITY_ID,
    effectText:
      '【登场】自己的舞台上存在3名『R3BIRTH』的成员的场合，LIVE结束时为止，获得[桃ハート]。',
  },
  {
    baseCardCode: 'PL!N-sd2-003',
    abilityId: N_SD2_003_CONTINUOUS_SUCCESS_NIJIGASAKI_LIVE_COST_MINUS_TWO_ABILITY_ID,
    effectText:
      '【常时】只要自己的成功LIVE卡区存在『虹咲』的卡片，存在于手牌的此成员卡的费用减少2。',
  },
  {
    baseCardCode: 'PL!N-sd2-009',
    abilityId: N_SD2_009_ON_ENTER_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
    effectText:
      '【登场】检视自己的卡组顶的3张卡片。可以将1张其中的『虹咲』的卡片公开并加入手牌。其余的放置入休息室。',
  },
  {
    baseCardCode: 'PL!N-sd2-011',
    abilityId: N_SD2_011_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    effectText: '【登场】可以将1张手牌放置入休息室：从自己的休息室将1张『虹咲』的LIVE卡加入手牌。',
  },
  {
    baseCardCode: 'PL!N-sd2-012',
    abilityId: N_SD2_012_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
    effectText:
      '【登场】可以将1张手牌放置入休息室：检视自己的卡组顶的3张卡，可以将其中的1张『虹咲』的卡片公开并加入手牌。其余的放置入休息室。',
  },
  {
    baseCardCode: 'PL!N-sd2-014',
    abilityId: N_SD2_014_ON_ENTER_DISCARD_LOOK_TOP_THREE_NIJIGASAKI_CARD_ABILITY_ID,
    effectText:
      '【登场】可以将1张手牌放置入休息室：检视自己的卡组顶的3张卡片。可以将其中的1张『虹咲』的卡片公开并加入手牌。其余的放置入休息室。',
  },
  {
    baseCardCode: 'PL!S-bp7-014',
    abilityId: S_BP7_014_CONTINUOUS_OPPONENT_MORE_ENERGY_GAIN_RED_HEART_ABILITY_ID,
    effectText: '【常时】对方的能量比自己多的场合，获得[赤ハート]。',
  },
  {
    baseCardCode: 'PL!SP-bp7-018',
    abilityId: SP_BP7_018_ON_ENTER_DISCARD_LIVE_LOOK_TOP_FIVE_TAKE_ONE_ABILITY_ID,
    effectText:
      '【登场】可以将手牌的1张LIVE卡放置入休息室：检视自己的卡组顶的5张卡片。从其中将1张卡片加入手牌，其余的放置入休息室。',
  },
  {
    baseCardCode: 'PL!SP-bp7-019',
    abilityId: SP_BP7_019_ON_ENTER_THREE_FIVEYNCRISE_RECOVER_LIVE_ABILITY_ID,
    effectText:
      '【登场】自己的舞台上存在大于等于3名『5yncri5e!』的成员的场合，从自己的休息室将1张LIVE卡加入手牌。',
  },
  {
    baseCardCode: 'PL!SP-bp7-020',
    abilityId: SP_BP7_020_CONTINUOUS_MORE_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
    effectText: '【常时】只要自己的能量比对方多，获得[ブレード][ブレード]。',
  },
  {
    baseCardCode: 'PL!SP-bp7-021',
    abilityId: SP_BP7_021_CONTINUOUS_MORE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID,
    effectText: '【常时】只要自己的能量比对方多，获得[紫ハート]。',
  },
] as const;

describe('first-batch definition contracts', () => {
  it.each(CASES)('$baseCardCode uses its complete player-visible text and base coverage', (row) => {
    const definition = findCardAbilityDefinitionById(row.abilityId);
    expect(definition?.baseCardCodes).toEqual([row.baseCardCode]);
    expect(definition?.effectText).toBe(row.effectText);
    expect(definition?.implemented).toBe(true);
    expect(getCardAbilityDefinitionsForCardCode(`${row.baseCardCode}-SEC`)).toContainEqual(
      definition
    );
    if ('activated' in row && row.activated) {
      expect(definition?.activatedUi?.text).toBe(row.effectText);
    } else {
      expect(definition?.activatedUi).toBeUndefined();
    }
  });

  it('records the explicit low-cost waiting-room delegation decisions', () => {
    expect(
      findCardAbilityDefinitionById(N_BP7_013_ON_ENTER_THREE_AZUNA_DRAW_ONE_ABILITY_ID)
        ?.delegatedOnEnterFromWaitingRoomPolicy
    ).toEqual({ decision: 'ALLOW', reason: 'SOURCE_INDEPENDENT' });
    expect(
      findCardAbilityDefinitionById(N_BP7_024_ON_ENTER_THREE_R3BIRTH_GAIN_PINK_HEART_ABILITY_ID)
        ?.delegatedOnEnterFromWaitingRoomPolicy
    ).toEqual({ decision: 'DENY', reason: 'SOURCE_SLOT_REQUIRED' });
  });
});
