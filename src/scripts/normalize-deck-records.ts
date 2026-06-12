/**
 * 云端卡组记录格式检查/迁移脚本
 *
 * 处理历史 decks.main_deck 中缺失 card_type 的旧格式记录，并按当前 PUBLISHED
 * 卡池重新计算 is_valid / validation_errors。
 *
 * 使用方法:
 *   # 预览模式（默认，不修改数据库）
 *   DATABASE_URL=postgres://... npx tsx src/scripts/normalize-deck-records.ts
 *
 *   # 正式执行（事务更新）
 *   DATABASE_URL=postgres://... npx tsx src/scripts/normalize-deck-records.ts --apply
 */

import { Pool, type PoolClient } from 'pg';
import type {
  DeckRecordEnergyEntry,
  DeckRecordMainEntry,
  MainDeckEntryType,
} from '../domain/card-data/deck-record-utils';
import { normalizeDeckRecordPayload } from '../domain/card-data/deck-record-utils';
import { CardType } from '../shared/types/enums';

const DATABASE_URL = process.env.DATABASE_URL;
const APPLY = process.argv.includes('--apply');

type CardTypeValue = 'MEMBER' | 'LIVE' | 'ENERGY';

interface CardRow {
  card_code: string;
  card_type: CardTypeValue;
  status: 'DRAFT' | 'PUBLISHED';
}

interface DeckRow {
  id: string;
  name: string;
  description: string | null;
  main_deck: unknown;
  energy_deck: unknown;
  is_valid: boolean;
  validation_errors: unknown;
}

interface NormalizedDeckReport {
  id: string;
  name: string;
  missingTypeFixed: number;
  mismatchedTypeFixed: number;
  structuralErrors: string[];
  validationErrors: string[];
  oldIsValid: boolean;
  newIsValid: boolean;
  mainDeckChanged: boolean;
  energyDeckChanged: boolean;
  validationChanged: boolean;
  normalizedMainDeck: DeckRecordMainEntry[];
  normalizedEnergyDeck: DeckRecordEnergyEntry[];
}

interface MigrationSummary {
  totalDecks: number;
  changedDecks: number;
  missingTypeFixed: number;
  mismatchedTypeFixed: number;
  invalidDecks: number;
  structuralErrorDecks: number;
}

function isMainDeckEntryType(value: unknown): value is MainDeckEntryType {
  return value === 'MEMBER' || value === 'LIVE';
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function getValidationErrors(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}

function readMainDeck(
  value: unknown,
  deckName: string
): {
  entries: DeckRecordMainEntry[];
  structuralErrors: string[];
} {
  const structuralErrors: string[] = [];
  if (!Array.isArray(value)) {
    return { entries: [], structuralErrors: [`${deckName}: main_deck 不是数组`] };
  }

  const entries: DeckRecordMainEntry[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      structuralErrors.push(`${deckName}: main_deck[${index}] 不是对象`);
      return;
    }

    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.card_code !== 'string' || candidate.card_code.trim() === '') {
      structuralErrors.push(`${deckName}: main_deck[${index}].card_code 缺失`);
      return;
    }
    if (!Number.isInteger(candidate.count) || Number(candidate.count) <= 0) {
      structuralErrors.push(`${deckName}: main_deck[${index}].count 非法`);
      return;
    }

    entries.push({
      card_code: candidate.card_code,
      count: Number(candidate.count),
      ...(isMainDeckEntryType(candidate.card_type) ? { card_type: candidate.card_type } : {}),
    });
  });

  return { entries, structuralErrors };
}

function readEnergyDeck(
  value: unknown,
  deckName: string
): {
  entries: DeckRecordEnergyEntry[];
  structuralErrors: string[];
} {
  const structuralErrors: string[] = [];
  if (!Array.isArray(value)) {
    return { entries: [], structuralErrors: [`${deckName}: energy_deck 不是数组`] };
  }

  const entries: DeckRecordEnergyEntry[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      structuralErrors.push(`${deckName}: energy_deck[${index}] 不是对象`);
      return;
    }

    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.card_code !== 'string' || candidate.card_code.trim() === '') {
      structuralErrors.push(`${deckName}: energy_deck[${index}].card_code 缺失`);
      return;
    }
    if (!Number.isInteger(candidate.count) || Number(candidate.count) <= 0) {
      structuralErrors.push(`${deckName}: energy_deck[${index}].count 非法`);
      return;
    }

    entries.push({
      card_code: candidate.card_code,
      count: Number(candidate.count),
    });
  });

  return { entries, structuralErrors };
}

