import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as yaml from 'yaml';
import { getCardAbilityDefinitions } from '../../src/application/card-effect-runner';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { queryActivatedAbilityPreflight } from '../../src/application/card-effects/runtime/activated-registry';
import { DeckConfigSchema } from '../../src/domain/card-data/deck-loader';
import { createGameState } from '../../src/domain/entities/game';
import { getBaseCardCode, normalizeCardCode } from '../../src/shared/utils/card-code';
import { AI_BATTLE_PHASE_ZERO_ABILITY_EVIDENCE } from '../../src/server/ai-battle/phase-zero-ability-evidence';
import { AI_BATTLE_PHASE_ZERO_DECKS } from '../../src/server/ai-battle/phase-zero-baseline';

interface CardDatabaseRecord {
  readonly card_no?: string;
  readonly ability?: string;
  readonly type?: string;
  readonly detail?: {
    readonly card_number?: string;
    readonly ability?: string;
  };
}

interface AuthoritativeCardRecord {
  readonly sourceCardCode: string;
  readonly card: CardDatabaseRecord;
}

const authoritativeCardsByBaseCode = loadAuthoritativeCardDatabase();
const cardEffectLedger = readFileSync(
  'docs/card-effect-reuse-audit/existing_module_map.md',
  'utf8'
);

const CATEGORY_BY_JAPANESE_MARKER = new Map<string, CardAbilityCategory>([
  ['登場', CardAbilityCategory.ON_ENTER],
  ['常時', CardAbilityCategory.CONTINUOUS],
  ['起動', CardAbilityCategory.ACTIVATED],
  ['ライブ開始時', CardAbilityCategory.LIVE_START],
  ['ライブ成功時', CardAbilityCategory.LIVE_SUCCESS],
  ['自動', CardAbilityCategory.AUTO],
]);
const evidenceByAbilityKey = new Map(
  AI_BATTLE_PHASE_ZERO_ABILITY_EVIDENCE.map((entry) => [
    abilityEvidenceKey(entry.baseCardCode, entry.abilityId),
    entry,
  ])
);

