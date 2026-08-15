/**
 * Loveca Excel 卡牌数据同步脚本
 *
 * 同步 Excel 权威卡牌类型、展示与来源字段：
 * - name_jp / name_cn
 * - card_text_jp / card_text_cn
 * - group_names
 * - unit_name_raw / unit_name
 * - cost / blade / score
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
 * 使用方法：
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts --dry-run
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts --yes
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-loveca-excel.ts --source=cloudbase --dry-run
 * DATABASE_URL=postgresql://... MINIO_ENDPOINT=... npx tsx src/scripts/sync-cards-loveca-excel.ts --source=cloudbase --card-codes='PL!-sd1-004-SD,PL!-sd1-007-SD' --yes
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { parse as parseDotenv } from 'dotenv';
import * as Minio from 'minio';
import { Pool } from 'pg';
import sharp from 'sharp';
import { normalizeCardCode } from '../shared/utils/card-code.js';
import { appendDoubleGrayBladeHearts } from './card-sync-double-heart.js';
import { normalizeCardSyncGroupNames } from './card-sync-group-names.js';
import { resolveSyncedRuleFields } from './card-sync-rule-fields.js';
import { cardSyncTextValuesEqual } from './card-sync-text.js';
import {
  LOVECA_SYNC_BLADE_HEART_COLOR_MAP,
  LOVECA_SYNC_HEART_COLOR_MAP,
  LOVECA_SYNC_RAINBOW_HEART_TOKENS,
  type LovecaSyncHeartColor,
} from './card-sync-heart-colors.js';
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

type HeartColor = LovecaSyncHeartColor;

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
  readonly cardCodes: ReadonlySet<string> | null;
  readonly refreshImageFilenames: boolean;
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
  readonly cost: number | null;
  readonly blade: number | null;
  readonly hearts: HeartSyncItem[] | null;
  readonly blade_hearts: BladeHeartSyncItem[] | null;
  readonly score: number | null;
  readonly requirements: HeartSyncItem[] | null;
  readonly product: string | null;
  readonly product_code: string | null;
  readonly image_source_uri: string | null;
  readonly image_filename: string | null;
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
  readonly cost: number | null;
  readonly blade: number | null;
  readonly hearts: HeartSyncItem[] | null;
  readonly blade_hearts: BladeHeartSyncItem[] | null;
  readonly score: number | null;
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
  readonly changedFields: (keyof ExcelSyncRecord)[];
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
  cost: 'コスト',
  blade: 'ブレード',
  baseHeart: '基本ハート',
  bladeHeart: 'ブレードハート',
  specialHeart: '特殊ハート',
  requiredHeart: '必要ハート',
  score: 'スコア',
  imageSourceUri: '卡图链接',
  product: '収録商品',
  productCode: '商品编号',
  sourceExternalId: '数据标识',
} as const;

type SourceFieldName = (typeof FIELD_NAMES)[keyof typeof FIELD_NAMES];

const DEFAULT_CLOUDBASE_COLLECTION = 'loveca';
const DEFAULT_CLOUDBASE_BATCH_SIZE = 100;
const LOVECA_EXCEL_SOURCES_DIR = 'docs/card-data-sync/sources';
const IMAGE_SIZES = {
  thumb: { width: 100, quality: 75 },
  medium: { width: 300, quality: 80 },
  large: { width: 600, quality: 85 },
} as const;

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
  [FIELD_NAMES.cost]: [FIELD_NAMES.cost, 'cost', '费用'],
  [FIELD_NAMES.blade]: [FIELD_NAMES.blade, 'blade', 'BLADE', 'trigger_count', 'triggerCount'],
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
  [FIELD_NAMES.score]: [FIELD_NAMES.score, 'score', '分数'],
  [FIELD_NAMES.imageSourceUri]: [
    FIELD_NAMES.imageSourceUri,
    'image_source_uri',
    'imageSourceUri',
    'image_url',
    'imageUrl',
    'imgUrl',
    'image',
    'fileID',
    'fileId',
    'cloudId',
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
  'cost',
  'blade',
  'hearts',
  'blade_hearts',
  'score',
  'requirements',
  'product',
  'product_code',
  'image_source_uri',
  'source_external_id',
  'source_flags',
];

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
  let cardCodes: ReadonlySet<string> | null = null;
  let refreshImageFilenames = false;

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
      if (value !== DEFAULT_CLOUDBASE_COLLECTION) {
        throw new Error(
          `CloudBase source is fixed to the ${DEFAULT_CLOUDBASE_COLLECTION} collection`
        );
      }
      cloudbaseCollection = DEFAULT_CLOUDBASE_COLLECTION;
    } else if (arg.startsWith('--cloudbase-limit=')) {
      cloudbaseLimit = parseNonNegativeIntegerArg(arg, '--cloudbase-limit=');
    } else if (arg.startsWith('--cloudbase-batch-size=')) {
      cloudbaseBatchSize = parsePositiveIntegerArg(arg, '--cloudbase-batch-size=');
    } else if (arg.startsWith('--card-codes=')) {
      cardCodes = parseCardCodesArg(arg.slice('--card-codes='.length));
    } else if (arg === '--refresh-image-filenames') {
      refreshImageFilenames = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (refreshImageFilenames && !cardCodes) {
    throw new Error('--refresh-image-filenames requires --card-codes');
  }

  return {
    dryRun,
    yes,
    source,
    xlsxPath: source === 'xlsx' ? resolveLovecaExcelPath(xlsxPath) : xlsxPath,
    cloudbaseCollection,
    cloudbaseLimit,
    cloudbaseBatchSize,
    cardCodes,
    refreshImageFilenames,
  };
}

function parseCardCodesArg(raw: string): ReadonlySet<string> {
  const values = raw
    .split(/[,，;；\s]+/)
    .map((value) => cleanString(value))
    .filter((value): value is string => value !== null)
    .map(normalizeCardCode);
  if (values.length === 0) {
    throw new Error('--card-codes requires at least one card code');
  }
  return new Set(values);
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
      return readLovecaExcelRows(await exportCloudbaseExcel(args));
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

function createCloudbaseApp() {
  return cloudbaseSDK.init({
    env: requiredEnv('CLOUDBASE_ENV_ID'),
    secretId: requiredEnv('CLOUDBASE_SECRET_ID', 'CLOUDBASE_SECRETID'),
    secretKey: requiredEnv('CLOUDBASE_SECRET_KEY', 'CLOUDBASE_SECRETKEY'),
  });
}

async function exportCloudbaseExcel(args: Args): Promise<string> {
  const cloudbase = createCloudbaseApp();
  const db = cloudbase.database();
  const documents = await readCloudbaseDocuments(
    db.collection(args.cloudbaseCollection),
    args.cloudbaseLimit,
    args.cloudbaseBatchSize
  );

  const exportPath = nextCloudbaseExcelPath();
  writeCloudbaseDocumentsAsXlsx(documents, exportPath);
  console.log(`  Exported Excel: ${exportPath}`);
  return exportPath;
}

function nextCloudbaseExcelPath(): string {
  fs.mkdirSync(LOVECA_EXCEL_SOURCES_DIR, { recursive: true });
  for (let offsetSeconds = 0; offsetSeconds < 60; offsetSeconds++) {
    const timestamp = formatTimestamp(new Date(Date.now() + offsetSeconds * 1000));
    const candidate = path.resolve(LOVECA_EXCEL_SOURCES_DIR, `loveca_${timestamp}.xlsx`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Unable to allocate a unique CloudBase Excel export filename');
}

function formatTimestamp(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}${part(value.getMonth() + 1)}${part(value.getDate())}${part(value.getHours())}${part(value.getMinutes())}${part(value.getSeconds())}`;
}

function writeCloudbaseDocumentsAsXlsx(
  documents: readonly Record<string, unknown>[],
  outputPath: string
): void {
  const canonicalHeaders = Object.values(FIELD_NAMES);
  const canonicalHeaderSet = new Set<string>(canonicalHeaders);
  const sourceAliases = new Set(Object.values(CLOUDBASE_FIELD_ALIASES).flat());
  const extraHeaders = [...new Set(documents.flatMap((document) => Object.keys(document)))]
    .filter((header) => !canonicalHeaderSet.has(header) && !sourceAliases.has(header))
    .sort();
  const headers = [...canonicalHeaders, ...extraHeaders];
  const rows = documents.map((document) => [
    ...canonicalHeaders.map((header) =>
      stringifyCloudbaseFieldValue(readCloudbaseField(document, header))
    ),
    ...extraHeaders.map((header) => stringifyCloudbaseFieldValue(document[header])),
  ]);
  writeMinimalXlsx(outputPath, headers, rows);
}

function writeMinimalXlsx(
  outputPath: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loveca-cloudbase-xlsx-'));
  try {
    const files: Record<string, string> = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>`,
      'xl/worksheets/sheet1.xml': buildWorksheetXml([headers, ...rows]),
    };
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolutePath = path.join(tempDir, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, contents);
    }
    execFileSync('zip', ['-q', '-r', outputPath, '.'], { cwd: tempDir });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildWorksheetXml(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${excelColumnName(columnIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function excelColumnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function filterSelectedRows(rows: readonly ExcelCardRow[], cardCodes: ReadonlySet<string> | null) {
  if (!cardCodes) {
    return [...rows];
  }
  const availableCodes = new Set(rows.map((row) => row.cardCode));
  const missingCodes = [...cardCodes].filter((cardCode) => !availableCodes.has(cardCode));
  if (missingCodes.length > 0) {
    throw new Error(`Requested card codes missing from source: ${missingCodes.join(', ')}`);
  }
  return rows.filter((row) => cardCodes.has(row.cardCode));
}

async function uploadSelectedCardImages(
  rows: readonly ExcelCardRow[],
  existingByCode: ReadonlyMap<string, ExistingCardRow>,
  refreshImageFilenames: boolean
): Promise<ReadonlyMap<string, string>> {
  const minio = createMinioClient();
  if (!(await minio.client.bucketExists(minio.bucket))) {
    await minio.client.makeBucket(minio.bucket);
  }
  let cloudbase: ReturnType<typeof createCloudbaseApp> | null = null;
  const uploadedFilenames = new Map<string, string>();

  for (const row of rows) {
    const sourceUri = resolveImageSourceUri(cleanString(row.values[FIELD_NAMES.imageSourceUri]));
    if (!sourceUri) {
      throw new Error(
        `${row.cardCode}: missing ${FIELD_NAMES.imageSourceUri}; image was not uploaded`
      );
    }
    let imageBuffer: Buffer;
    if (/^https?:\/\//i.test(sourceUri)) {
      imageBuffer = await downloadHttpImage(sourceUri);
    } else {
      cloudbase ??= createCloudbaseApp();
      imageBuffer = await downloadCloudbaseImage(cloudbase, sourceUri);
    }
    const imageBaseName = refreshImageFilenames
      ? `${row.cardCode}-${createHash('sha256').update(imageBuffer).digest('hex').slice(0, 12)}`
      : (imageBaseNameFromFilename(existingByCode.get(row.cardCode)?.image_filename ?? null) ??
        imageBaseNameFromFilename(basenameFromUri(sourceUri)) ??
        row.cardCode);
    const compressed = await compressImageBuffers(imageBuffer);
    for (const [sizeName, buffer] of Object.entries(compressed)) {
      const objectKey = `${sizeName}/${imageBaseName}.webp`;
      await minio.client.putObject(minio.bucket, objectKey, buffer, buffer.length, {
        'Content-Type': 'image/webp',
      });
    }
    const imageFilename = `${imageBaseName}.webp`;
    uploadedFilenames.set(row.cardCode, imageFilename);
    console.log(`  Re-uploaded image: ${row.cardCode} (${imageFilename})`);
  }
  return uploadedFilenames;
}

async function updateImageFilenames(
  pool: Pool,
  imageFilenames: ReadonlyMap<string, string>
): Promise<void> {
  if (imageFilenames.size === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [cardCode, imageFilename] of imageFilenames) {
      const result = await client.query(
        'UPDATE cards SET image_filename = $2, updated_at = now() WHERE card_code = $1',
        [cardCode, imageFilename]
      );
      if (result.rowCount !== 1) {
        throw new Error(`${cardCode}: image filename update matched ${result.rowCount ?? 0} rows`);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createMinioClient(): { client: Minio.Client; bucket: string } {
  const port = Number(readEnvValue('MINIO_PORT') ?? '9000');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('MINIO_PORT must be an integer between 1 and 65535');
  }
  return {
    client: new Minio.Client({
      endPoint: requiredEnv('MINIO_ENDPOINT'),
      port,
      useSSL: readEnvValue('MINIO_USE_SSL') === 'true',
      accessKey: requiredEnv('MINIO_ACCESS_KEY'),
      secretKey: requiredEnv('MINIO_SECRET_KEY'),
    }),
    bucket: readEnvValue('MINIO_BUCKET') ?? 'loveca-cards',
  };
}

function resolveImageSourceUri(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith('[') && !value.startsWith('{') && !value.startsWith('"')) return value;
  try {
    return findImageUri(JSON.parse(value));
  } catch {
    return value;
  }
}

function findImageUri(value: unknown): string | null {
  if (typeof value === 'string') return cleanString(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = findImageUri(item);
      if (resolved) return resolved;
    }
  } else if (isRecord(value)) {
    for (const key of ['fileID', 'fileId', 'cloudId', 'url', 'src', 'path', 'imageUrl']) {
      const resolved = findImageUri(value[key]);
      if (resolved) return resolved;
    }
  }
  return null;
}

async function downloadHttpImage(url: string): Promise<Buffer> {
  const response = await globalThis.fetch(url);
  if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function downloadCloudbaseImage(
  cloudbase: ReturnType<typeof createCloudbaseApp>,
  sourceUri: string
): Promise<Buffer> {
  const response = await cloudbase.getTempFileURL({
    fileList: [{ fileID: sourceUri, maxAge: 600 }],
  });
  const item = response.fileList?.[0];
  if (!item || item.code !== 'SUCCESS' || !item.tempFileURL) {
    const failure: unknown = item?.code;
    throw new Error(typeof failure === 'string' ? failure : 'CloudBase temp file URL failed');
  }
  return downloadHttpImage(item.tempFileURL);
}

async function compressImageBuffers(input: Buffer) {
  const metadata = await sharp(input).metadata();
  const rotate =
    metadata.width != null && metadata.height != null && metadata.width > metadata.height;
  const result: Record<keyof typeof IMAGE_SIZES, Buffer> = {} as Record<
    keyof typeof IMAGE_SIZES,
    Buffer
  >;
  for (const [sizeName, config] of Object.entries(IMAGE_SIZES) as Array<
    [keyof typeof IMAGE_SIZES, (typeof IMAGE_SIZES)[keyof typeof IMAGE_SIZES]]
  >) {
    let pipeline = sharp(input);
    if (rotate) pipeline = pipeline.rotate(90);
    result[sizeName] = await pipeline
      .resize(config.width, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: config.quality })
      .toBuffer();
  }
  return result;
}

function imageBaseNameFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  return cleanString(filename.replace(/^.*[\\/]/, '').replace(/\.(jpg|jpeg|png|webp)$/i, ''));
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
    const items = normalizeCardSyncGroupNames(
      parsed.map((item) => (typeof item === 'string' ? item : ''))
    );
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
    const color = LOVECA_SYNC_RAINBOW_HEART_TOKENS.has(token)
      ? 'RAINBOW'
      : LOVECA_SYNC_HEART_COLOR_MAP[token];
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
    const heartColor = LOVECA_SYNC_BLADE_HEART_COLOR_MAP[token];
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
  const withoutQuery = uri.split(/[?#]/)[0] ?? uri;
  try {
    if (/^https?:\/\//i.test(uri)) {
      return cleanString(path.posix.basename(decodeURIComponent(new URL(uri).pathname)));
    }
  } catch {
    // Fall through to simple path splitting.
  }
  return cleanString(withoutQuery.split(/[\\/]/).pop());
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
  const ruleFields = resolveSyncedRuleFields(
    sourceCardType,
    {
      cost: value(FIELD_NAMES.cost),
      blade: value(FIELD_NAMES.blade),
      score: value(FIELD_NAMES.score),
    },
    existing,
    context,
    warnings
  );
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
    cost: ruleFields.cost,
    blade: ruleFields.blade,
    hearts: baseHearts ?? existing.hearts,
    blade_hearts: bladeHearts ?? existing.blade_hearts,
    score: ruleFields.score,
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
    case 'card_text_jp':
    case 'card_text_cn':
      return cardSyncTextValuesEqual(left, right);
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

function collectChangedFields(
  existing: ExistingCardRow,
  next: ExcelSyncRecord
): (keyof ExcelSyncRecord)[] {
  const result: (keyof ExcelSyncRecord)[] = [];
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
    if (
      nonEmpty(existing[field] as string | null) &&
      !syncFieldValuesEqual(field, existing[field], next[field])
    ) {
      conflicts.push(label);
    }
  };
  const checkNumber = (field: keyof ExistingCardRow & keyof ExcelSyncRecord, label: string) => {
    if (existing[field] != null && !syncFieldValuesEqual(field, existing[field], next[field])) {
      conflicts.push(label);
    }
  };

  checkString('product', FIELD_NAMES.product);
  checkString('unit_name', FIELD_NAMES.unitName);
  checkString('unit_name_raw', FIELD_NAMES.unitName);
  checkString('name_jp', FIELD_NAMES.nameJp);
  checkString('name_cn', FIELD_NAMES.nameCn);
  checkString('card_text_jp', FIELD_NAMES.effectJa);
  checkString('card_text_cn', FIELD_NAMES.effectCn);
  checkNumber('cost', FIELD_NAMES.cost);
  checkNumber('blade', FIELD_NAMES.blade);
  checkNumber('score', FIELD_NAMES.score);

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
  const cardEffectDifferenceCount = updates.filter((update) =>
    update.changedFields.some(isCardEffectField)
  ).length;
  console.log(`  Pending updates: ${updates.length}`);
  console.log(`  Updates with warning/conflict: ${conflictCount}`);
  console.log(`  Cards with card-effect text differences: ${cardEffectDifferenceCount}`);

  if (updates.length === 0) {
    return;
  }

  console.log('\nPending update details:');
  for (const update of updates) {
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
    for (const field of update.changedFields) {
      const warningPrefix = isCardEffectField(field) ? 'WARNING card-effect difference: ' : '';
      console.log(
        `    ${warningPrefix}${syncFieldLabel(field)}: ${formatValue(update.existing[field])} -> ${formatValue(update.next[field])}`
      );
    }
  }
}

function isCardEffectField(field: keyof ExcelSyncRecord): field is 'card_text_jp' | 'card_text_cn' {
  return field === 'card_text_jp' || field === 'card_text_cn';
}

function syncFieldLabel(field: keyof ExcelSyncRecord): string {
  switch (field) {
    case 'card_code':
      return `${field} (${FIELD_NAMES.cardCode})`;
    case 'card_type':
      return `${field} (${FIELD_NAMES.cardType})`;
    case 'name_jp':
      return `${field} (${FIELD_NAMES.nameJp})`;
    case 'name_cn':
      return `${field} (${FIELD_NAMES.nameCn})`;
    case 'group_names':
      return `${field} (${FIELD_NAMES.groupNames})`;
    case 'unit_name':
    case 'unit_name_raw':
      return `${field} (${FIELD_NAMES.unitName})`;
    case 'card_text_jp':
      return `${field} (${FIELD_NAMES.effectJa})`;
    case 'card_text_cn':
      return `${field} (${FIELD_NAMES.effectCn})`;
    case 'cost':
      return `${field} (${FIELD_NAMES.cost})`;
    case 'blade':
      return `${field} (${FIELD_NAMES.blade})`;
    case 'hearts':
      return `${field} (${FIELD_NAMES.baseHeart})`;
    case 'blade_hearts':
      return `${field} (${FIELD_NAMES.bladeHeart}/${FIELD_NAMES.specialHeart})`;
    case 'score':
      return `${field} (${FIELD_NAMES.score})`;
    case 'requirements':
      return `${field} (${FIELD_NAMES.requiredHeart})`;
    case 'product':
      return `${field} (${FIELD_NAMES.product})`;
    case 'product_code':
      return `${field} (${FIELD_NAMES.productCode})`;
    case 'image_source_uri':
      return `${field} (${FIELD_NAMES.imageSourceUri})`;
    case 'source_external_id':
      return `${field} (${FIELD_NAMES.sourceExternalId})`;
    case 'source_flags':
      return field;
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
  for (const update of conflicts) {
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
    case FIELD_NAMES.cost:
      return 'cost';
    case FIELD_NAMES.blade:
      return 'blade';
    case FIELD_NAMES.score:
      return 'score';
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

async function confirmApplyUpdates(updateCount: number, imageCount: number): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive update confirmation requires a TTY. Use --yes to apply.');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const imageMessage = imageCount > 0 ? ` and force re-upload ${imageCount} card images` : '';
    const answer = (
      await rl.question(`\nApply ${updateCount} Loveca Excel updates${imageMessage}? [Y/n] `)
    )
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
            cost = $10,
            blade = $11,
            hearts = $12,
            blade_hearts = $13,
            score = $14,
            requirements = $15,
            product = $16,
            product_code = $17,
            image_source_uri = $18,
            source_external_id = $19,
            source_flags = $20,
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
          next.cost,
          next.blade,
          next.hearts == null ? null : JSON.stringify(next.hearts),
          next.blade_hearts == null ? null : JSON.stringify(next.blade_hearts),
          next.score,
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

  const allSourceRows = await readSyncSourceRows(args);
  const sourceRows = filterSelectedRows(allSourceRows, args.cardCodes);
  const duplicates = summarizeDuplicateRows(sourceRows);
  const duplicateCodes = new Set(duplicates.keys());
  if (args.cardCodes && duplicates.size > 0) {
    throw new Error(
      `Requested card codes have duplicate source rows: ${[...duplicates.keys()].join(', ')}`
    );
  }
  const usableRows = sourceRows.filter((row) => !duplicateCodes.has(row.cardCode));
  const sourceByCode = new Map(usableRows.map((row) => [row.cardCode, row]));

  console.log(`  Source rows: ${sourceRows.length}`);
  if (args.cardCodes) {
    console.log(`  Selected card codes: ${[...args.cardCodes].join(', ')}`);
    console.log(`  Images to force re-upload: ${sourceRows.length}`);
    console.log(`  Refresh image filenames: ${args.refreshImageFilenames ? 'yes' : 'no'}`);
  }
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

  const databaseUrl = readEnvValue('DATABASE_URL');
  if (!databaseUrl) {
    if (!args.dryRun) {
      throw new Error(
        'DATABASE_URL is required unless --dry-run is used for parse-only validation'
      );
    }
    console.log('\nNo DATABASE_URL provided; parse-only dry run finished.');
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { rows: existingRows } = await pool.query<ExistingCardRow>(`
      SELECT
        card_code, card_type, name_jp, name_cn,
        group_names, unit_name, unit_name_raw,
        card_text_jp, card_text_cn, cost, blade, hearts, blade_hearts, score, requirements,
        product, product_code, image_source_uri, image_filename, source_external_id, source_flags
      FROM cards
      ORDER BY card_code
    `);

    const existingByCode = new Map(existingRows.map((row) => [row.card_code, row]));
    if (args.cardCodes) {
      const missingDatabaseCodes = [...args.cardCodes].filter((code) => !existingByCode.has(code));
      if (missingDatabaseCodes.length > 0) {
        throw new Error(
          `Requested card codes missing from database: ${missingDatabaseCodes.join(', ')}`
        );
      }
    }
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

    if (args.dryRun) {
      console.log('\nDry run finished. No DB changes or image uploads applied.');
      return;
    }

    if (updates.length === 0 && !args.cardCodes) {
      console.log('\nNo updates needed.');
      return;
    }

    const shouldApply =
      args.yes || (await confirmApplyUpdates(updates.length, args.cardCodes?.size ?? 0));
    if (!shouldApply) {
      console.log('Update cancelled.');
      return;
    }

    let uploadedImageFilenames: ReadonlyMap<string, string> = new Map();
    if (args.cardCodes) {
      uploadedImageFilenames = await uploadSelectedCardImages(
        usableRows,
        existingByCode,
        args.refreshImageFilenames
      );
    }
    if (updates.length > 0) {
      await applyUpdates(pool, updates);
    }
    if (args.refreshImageFilenames) {
      await updateImageFilenames(pool, uploadedImageFilenames);
    }
    console.log(`Applied ${updates.length} Loveca source updates.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
