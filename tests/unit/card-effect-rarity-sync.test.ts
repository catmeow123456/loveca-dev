import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { CardAbilityDefinition } from '../../src/application/card-effects/ability-definition-types';
import { CARD_ABILITY_DEFINITIONS } from '../../src/application/card-effects/definitions';
import {
  doesCardAbilityDefinitionMatchCardCode,
  getCardAbilityDefinitionsForCardCode,
  getImplementedQueuedAbilityDefinitionsForCardCode,
  type ImplementedQueuedAbilityDefinitionQuery,
} from '../../src/application/card-effects/definitions/lookup';
import { getContinuousLiveModifierVisibilityDeclarations } from '../../src/domain/rules/live-modifiers';
import {
  normalizeCardCode,
  parseCardCode,
  VALID_RARITIES,
  validateCardCode,
} from '../../src/shared/utils/card-code';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const ruleSourceDirectories = ['src/application', 'src/domain', 'src/shared'];

// These print-specific references select a default energy print or a cosmetic presentation.
const printReferencesOutsideCardEffects = new Set([
  'src/domain/card-data/deck-defaults.ts:LL-E-001-SD',
  'src/domain/rules/sealed-box.ts:LL-E-001-SD',
  'src/shared/card-entrance.ts:PL!N-bp7-003-SEC',
]);

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(path.join(repoRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(file);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [file] : [];
  });
}

function isFullCardCodeLiteral(text: string): boolean {
  const parsed = parseCardCode(normalizeCardCode(text));
  if (!parsed || !/^[\w!+]+$/.test(parsed.rarity)) {
    return false;
  }
  // Recognize future print suffixes as well as the rarities known to card-data validation.
  const base = [parsed.prefix, parsed.product, parsed.seq].join('-');
  return validateCardCode(`${base}-${VALID_RARITIES[0]}`).valid;
}

function findPrintReferences(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(path.join(repoRoot, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isStringLiteralLike(node) &&
      isFullCardCodeLiteral(node.text) &&
      !printReferencesOutsideCardEffects.has(`${file}:${node.text}`)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push(`${file}:${line + 1} ${node.text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

describe('card effect rarity synchronization', () => {
  it('registers every ability and continuous modifier by a nonempty list of canonical base codes', () => {
    const declarations = getContinuousLiveModifierVisibilityDeclarations();
    expect(declarations.length).toBeGreaterThan(0);
    const registrations = [
      ...CARD_ABILITY_DEFINITIONS.map((definition) => ({
        label: definition.abilityId,
        binding: definition,
      })),
      ...declarations.map((binding, index) => ({
        label: `continuous modifier #${index + 1}`,
        binding,
      })),
    ];

    const violations: string[] = [];
    for (const { label, binding } of registrations) {
      if (Object.hasOwn(binding, 'cardCodes')) {
        violations.push(`${label} declares cardCodes`);
      }
      const bases = binding.baseCardCodes ?? [];
      if (bases.length === 0) {
        violations.push(`${label} has no baseCardCodes`);
      }
      for (const base of bases) {
        const result = validateCardCode(`${base}-${VALID_RARITIES[0]}`);
        if (!result.valid) {
          violations.push(`${label} has invalid base ${base}: ${result.errors.join(', ')}`);
        }
      }
    }

    expect(violations, 'Card effect registrations must use baseCardCodes for every print.').toEqual(
      []
    );
  });

  it('resolves the complete registered ability list for each rarity of every base code', () => {
    const byBase = new Map<string, CardAbilityDefinition[]>();
    for (const definition of CARD_ABILITY_DEFINITIONS) {
      for (const base of new Set(definition.baseCardCodes)) {
        const group = byBase.get(base) ?? [];
        group.push(definition);
        byBase.set(base, group);
      }
    }

    const unknownRarity = 'FUTURE_RARITY';
    const rarities = new Set([
      ...VALID_RARITIES,
      ...VALID_RARITIES.map((rarity) => rarity.replaceAll('+', '＋')),
    ]);

    expect(byBase.size).toBeGreaterThan(0);
    for (const [base, expected] of byBase) {
      const expectedIds = expected.map((definition) => definition.abilityId);
      const queuedQueries = new Map<
        string,
        { query: ImplementedQueuedAbilityDefinitionQuery; expectedQueuedIds: string[] }
      >();
      for (const definition of expected) {
        const { category, sourceZone, triggerCondition } = definition;
        if (!definition.implemented || !definition.queued || triggerCondition === undefined) {
          continue;
        }
        const key = `${category}:${sourceZone}:${triggerCondition}`;
        const group = queuedQueries.get(key) ?? {
          query: { category, sourceZone, triggerCondition, ignoreRequiredSourceSlots: true },
          expectedQueuedIds: [],
        };
        group.expectedQueuedIds.push(definition.abilityId);
        queuedQueries.set(key, group);
      }
      const unknownPrint = `${base}-${unknownRarity}`;
      // Compare all definitions here to detect matches leaking across different bases.
      for (const cardCode of [base, unknownPrint]) {
        const matches = CARD_ABILITY_DEFINITIONS.filter((definition) =>
          doesCardAbilityDefinitionMatchCardCode(definition, cardCode)
        );
        expect(
          matches.map((definition) => definition.abilityId),
          cardCode
        ).toEqual(expectedIds);
      }
      const cardCodes = [
        base,
        unknownPrint,
        ...Array.from(rarities, (rarity) => `${base}-${rarity}`),
      ];
      for (const cardCode of cardCodes) {
        const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
        expect(
          definitions.map((definition) => definition.abilityId),
          cardCode
        ).toEqual(expectedIds);
        for (const { query, expectedQueuedIds } of queuedQueries.values()) {
          expect(
            getImplementedQueuedAbilityDefinitionsForCardCode(cardCode, query).map(
              (definition) => definition.abilityId
            ),
            `${cardCode} ${query.category} ${query.sourceZone} ${query.triggerCondition}`
          ).toEqual(expectedQueuedIds);
        }
        for (const definition of expected) {
          expect(
            doesCardAbilityDefinitionMatchCardCode(definition, cardCode),
            `${cardCode} should match ${definition.abilityId}`
          ).toBe(true);
        }
      }
    }
  });

  it('keeps complete print codes out of rule implementations', () => {
    const violations = ruleSourceDirectories
      .flatMap(collectTypeScriptFiles)
      .flatMap(findPrintReferences);
    expect(violations, 'Use a base card code when selecting a card effect.').toEqual([]);
  });
});
