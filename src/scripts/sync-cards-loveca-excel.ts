/**
 * Loveca Excel 卡牌展示/文本字段同步脚本
 *
 * 只同步 Excel 权威展示与来源字段：
 * - name_jp / name_cn
 * - card_text_jp / card_text_cn
 * - group_names
 * - unit_name_raw / unit_name
 * - product / product_code
 * - image_source_uri / source_external_id / source_flags
 *
 * 不读取 Excel 官方 `作品名` / `参加ユニット`。这两列存在已知修正问题；
 * 归属信息使用人工修正后的 `真实团体` / `真实小队`。
 *
 * 不更新 cost / hearts / blade / score / requirements / blade_hearts 等规则字段。
 *
 * 使用方法：
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts --dry-run
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts --yes
 */

import { execFileSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { Pool } from 'pg';
import { normalizeCardCode } from '../shared/utils/card-code.js';
import { resolveLovecaExcelPath } from './loveca-excel-source.js';

type SourceFlags = {
  excelOnly?: boolean;
  oldSourceOnly?: boolean;
  fieldConflict?: boolean;
  derivedFromBase?: boolean;
};

interface Args {
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly xlsxPath: string;
}

interface ExcelCardRow {
  readonly rowNumber: number;
  readonly cardCode: string;
  readonly values: Record<string, string>;
}

interface ExistingCardRow {
  readonly card_code: string;
  readonly name_jp: string | null;
  readonly name_cn: string | null;
  readonly group_names: string[] | null;
  readonly unit_name: string | null;
  readonly unit_name_raw: string | null;
  readonly card_text_jp: string | null;
  readonly card_text_cn: string | null;
  readonly product: string | null;
  readonly product_code: string | null;
  readonly image_source_uri: string | null;
  readonly source_external_id: string | null;
  readonly source_flags: SourceFlags | null;
}

interface ExcelSyncRecord {
  readonly card_code: string;
  readonly name_jp: string | null;
  readonly name_cn: string | null;
  readonly group_names: string[] | null;
  readonly unit_name: string | null;
  readonly unit_name_raw: string | null;
  readonly card_text_jp: string | null;
  readonly card_text_cn: string | null;
  readonly product: string | null;
  readonly product_code: string | null;
  readonly image_source_uri: string | null;
  readonly source_external_id: string | null;
  readonly source_flags: SourceFlags | null;
}

interface PendingUpdate {
  readonly existing: ExistingCardRow;
  readonly next: ExcelSyncRecord;
  readonly changedFields: string[];
  readonly conflictFields: string[];
}

const FIELD_NAMES = {
  effectJa: '多行日文效果',
  effectCn: '多行中文效果',
  groupNames: '真实团体',
  unitName: '真实小队',
  nameJp: 'カード名',
  nameCn: '卡牌中文名',
  cardCode: 'カード番号',
  imageSourceUri: '卡图链接',
  product: '収録商品',
  productCode: '商品编号',
  sourceExternalId: '数据标识',
} as const;

const SYNC_FIELDS: readonly (keyof ExcelSyncRecord)[] = [
  'name_jp',
  'name_cn',
  'group_names',
  'unit_name',
  'unit_name_raw',
  'card_text_jp',
  'card_text_cn',
  'product',
  'product_code',
  'image_source_uri',
  'source_external_id',
  'source_flags',
];

function parseArgs(argv: readonly string[]): Args {
  let xlsxPath: string | null = null;
  let dryRun = false;
  let yes = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg.startsWith('--xlsx=')) {
      xlsxPath = arg.slice('--xlsx='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    dryRun,
    yes,
    xlsxPath: resolveLovecaExcelPath(xlsxPath),
  };
}

function unzipText(xlsxPath: string, entryName: string): string {
  return execFileSync('unzip', ['-p', xlsxPath, entryName], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function getAttribute(source: string, name: string): string | null {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXmlText(match[1]) : null;
}

function columnIndexFromCellRef(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/)?.[0];
  if (!letters) {
    throw new Error(`Invalid cell ref: ${cellRef}`);
  }

  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function extractTextNodes(xml: string): string {
  const parts: string[] = [];
  const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(xml)) !== null) {
    parts.push(decodeXmlText(match[1] ?? ''));
  }
  return parts.join('');
}

function parseSharedStrings(sharedStringsXml: string): string[] {
  const result: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(sharedStringsXml)) !== null) {
    result.push(extractTextNodes(match[1] ?? ''));
  }
  return result;
}

