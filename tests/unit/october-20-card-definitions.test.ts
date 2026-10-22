import { describe, expect, it } from 'vitest';
import sourceRows from '../fixtures/october-20-on-enter-copy-sources.json';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { VALID_RARITIES } from '../../src/shared/utils/card-code';

const TARGET_BASES = [
  'PL!-bp8-012',
  'PL!N-bp8-004',
  'PL!S-cl1-006',
  'PL!S-cl1-008',
  'PL!S-cl1-009',
  'PL!HS-bp8-003',
  'PL!HS-bp8-004',
  'PL!HS-bp8-013',
  'PL!N-bp8-010',
  'PL!N-bp8-019',
  'PL!N-bp8-026',
  'PL!N-bp8-028',
  'PL!SP-PR-035',
  'PL!HS-PR-043',
  'PL!HS-bp8-012',
  'PL!HS-bp8-017',
  'PL!S-cl1-002',
  'PL!S-cl1-007',
  'PL!SP-PR-034',
] as const;
const rows = Object.values(sourceRows);
function fixture(base: string) {
  const row = rows.find((row) => row.cardCode.startsWith(`${base}-`));
  if (!row) throw new Error(`Missing authoritative target fixture ${base}`);
  return row;
}

describe('October 20 authorized 19 cards / 22 full ability paragraphs', () => {
  it.each(TARGET_BASES)(
    '%s preserves every complete Chinese paragraph and all 27 standard rarities',
    (base) => {
      const row = fixture(base);
      const expected = row.cardTextCn
        .replace(/\r\n/g, '\n')
        .split(/\n\n+/)
        .map((paragraph) => paragraph.trim());
      const native = getCardAbilityDefinitionsForCardCode(row.cardCode);
      expect(native).toHaveLength(expected.length);
      expect(native.map(({ effectText }) => effectText)).toEqual(expected);
      for (const rarity of VALID_RARITIES) {
        const definitions = getCardAbilityDefinitionsForCardCode(`${base}-${rarity}`);
        expect(definitions.map(({ abilityId }) => abilityId)).toEqual(
          native.map(({ abilityId }) => abilityId)
        );
        definitions.forEach((definition, index) => {
          expect(definition.baseCardCodes).toEqual([base]);
          expect(definition.cardCodes).toBeUndefined();
          expect(definition.implemented).toBe(true);
          expect(definition.effectText).toBe(expected[index]);
          if (definition.category === CardAbilityCategory.ACTIVATED) {
            expect(definition.activatedUi?.text).toBe(expected[index]);
            expect(definition.activatedUi?.abilityId).toBe(definition.abilityId);
            expect(definition.queued).toBe(false);
          }
        });
      }
    }
  );
  it('registers 22 distinct abilities with five activated UI paragraphs and the real hand-source boundary', () => {
    const definitions = TARGET_BASES.flatMap((base) =>
      getCardAbilityDefinitionsForCardCode(fixture(base).cardCode)
    );
    expect(definitions).toHaveLength(22);
    expect(new Set(definitions.map(({ abilityId }) => abilityId)).size).toBe(22);
    expect(definitions.filter(({ activatedUi }) => activatedUi)).toHaveLength(5);
    expect(VALID_RARITIES).toHaveLength(27);
    const karin = getCardAbilityDefinitionsForCardCode(fixture('PL!N-bp8-004').cardCode);
    expect(
      karin.map(({ category, sourceZone, queued }) => ({ category, sourceZone, queued }))
    ).toEqual([
      {
        category: CardAbilityCategory.ACTIVATED,
        sourceZone: CardAbilitySourceZone.HAND,
        queued: false,
      },
      {
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: true,
      },
    ]);
  });
});
