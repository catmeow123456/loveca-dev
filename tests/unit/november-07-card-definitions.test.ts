import { describe, expect, it } from 'vitest';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory as C,
  CardAbilitySourceZone as Z,
} from '../../src/application/card-effects/ability-definition-types';
import { getActivatedAbilityUiConfigs } from '../../src/application/card-effects/runtime/activated-ability-ui';
import { TriggerCondition as T } from '../../src/shared/types/enums';
import { VALID_RARITIES } from '../../src/shared/utils/card-code';
import rows from '../fixtures/november-07-draft-effects.json';
import partnerRows from '../fixtures/november-07-regression-partners.json';

const expected = {
  'PL!S-ad2-003': [
    [C.ON_ENTER, Z.PLAYED_MEMBER, T.ON_ENTER_STAGE],
    [C.AUTO, Z.STAGE_MEMBER, T.ON_CHEER],
  ],
  'PL!SP-ad1-003': [
    [C.LIVE_START, Z.LIVE_CARD, T.ON_LIVE_START],
    [C.AUTO, Z.LIVE_CARD, T.ON_CHEER],
  ],
  'PL!-bp8-019': [[C.LIVE_START, Z.LIVE_CARD, T.ON_LIVE_START]],
  'PL!-bp8-024': [[C.LIVE_START, Z.LIVE_CARD, T.ON_LIVE_START]],
  'PL!HS-ad2-004': [[C.LIVE_START, Z.LIVE_CARD, T.ON_LIVE_START]],
  'PL!HS-bp8-019': [
    [C.LIVE_START, Z.LIVE_CARD, T.ON_LIVE_START],
    [C.LIVE_START, Z.LIVE_CARD, T.ON_LIVE_START],
  ],
  'PL!HS-bp8-022': [
    [C.LIVE_START, Z.LIVE_CARD, T.ON_LIVE_START],
    [C.LIVE_SUCCESS, Z.LIVE_CARD, T.ON_LIVE_SUCCESS],
  ],
  'PL!HS-bp8-009': [[C.ON_ENTER, Z.PLAYED_MEMBER, T.ON_ENTER_STAGE]],
  'PL!N-bp8-014': [[C.LIVE_START, Z.STAGE_MEMBER, T.ON_LIVE_START]],
  'PL!N-bp8-016': [[C.ON_ENTER, Z.PLAYED_MEMBER, T.ON_ENTER_STAGE]],
  'PL!N-bp8-024': [[C.AUTO, Z.STAGE_MEMBER, T.ON_LEAVE_STAGE]],
  'PL!N-bp8-027': [[C.LIVE_SUCCESS, Z.LIVE_CARD, T.ON_LIVE_SUCCESS]],
} as const;

describe('November 07 complete authorized card definitions', () => {
  it('preserves the exact authorized paragraphs of the three migrated regression partners', () => {
    for (const [base, paragraph] of [
      ['PL!HS-ad2-001', 1],
      ['PL!N-bp7-019', 0],
      ['PL!SP-bp7-004', 0],
    ] as const) {
      const row = Object.values(partnerRows).find((print) =>
        print.cardCode.startsWith(`${base}-`)
      )!;
      expect(
        getCardAbilityDefinitionsForCardCode(base).some(
          (definition) => definition.effectText === row.cardTextCn.split('\n\n')[paragraph]
        )
      ).toBe(true);
    }
  });
  it('preserves all 13 real print records, including distinct SUNNY DAY SONG requirements', () => {
    expect(Object.keys(rows)).toHaveLength(13);
    expect(rows['PL!-bp8-024-L'].requirements).not.toEqual(rows['PL!-bp8-024-SECL'].requirements);
  });
  it.each(Object.entries(expected))(
    '%s registers each full paragraph for every rarity',
    (base, timings) => {
      const print = Object.values(rows).find((row) => row.cardCode.startsWith(`${base}-`))!;
      const paragraphs = print.cardTextCn.split('\n\n');
      for (const suffix of [
        '',
        ...VALID_RARITIES.map((rarity) => `-${rarity}`),
        '-R＋',
        '-FUTURE',
      ]) {
        const cardCode = `${base}${suffix}`;
        const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
        expect(definitions, cardCode).toHaveLength(timings.length);
        expect(new Set(definitions.map((definition) => definition.abilityId)).size).toBe(
          timings.length
        );
        definitions.forEach((definition, index) => {
          const [category, sourceZone, triggerCondition] = timings[index]!;
          expect(definition).toMatchObject({
            baseCardCodes: [base],
            category,
            sourceZone,
            triggerCondition,
            queued: true,
            implemented: true,
            effectText: paragraphs[index],
          });
          expect(definition.activatedUi).toBeUndefined();
          if (triggerCondition === T.ON_CHEER)
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
        expect(getActivatedAbilityUiConfigs(cardCode)).toEqual([]);
      }
    }
  );
  it('recognizes the three orange-heart cards completed in the November 10 batch', () => {
    for (const base of ['PL!-ad1-001', 'PL!-ad1-004', 'PL!SP-ad1-001'])
      expect(getCardAbilityDefinitionsForCardCode(base).every((definition) => definition.implemented === true)).toBe(true);
  });
});
