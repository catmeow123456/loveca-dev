/**
 * Loveca Excel 卡牌展示/文本字段同步脚本
 *
 * 同步 Excel 权威卡牌类型、展示与来源字段：
 * - name_jp / name_cn
 * - card_text_jp / card_text_cn
 * - group_names
 * - unit_name_raw / unit_name
 * - hearts
 * - blade_hearts
 * - requirements
 * - product / product_code
 * - image_source_uri / source_external_id / source_flags
 *
 * 来源卡牌类型合法时写回 DB `card_type`；缺失或无法映射时跳过该行。
 *
 * 不读取 Excel 官方 `作品名` / `参加ユニット`。这两列存在已知修正问题；
 * 归属信息使用人工修正后的 `真实团体` / `真实小队`。
 *
 * 不更新 cost / blade / score 等其他规则字段。
 *
 * 使用方法：
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts --dry-run
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts --yes
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts --source=cloudbase --cloudbase-collection=loveca --dry-run
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as readline from 'node:readline/promises';
import { Pool } from 'pg';
import { parse as parseDotenv } from 'dotenv';
import { normalizeCardCode } from '../shared/utils/card-code.js';
import { appendDoubleGrayBladeHearts } from './card-sync-double-heart.js';
import { resolveLovecaExcelPath } from './loveca-excel-source.js';

const require = createRequire(import.meta.url);
const cloudbaseSDK = require('@cloudbase/node-sdk') as typeof import('@cloudbase/node-sdk');

type SourceFlags = {
  excelOnly?: boolean;
  oldSourceOnly?: boolean;
  fieldConflict?: boolean;
  derivedFromBase?: boolean;
};

type BladeHeartSyncItem = {
  readonly effect: 'HEART' | 'DRAW' | 'SCORE';
  readonly heartColor?: HeartColor;
};

type HeartColor = 'PINK' | 'RED' | 'YELLOW' | 'GREEN' | 'BLUE' | 'PURPLE' | 'GRAY' | 'RAINBOW';

type HeartSyncItem = {
  readonly color: HeartColor;
  readonly count: number;
};

type LovecaSyncSource = 'xlsx' | 'cloudbase';
type CardType = 'MEMBER' | 'LIVE' | 'ENERGY';

interface Args {
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly source: LovecaSyncSource;
  readonly xlsxPath: string | null;
  readonly cloudbaseCollection: string;
  readonly cloudbaseLimit: number | null;
  readonly cloudbaseBatchSize: number;
}

interface ExcelCardRow {
  readonly rowNumber: number;
  readonly cardCode: string;
  readonly values: Record<string, string>;
  readonly sourceId?: string;
}

interface ExistingCardRow {
  readonly card_code: string;
  readonly card_type: CardType;
  readonly name_jp: string | null;
  readonly name_cn: string | null;
  readonly group_names: string[] | null;
  readonly unit_name: string | null;
  readonly unit_name_raw: string | null;
  readonly card_text_jp: string | null;
  readonly card_text_cn: string | null;
  readonly hearts: HeartSyncItem[] | null;
  readonly blade_hearts: BladeHeartSyncItem[] | null;
  readonly requirements: HeartSyncItem[] | null;
  readonly product: string | null;
  readonly product_code: string | null;
  readonly image_source_uri: string | null;
  readonly source_external_id: string | null;
  readonly source_flags: SourceFlags | null;
}

interface ExcelSyncRecord {
  readonly card_code: string;
  readonly card_type: CardType;
  readonly name_jp: string | null;
  readonly name_cn: string | null;
  readonly group_names: string[] | null;
  readonly unit_name: string | null;
  readonly unit_name_raw: string | null;
  readonly card_text_jp: string | null;
  readonly card_text_cn: string | null;
  readonly hearts: HeartSyncItem[] | null;
  readonly blade_hearts: BladeHeartSyncItem[] | null;
  readonly requirements: HeartSyncItem[] | null;
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

interface CardTypeValidationIssue {
  readonly sourceRow: ExcelCardRow;
  readonly sourceValue: string | null;
}

interface CardTypeCorrection {
  readonly sourceRow: ExcelCardRow;
  readonly existing: ExistingCardRow;
  readonly sourceValue: string;
  readonly sourceCardType: CardType;
}

const FIELD_NAMES = {
  effectJa: '多行日文效果',
  effectCn: '多行中文效果',
  groupNames: '真实团体',
  unitName: '真实小队',
  nameJp: 'カード名',
  nameCn: '卡牌中文名',
  cardCode: 'カード番号',
  cardType: 'カードタイプ',
  baseHeart: '基本ハート',
  bladeHeart: 'ブレードハート',
  specialHeart: '特殊ハート',
  requiredHeart: '必要ハート',
  imageSourceUri: '卡图链接',
  product: '収録商品',
  productCode: '商品编号',
  sourceExternalId: '数据标识',
} as const;

type SourceFieldName = (typeof FIELD_NAMES)[keyof typeof FIELD_NAMES];

const DEFAULT_CLOUDBASE_COLLECTION = 'loveca';
const DEFAULT_CLOUDBASE_BATCH_SIZE = 100;

const CLOUDBASE_FIELD_ALIASES: Record<SourceFieldName, readonly string[]> = {
  [FIELD_NAMES.effectJa]: [
    FIELD_NAMES.effectJa,
    'card_text_jp',
    'cardTextJp',
    'card_text_ja',
    'cardTextJa',
    'effect_jp',
    'effectJp',
    'effect_ja',
    'effectJa',
    'text_jp',
    'textJp',
  ],
  [FIELD_NAMES.effectCn]: [
    FIELD_NAMES.effectCn,
    'card_text_cn',
    'cardTextCn',
    'effect_cn',
    'effectCn',
    'text_cn',
    'textCn',
  ],
  [FIELD_NAMES.groupNames]: [
    FIELD_NAMES.groupNames,
    'group_names',
    'groupNames',
    'groups',
    'real_groups',
    'realGroups',
  ],
  [FIELD_NAMES.unitName]: [
    FIELD_NAMES.unitName,
    'unit_name_raw',
    'unitNameRaw',
    'unit_name',
    'unitName',
    'real_unit',
    'realUnit',
    'unit',
  ],
  [FIELD_NAMES.nameJp]: [
    FIELD_NAMES.nameJp,
    'name_jp',
    'nameJp',
    'name_ja',
    'nameJa',
    'card_name_jp',
    'cardNameJp',
    'card_name_org',
    'cardNameOrg',
  ],
  [FIELD_NAMES.nameCn]: [
    FIELD_NAMES.nameCn,
    'name_cn',
    'nameCn',
    'card_name_cn',
    'cardNameCn',
    'card_name',
    'cardName',
  ],
  [FIELD_NAMES.cardCode]: [
    FIELD_NAMES.cardCode,
    'card_code',
    'cardCode',
    'code',
    'card_no',
    'cardNo',
    'card_number',
    'cardNumber',
  ],
  [FIELD_NAMES.cardType]: ['type'],
  [FIELD_NAMES.baseHeart]: [FIELD_NAMES.baseHeart, 'base_heart', 'baseHeart', 'hearts', 'heart'],
  [FIELD_NAMES.bladeHeart]: [
    FIELD_NAMES.bladeHeart,
    'blade_heart',
    'bladeHeart',
    'blade_hearts',
    'bladeHearts',
  ],
  [FIELD_NAMES.specialHeart]: [
    FIELD_NAMES.specialHeart,
    'special_heart',
    'specialHeart',
    'special_hearts',
    'specialHearts',
  ],
  [FIELD_NAMES.requiredHeart]: [
    FIELD_NAMES.requiredHeart,
    'required_heart',
    'requiredHeart',
    'requirements',
    'requirement',
  ],
  [FIELD_NAMES.imageSourceUri]: [
    FIELD_NAMES.imageSourceUri,
    'image_source_uri',
    'imageSourceUri',
    'image_url',
    'imageUrl',
    'image',
  ],
  [FIELD_NAMES.product]: [FIELD_NAMES.product, 'product'],
  [FIELD_NAMES.productCode]: [
    FIELD_NAMES.productCode,
    'product_code',
    'productCode',
    'product_no',
    'productNo',
  ],
  [FIELD_NAMES.sourceExternalId]: [
    FIELD_NAMES.sourceExternalId,
    'source_external_id',
    'sourceExternalId',
    'external_id',
    'externalId',
    '_id',
    'id',
  ],
};

const SYNC_FIELDS: readonly (keyof ExcelSyncRecord)[] = [
  'card_type',
  'name_jp',
  'name_cn',
  'group_names',
  'unit_name',
  'unit_name_raw',
  'card_text_jp',
  'card_text_cn',
  'hearts',
  'blade_hearts',
  'requirements',
  'product',
  'product_code',
  'image_source_uri',
  'source_external_id',
  'source_flags',
];

const EXCEL_HEART_COLOR_MAP: Record<string, Exclude<HeartColor, 'RAINBOW'>> = {
  pink: 'PINK',
  red: 'RED',
  yellow: 'YELLOW',
  green: 'GREEN',
  blue: 'BLUE',
  purple: 'PURPLE',
  gray: 'GRAY',
  grey: 'GRAY',
  colorless: 'GRAY',
};

const EXCEL_RAINBOW_HEART_TOKENS = new Set(['any', 'all']);

const EXCEL_BLADE_HEART_COLOR_MAP: Record<string, HeartColor> = {
  ...EXCEL_HEART_COLOR_MAP,
  all: 'RAINBOW',
};

const EXCEL_SPECIAL_HEART_EFFECT_MAP: Record<
  string,
  Exclude<BladeHeartSyncItem['effect'], 'HEART'>
> = {
  draw: 'DRAW',
  score: 'SCORE',
  bonus: 'SCORE',
};

const SOURCE_CARD_TYPE_MAP: Readonly<Record<string, CardType>> = {
  MEMBER: 'MEMBER',
  LIVE: 'LIVE',
  ENERGY: 'ENERGY',
  メンバー: 'MEMBER',
  ライブ: 'LIVE',
  エネルギー: 'ENERGY',
};

function parseArgs(argv: readonly string[]): Args {
  let xlsxPath: string | null = null;
  let dryRun = false;
  let yes = false;
  let source: LovecaSyncSource = 'xlsx';
  let cloudbaseCollection = DEFAULT_CLOUDBASE_COLLECTION;
  let cloudbaseLimit: number | null = null;
  let cloudbaseBatchSize = DEFAULT_CLOUDBASE_BATCH_SIZE;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length);
      if (value !== 'xlsx' && value !== 'cloudbase') {
        throw new Error(`Invalid --source value: ${value}. Expected xlsx or cloudbase.`);
      }
      source = value;
    } else if (arg.startsWith('--xlsx=')) {
      xlsxPath = arg.slice('--xlsx='.length);
    } else if (arg.startsWith('--cloudbase-collection=')) {
      const value = cleanString(arg.slice('--cloudbase-collection='.length));
      if (!value) {
        throw new Error('--cloudbase-collection requires a non-empty value');
      }
      cloudbaseCollection = value;
    } else if (arg.startsWith('--cloudbase-limit=')) {
      cloudbaseLimit = parseNonNegativeIntegerArg(arg, '--cloudbase-limit=');
    } else if (arg.startsWith('--cloudbase-batch-size=')) {
      cloudbaseBatchSize = parsePositiveIntegerArg(arg, '--cloudbase-batch-size=');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    dryRun,
    yes,
    source,
    xlsxPath: source === 'xlsx' ? resolveLovecaExcelPath(xlsxPath) : xlsxPath,
    cloudbaseCollection,
    cloudbaseLimit,
    cloudbaseBatchSize,
  };
}

function parsePositiveIntegerArg(arg: string, prefix: string): number {
  const raw = arg.slice(prefix.length);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${prefix}${raw} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${prefix}${raw} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeIntegerArg(arg: string, prefix: string): number {
  const raw = arg.slice(prefix.length);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${prefix}${raw} must be a non-negative integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${prefix}${raw} must be a non-negative integer`);
  }
  return value;
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
  if (!headers.includes(FIELD_NAMES.cardType)) {
    throw new Error(`Missing Excel column: ${FIELD_NAMES.cardType}`);
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

async function readSyncSourceRows(args: Args): Promise<ExcelCardRow[]> {
  switch (args.source) {
    case 'xlsx':
      if (!args.xlsxPath) {
        throw new Error('Missing xlsx path');
      }
      return readLovecaExcelRows(args.xlsxPath);
    case 'cloudbase':
      return readCloudbaseRows(args);
  }
}

function requiredEnv(name: string, fallbackName?: string): string {
  const value = readEnvValue(name) ?? (fallbackName ? readEnvValue(fallbackName) : null);
  if (!value) {
    throw new Error(
      fallbackName
        ? `Missing required environment variable: ${name} or ${fallbackName}`
        : `Missing required environment variable: ${name}`
    );
  }
  return value;
}

let dotenvValues: Record<string, string> | null = null;

function readEnvValue(name: string): string | null {
  return cleanString(process.env[name]) ?? cleanString(readDotenvValues()[name]);
}

function readDotenvValues(): Record<string, string> {
  if (dotenvValues) {
    return dotenvValues;
  }

  try {
    dotenvValues = parseDotenv(fs.readFileSync('.env'));
  } catch {
    dotenvValues = {};
  }
  return dotenvValues;
}

async function readCloudbaseRows(args: Args): Promise<ExcelCardRow[]> {
  const cloudbase = cloudbaseSDK.init({
    env: requiredEnv('CLOUDBASE_ENV_ID'),
    secretId: requiredEnv('CLOUDBASE_SECRET_ID', 'CLOUDBASE_SECRETID'),
    secretKey: requiredEnv('CLOUDBASE_SECRET_KEY', 'CLOUDBASE_SECRETKEY'),
  });
  const db = cloudbase.database();
  const documents = await readCloudbaseDocuments(
    db.collection(args.cloudbaseCollection),
    args.cloudbaseLimit,
    args.cloudbaseBatchSize
  );

  const warnings: string[] = [];
  const rows = documents
    .map((document, index) => cloudbaseDocumentToRow(document, index + 1, warnings))
    .filter((row): row is ExcelCardRow => row !== null);

  if (warnings.length > 0) {
    console.warn(`  CloudBase source warnings: ${warnings.length}`);
    for (const warning of warnings.slice(0, 30)) {
      console.warn(`    ${warning}`);
    }
    if (warnings.length > 30) {
      console.warn(`    ... and ${warnings.length - 30} more`);
    }
  }

  return rows;
}

async function readCloudbaseDocuments(
  collection: {
    skip(offset: number): { limit(limit: number): { get(): Promise<{ data?: unknown[] }> } };
  },
  limit: number | null,
  batchSize: number
): Promise<Record<string, unknown>[]> {
  const documents: Record<string, unknown>[] = [];
  let offset = 0;

  while (limit === null || documents.length < limit) {
    const remaining = limit === null ? batchSize : limit - documents.length;
    const pageSize = Math.min(batchSize, remaining);
    if (pageSize <= 0) {
      break;
    }

    const response = await collection.skip(offset).limit(pageSize).get();
    const page = (response.data ?? []).filter(isRecord);
    documents.push(...page);
    offset += response.data?.length ?? 0;

    if ((response.data?.length ?? 0) < pageSize) {
      break;
    }
  }

  return documents;
}

function cloudbaseDocumentToRow(
  document: Record<string, unknown>,
  rowNumber: number,
  warnings: string[]
): ExcelCardRow | null {
  const rawCode = cleanString(
    stringifyCloudbaseFieldValue(readCloudbaseField(document, FIELD_NAMES.cardCode))
  );
  if (!rawCode) {
    const sourceId = cleanString(stringifyCloudbaseFieldValue(document._id));
    warnings.push(
      sourceId
        ? `document ${sourceId}: missing card code; skipped`
        : `document #${rowNumber}: missing card code; skipped`
    );
    return null;
  }

  const values: Record<string, string> = {};
  for (const fieldName of Object.values(FIELD_NAMES)) {
    const value = readCloudbaseField(document, fieldName);
    if (value !== undefined) {
      values[fieldName] = stringifyCloudbaseFieldValue(value);
    }
  }

  return {
    rowNumber,
    cardCode: normalizeCardCode(rawCode),
    values,
    sourceId: cleanString(stringifyCloudbaseFieldValue(document._id)) ?? undefined,
  };
}

function readCloudbaseField(
  document: Record<string, unknown>,
  fieldName: SourceFieldName
): unknown {
  const aliases = CLOUDBASE_FIELD_ALIASES[fieldName] ?? [fieldName];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(document, alias)) {
      return document[alias];
    }
  }
  return undefined;
}

function stringifyCloudbaseFieldValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseSourceCardType(value: string | null): CardType | null {
  if (!value) {
    return null;
  }
  return SOURCE_CARD_TYPE_MAP[value.trim().toUpperCase()] ?? null;
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

function parseJsonObject(
  value: string | null,
  context: string,
  warnings: string[]
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push(`${context}: JSON is not an object`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    warnings.push(
      `${context}: JSON parse failed (${error instanceof Error ? error.message : error})`
    );
    return null;
  }
}

function normalizeBladeHeartToken(value: string): string {
  return value.trim().toLowerCase();
}

function parsePositiveIntegerCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : null;
  }
  return null;
}

function normalizeHeartToken(value: string): string {
  return value.trim().toLowerCase();
}

function parseExcelHearts(
  heartValue: string | null,
  fieldName: string,
  context: string,
  warnings: string[]
): HeartSyncItem[] | null {
  const heartObject = parseJsonObject(heartValue, `${context} ${fieldName}`, warnings);
  if (!heartObject) {
    return null;
  }

  const result: HeartSyncItem[] = [];
  let hasParseError = false;
  for (const [rawKey, rawCount] of Object.entries(heartObject)) {
    const token = normalizeHeartToken(rawKey);
    const color = EXCEL_RAINBOW_HEART_TOKENS.has(token) ? 'RAINBOW' : EXCEL_HEART_COLOR_MAP[token];
    const count = parsePositiveIntegerCount(rawCount);

    if (!color) {
      warnings.push(`${context} ${fieldName}: unknown token "${rawKey}"`);
      hasParseError = true;
      continue;
    }
    if (!count) {
      warnings.push(`${context} ${fieldName}: invalid count for "${rawKey}"`);
      hasParseError = true;
      continue;
    }

    result.push({ color, count });
  }

  if (hasParseError) {
    return null;
  }
  return result.length > 0 ? result : null;
}

function parseExcelBladeHearts(
  bladeHeartValue: string | null,
  specialHeartValue: string | null,
  context: string,
  warnings: string[]
): BladeHeartSyncItem[] | null {
  const result: BladeHeartSyncItem[] = [];
  let hasParseError = false;

  if (bladeHeartValue) {
    const token = normalizeBladeHeartToken(bladeHeartValue);
    const heartColor = EXCEL_BLADE_HEART_COLOR_MAP[token];
    const specialEffect = EXCEL_SPECIAL_HEART_EFFECT_MAP[token];

    if (appendDoubleGrayBladeHearts(result, token)) {
      // `double` is one Blade Heart icon that produces two colorless Hearts.
    } else if (heartColor) {
      result.push({ effect: 'HEART', heartColor });
    } else if (specialEffect) {
      result.push({ effect: specialEffect });
    } else {
      warnings.push(`${context} ${FIELD_NAMES.bladeHeart}: unknown token "${bladeHeartValue}"`);
      hasParseError = true;
    }
  }

  const warningCountBeforeSpecialHeart = warnings.length;
  const specialHeart = parseJsonObject(
    specialHeartValue,
    `${context} ${FIELD_NAMES.specialHeart}`,
    warnings
  );
  if (specialHeartValue && !specialHeart && warnings.length > warningCountBeforeSpecialHeart) {
    hasParseError = true;
  }
  if (specialHeart) {
    for (const [rawKey, rawCount] of Object.entries(specialHeart)) {
      const token = normalizeBladeHeartToken(rawKey);
      const effect = EXCEL_SPECIAL_HEART_EFFECT_MAP[token];
      const count = parsePositiveIntegerCount(rawCount);

      if (count && appendDoubleGrayBladeHearts(result, token, count)) {
        continue;
      }
      if (!effect) {
        warnings.push(`${context} ${FIELD_NAMES.specialHeart}: unknown token "${rawKey}"`);
        hasParseError = true;
        continue;
      }
      if (!count) {
        warnings.push(`${context} ${FIELD_NAMES.specialHeart}: invalid count for "${rawKey}"`);
        hasParseError = true;
        continue;
      }

      for (let index = 0; index < count; index++) {
        result.push({ effect });
      }
    }
  }

  if (hasParseError) {
    return null;
  }
  return result.length > 0 ? result : null;
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
  sourceCardType: CardType,
  warnings: string[]
): ExcelSyncRecord {
  const value = (field: string) => cleanString(row.values[field]);
  const nameJp = value(FIELD_NAMES.nameJp);
  const nameCn = value(FIELD_NAMES.nameCn);
  const cardTextJa = value(FIELD_NAMES.effectJa);
  const cardTextCn = value(FIELD_NAMES.effectCn);
  const context = `${row.cardCode} row ${row.rowNumber}`;
  const groupNames = parseJsonStringArray(
    value(FIELD_NAMES.groupNames),
    `${context} ${FIELD_NAMES.groupNames}`,
    warnings
  );
  const unitNameRaw = value(FIELD_NAMES.unitName);
  const unitName = normalizeUnitName(unitNameRaw);
  const baseHearts =
    sourceCardType === 'MEMBER'
      ? parseExcelHearts(value(FIELD_NAMES.baseHeart), FIELD_NAMES.baseHeart, context, warnings)
      : null;
  const bladeHearts = parseExcelBladeHearts(
    value(FIELD_NAMES.bladeHeart),
    value(FIELD_NAMES.specialHeart),
    context,
    warnings
  );
  const requiredHearts =
    sourceCardType === 'LIVE'
      ? parseExcelHearts(
          value(FIELD_NAMES.requiredHeart),
          FIELD_NAMES.requiredHeart,
          context,
          warnings
        )
      : null;
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
    card_type: sourceCardType,
    name_jp: nameJp ?? existing.name_jp,
    name_cn: nameCn ?? existing.name_cn,
    group_names: groupNames ?? existing.group_names,
    unit_name: unitName ?? existing.unit_name,
    unit_name_raw: unitNameRaw ?? existing.unit_name_raw,
    card_text_jp: cardTextJa ?? existing.card_text_jp,
    card_text_cn: cardTextCn ?? existing.card_text_cn,
    hearts: baseHearts ?? existing.hearts,
    blade_hearts: bladeHearts ?? existing.blade_hearts,
    requirements: requiredHearts ?? existing.requirements,
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

function unorderedArrayValuesEqual(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) && !Array.isArray(right)) {
    return valuesEqual(left, right);
  }
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  const normalize = (items: readonly unknown[]) => items.map(stableJson).sort();
  return stableJson(normalize(left)) === stableJson(normalize(right));
}

function syncFieldValuesEqual(
  field: keyof ExcelSyncRecord,
  left: unknown,
  right: unknown
): boolean {
  switch (field) {
    case 'group_names':
    case 'hearts':
    case 'blade_hearts':
    case 'requirements':
      return unorderedArrayValuesEqual(left, right);
    default:
      return valuesEqual(left, right);
  }
}

function nonEmpty(value: string | null | undefined): boolean {
  return value != null && value.trim().length > 0;
}

function nonEmptyArray<T>(value: readonly T[] | null | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
}

function collectChangedFields(existing: ExistingCardRow, next: ExcelSyncRecord): string[] {
  const result: string[] = [];
  for (const field of SYNC_FIELDS) {
    if (!syncFieldValuesEqual(field, existing[field], next[field])) {
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

  if (
    nonEmptyArray(existing.group_names) &&
    !syncFieldValuesEqual('group_names', existing.group_names, next.group_names)
  ) {
    conflicts.push(FIELD_NAMES.groupNames);
  }
  if (
    nonEmptyArray(existing.hearts) &&
    !syncFieldValuesEqual('hearts', existing.hearts, next.hearts)
  ) {
    conflicts.push(FIELD_NAMES.baseHeart);
  }
  if (
    nonEmptyArray(existing.blade_hearts) &&
    !syncFieldValuesEqual('blade_hearts', existing.blade_hearts, next.blade_hearts)
  ) {
    conflicts.push(FIELD_NAMES.bladeHeart);
  }
  if (
    nonEmptyArray(existing.requirements) &&
    !syncFieldValuesEqual('requirements', existing.requirements, next.requirements)
  ) {
    conflicts.push(FIELD_NAMES.requiredHeart);
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

function printCardTypeSyncReport(
  invalidSourceTypes: readonly CardTypeValidationIssue[],
  corrections: readonly CardTypeCorrection[]
) {
  if (invalidSourceTypes.length === 0 && corrections.length === 0) {
    return;
  }

  if (invalidSourceTypes.length > 0) {
    console.warn('\nCard type validation issues (rows skipped):');
    for (const issue of invalidSourceTypes.slice(0, 30)) {
      console.warn(
        `  ${issue.sourceRow.cardCode} row ${issue.sourceRow.rowNumber}: invalid ${FIELD_NAMES.cardType}=${formatValue(issue.sourceValue)}`
      );
    }
    if (invalidSourceTypes.length > 30) {
      console.warn(`  ... and ${invalidSourceTypes.length - 30} more invalid source card types`);
    }
  }

  if (corrections.length > 0) {
    console.log('\nCard type corrections:');
    for (const correction of corrections.slice(0, 30)) {
      console.log(
        `  ${correction.sourceRow.cardCode} row ${correction.sourceRow.rowNumber}: DB ${correction.existing.card_type} -> ${correction.sourceCardType} (source=${formatValue(correction.sourceValue)})`
      );
    }
    if (corrections.length > 30) {
      console.log(`  ... and ${corrections.length - 30} more card type corrections`);
    }
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
    case FIELD_NAMES.baseHeart:
      return 'hearts';
    case FIELD_NAMES.bladeHeart:
      return 'blade_hearts';
    case FIELD_NAMES.requiredHeart:
      return 'requirements';
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
            card_type = $2,
            name_jp = $3,
            name_cn = $4,
            group_names = $5,
            unit_name = $6,
            unit_name_raw = $7,
            card_text_jp = $8,
            card_text_cn = $9,
            hearts = $10,
            blade_hearts = $11,
            requirements = $12,
            product = $13,
            product_code = $14,
            image_source_uri = $15,
            source_external_id = $16,
            source_flags = $17,
            updated_at = now()
          WHERE card_code = $1
        `,
        [
          next.card_code,
          next.card_type,
          next.name_jp,
          next.name_cn,
          next.group_names == null ? null : JSON.stringify(next.group_names),
          next.unit_name,
          next.unit_name_raw,
          next.card_text_jp,
          next.card_text_cn,
          next.hearts == null ? null : JSON.stringify(next.hearts),
          next.blade_hearts == null ? null : JSON.stringify(next.blade_hearts),
          next.requirements == null ? null : JSON.stringify(next.requirements),
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
  console.log(`Loveca card text sync${args.dryRun ? ' (DRY RUN)' : ''}`);
  if (args.source === 'xlsx') {
    console.log(`  Source: xlsx`);
    console.log(`  Excel: ${args.xlsxPath}`);
  } else {
    console.log(`  Source: cloudbase`);
    console.log(`  CloudBase collection: ${args.cloudbaseCollection}`);
    if (args.cloudbaseLimit !== null) {
      console.log(`  CloudBase limit: ${args.cloudbaseLimit}`);
    }
  }

  const sourceRows = await readSyncSourceRows(args);
  const duplicates = summarizeDuplicateRows(sourceRows);
  const duplicateCodes = new Set(duplicates.keys());
  const usableRows = sourceRows.filter((row) => !duplicateCodes.has(row.cardCode));
  const sourceByCode = new Map(usableRows.map((row) => [row.cardCode, row]));

  console.log(`  Source rows: ${sourceRows.length}`);
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
        card_code, card_type, name_jp, name_cn,
        group_names, unit_name, unit_name_raw,
        card_text_jp, card_text_cn, hearts, blade_hearts, requirements,
        product, product_code, image_source_uri, source_external_id, source_flags
      FROM cards
      ORDER BY card_code
    `);

    const existingByCode = new Map(existingRows.map((row) => [row.card_code, row]));
    const sourceOnly = [...sourceByCode.keys()].filter((code) => !existingByCode.has(code));
    const dbOnly = existingRows.filter((row) => !sourceByCode.has(row.card_code));
    const warnings: string[] = [];
    const updates: PendingUpdate[] = [];
    const invalidSourceTypes: CardTypeValidationIssue[] = [];
    const cardTypeCorrections: CardTypeCorrection[] = [];

    for (const [code, sourceRow] of sourceByCode) {
      const existing = existingByCode.get(code);
      if (!existing) {
        continue;
      }

      const sourceValue = cleanString(sourceRow.values[FIELD_NAMES.cardType]);
      const sourceCardType = parseSourceCardType(sourceValue);
      if (!sourceCardType) {
        invalidSourceTypes.push({ sourceRow, sourceValue });
        continue;
      }
      if (sourceCardType !== existing.card_type) {
        cardTypeCorrections.push({
          sourceRow,
          existing,
          sourceValue: sourceValue!,
          sourceCardType,
        });
      }

      const rawNext = buildExcelSyncRecord(sourceRow, existing, sourceCardType, warnings);
      const conflictFields = collectConflictFields(existing, rawNext);
      const next = applyConflictFlag(rawNext, conflictFields.length > 0);
      const changedFields = collectChangedFields(existing, next);
      if (changedFields.length > 0) {
        updates.push({ existing, next, changedFields, conflictFields });
      }
    }

    console.log('\nDB comparison:');
    console.log(`  DB cards: ${existingRows.length}`);
    console.log(`  Source-only skipped: ${sourceOnly.length}`);
    console.log(`  DB-only untouched: ${dbOnly.length}`);
    console.log(
      `  Invalid or missing ${FIELD_NAMES.cardType} skipped: ${invalidSourceTypes.length}`
    );
    console.log(
      `  ${FIELD_NAMES.cardType} / DB card_type corrections: ${cardTypeCorrections.length}`
    );
    if (warnings.length > 0) {
      console.warn(`  Transform warnings: ${warnings.length}`);
      for (const warning of warnings.slice(0, 30)) {
        console.warn(`    ${warning}`);
      }
    }

    printUpdateSummary(updates);
    printConflictDetails(updates);
    printCardTypeSyncReport(invalidSourceTypes, cardTypeCorrections);

    if (sourceOnly.length > 0) {
      console.log(`\nSource-only card codes (not inserted): ${sourceOnly.slice(0, 40).join(', ')}`);
      if (sourceOnly.length > 40) {
        console.log(`  ... and ${sourceOnly.length - 40} more`);
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
    console.log(`Applied ${updates.length} Loveca source updates.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
