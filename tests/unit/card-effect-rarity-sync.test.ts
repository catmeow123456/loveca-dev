import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_ABILITY_DEFINITIONS } from '../../src/application/card-effect-runner';
import { getBaseCardCode, normalizeCardCode } from '../../src/shared/utils/card-code';

interface LlocgCardRecord {
  readonly detail?: {
    readonly card_number?: string;
  };
}

function loadCardCodeFamilies(): Map<string, readonly string[]> {
  const cards = {
    ...loadLlocgCards('../../llocg_db/json/cards_cn.json'),
    ...loadLlocgCards('../../llocg_db/json/cards.json'),
  };
  const families = new Map<string, string[]>();

  for (const [rawCardCode, record] of Object.entries(cards)) {
    const sourceCardCode = record.detail?.card_number ?? rawCardCode;
    if (!sourceCardCode) {
      continue;
    }
    const cardCode = normalizeCardCode(sourceCardCode);
    const baseCardCode = getBaseCardCode(cardCode);
    families.set(baseCardCode, [...(families.get(baseCardCode) ?? []), cardCode]);
  }

  return new Map(
    [...families.entries()].map(([baseCardCode, cardCodes]) => [
      baseCardCode,
      [...new Set(cardCodes)].sort(),
    ])
  );
}

function loadLlocgCards(relativePath: string): Record<string, LlocgCardRecord> {
  const url = new URL(relativePath, import.meta.url);
  if (!existsSync(url)) {
    return {};
  }
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, LlocgCardRecord>;
}

describe('card effect rarity synchronization', () => {
  it('covers both PL!HS-bp1-007 rarities through the shared base code', () => {
    const definition = CARD_ABILITY_DEFINITIONS.find(
      (ability) => ability.abilityId === 'PL!SP-bp5-020:activated-pay-two-energy-draw-one'
    );
    expect(definition?.baseCardCodes).toContain('PL!HS-bp1-007');
    expect(loadCardCodeFamilies().get('PL!HS-bp1-007')).toEqual([
      'PL!HS-bp1-007-P',
      'PL!HS-bp1-007-R',
    ]);
  });

  it('does not partially cover same-base multi-rarity cards with exact cardCodes', () => {
    const families = loadCardCodeFamilies();
    const partialExactMatches: string[] = [];

    for (const definition of CARD_ABILITY_DEFINITIONS) {
      const exactCardCodes = new Set((definition.cardCodes ?? []).map(normalizeCardCode));
      const baseCardCodes = new Set((definition.baseCardCodes ?? []).map(normalizeCardCode));

      for (const baseCardCode of baseCardCodes) {
        expect(families.has(baseCardCode)).toBe(true);
      }

      for (const cardCode of exactCardCodes) {
        const baseCardCode = getBaseCardCode(cardCode);
        const siblingCardCodes = families.get(baseCardCode) ?? [];
        const missingSiblingCardCodes = siblingCardCodes.filter(
          (siblingCardCode) => !exactCardCodes.has(siblingCardCode)
        );

        if (
          siblingCardCodes.length > 1 &&
          !baseCardCodes.has(baseCardCode) &&
          missingSiblingCardCodes.length > 0
        ) {
          partialExactMatches.push(
            `${definition.abilityId}: ${cardCode} misses ${missingSiblingCardCodes.join(', ')}`
          );
        }
      }
    }

    expect(partialExactMatches).toEqual([]);
  });
});