function normalizeMainDeckTypes(
  entries: readonly DeckRecordMainEntry[],
  cardTypes: ReadonlyMap<string, CardTypeValue>
): {
  entries: DeckRecordMainEntry[];
  missingTypeFixed: number;
  mismatchedTypeFixed: number;
} {
  let missingTypeFixed = 0;
  let mismatchedTypeFixed = 0;

  const normalized = entries.map((entry) => {
    const actualType = cardTypes.get(entry.card_code);
    if (actualType !== CardType.MEMBER && actualType !== CardType.LIVE) {
      return entry;
    }

    if (!entry.card_type) {
      missingTypeFixed++;
      return { ...entry, card_type: actualType };
    }

    if (entry.card_type !== actualType) {
      mismatchedTypeFixed++;
      return { ...entry, card_type: actualType };
    }

    return entry;
  });

  return { entries: normalized, missingTypeFixed, mismatchedTypeFixed };
}

function analyzeDeck(
  deck: DeckRow,
  allCardTypes: ReadonlyMap<string, CardTypeValue>,
  publishedCardTypes: ReadonlyMap<string, CardTypeValue>
): NormalizedDeckReport {
  const mainDeck = readMainDeck(deck.main_deck, deck.name);
  const energyDeck = readEnergyDeck(deck.energy_deck, deck.name);
  const mainDeckTypeFix = normalizeMainDeckTypes(mainDeck.entries, allCardTypes);

  const normalized = normalizeDeckRecordPayload(
    {
      name: deck.name,
      description: deck.description,
      main_deck: mainDeckTypeFix.entries,
      energy_deck: energyDeck.entries,
    },
    (cardCode) => publishedCardTypes.get(cardCode) as CardType | undefined
  );

  const validationErrors = [
    ...mainDeck.structuralErrors,
    ...energyDeck.structuralErrors,
    ...normalized.sourceErrors,
    ...normalized.validation.errors,
  ];
  const oldValidationErrors = getValidationErrors(deck.validation_errors);
  const newIsValid = validationErrors.length === 0;
  const normalizedMainDeck = mainDeckTypeFix.entries;
  const normalizedEnergyDeck = energyDeck.entries;

  return {
    id: deck.id,
    name: deck.name,
    missingTypeFixed: mainDeckTypeFix.missingTypeFixed,
    mismatchedTypeFixed: mainDeckTypeFix.mismatchedTypeFixed,
    structuralErrors: [...mainDeck.structuralErrors, ...energyDeck.structuralErrors],
    validationErrors,
    oldIsValid: deck.is_valid,
    newIsValid,
    mainDeckChanged: stableJson(deck.main_deck) !== stableJson(normalizedMainDeck),
    energyDeckChanged: stableJson(deck.energy_deck) !== stableJson(normalizedEnergyDeck),
    validationChanged:
      deck.is_valid !== newIsValid ||
      stableJson(oldValidationErrors) !== stableJson(validationErrors),
    normalizedMainDeck,
    normalizedEnergyDeck,
  };
}

function shouldUpdateDeck(report: NormalizedDeckReport): boolean {
  return report.mainDeckChanged || report.energyDeckChanged || report.validationChanged;
}

async function updateDeck(client: PoolClient, report: NormalizedDeckReport): Promise<void> {
  await client.query(
    `UPDATE decks
     SET main_deck = $1,
         energy_deck = $2,
         is_valid = $3,
         validation_errors = $4,
         updated_at = now()
     WHERE id = $5`,
    [
      JSON.stringify(report.normalizedMainDeck),
      JSON.stringify(report.normalizedEnergyDeck),
      report.newIsValid,
      JSON.stringify(report.validationErrors),
      report.id,
    ]
  );
}