function parseWorksheetRows(sheetXml: string, sharedStrings: readonly string[]): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowAttrs = rowMatch[1] ?? '';
    const rowNumber = Number(getAttribute(rowAttrs, 'r') ?? rows.length + 1);
    const row: string[] = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowMatch[2] ?? '')) !== null) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const cellRef = getAttribute(attrs, 'r');
      if (!cellRef) {
        continue;
      }
      const columnIndex = columnIndexFromCellRef(cellRef);
      const type = getAttribute(attrs, 't');
      let value = '';

      if (type === 'inlineStr') {
        value = extractTextNodes(body);
      } else {
        const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        const decoded = decodeXmlText(rawValue);
        value = type === 's' ? (sharedStrings[Number(decoded)] ?? '') : decoded;
      }

      row[columnIndex] = value;
    }

    rows[rowNumber - 1] = row;
  }

  return rows;
}

function readLovecaExcelRows(xlsxPath: string): ExcelCardRow[] {
  const sheetXml = unzipText(xlsxPath, 'xl/worksheets/sheet1.xml');
  let sharedStrings: string[] = [];
  try {
    sharedStrings = parseSharedStrings(unzipText(xlsxPath, 'xl/sharedStrings.xml'));
  } catch {
    sharedStrings = [];
  }

  const rows = parseWorksheetRows(sheetXml, sharedStrings);
  const headers = rows[0] ?? [];
  const cardCodeIndex = headers.indexOf(FIELD_NAMES.cardCode);
  if (cardCodeIndex < 0) {
    throw new Error(`Missing Excel column: ${FIELD_NAMES.cardCode}`);
  }

  const result: ExcelCardRow[] = [];
  for (let index = 1; index < rows.length; index++) {
    const rawRow = rows[index] ?? [];
    const rawCode = cleanString(rawRow[cardCodeIndex]);
    if (!rawCode) {
      continue;
    }

    const values: Record<string, string> = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex++) {
      const header = headers[columnIndex];
      if (header) {
        values[header] = rawRow[columnIndex] ?? '';
      }
    }

    result.push({
      rowNumber: index + 1,
      cardCode: normalizeCardCode(rawCode),
      values,
    });
  }

  return result;
}

function cleanString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeUnitName(value: string | null): string | null {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }

  const unwrapped = raw.replace(/^「/, '').replace(/」$/, '');
  const normalized =
    {
      'lily white': 'lilywhite',
      'Guilty Kiss': 'GuiltyKiss',
      'Edel Note': 'EdelNote',
      'Saint Snow': 'SaintSnow',
      'Sunny Passion': 'SunnyPassion',
      'みらくらぱーく!': 'みらくらぱーく！',
    }[unwrapped] ?? unwrapped;

  return `「${normalized}」`;
}

function parseJsonStringArray(
  value: string | null,
  context: string,
  warnings: string[]
): string[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      warnings.push(`${context}: JSON is not an array`);
      return null;
    }
    const items = parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return items.length > 0 ? items : null;
  } catch (error) {
    warnings.push(
      `${context}: JSON parse failed (${error instanceof Error ? error.message : error})`
    );
    return null;
  }
}

function basenameFromUri(uri: string | null): string | null {
  if (!uri) {
    return null;
  }
  return uri.split(/[\\/]/).pop() ?? null;
}

