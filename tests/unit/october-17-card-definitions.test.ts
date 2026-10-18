import { describe, expect, it } from 'vitest';
import * as ids from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';

// Literal expectations checked against the designated October 17 export; tests do not read it.
// The user approved only PL!S-cl1-012's 每种LIVE卡 -> 每张LIVE卡 display correction.
const cards = [
  {
    base: 'PL!-bp8-001',
    abilityId:
      ids.PL_BP8_001_CONTINUOUS_SUCCESS_SCORE_SIX_LOW_SCORE_MUSE_LIVE_REQUIREMENT_ABILITY_ID,
    category: 'CONTINUOUS',
    sourceZone: 'STAGE_MEMBER',
    queued: false,
    effectText:
      '【常时】只要存在于自己的成功LIVE卡区的卡片的分数合计大于等于６，存在于自己的LIVE卡区的原本的分数小于等于４的『μ’s』的LIVE卡的必要HEART减少[無ハート]。',
  },
  {
    base: 'PL!-bp8-008',
    abilityId: ids.PL_BP8_008_LIVE_SUCCESS_DISCARD_RECOVER_MUSE_CHEER_ABILITY_ID,
    category: 'LIVE_SUCCESS',
    sourceZone: 'STAGE_MEMBER',
    queued: true,
    effectText:
      '【LIVE成功时】可以将１张手牌放置入休息室：从因声援被公开的自己的卡片中，将１张『μ’s』的卡片加入手牌。',
  },
  {
    base: 'PL!HS-bp8-010',
    abilityId:
      ids.HS_BP8_010_LIVE_START_DISCARD_HASUNOSORA_COST_TWENTY_FIVE_RECOVER_DOLLCHESTRA_LIVE_ABILITY_ID,
    category: 'LIVE_START',
    sourceZone: 'STAGE_MEMBER',
    queued: true,
    effectText:
      '【LIVE开始时】可以将１张手牌放置入休息室：存在于自己的舞台的『莲之空』的成员的费用合计大于等于２５的场合，从自己的休息室将１张『DOLLCHESTRA』的LIVE卡加入手牌。',
  },
  {
    base: 'PL!N-bp8-007',
    abilityId: ids.N_BP8_007_LIVE_START_ENERGY_BELOW_NIJIGASAKI_COUNT_CHOOSE_HEART_ABILITY_ID,
    category: 'LIVE_START',
    sourceZone: 'STAGE_MEMBER',
    queued: true,
    effectText:
      '【LIVE开始时】选择[桃ハート]或[赤ハート]或[黄ハート]中的１种。LIVE结束时为止，存在于自己的舞台的下方存在能量卡的『虹咲』的成员每有１名，获得１个选择的HEART。',
  },
  {
    base: 'PL!S-cl1-001',
    abilityId: ids.S_CL1_001_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
    category: 'ON_ENTER',
    sourceZone: 'PLAYED_MEMBER',
    queued: true,
    effectText: '【登场】将自己的卡组顶的５张卡片放置入休息室。',
  },
  {
    base: 'PL!S-cl1-003',
    abilityId: ids.S_CL1_003_ACTIVATED_SELF_SACRIFICE_RECOVER_AQOURS_CARD_ABILITY_ID,
    category: 'ACTIVATED',
    sourceZone: 'STAGE_MEMBER',
    queued: false,
    effectText:
      '【起动】将此成员从舞台放置入休息室：从自己的休息室将１张『Aqours』的卡片加入手牌。',
  },
  {
    base: 'PL!S-cl1-004',
    abilityId: ids.S_CL1_004_AUTO_ON_CHEER_TWO_LIVES_WAIT_OPPONENT_ORIGINAL_HEART_FOUR_ABILITY_ID,
    category: 'AUTO',
    sourceZone: 'STAGE_MEMBER',
    queued: true,
    effectText:
      '【自动】【中央】【１回合１次】自己进行声援时，因声援被公开的自己的卡片中存在大于等于２张LIVE卡的场合，将存在于对方的舞台的１名原本持有的HEART的数量小于等于４的成员变为待机状态。',
  },
  {
    base: 'PL!S-cl1-005',
    abilityId: ids.S_CL1_005_LIVE_START_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID,
    category: 'LIVE_START',
    sourceZone: 'STAGE_MEMBER',
    queued: true,
    effectText: '【LIVE开始时】检视自己的卡组顶的卡片，可以将其放置于卡组底。',
  },
  {
    base: 'PL!S-cl1-010',
    abilityId: ids.S_CL1_010_LIVE_START_BOTTOM_GROUPED_AQOURS_LIVES_GAIN_CENTER_BLADE_ABILITY_ID,
    category: 'LIVE_START',
    sourceZone: 'LIVE_CARD',
    queued: true,
    effectText:
      '【LIVE开始时】选择存在于自己休息室的至多１张持有[スコア]的『Aqours』的LIVE卡，和至多１张持有[ALLハート]的『Aqours』的LIVE卡，和至多１张持有[ダブル無色ブレード]的『Aqours』的LIVE卡，按任意顺序放置于卡组底。此后，LIVE结束时为止，每有１张因此放置于卡组底的卡片，存在于自己的中央区域的『Aqours』的成员，获得[ブレード]。',
  },
  {
    base: 'PL!S-cl1-011',
    abilityId: ids.S_CL1_011_LIVE_SUCCESS_COMMON_HEART_AQOURS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
    category: 'LIVE_SUCCESS',
    sourceZone: 'LIVE_CARD',
    queued: true,
    effectText:
      '【LIVE成功时】自己的舞台上存在大于等于３名『Aqours』的成员，且那些成员持有相同颜色的HEART的场合，从因声援被公开的自己的卡片中，将１张持有该颜色的HEART的『Aqours』的成员卡加入手牌。',
  },
  {
    base: 'PL!S-cl1-012',
    abilityId: ids.S_CL1_012_LIVE_START_STACK_SAME_NAME_SUCCESS_AQOURS_LIVES_ABILITY_ID,
    category: 'LIVE_START',
    sourceZone: 'LIVE_CARD',
    queued: true,
    effectText:
      '【LIVE开始时】对于存在于自己的成功LIVE卡区的『Aqours』的每张LIVE卡，从自己的休息室，分别选择至多１张与该卡持有相同卡名的LIVE卡，将它们按任意顺序放置于自己的卡组顶。',
  },
] as const;

