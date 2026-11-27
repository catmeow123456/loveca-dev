import { describe, expect, it } from 'vitest';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getActivatedAbilityUiConfigs } from '../../src/application/card-effects/runtime/activated-ability-ui';
import { getBaseCardCode, VALID_RARITIES } from '../../src/shared/utils/card-code';
import { expectMemberPlayAtPrintedCost } from '../helpers/rules-member-play';
import rows from '../fixtures/november-20-draft-effects.json';
import {
  getNovember20MemberData,
  november20SharedPrBases,
} from '../helpers/november-20-draft-effects';

describe.each(rows.filter((row) => row.status === 'DRAFT'))('$cardCode $nameCn', (row) => {
  it('binds every printed paragraph to all rarities and the correct trigger and source', () => {
    const base = getBaseCardCode(row.cardCode);
    const expectedBases = november20SharedPrBases.find((codes) => codes.includes(base)) ?? [base];
    const paragraphs = row.cardTextCn.split('\n\n');
    const timings = new Map([
      [
        '【自动】',
        [
          'AUTO',
          'STAGE_MEMBER',
          base === 'PL!N-PR-038' ? 'ON_LEAVE_STAGE' : 'ON_ENTER_WAITING_ROOM',
        ],
      ],
      ['【LIVE开始时】', ['LIVE_START', 'STAGE_MEMBER', 'ON_LIVE_START']],
      ['【LIVE成功时】', ['LIVE_SUCCESS', 'STAGE_MEMBER', 'ON_LIVE_SUCCESS']],
      ['【登场】', ['ON_ENTER', 'PLAYED_MEMBER', 'ON_ENTER_STAGE']],
    ]);
    for (const code of [base, ...VALID_RARITIES.map((rare) => `${base}-${rare}`), `${base}-P＋`]) {
      const definitions = getCardAbilityDefinitionsForCardCode(code);
      expect(definitions).toHaveLength(paragraphs.length);
      expect(new Set(definitions.map((d) => d.abilityId)).size).toBe(paragraphs.length);
      paragraphs.forEach((paragraph, index) => {
        const tag = paragraph.slice(0, paragraph.indexOf('】') + 1);
        const definition = definitions[index];
        expect([definition.category, definition.sourceZone, definition.triggerCondition]).toEqual(
          timings.get(tag)
        );
        expect(definition).toMatchObject({
          baseCardCodes: expectedBases,
          effectText: paragraph,
          queued: true,
          implemented: true,
        });
        expect(definition.activatedUi).toBeUndefined();
      });
      expect(getActivatedAbilityUiConfigs(code)).toEqual([]);
    }
  });

  it('requires and spends the exported energy cost for an ordinary RULES hand play', () => {
    expectMemberPlayAtPrintedCost(getNovember20MemberData(row.cardCode));
  });
});

it.each(november20SharedPrBases)(
  '%s and %s share the definition for the same printed ability',
  (oldBase, newBase) => {
    const oldCard = getNovember20MemberData(oldBase);
    const newCard = getNovember20MemberData(newBase);
    expect(newCard.cardTextJp).toBe(oldCard.cardTextJp);
    expect(newCard.cardTextCn).toBe(oldCard.cardTextCn);
    const older = getCardAbilityDefinitionsForCardCode(oldCard.cardCode);
    const newer = getCardAbilityDefinitionsForCardCode(newCard.cardCode);
    expect(older).toHaveLength(1);
    expect(newer).toEqual(older);
  }
);