function buildExcelSyncRecord(
  row: ExcelCardRow,
  existing: ExistingCardRow,
  warnings: string[]
): ExcelSyncRecord {
  const value = (field: string) => cleanString(row.values[field]);
  const nameJp = value(FIELD_NAMES.nameJp);
  const nameCn = value(FIELD_NAMES.nameCn);
  const cardTextJa = value(FIELD_NAMES.effectJa);
  const cardTextCn = value(FIELD_NAMES.effectCn);
  const groupNames = parseJsonStringArray(
    value(FIELD_NAMES.groupNames),
    `${row.cardCode} row ${row.rowNumber} ${FIELD_NAMES.groupNames}`,
    warnings
  );
  const unitNameRaw = value(FIELD_NAMES.unitName);
  const unitName = normalizeUnitName(unitNameRaw);
  const product = value(FIELD_NAMES.product);
  const productCode = value(FIELD_NAMES.productCode);
  const imageSourceUri = value(FIELD_NAMES.imageSourceUri);
  const sourceExternalId = value(FIELD_NAMES.sourceExternalId);
  const sourceFlags = existing.source_flags ?? null;

  if (imageSourceUri && !basenameFromUri(imageSourceUri)) {
    warnings.push(`${row.cardCode} row ${row.rowNumber}: unable to derive image basename`);
  }

  return {
    card_code: row.cardCode,
    name_jp: nameJp ?? existing.name_jp,
    name_cn: nameCn ?? existing.name_cn,
    group_names: groupNames ?? existing.group_names,
    unit_name: unitName ?? existing.unit_name,
    unit_name_raw: unitNameRaw ?? existing.unit_name_raw,
    card_text_jp: cardTextJa ?? existing.card_text_jp,
    card_text_cn: cardTextCn ?? existing.card_text_cn,
    product: product ?? existing.product,
    product_code: productCode ?? existing.product_code,
    image_source_uri: imageSourceUri ?? existing.image_source_uri,
    source_external_id: sourceExternalId ?? existing.source_external_id,
    source_flags: sourceFlags,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function nonEmpty(value: string | null | undefined): boolean {
  return value != null && value.trim().length > 0;
}

function collectChangedFields(existing: ExistingCardRow, next: ExcelSyncRecord): string[] {
  const result: string[] = [];
  for (const field of SYNC_FIELDS) {
    if (!valuesEqual(existing[field], next[field])) {
      result.push(field);
    }
  }
  return result;
}

function collectConflictFields(existing: ExistingCardRow, next: ExcelSyncRecord): string[] {
  const conflicts: string[] = [];
  const checkString = (field: keyof ExistingCardRow & keyof ExcelSyncRecord, label: string) => {
    if (nonEmpty(existing[field] as string | null) && existing[field] !== next[field]) {
      conflicts.push(label);
    }
  };

  checkString('product', FIELD_NAMES.product);
  checkString('unit_name', FIELD_NAMES.unitName);
  checkString('unit_name_raw', FIELD_NAMES.unitName);
  checkString('name_jp', FIELD_NAMES.nameJp);
  checkString('name_cn', FIELD_NAMES.nameCn);
  checkString('card_text_jp', FIELD_NAMES.effectJa);
  if (nonEmpty(existing.card_text_cn) && existing.card_text_cn !== next.card_text_cn) {
    conflicts.push(FIELD_NAMES.effectCn);
  }

  if (existing.group_names && !valuesEqual(existing.group_names, next.group_names)) {
    conflicts.push(FIELD_NAMES.groupNames);
  }

  return [...new Set(conflicts)];
}

function applyConflictFlag(next: ExcelSyncRecord, hasConflict: boolean): ExcelSyncRecord {
  if (!hasConflict) {
    return next;
  }
  return {
    ...next,
    source_flags: {
      ...(next.source_flags ?? {}),
      fieldConflict: true,
    },
  };
}

function summarizeDuplicateRows(rows: readonly ExcelCardRow[]): Map<string, ExcelCardRow[]> {
  const byCode = new Map<string, ExcelCardRow[]>();
  for (const row of rows) {
    const list = byCode.get(row.cardCode) ?? [];
    list.push(row);
    byCode.set(row.cardCode, list);
  }

  return new Map([...byCode.entries()].filter(([, list]) => list.length > 1));
}

function printUpdateSummary(updates: readonly PendingUpdate[]) {
  const conflictCount = updates.filter((update) => update.conflictFields.length > 0).length;
  console.log(`  Pending updates: ${updates.length}`);
  console.log(`  Updates with warning/conflict: ${conflictCount}`);

  for (const update of updates.slice(0, 60)) {
    const conflictSuffix =
      update.conflictFields.length > 0 ? ` warnings=${update.conflictFields.join(',')}` : '';
    const displayName =
      update.next.name_cn ??
      update.next.name_jp ??
      update.existing.name_cn ??
      update.existing.name_jp;
    console.log(
      `  ${update.next.card_code} ${displayName ?? ''}: fields=${update.changedFields.join(',')}${conflictSuffix}`
    );
  }
  if (updates.length > 60) {
    console.log(`  ... and ${updates.length - 60} more`);
  }
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value ?? null);
}

function printConflictDetails(updates: readonly PendingUpdate[]) {
  const conflicts = updates.filter((update) => update.conflictFields.length > 0);
  if (conflicts.length === 0) {
    return;
  }

  console.log('\nConflict warnings:');
  for (const update of conflicts.slice(0, 40)) {
    const displayName =
      update.next.name_cn ??
      update.next.name_jp ??
      update.existing.name_cn ??
      update.existing.name_jp;
    console.log(`  ${update.next.card_code} ${displayName ?? ''}`);
    for (const field of update.conflictFields) {
      const fieldKey = conflictLabelToFieldKey(field);
      if (!fieldKey) {
        continue;
      }
      console.log(
        `    ${field}: ${formatValue(update.existing[fieldKey])} -> ${formatValue(update.next[fieldKey])}`
      );
    }
  }
  if (conflicts.length > 40) {
    console.log(`  ... and ${conflicts.length - 40} more conflict rows`);
  }
}

function conflictLabelToFieldKey(
  label: string
): (keyof ExistingCardRow & keyof ExcelSyncRecord) | null {
  switch (label) {
    case FIELD_NAMES.product:
      return 'product';
    case FIELD_NAMES.unitName:
      return 'unit_name';
    case FIELD_NAMES.nameJp:
      return 'name_jp';
    case FIELD_NAMES.nameCn:
      return 'name_cn';
    case FIELD_NAMES.effectJa:
      return 'card_text_jp';
    case FIELD_NAMES.effectCn:
      return 'card_text_cn';
    case FIELD_NAMES.groupNames:
      return 'group_names';
    default:
      return null;
  }
}

async function confirmApplyUpdates(updateCount: number): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive update confirmation requires a TTY. Use --yes to apply.');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(`\nApply ${updateCount} Loveca Excel updates? [Y/n] `))
      .trim()
      .toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function applyUpdates(pool: Pool, updates: readonly PendingUpdate[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const update of updates) {
      const next = update.next;
      await client.query(
        `
          UPDATE cards SET
            name_jp = $2,
            name_cn = $3,
            group_names = $4,
            unit_name = $5,
            unit_name_raw = $6,
            card_text_jp = $7,
            card_text_cn = $8,
            product = $9,
            product_code = $10,
            image_source_uri = $11,
            source_external_id = $12,
            source_flags = $13,
            updated_at = now()
          WHERE card_code = $1
        `,
        [
          next.card_code,
          next.name_jp,
          next.name_cn,
          next.group_names == null ? null : JSON.stringify(next.group_names),
          next.unit_name,
          next.unit_name_raw,
          next.card_text_jp,
          next.card_text_cn,
          next.product,
          next.product_code,
          next.image_source_uri,
          next.source_external_id,
          next.source_flags == null ? null : JSON.stringify(next.source_flags),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Loveca Excel card text sync${args.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  Excel: ${args.xlsxPath}`);

  const excelRows = readLovecaExcelRows(args.xlsxPath);
  const duplicates = summarizeDuplicateRows(excelRows);
  const duplicateCodes = new Set(duplicates.keys());
  const usableRows = excelRows.filter((row) => !duplicateCodes.has(row.cardCode));
  const excelByCode = new Map(usableRows.map((row) => [row.cardCode, row]));

  console.log(`  Excel rows: ${excelRows.length}`);
  console.log(`  Unique usable card codes: ${usableRows.length}`);
  console.log(`  Duplicate card codes skipped: ${duplicates.size}`);
  if (duplicates.size > 0) {
    for (const [code, rows] of [...duplicates.entries()].slice(0, 20)) {
      console.warn(
        `  Warning: duplicate ${code} at rows ${rows.map((row) => row.rowNumber).join(', ')}`
      );
    }
    if (duplicates.size > 20) {
      console.warn(`  ... and ${duplicates.size - 20} more duplicate groups`);
    }
  }

  if (!process.env.DATABASE_URL) {
    if (!args.dryRun) {
      throw new Error(
        'DATABASE_URL is required unless --dry-run is used for parse-only validation'
      );
    }
    console.log('\nNo DATABASE_URL provided; parse-only dry run finished.');
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: existingRows } = await pool.query<ExistingCardRow>(`
      SELECT
        card_code, name_jp, name_cn,
        group_names, unit_name, unit_name_raw,
        card_text_jp, card_text_cn,
        product, product_code, image_source_uri, source_external_id, source_flags
      FROM cards
      ORDER BY card_code
    `);

    const existingByCode = new Map(existingRows.map((row) => [row.card_code, row]));
    const excelOnly = [...excelByCode.keys()].filter((code) => !existingByCode.has(code));
    const dbOnly = existingRows.filter((row) => !excelByCode.has(row.card_code));
    const warnings: string[] = [];
    const updates: PendingUpdate[] = [];

    for (const [code, excelRow] of excelByCode) {
      const existing = existingByCode.get(code);
      if (!existing) {
        continue;
      }

      const rawNext = buildExcelSyncRecord(excelRow, existing, warnings);
      const conflictFields = collectConflictFields(existing, rawNext);
      const next = applyConflictFlag(rawNext, conflictFields.length > 0);
      const changedFields = collectChangedFields(existing, next);
      if (changedFields.length > 0) {
        updates.push({ existing, next, changedFields, conflictFields });
      }
    }

    console.log('\nDB comparison:');
    console.log(`  DB cards: ${existingRows.length}`);
    console.log(`  Excel-only skipped: ${excelOnly.length}`);
    console.log(`  DB-only untouched: ${dbOnly.length}`);
    if (warnings.length > 0) {
      console.warn(`  Transform warnings: ${warnings.length}`);
      for (const warning of warnings.slice(0, 30)) {
        console.warn(`    ${warning}`);
      }
    }

    printUpdateSummary(updates);
    printConflictDetails(updates);

    if (excelOnly.length > 0) {
      console.log(`\nExcel-only card codes (not inserted): ${excelOnly.slice(0, 40).join(', ')}`);
      if (excelOnly.length > 40) {
        console.log(`  ... and ${excelOnly.length - 40} more`);
      }
    }

    if (args.dryRun || updates.length === 0) {
      console.log(
        args.dryRun ? '\nDry run finished. No DB changes applied.' : '\nNo updates needed.'
      );
      return;
    }

    const shouldApply = args.yes || (await confirmApplyUpdates(updates.length));
    if (!shouldApply) {
      console.log('Update cancelled.');
      return;
    }

    await applyUpdates(pool, updates);
    console.log(`Applied ${updates.length} Loveca Excel updates.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