function printDeckReport(report: NormalizedDeckReport): void {
  const changes: string[] = [];
  if (report.missingTypeFixed > 0) changes.push(`补 card_type ${report.missingTypeFixed}`);
  if (report.mismatchedTypeFixed > 0) changes.push(`修正 card_type ${report.mismatchedTypeFixed}`);
  if (report.oldIsValid !== report.newIsValid) {
    changes.push(`is_valid ${report.oldIsValid} -> ${report.newIsValid}`);
  }
  if (report.validationChanged) changes.push('validation_errors 更新');

  if (changes.length === 0 && report.validationErrors.length === 0) {
    return;
  }

  console.log(`\n- ${report.name} (${report.id})`);
  if (changes.length > 0) {
    console.log(`  变更: ${changes.join(', ')}`);
  }
  if (report.validationErrors.length > 0) {
    console.log('  校验问题:');
    report.validationErrors.slice(0, 8).forEach((error) => console.log(`    - ${error}`));
    if (report.validationErrors.length > 8) {
      console.log(`    ... 还有 ${report.validationErrors.length - 8} 条`);
    }
  }
}

function createSummary(reports: readonly NormalizedDeckReport[]): MigrationSummary {
  return {
    totalDecks: reports.length,
    changedDecks: reports.filter(shouldUpdateDeck).length,
    missingTypeFixed: reports.reduce((sum, report) => sum + report.missingTypeFixed, 0),
    mismatchedTypeFixed: reports.reduce((sum, report) => sum + report.mismatchedTypeFixed, 0),
    invalidDecks: reports.filter((report) => !report.newIsValid).length,
    structuralErrorDecks: reports.filter((report) => report.structuralErrors.length > 0).length,
  };
}

function printSummary(summary: MigrationSummary): void {
  console.log('\n' + '='.repeat(60));
  console.log('卡组记录检查结果');
  console.log('='.repeat(60));
  console.log(`总卡组数: ${summary.totalDecks}`);
  console.log(`需更新卡组: ${summary.changedDecks}`);
  console.log(`补齐 card_type: ${summary.missingTypeFixed}`);
  console.log(`修正 card_type: ${summary.mismatchedTypeFixed}`);
  console.log(`当前无效卡组: ${summary.invalidDecks}`);
  console.log(`结构异常卡组: ${summary.structuralErrorDecks}`);
  console.log(`模式: ${APPLY ? 'APPLY，已写入数据库' : 'DRY RUN，未修改数据库'}`);
  console.log('='.repeat(60));
}

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    console.error('Error: DATABASE_URL is required');
    console.log(
      'Usage: DATABASE_URL=postgres://... npx tsx src/scripts/normalize-deck-records.ts [--apply]'
    );
    process.exit(1);
  }

  console.log(`云端卡组记录检查${APPLY ? ' (APPLY)' : ' (DRY RUN)'}\n`);
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    const { rows: cards } = await pool.query<CardRow>(
      'SELECT card_code, card_type, status FROM cards ORDER BY card_code'
    );
    const allCardTypes = new Map(cards.map((card) => [card.card_code, card.card_type] as const));
    const publishedCardTypes = new Map(
      cards
        .filter((card) => card.status === 'PUBLISHED')
        .map((card) => [card.card_code, card.card_type] as const)
    );

    const { rows: decks } = await pool.query<DeckRow>(
      `SELECT id, name, description, main_deck, energy_deck, is_valid, validation_errors
       FROM decks
       ORDER BY updated_at DESC`
    );

    const reports = decks.map((deck) => analyzeDeck(deck, allCardTypes, publishedCardTypes));
    reports.forEach(printDeckReport);
    printSummary(createSummary(reports));

    if (!APPLY) {
      console.log('\n加 --apply 才会在事务中写入上述变更。');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const report of reports.filter(shouldUpdateDeck)) {
        await updateDeck(client, report);
      }
      await client.query('COMMIT');
      console.log('\n事务已提交。');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('\n事务已回滚:', error);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
