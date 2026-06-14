import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_ABILITY_DEFINITIONS } from '../../src/application/card-effect-runner';
import { getBaseCardCode, normalizeCardCode } from '../../src/shared/utils/card-code';

interface LlocgCardRecord {
  readonly detail?: {
    readonly card_number?: string;
  };
}

function loadCardCodeFamilies(): Map<string, readonly string[]> {
  const cards = JSON.parse(
    readFileSync(new URL('../../llocg_db/json/cards_cn.json', import.meta.url), 'utf8')
  ) as Record<string, LlocgCardRecord>;
  const families = new Map<string, string[]>();

  for (const rawCardCode of Object.keys(cards)) {
    const cardCode = normalizeCardCode(rawCardCode);
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

describe('card effect rarity synchronization', () => {
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