describe('AI battle Phase 0 card-effect certification', () => {
  it.each(Object.values(AI_BATTLE_PHASE_ZERO_DECKS))(
    'matches every authoritative ability segment to an implemented definition in $deckKey',
    ({ sourceAssetPath }) => {
      const deck = DeckConfigSchema.parse(yaml.parse(readFileSync(sourceAssetPath, 'utf8')));
      const entries = [...deck.main_deck.members, ...deck.main_deck.lives];

      for (const entry of entries) {
        const cardCode = normalizeCardCode(entry.card_code);
        const baseCardCode = getBaseCardCode(cardCode);
        const cards = authoritativeCardsByBaseCode.get(baseCardCode);
        expect(
          cards,
          `${cardCode} must exist in the authoritative Japanese card database`
        ).toBeDefined();
        const exactCard = cards?.find((candidate) => candidate.sourceCardCode === cardCode);
        expect(
          exactCard,
          `${cardCode} exact printed card must exist in the authoritative Japanese card database`
        ).toBeDefined();
        const card = exactCard?.card;
        expect(
          new Set(
            cards?.map((candidate) => normalizeAuthoritativeAbilityText(candidate.card.ability))
          ).size,
          `${baseCardCode} authoritative rarities must share the complete ability text`
        ).toBe(1);

        const abilityText = card?.ability?.trim() ?? '';
        if (abilityText.length === 0 || abilityText === '-') {
          expect(getCardAbilityDefinitions(cardCode)).toHaveLength(0);
          continue;
        }

        const definitions = getCardAbilityDefinitions(cardCode);
        const expectedCategories = extractAbilityCategories(abilityText);
        const actualCategories = definitions.map((definition) => definition.category);
        const sameBaseProbeDefinitions = getCardAbilityDefinitions(`${baseCardCode}-AR`);

        expect(
          sortCategories(actualCategories),
          `${cardCode} must register every card-text segment`
        ).toEqual(sortCategories(expectedCategories));
        expect(
          sameBaseProbeDefinitions.map((definition) => definition.abilityId).sort(),
          `${baseCardCode} must automatically cover a newly observed same-base rarity`
        ).toEqual(definitions.map((definition) => definition.abilityId).sort());
        for (const definition of definitions) {
          expect(definition.implemented, `${definition.abilityId} must be implemented`).toBe(true);
          expect(
            definition.effectText.trim(),
            `${definition.abilityId} must retain non-empty player-facing effect text`
          ).not.toBe('');
          expect(
            definition.cardCodes,
            `${definition.abilityId} must not narrow same-base rarity coverage`
          ).toBeUndefined();
          expect(
            definition.baseCardCodes,
            `${definition.abilityId} must cover ${baseCardCode} by base card code`
          ).toContain(baseCardCode);
          assertDefinitionWindowMetadata(definition, card?.type);

          const evidence = evidenceByAbilityKey.get(
            abilityEvidenceKey(baseCardCode, definition.abilityId)
          );
          expect(
            evidence,
            `${baseCardCode} ${definition.abilityId} must bind behavior-test evidence`
          ).toBeDefined();
          expect(evidence?.behaviorTests.length).toBeGreaterThan(0);
          let hasDirectBehaviorAnchor = false;
          for (const testPath of evidence?.behaviorTests ?? []) {
            expect(
              existsSync(testPath),
              `${definition.abilityId} evidence must exist: ${testPath}`
            ).toBe(true);
            const testSource = readFileSync(testPath, 'utf8');
            hasDirectBehaviorAnchor ||= [baseCardCode, definition.abilityId].some((anchor) =>
              testSource.includes(anchor)
            );
          }
          expect(
            hasDirectBehaviorAnchor,
            `${baseCardCode} ${definition.abilityId} evidence must directly name the card base or ability`
          ).toBe(true);
        }
        assertPrintedRestrictions(definitions, abilityText);

        const ledgerLine = findExactLedgerLine(baseCardCode);
        expect(
          ledgerLine,
          `${baseCardCode} must be present in the main card-effect ledger`
        ).toBeDefined();
        expect(
          ledgerLine,
          `${baseCardCode} must be certified complete or same-family complete in the main ledger`
        ).toMatch(/(?:完整已实现|同型已实现)/);
      }
    }
  );

  it('keeps the ability evidence manifest exact and free of stale entries', () => {
    const expectedKeys = new Set<string>();
    for (const { sourceAssetPath } of Object.values(AI_BATTLE_PHASE_ZERO_DECKS)) {
      const deck = DeckConfigSchema.parse(yaml.parse(readFileSync(sourceAssetPath, 'utf8')));
      for (const entry of [...deck.main_deck.members, ...deck.main_deck.lives]) {
        const cardCode = normalizeCardCode(entry.card_code);
        const baseCardCode = getBaseCardCode(cardCode);
        for (const definition of getCardAbilityDefinitions(cardCode)) {
          expectedKeys.add(abilityEvidenceKey(baseCardCode, definition.abilityId));
        }
      }
    }

    const evidenceKeys = AI_BATTLE_PHASE_ZERO_ABILITY_EVIDENCE.map((entry) =>
      abilityEvidenceKey(entry.baseCardCode, entry.abilityId)
    );
    expect(new Set(evidenceKeys).size, 'ability evidence keys must be unique').toBe(
      evidenceKeys.length
    );
    expect([...new Set(evidenceKeys)].sort()).toEqual([...expectedKeys].sort());
  });

  it('registers a read-only preflight for every activated ability in the certified decks', () => {
    const probeState = createGameState(
      'ai-preflight-registration',
      'player-1',
      'Player 1',
      'player-2',
      'Player 2'
    );
    const activatedAbilityIds = new Set(
      AI_BATTLE_PHASE_ZERO_ABILITY_EVIDENCE.flatMap((entry) =>
        getCardAbilityDefinitions(entry.baseCardCode).some(
          (definition) =>
            definition.abilityId === entry.abilityId &&
            definition.category === CardAbilityCategory.ACTIVATED
        )
          ? [entry.abilityId]
          : []
      )
    );

    expect(activatedAbilityIds.size).toBeGreaterThan(0);
    for (const abilityId of activatedAbilityIds) {
      expect(
        queryActivatedAbilityPreflight(probeState, 'player-1', 'missing-source', abilityId),
        abilityId
      ).toMatchObject({ status: 'REGISTERED' });
    }
  });
});

