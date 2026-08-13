import { describe, expect, it } from 'vitest';
import {
  N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID,
  N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID,
  PL_BP8_005_LIVE_START_CHEER_HEART_COLORS_TO_YELLOW_ABILITY_ID,
  PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
  PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID,
  S_BP7_022_LIVE_SUCCESS_DISTINCT_AQOURS_RED_GREEN_BLUE_CHEER_SCORE_ABILITY_ID,
  SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';

function getEffectText(cardCode: string, abilityId: string): string | undefined {
  return getCardAbilityDefinitionsForCardCode(cardCode).find(
    (definition) => definition.abilityId === abilityId
  )?.effectText;
}

describe('BLADE HEART player-visible card effect texts', () => {
  it('uses the exported PL!N-bp3-030 ALL BLADE HEART text', () => {
    expect(
      getEffectText(
        'PL!N-bp3-030-L',
        PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(
      '【LIVE成功时】因声援被公开的自己的卡片中持有[ALLブレード]的卡片大于等于1张的场合，此卡的分数+1。'
    );
  });

  it('uses the exported PL!N-bp5-001 seven-type BLADE HEART text', () => {
    expect(
      getEffectText(
        'PL!N-bp5-001-P',
        N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID
      )
    ).toBe(
      '【自动】【1回合1次】自己进行声援时，因声援被公开的自己的卡片中持有的BLADE HEART中的[桃ブレード]，[赤ブレード]，[黄ブレード]，[緑ブレード]，[青ブレード]，[紫ブレード]，[ALLブレード]之中，存在大于等于3种的场合，LIVE结束时为止，获得[桃ハート]。存在大于等于6种的场合，LIVE结束时为止，再获得「【常时】LIVE的合计分数+1。」。'
    );
  });

  it('uses the exported PL!N-bp7-025 six-color BLADE HEART text', () => {
    expect(
      getEffectText(
        'PL!N-bp7-025-SECL',
        N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID
      )
    ).toBe(
      '【LIVE成功时】因声援被公开的自己的卡片中，存在[桃ブレード]、[赤ブレード]、[黄ブレード]、[緑ブレード]、[青ブレード]、[紫ブレード]中大于等于3种的场合，此卡的分数+1。'
    );
  });

  it('uses the exported PL!S-bp7-022 three-color BLADE HEART text', () => {
    expect(
      getEffectText(
        'PL!S-bp7-022-SECL',
        S_BP7_022_LIVE_SUCCESS_DISTINCT_AQOURS_RED_GREEN_BLUE_CHEER_SCORE_ABILITY_ID
      )
    ).toBe(
      '【LIVE成功时】因声援被公开的自己的卡片中，分别存在持有[赤ブレード]、[緑ブレード]、[青ブレード]的『Aqours』的成员的场合，此卡的分数+1。'
    );
  });

  it('uses the exported PL!SP-bp4-023 purple replacement BLADE HEART text', () => {
    expect(
      getEffectText(
        'PL!SP-bp4-023-L',
        SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID
      )
    ).toBe(
      '【LIVE开始时】LIVE结束时为止，因声援被公开的自己的卡片持有的[桃ブレード]，[赤ブレード]，[黄ブレード]，[緑ブレード]，[青ブレード]，[ALLブレード]，全部变为[紫ブレード]。'
    );
  });

  it('uses the exported PL!N-bp4-025 blue replacement BLADE HEART text', () => {
    expect(
      getEffectText('PL!N-bp4-025-L', PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID)
    ).toBe(
      '【LIVE开始时】LIVE结束时为止，因声援被公开的自己的卡片持有的[桃ブレード]，[赤ブレード]，[黄ブレード]，[緑ブレード]，[紫ブレード]，[ALLブレード]，全部变为[青ブレード]。'
    );
  });

  it('uses the exported PL!-bp8-005 yellow replacement BLADE HEART text', () => {
    expect(
      getEffectText('PL!-bp8-005-P', PL_BP8_005_LIVE_START_CHEER_HEART_COLORS_TO_YELLOW_ABILITY_ID)
    ).toBe(
      '【LIVE开始时】LIVE结束时为止，因声援被公开的自己的卡片持有的[桃ブレード]、[赤ブレード]、[緑ブレード]、[青ブレード]、[紫ブレード]、[ALLブレード]，全部变为[黄ブレード]。'
    );
  });

  it('uses the exported PL!-pb2-001 ALL BLADE condition and ALL Heart reward text', () => {
    expect(
      getEffectText('PL!-pb2-001-R', PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID)
    ).toBe(
      '【LIVE开始时】存在于自己的成功LIVE卡区的『μ’s』的卡片中，存在持有[スコア]的卡片的场合，LIVE结束时为止，获得「【常时】LIVE的合计分数+1。」。存在持有[ALLブレード]的卡片的场合，LIVE结束时为止，获得[ALLハート]。存在持有[ドロー]的卡片的场合，从自己的休息室将1张『μ’s』的卡片加入手牌。'
    );
  });
});
