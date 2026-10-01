import { describe, expect, it } from 'vitest';
import * as ids from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';

// Full Chinese paragraphs from cards_export_2026-09-29.json, reviewed and fixed in this fixture.
const cases = [
  {
    baseCardCode: 'PL!-bp3-019',
    printings: ['PL!-bp3-019-L', 'PL!-bp3-019-SRL'],
    abilities: [
      {
        abilityId: ids.PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'LIVE_CARD',
        triggerCondition: 'ON_LIVE_START',
        effectText: "【LIVE开始时】自己的LIVE中存在大于等于2张『μ's』的卡片的场合，此卡的分数+1。",
      },
    ],
  },
  {
    baseCardCode: 'PL!-bp3-022',
    printings: ['PL!-bp3-022-L', 'PL!-bp3-022-SECL', 'PL!-bp3-022-SRL'],
    abilities: [
      {
        abilityId: ids.PL_BP3_022_LIVE_START_REVEAL_PER_STAGE_MEMBER_GAIN_LIVE_SCORE_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'LIVE_CARD',
        triggerCondition: 'ON_LIVE_START',
        effectText:
          '【LIVE开始时】从自己的卡组顶，每有1名存在于舞台的成员，公开1张卡片。其中每有1张LIVE卡，此卡的分数+1。之后，将因此公开的卡片放置入休息室。',
      },
    ],
  },
  {
    baseCardCode: 'PL!-bp3-023',
    printings: ['PL!-bp3-023-L', 'PL!-bp3-023-SRL'],
    abilities: [
      {
        abilityId: ids.PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'LIVE_CARD',
        triggerCondition: 'ON_LIVE_START',
        effectText:
          '【LIVE开始时】存在于自己的舞台的成员持有的[ブレード]的合计大于等于10的场合、使此卡成功的必要HEART减少[無ハート][無ハート]。',
      },
    ],
  },
  {
    baseCardCode: 'PL!-bp3-024',
    printings: ['PL!-bp3-024-L', 'PL!-bp3-024-SRL'],
    abilities: [
      {
        abilityId: ids.PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'LIVE_CARD',
        triggerCondition: 'ON_LIVE_START',
        effectText:
          "【LIVE开始时】自己的成功LIVE卡区存在卡片的场合，选择[桃ハート]或[黄ハート]或[紫ハート]中的1种。LIVE结束时为止，存在于自己的舞台的1名『μ's』的成员，获得1个选择了的HEART。",
      },
      {
        abilityId: ids.PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'LIVE_CARD',
        triggerCondition: 'ON_LIVE_START',
        effectText: '【LIVE开始时】自己的成功LIVE卡区存在大于等于2张的场合，此卡的分数+1。',
      },
    ],
  },
  {
    baseCardCode: 'PL!-bp3-025',
    printings: ['PL!-bp3-025-L', 'PL!-bp3-025-SRL'],
    abilities: [
      {
        abilityId: ids.PL_BP3_025_LIVE_SUCCESS_NO_REMAINING_HEART_THIS_LIVE_SCORE_ABILITY_ID,
        category: 'LIVE_SUCCESS',
        sourceZone: 'LIVE_CARD',
        triggerCondition: 'ON_LIVE_SUCCESS',
        effectText: '【LIVE成功时】此回合中，自己没有剩余HEART的场合，此卡的分数+1。',
      },
    ],
  },
  {
    baseCardCode: 'PL!-bp4-021',
    printings: ['PL!-bp4-021-L', 'PL!-bp4-021-SRL'],
    abilities: [
      {
        abilityId: ids.BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'LIVE_CARD',
        triggerCondition: 'ON_LIVE_START',
        effectText:
          '【LIVE开始时】存在于自己的成功LIVE卡区的卡片的分数合计大于等于6的场合，使此卡成功的必要HEART减少[無ハート]。分数合计大于等于9的场合，此卡的分数再+1。',
      },
    ],
  },
  {
    baseCardCode: 'PL!-bp5-021',
    printings: ['PL!-bp5-021-L', 'PL!-bp5-021-SRL'],
    abilities: [
      {
        abilityId: ids.PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'LIVE_CARD',
        triggerCondition: 'ON_LIVE_START',
        effectText:
          "【LIVE开始时】自己的舞台中存在大于等于1名成员的场合，自己与对方抽1张卡，将1张手牌放置入休息室。大于等于2名的场合，再使存在于自己的舞台的1名『μ's』的成员，LIVE结束时为止，获得[黄ハート]。大于等于3名，且名称互不相同的场合，再使此卡的分数+1。",
      },
    ],
  },
  {
    baseCardCode: 'PL!-pb2-021',
    printings: ['PL!-pb2-021-N'],
    abilities: [
      {
        abilityId: ids.PL_PB2_021_AUTO_SELF_WAITED_ACTIVATE_GAIN_BLADE_ABILITY_ID,
        category: 'AUTO',
        sourceZone: 'STAGE_MEMBER',
        triggerCondition: 'ON_MEMBER_STATE_CHANGED',
        effectText:
          '【自动】【1回合1次】此成员，因自己的卡片的费用，或因自己的卡片的能力变为待机状态时，将此成员变为活跃状态，LIVE结束时为止，获得[ブレード]。',
      },
    ],
  },
  {
    baseCardCode: 'PL!-pb2-029',
    printings: ['PL!-pb2-029-N'],
    abilities: [
      {
        abilityId: ids.PL_PB2_029_ON_ENTER_ONLY_MUSE_WAIT_LOW_ORIGINAL_BLADE_ABILITY_ID,
        category: 'ON_ENTER',
        sourceZone: 'PLAYED_MEMBER',
        triggerCondition: 'ON_ENTER_STAGE',
        effectText:
          "【登场】/【LIVE开始时】自己的舞台上仅存在『μ's』的成员的场合，将存在于对方的舞台的1名原本持有的[ブレード]的数量小于等于2的成员变为待机状态。（待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。）",
      },
      {
        abilityId: ids.PL_PB2_029_LIVE_START_ONLY_MUSE_WAIT_LOW_ORIGINAL_BLADE_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'STAGE_MEMBER',
        triggerCondition: 'ON_LIVE_START',
        effectText:
          "【登场】/【LIVE开始时】自己的舞台上仅存在『μ's』的成员的场合，将存在于对方的舞台的1名原本持有的[ブレード]的数量小于等于2的成员变为待机状态。（待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。）",
      },
    ],
  },
  {
    baseCardCode: 'PL!N-PR-036',
    printings: ['PL!N-PR-036-PR'],
    abilities: [
      {
        abilityId: ids.N_PR_036_LIVE_START_OTHER_NIJIGASAKI_YELLOW_HEART_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'STAGE_MEMBER',
        triggerCondition: 'ON_LIVE_START',
        effectText:
          '【LIVE开始时】LIVE结束时为止，存在于自己的舞台的1名其他的『虹咲』的成员获得[黄ハート]。该成员的费用大于等于15的场合，再获得[黄ハート]。',
      },
    ],
  },
  {
    baseCardCode: 'PL!S-PR-046',
    printings: ['PL!S-PR-046-PR'],
    abilities: [
      {
        abilityId: ids.S_PR_046_LIVE_SUCCESS_OPPONENT_CHEER_LIVE_DRAW_ONE_ABILITY_ID,
        category: 'LIVE_SUCCESS',
        sourceZone: 'STAGE_MEMBER',
        triggerCondition: 'ON_LIVE_SUCCESS',
        effectText: '【LIVE成功时】因声援被公开的对方的卡片中存在LIVE卡的场合，抽1张卡。',
      },
    ],
  },
  {
    baseCardCode: 'PL!S-PR-047',
    printings: ['PL!S-PR-047-PR'],
    abilities: [
      {
        abilityId: ids.PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
        category: 'AUTO',
        sourceZone: 'STAGE_MEMBER',
        triggerCondition: 'ON_LEAVE_STAGE',
        effectText:
          '【自动】此成员从舞台被放置入休息室时，此成员曾与费用大于等于9的成员换手的场合，LIVE结束时为止，该换手登场的成员获得[ブレード][ブレード]。',
      },
    ],
  },
  {
    baseCardCode: 'PL!S-PR-048',
    printings: ['PL!S-PR-048-PR'],
    abilities: [
      {
        abilityId: ids.PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID,
        category: 'LIVE_START',
        sourceZone: 'STAGE_MEMBER',
        triggerCondition: 'ON_LIVE_START',
        effectText:
          '【LIVE开始时】存在于自己的休息室的卡片小于等于9张的场合，选择存在于自己的休息室的至多3张LIVE卡，按任意顺序放置于自己的卡组顶。',
      },
    ],
  },
] as const;

