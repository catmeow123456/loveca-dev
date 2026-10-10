import { describe, expect, it } from 'vitest';
import * as ids from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';

// Full ability paragraphs independently checked against cards_export_2026-10-07.json.
const cards = [
  {
    base: 'PL!-bp8-013',
    abilities: [
      {
        abilityId: ids.PL_BP8_013_CONTINUOUS_CARD_EFFECT_SUCCESS_LIVE_SCORE_PLUS_TWO_ABILITY_ID,
        category: 'CONTINUOUS',
        sourceZone: 'STAGE_MEMBER',
        queued: false,
        effectText:
          '【常时】因自己的卡片的效果参照存在于成功LIVE卡区的LIVE的卡的分数的合计值时，只要自己的成功LIVE卡区存在卡片，该合计值+２。',
      },
    ],
  },
  {
    base: 'PL!HS-bp8-005',
    abilities: [
      {
        abilityId: ids.HS_BP8_005_PLAY_REQUIRES_OTHER_DOLLCHESTRA_ABILITY_ID,
        category: 'CONTINUOUS',
        sourceZone: 'HAND',
        queued: false,
        effectText: '【常时】只要自己的舞台上不存在『DOLLCHESTRA』的成员，无法打出此卡。',
      },
      {
        abilityId: ids.HS_BP8_005_NO_OTHER_DOLLCHESTRA_SEND_SELF_ABILITY_ID,
        category: 'AUTO',
        sourceZone: 'STAGE_MEMBER',
        queued: true,
        observerOnly: true,
        effectText:
          '【自动】自己的舞台上不存在其他的『DOLLCHESTRA』的成员时，将此成员放置入休息室。',
      },
    ],
  },
  {
    base: 'PL!N-bp8-011',
    abilities: [
      {
        abilityId: ids.N_BP8_011_DECK_REFRESH_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
        category: 'AUTO',
        sourceZone: 'STAGE_MEMBER',
        queued: true,
        triggerCondition: 'ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK',
        waitingRoomToMainDeckCause: 'REFRESH',
        perTurnLimit: 1,
        skipQueueWhenTurnLimitReached: true,
        effectText:
          '【自动】【１回合１次】自己的卡组更新时，抽２张卡，将１张手牌放置入休息室。',
      },
      {
        abilityId: ids.N_BP8_011_LIVE_SUCCESS_OPTIONAL_MILL_TOP_FIVE_ABILITY_ID,
        category: 'LIVE_SUCCESS',
        sourceZone: 'STAGE_MEMBER',
        queued: true,
        triggerCondition: 'ON_LIVE_SUCCESS',
        effectText: '【LIVE成功时】可以将自己的卡组顶的５张卡片放置入休息室。',
      },
    ],
  },
] as const;

describe('October 7 new member definitions and full Chinese paragraphs', () => {
  it.each(['AR', 'P', 'R'])('preserves the repaired 4-cost Kosuzu full paragraph for %s', (rarity) => {
    const definitions = getCardAbilityDefinitionsForCardCode(`PL!HS-bp5-005-${rarity}`);
    expect(definitions).toHaveLength(1);
    expect(definitions[0].effectText).toBe(
      '【LIVE开始时】可以将1张手牌的『DOLLCHESTRA』的卡片放置入休息室：选择存在于自己的舞台的1名『DOLLCHESTRA』的成员。LIVE结束时为止，此成员的费用等于选择的成员原本持有的费用减少1。此卡的费用因此变为大于等于10的场合，LIVE结束时为止，获得[青ハート]。'
    );
  });
  for (const card of cards) {
    it.each(['N', 'P', 'R+', 'P+', 'SEC'])(`${card.base} covers rarity %s`, (rarity) => {
      const definitions = getCardAbilityDefinitionsForCardCode(`${card.base}-${rarity}`);
      expect(definitions).toHaveLength(card.abilities.length);
      for (const expected of card.abilities) {
        const definition = definitions.find((item) => item.abilityId === expected.abilityId);
        expect(definition).toMatchObject({
          ...expected,
          implemented: true,
          baseCardCodes: [card.base],
        });
        expect(definition?.cardCodes).toBeUndefined();
        expect(definition?.activatedUi).toBeUndefined();
      }
    });
  }
});
