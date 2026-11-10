import { describe, expect, it } from 'vitest';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory as C,
  CardAbilitySourceZone as Z,
} from '../../src/application/card-effects/ability-definition-types';
import { getActivatedAbilityUiConfigs } from '../../src/application/card-effects/runtime/activated-ability-ui';
import { TriggerCondition as T } from '../../src/shared/types/enums';
import { VALID_RARITIES } from '../../src/shared/utils/card-code';
import rows from '../fixtures/november-10-orange-effects.json';
import { getUnknownCardEffectPlaceholders } from '../../client/src/lib/cardEffectTokens';

const expected = {
  'PL!-ad1-001': [
    [C.ON_ENTER, Z.PLAYED_MEMBER, T.ON_ENTER_STAGE],
    [C.LIVE_START, Z.STAGE_MEMBER, T.ON_LIVE_START],
  ],
  'PL!-ad1-004': [[C.LIVE_SUCCESS, Z.LIVE_CARD, T.ON_LIVE_SUCCESS]],
  'PL!SP-ad1-001': [
    [C.LIVE_START, Z.STAGE_MEMBER, T.ON_LIVE_START],
    [C.AUTO, Z.STAGE_MEMBER, T.ON_CHEER],
  ],
  'PL!-bp8-023': [
    [C.LIVE_START, Z.LIVE_CARD, T.ON_LIVE_START],
    [C.LIVE_SUCCESS, Z.LIVE_CARD, T.ON_LIVE_SUCCESS],
  ],
} as const;

const paragraphs = {
  'PL!-ad1-001': [
    '【登场】可以将１张手牌放置入休息室：从自己的休息室将１张持有[ALLブレード]或[オレンジブレード]的LIVE卡加入手牌。',
    '【LIVE开始时】将存在于自己的休息室的１张持有[オレンジブレード]的卡片放置于自己的卡组顶第５张。',
  ],
  'PL!-ad1-004': [
    '【LIVE成功时】从因声援被公开的自己的卡片中，将１张持有[オレンジブレード]的卡片加入手牌。',
  ],
  'PL!SP-ad1-001': [
    '【LIVE开始时】将１张手牌放置入休息室。因此将成员卡放置入休息室的场合，从自己的休息室将１张LIVE卡加入手牌。因此将LIVE卡放置入休息室的场合，抽１张卡，此后，将因此放置入休息室的卡片放置于自己的卡组顶的第７张卡的位置。',
    '【自动】【１回合１次】自己进行声援时，因声援被公开的自己的卡片中存在持有[オレンジブレード]的卡片的场合，追加进行２张卡片的声援。',
  ],
  'PL!-bp8-023': [
    '【LIVE开始时】LIVE结束时为止，因声援被公开的自己的费用小于等于4的不持有BLADE HEART的成员卡获得[オレンジブレード]。',
    '【LIVE成功时】因声援被公开的自己的卡片中存在大于等于6张持有[オレンジブレード]的卡片的场合，此卡的分数+2。',
  ],
} as const;

describe('November 10 orange-heart card definitions', () => {
  it('preserves all four authorized print records and exact paragraphs with supported tokens', () => {
    expect(Object.keys(rows)).toHaveLength(4);
    for (const [base, texts] of Object.entries(paragraphs)) {
      const row = Object.values(rows).find((r) => r.cardCode.startsWith(`${base}-`))!;
      expect(row.cardTextCn.split('\n\n')).toEqual(texts);
      for (const text of texts) expect(getUnknownCardEffectPlaceholders(text)).toEqual([]);
    }
  });
  it.each(Object.entries(expected))(
    '%s covers every rarity with complete authoritative paragraphs',
    (base, timings) => {
      for (const suffix of ['', ...VALID_RARITIES.map((r) => `-${r}`), '-R＋', '-FUTURE']) {
        const definitions = getCardAbilityDefinitionsForCardCode(`${base}${suffix}`);
        expect(definitions).toHaveLength(timings.length);
        expect(new Set(definitions.map((d) => d.abilityId)).size).toBe(timings.length);
        definitions.forEach((definition, i) => {
          const [category, sourceZone, triggerCondition] = timings[i]!;
          expect(definition).toMatchObject({
            baseCardCodes: [base],
            category,
            sourceZone,
            triggerCondition,
            queued: true,
            implemented: true,
          });
          expect(definition.effectText).toBe(paragraphs[base as keyof typeof paragraphs][i]);
          expect(definition.activatedUi).toBeUndefined();
          if (category === C.AUTO)
            expect(definition).toMatchObject({
              perTurnLimit: 1,
              skipQueueWhenTurnLimitReached: true,
            });
          if (category === C.ON_ENTER)
            expect(definition.delegatedOnEnterFromWaitingRoomPolicy).toEqual({
              decision: 'ALLOW',
              reason: 'SOURCE_INDEPENDENT',
            });
        });
        expect(getActivatedAbilityUiConfigs(`${base}${suffix}`)).toEqual([]);
      }
    }
  );
});