function loadAuthoritativeCardDatabase(): Map<string, AuthoritativeCardRecord[]> {
  const records = JSON.parse(readFileSync('llocg_db/json/cards.json', 'utf8')) as Record<
    string,
    CardDatabaseRecord
  >;
  const normalized = new Map<string, AuthoritativeCardRecord[]>();

  for (const [sourceKey, record] of Object.entries(records)) {
    const sourceCardCode = normalizeCardCode(record.card_no ?? sourceKey);
    const baseCardCode = getBaseCardCode(sourceCardCode);
    const existing = normalized.get(baseCardCode) ?? [];
    existing.push({ sourceCardCode, card: record });
    normalized.set(baseCardCode, existing);
  }

  return normalized;
}

function extractAbilityCategories(abilityText: string): CardAbilityCategory[] {
  const categories: CardAbilityCategory[] = [];
  const markerPattern = /(?:^|\n)\{\{[^|}]+\|([^}]+)\}\}/g;
  for (const match of abilityText.matchAll(markerPattern)) {
    const category = CATEGORY_BY_JAPANESE_MARKER.get(match[1]);
    if (!category) {
      throw new Error(`Unknown authoritative ability marker: ${match[1]}`);
    }
    categories.push(category);
  }
  return categories;
}

function normalizeAuthoritativeAbilityText(abilityText: string | undefined): string {
  return (abilityText ?? '')
    .replace(/\r\n?/g, '\n')
    .replaceAll('＋', '+')
    .replace(/[、，,\s]/g, '')
    .trim();
}

function sortCategories(categories: readonly CardAbilityCategory[]): CardAbilityCategory[] {
  return [...categories].sort((left, right) => left.localeCompare(right));
}

function assertDefinitionWindowMetadata(
  definition: ReturnType<typeof getCardAbilityDefinitions>[number],
  authoritativeCardType: string | undefined
): void {
  const sourceZoneByCardType =
    authoritativeCardType === 'ライブ'
      ? CardAbilitySourceZone.LIVE_CARD
      : CardAbilitySourceZone.STAGE_MEMBER;

  switch (definition.category) {
    case CardAbilityCategory.CONTINUOUS:
      expect(definition.queued, `${definition.abilityId} continuous ability must not queue`).toBe(
        false
      );
      expect(definition.triggerCondition).toBeUndefined();
      expect(definition.sourceZone).toBe(sourceZoneByCardType);
      break;
    case CardAbilityCategory.ACTIVATED:
      expect(definition.queued, `${definition.abilityId} activated ability must not queue`).toBe(
        false
      );
      expect(
        definition.activatedUi,
        `${definition.abilityId} must expose its activated input`
      ).toBeDefined();
      expect(definition.sourceZone).toBe(CardAbilitySourceZone.STAGE_MEMBER);
      break;
    case CardAbilityCategory.ON_ENTER:
      expect(definition.queued, `${definition.abilityId} on-enter ability must queue`).toBe(true);
      expect(definition.triggerCondition).toBe('ON_ENTER_STAGE');
      expect(definition.sourceZone).toBe(CardAbilitySourceZone.PLAYED_MEMBER);
      break;
    case CardAbilityCategory.LIVE_START:
      expect(definition.queued, `${definition.abilityId} LIVE-start ability must queue`).toBe(true);
      expect(definition.triggerCondition).toBe('ON_LIVE_START');
      expect(definition.sourceZone).toBe(sourceZoneByCardType);
      break;
    case CardAbilityCategory.LIVE_SUCCESS:
      expect(definition.queued, `${definition.abilityId} LIVE-success ability must queue`).toBe(
        true
      );
      expect(definition.triggerCondition).toBe('ON_LIVE_SUCCESS');
      expect(definition.sourceZone).toBe(sourceZoneByCardType);
      break;
    case CardAbilityCategory.AUTO:
      expect(definition.queued, `${definition.abilityId} automatic ability must queue`).toBe(true);
      expect(
        definition.triggerCondition,
        `${definition.abilityId} must declare its authority event`
      ).toBeDefined();
      expect(definition.sourceZone).toBe(sourceZoneByCardType);
      break;
  }
}

