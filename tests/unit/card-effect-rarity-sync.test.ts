import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CARD_ABILITY_DEFINITIONS,
  getCardAbilityDefinitions,
} from '../../src/application/card-effect-runner';
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
    const cardCodeFamily = loadCardCodeFamilies().get('PL!HS-bp1-007');

    // The card data submodule is optional in focused CI and production checkouts.
    if (!cardCodeFamily) {
      return;
    }

    expect(cardCodeFamily).toEqual([
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
        expect(getBaseCardCode(baseCardCode)).toBe(baseCardCode);
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

  it('registers API-only bp7 cards by base code and resolves every rarity through the same definitions', () => {
    const bp7ExactCardCodes = CARD_ABILITY_DEFINITIONS.flatMap((definition) =>
      (definition.cardCodes ?? []).filter((cardCode) =>
        normalizeCardCode(cardCode).includes('-bp7-')
      )
    );
    expect(bp7ExactCardCodes).toEqual([]);

    const bp7Definitions = CARD_ABILITY_DEFINITIONS.filter((definition) =>
      (definition.baseCardCodes ?? []).some((cardCode) =>
        normalizeCardCode(cardCode).includes('-bp7-')
      )
    );
    expect(bp7Definitions.length).toBeGreaterThan(0);

    const bp7BaseCardCodes = [
      ...new Set(
        bp7Definitions.flatMap((definition) =>
          (definition.baseCardCodes ?? [])
            .map(normalizeCardCode)
            .filter((cardCode) => cardCode.includes('-bp7-'))
        )
      ),
    ];

    for (const baseCardCode of bp7BaseCardCodes) {
      expect(getBaseCardCode(baseCardCode)).toBe(baseCardCode);
      const normalRarityAbilityIds = getCardAbilityDefinitions(`${baseCardCode}-N`).map(
        (definition) => definition.abilityId
      );
      const specialRarityAbilityIds = getCardAbilityDefinitions(`${baseCardCode}-SECL`).map(
        (definition) => definition.abilityId
      );
      expect(normalRarityAbilityIds).toEqual(specialRarityAbilityIds);
      expect(normalRarityAbilityIds.length).toBeGreaterThan(0);
    }
  });
});