describe('September 29 approved card definitions and export text', () => {
  it.each(cases)('$baseCardCode covers each export printing and future rarity', (cardCase) => {
    for (const cardCode of [...cardCase.printings, `${cardCase.baseCardCode}-FUTURE`]) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toHaveLength(cardCase.abilities.length);
      expect(new Set(definitions.map((definition) => definition.abilityId)).size).toBe(
        definitions.length
      );
      for (const expected of cardCase.abilities) {
        const definition = definitions.find(
          (candidate) => candidate.abilityId === expected.abilityId
        );
        expect(definition).toMatchObject({ ...expected, queued: true, implemented: true });
        expect(definition?.baseCardCodes).toContain(cardCase.baseCardCode);
        expect(definition?.cardCodes).toBeUndefined();
        expect(definition?.effectText).toBe(expected.effectText);
        expect(definition?.activatedUi).toBeUndefined();
      }
    }
  });

  it('keeps self-waited Kotori observer-only and once per turn', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!-pb2-021-N')[0]).toMatchObject({
      observerOnly: true,
      perTurnLimit: 1,
      skipQueueWhenTurnLimitReached: true,
    });
  });

  it('does not attach the old speculative PR abilities to adjacent cards', () => {
    const idsFor = (code: string) =>
      getCardAbilityDefinitionsForCardCode(code).map((definition) => definition.abilityId);
    expect(idsFor('PL!S-PR-046-PR')).not.toContain(
      ids.PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID
    );
    expect(idsFor('PL!S-PR-047-PR')).not.toContain(
      ids.PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID
    );
  });
});