function assertPrintedRestrictions(
  definitions: ReturnType<typeof getCardAbilityDefinitions>,
  authoritativeAbilityText: string
): void {
  for (const segment of extractAbilitySegments(authoritativeAbilityText)) {
    const matchingDefinitions = definitions.filter(
      (definition) => definition.category === segment.category
    );
    if (segment.text.includes('{{center.png|センター}}')) {
      expect(
        matchingDefinitions.some(
          (definition) =>
            definition.requiredSourceSlots?.length === 1 &&
            definition.requiredSourceSlots[0] === 'CENTER'
        ),
        `${segment.category} printed CENTER restriction must exist in definition metadata`
      ).toBe(true);
    }

    const turnLimit = segment.text.includes('{{turn2.png|ターン2回}}')
      ? 2
      : segment.text.includes('{{turn1.png|ターン1回}}')
        ? 1
        : null;
    if (turnLimit !== null) {
      expect(
        matchingDefinitions.some((definition) => definition.perTurnLimit === turnLimit),
        `${segment.category} printed per-turn limit ${turnLimit} must exist in definition metadata`
      ).toBe(true);
    }
  }
}

function extractAbilitySegments(
  abilityText: string
): Array<{ readonly category: CardAbilityCategory; readonly text: string }> {
  const markerPattern = /(?:^|\n)\{\{[^|}]+\|([^}]+)\}\}/g;
  const markers = [...abilityText.matchAll(markerPattern)];
  return markers.map((marker, index) => {
    const category = CATEGORY_BY_JAPANESE_MARKER.get(marker[1]);
    if (!category) {
      throw new Error(`Unknown authoritative ability marker: ${marker[1]}`);
    }
    const start = marker.index ?? 0;
    const end = markers[index + 1]?.index ?? abilityText.length;
    return { category, text: abilityText.slice(start, end) };
  });
}

function findExactLedgerLine(baseCardCode: string): string | undefined {
  return cardEffectLedger.split('\n').find((line) => {
    if (!line.startsWith('|')) {
      return false;
    }
    const firstCell = line.split('|')[1] ?? '';
    const registeredBaseCodes: string[] = [];
    for (const codeGroup of firstCell.matchAll(/`([^`]+)`/g)) {
      let shorthandPrefix: string | null = null;
      for (const rawPart of codeGroup[1].split('/')) {
        const part = rawPart.trim();
        const fullCode = part.match(/^[A-Z][A-Za-z0-9!]*-[A-Za-z0-9]+-\d{3}$/)?.[0];
        if (fullCode) {
          registeredBaseCodes.push(fullCode);
          shorthandPrefix = fullCode.slice(0, -3);
        } else if (shorthandPrefix && /^\d{3}$/.test(part)) {
          registeredBaseCodes.push(`${shorthandPrefix}${part}`);
        }
      }
    }
    return registeredBaseCodes.includes(baseCardCode);
  });
}

function abilityEvidenceKey(baseCardCode: string, abilityId: string): string {
  return `${baseCardCode}::${abilityId}`;
}