describe('October 17 independent card definitions and complete Chinese paragraphs', () => {
  for (const card of cards) {
    it.each(['N', 'R', 'R+', 'P', 'P+', 'SEC', 'CL', 'PR'])(
      `${card.base} covers rarity %s with its independent full paragraph`,
      (rarity) => {
        const definitions = getCardAbilityDefinitionsForCardCode(`${card.base}-${rarity}`);
        expect(definitions).toHaveLength(1);
        const definition = definitions[0];
        expect(definition).toMatchObject({
          abilityId: card.abilityId,
          category: card.category,
          sourceZone: card.sourceZone,
          queued: card.queued,
          implemented: true,
          baseCardCodes: [card.base],
        });
        expect(definition.cardCodes).toBeUndefined();
        expect(definition.effectText).toBe(card.effectText);
        if (card.base === 'PL!S-cl1-003') {
          expect(definition.activatedUi?.abilityId).toBe(card.abilityId);
          expect(definition.activatedUi?.text).toBe(card.effectText);
          expect(definition.perTurnLimit).toBeUndefined();
        } else {
          expect(definition.activatedUi).toBeUndefined();
        }
        if (card.base === 'PL!S-cl1-004') {
          expect(definition.triggerCondition).toBe('ON_CHEER');
          expect(definition.requiredSourceSlots).toEqual(['CENTER']);
          expect(definition.perTurnLimit).toBe(1);
        } else if (card.category === 'ON_ENTER') {
          expect(definition.triggerCondition).toBe('ON_ENTER_STAGE');
        } else if (card.category === 'LIVE_START') {
          expect(definition.triggerCondition).toBe('ON_LIVE_START');
        } else if (card.category === 'LIVE_SUCCESS') {
          expect(definition.triggerCondition).toBe('ON_LIVE_SUCCESS');
        }
      }
    );
  }
  it('uses a distinct runtime identity for every target base card', () => {
    expect(new Set(cards.map((card) => card.abilityId)).size).toBe(11);
  });
});
