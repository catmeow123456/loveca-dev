/**
 * CloudBase 新卡导入脚本
 *
 * 只从 CloudBase 卡牌集合导入当前 cards 表中不存在的新卡。
 * 默认 dry-run 不写库、不上传图片；正式写入必须显式确认图片策略。
 *
 * 使用方法：
 * CLOUDBASE_ENV_ID=... CLOUDBASE_SECRET_ID=... CLOUDBASE_SECRET_KEY=... \
 * DATABASE_URL=postgresql://... \
 * pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --cloudbase-collection=loveca --dry-run
 *
 * DATABASE_URL=postgresql://... MINIO_ENDPOINT=... MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
 * pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --cloudbase-collection=loveca --upload-images --yes
 */

import { createHash, randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import * as fs from 'node:fs';
import { request as httpsRequest } from 'node:https';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { isIP, type LookupFunction } from 'node:net';
import { pathToFileURL } from 'node:url';
import * as readline from 'node:readline/promises';
import { parse as parseDotenv } from 'dotenv';
import * as Minio from 'minio';
import { Pool } from 'pg';
import sharp from 'sharp';
import { normalizeCardCode, validateCardCode } from '../shared/utils/card-code.js';
import { appendDoubleGrayBladeHearts } from './card-sync-double-heart.js';
import { normalizeCardSyncGroupNames } from './card-sync-group-names.js';

const require = createRequire(import.meta.url);
const cloudbaseSDK = require('@cloudbase/node-sdk') as {
  init(config: { env: string; secretId: string; secretKey: string }): CloudBaseApp;
};

export type CardType = 'MEMBER' | 'LIVE' | 'ENERGY';
export type CardStatus = 'DRAFT' | 'PUBLISHED';
type HeartColor =
  'PINK' | 'RED' | 'YELLOW' | 'GREEN' | 'BLUE' | 'PURPLE' | 'ORANGE' | 'GRAY' | 'RAINBOW';
type BladeHeartEffect = 'HEART' | 'DRAW' | 'SCORE';
type ImageMode = 'upload' | 'skip' | 'none';
type ImageFailureSourceFlag =
  'missingImage' | 'imageDownloadFailed' | 'imageProcessFailed' | 'imageUploadFailed';

interface Args {
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly cloudbaseCollection: string;
  readonly cloudbaseLimit: number | null;
  readonly cloudbaseBatchSize: number;
  readonly status: CardStatus;
  readonly imageMode: ImageMode;
  readonly overwriteImages: boolean;
  readonly allowMissingImages: boolean;
  readonly reportPath: string | null;
}

export interface CloudBaseApp {
  database(): {
    collection(name: string): CloudBaseCollection;
  };
  getTempFileURL(input: {
    fileList: Array<string | { fileID: string; maxAge: number; urlType?: string }>;
  }): Promise<{
    fileList?: Array<{
      code?: string;
      fileID?: string;
      tempFileURL?: string;
      message?: string;
    }>;
    requestId?: string;
  }>;
}

export interface CloudBaseCollection {
  orderBy?(field: string, direction: 'asc' | 'desc'): CloudBaseCollection;
  skip(offset: number): {
    limit(limit: number): {
      get(): Promise<{ data?: unknown[] }>;
    };
  };
}

export interface SourceRow {
  readonly rowNumber: number;
  readonly document: Record<string, unknown>;
  readonly cardCode: string;
  readonly sourceId: string | null;
}

export interface InvalidSourceRow {
  readonly rowNumber: number;
  readonly sourceId: string | null;
  readonly reason: string;
}

export interface HeartItem {
  readonly color: HeartColor;
  readonly count: number;
}

export interface BladeHeartItem {
  readonly effect: BladeHeartEffect;
  readonly heartColor?: HeartColor;
}

export interface SourceFlags {
  readonly cloudbaseOnly?: boolean;
  readonly importedBy?: string;
  readonly missingRuleFields?: readonly string[];
  readonly parseWarnings?: readonly string[];
  readonly missingImage?: boolean;
  readonly imageSkipped?: boolean;
  readonly imageDownloadFailed?: boolean;
  readonly imageProcessFailed?: boolean;
  readonly imageUploadFailed?: boolean;
  readonly [key: string]: unknown;
}

export interface CardInsertRecord {
  readonly card_code: string;
  readonly card_type: CardType;
  readonly name_jp: string | null;
  readonly name_cn: string | null;
  readonly work_names: string[] | null;
  readonly group_names: string[] | null;
  readonly unit_name: string | null;
  readonly unit_name_raw: string | null;
  readonly cost: number | null;
  readonly blade: number | null;
  readonly hearts: HeartItem[] | null;
  readonly blade_hearts: BladeHeartItem[] | null;
  readonly score: number | null;
  readonly requirements: HeartItem[] | null;
  readonly card_text_jp: string | null;
  readonly card_text_cn: string | null;
  readonly image_filename: string | null;
  readonly image_source_uri: string | null;
  readonly rare: string | null;
  readonly product: string | null;
  readonly product_code: string | null;
  readonly source_external_id: string | null;
  readonly source_flags: SourceFlags | null;
  readonly status: CardStatus;
}

export interface ImagePlan {
  readonly sourceUri: string | null;
  readonly imageFilename: string | null;
  readonly imageBaseName: string | null;
}

export interface TransformResult {
  readonly row: SourceRow;
  readonly record: CardInsertRecord | null;
  readonly imagePlan: ImagePlan;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface ExistingCardRow {
  readonly card_code: string;
  readonly image_filename: string | null;
}

export interface PreparedCandidate {
  readonly transform: TransformResult;
  readonly record: CardInsertRecord;
  readonly imagePlan: ImagePlan;
}

export interface SkippedCandidate {
  readonly cardCode: string;
  readonly reason: string;
  readonly detail?: string;
}

export interface ImageProcessResult {
  readonly cardCode: string;
  readonly ok: boolean;
  /** Versioned filename that may be committed only by the task holding the current DB lease. */
  readonly imageFilename: string | null;
  readonly uploadedKeys: readonly string[];
  readonly reusedKeys: readonly string[];
  readonly cleanupFailures: readonly string[];
  readonly error?: string;
  readonly sourceFlag?: ImageFailureSourceFlag;
}

export interface CardImageProcessingOptions {
  readonly overwriteImages: boolean;
  /** Unique per import execution; hashed before it becomes part of an object key. */
  readonly imageObjectVersion: string;
  readonly signal?: AbortSignal;
  readonly assertCurrent?: () => Promise<void>;
  readonly imageLoader?: (
    cloudbase: CloudBaseApp,
    sourceUri: string,
    signal?: AbortSignal
  ) => Promise<Buffer>;
}

export interface InsertResult {
  readonly cardCode: string;
  readonly inserted: boolean;
  readonly error?: string;
}

export interface CloudbaseCardSnapshot {
  readonly documents: readonly Record<string, unknown>[];
  readonly invalidRows: readonly InvalidSourceRow[];
  readonly sourceRows: readonly SourceRow[];
  readonly duplicateRows: Map<string, SourceRow[]>;
  readonly transforms: readonly TransformResult[];
}

export interface CardExportRecord {
  readonly cardCode: string;
  readonly cardType: CardType;
  readonly nameJp: string | null;
  readonly nameCn: string | null;
  readonly workNames: string[] | null;
  readonly groupNames: string[] | null;
  readonly unitName: string | null;
  readonly unitNameRaw: string | null;
  readonly cost: number | null;
  readonly blade: number | null;
  readonly hearts: readonly HeartItem[] | null;
  readonly bladeHearts: readonly BladeHeartItem[] | null;
  readonly score: number | null;
  readonly requirements: readonly HeartItem[] | null;
  readonly cardTextJp: string | null;
  readonly cardTextCn: string | null;
  readonly imageFilename: string | null;
  readonly imageSourceUri: string | null;
  readonly rare: string | null;
  readonly product: string | null;
  readonly productCode: string | null;
  readonly sourceExternalId: string | null;
  readonly sourceFlags: SourceFlags | null;
  readonly status: CardStatus;
}

export const DEFAULT_CLOUDBASE_COLLECTION = 'loveca';
export const DEFAULT_CLOUDBASE_BATCH_SIZE = 100;
const SCRIPT_NAME = 'sync-cards-cloudbase-new';
const IMAGE_SIZES = {
  thumb: { width: 100, quality: 75 },
  medium: { width: 300, quality: 80 },
  large: { width: 600, quality: 85 },
} as const;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 20_000;
const IMAGE_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_INPUT_PIXELS = 32 * 1024 * 1024;
const IMAGE_DIGEST_METADATA_KEY = 'loveca-sha256';

export interface ResolvedImageAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type ImageHostResolver = (hostname: string) => Promise<readonly ResolvedImageAddress[]>;

interface ImageCleanupFailure {
  readonly cardCode: string;
  readonly objectKey: string;
  readonly message: string;
}

const FIELD_ALIASES = {
  cardCode: ['カード番号', 'card_code', 'cardCode', 'code', 'card_no', 'cardNo', 'card_number'],
  cardType: ['type'],
  nameJp: [
    'カード名',
    'name_jp',
    'nameJp',
    'name_ja',
    'nameJa',
    'card_name_jp',
    'cardNameJp',
    'name',
  ],
  nameCn: ['卡牌中文名', 'name_cn', 'nameCn', 'nameCN', 'card_name_cn', 'cardNameCn', 'card_name'],
  workNames: ['作品名', 'work_names', 'workNames', 'series', 'work', 'works', 'group'],
  groupNames: [
    '真实团体',
    'group_names',
    'groupNames',
    'groups',
    'real_group',
    'realGroup',
    'real_groups',
    'realGroups',
  ],
  unitName: [
    '真实小队',
    'unit_name_raw',
    'unitNameRaw',
    'unit_name',
    'unitName',
    'real_unit',
    'realUnit',
    'unit',
  ],
  cost: ['cost', '费用', 'コスト'],
  blade: ['blade', 'BLADE', 'ブレード', 'trigger_count', 'triggerCount'],
  hearts: ['基本ハート', 'hearts', 'heart', 'base_heart', 'baseHeart'],
  bladeHearts: ['ブレードハート', 'blade_hearts', 'bladeHearts', 'blade_heart', 'bladeHeart'],
  specialHearts: ['特殊ハート', 'special_hearts', 'specialHearts', 'special_heart', 'specialHeart'],
  score: ['score', '分数', 'スコア'],
  requirements: ['必要ハート', 'requirements', 'requirement', 'need_heart', 'needHeart'],
  cardTextJp: [
    '多行日文效果',
    'card_text_jp',
    'cardTextJp',
    'effect_jp',
    'effectJp',
    'effect_multi',
    'effectMulti',
    'ability',
  ],
  cardTextCn: [
    '多行中文效果',
    'card_text_cn',
    'cardTextCn',
    'effect_cn',
    'effectCn',
    'effectCN_multi',
    'effectCnMulti',
  ],
  imageFilename: ['image_filename', 'imageFilename', '_img', 'img', 'image_name', 'imageName'],
  imageSourceUri: [
    '卡图链接',
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
  rare: ['rare', 'rarity', 'レアリティ'],
  product: ['収録商品', 'product'],
  productCode: ['商品编号', 'product_code', 'productCode', 'product_no', 'productNo'],
  sourceExternalId: [
    '数据标识',
    'source_external_id',
    'sourceExternalId',
    'external_id',
    '_id',
    'id',
  ],
  sourceFlags: ['source_flags', 'sourceFlags'],
} as const;

const TYPE_MAP = new Map<string, CardType>([
  ['member', 'MEMBER'],
  ['members', 'MEMBER'],
  ['メンバー', 'MEMBER'],
  ['成员', 'MEMBER'],
  ['會員', 'MEMBER'],
  ['13', 'MEMBER'],
  ['live', 'LIVE'],
  ['ライブ', 'LIVE'],
  ['14', 'LIVE'],
  ['energy', 'ENERGY'],
  ['エネルギー', 'ENERGY'],
  ['能量', 'ENERGY'],
  ['15', 'ENERGY'],
]);

const HEART_COLOR_MAP = new Map<string, HeartColor>([
  ['pink', 'PINK'],
  ['p', 'PINK'],
  ['heart01', 'PINK'],
  ['b_heart01', 'PINK'],
  ['01', 'PINK'],
  ['ピンク', 'PINK'],
  ['桃', 'PINK'],
  ['粉', 'PINK'],
  ['粉色', 'PINK'],
  ['red', 'RED'],
  ['r', 'RED'],
  ['heart02', 'RED'],
  ['b_heart02', 'RED'],
  ['02', 'RED'],
  ['赤', 'RED'],
  ['红', 'RED'],
  ['紅', 'RED'],
  ['yellow', 'YELLOW'],
  ['y', 'YELLOW'],
  ['heart03', 'YELLOW'],
  ['b_heart03', 'YELLOW'],
  ['03', 'YELLOW'],
  ['黄', 'YELLOW'],
  ['黃色', 'YELLOW'],
  ['黄色', 'YELLOW'],
  ['green', 'GREEN'],
  ['g', 'GREEN'],
  ['heart04', 'GREEN'],
  ['b_heart04', 'GREEN'],
  ['04', 'GREEN'],
  ['緑', 'GREEN'],
  ['绿', 'GREEN'],
  ['绿色', 'GREEN'],
  ['綠色', 'GREEN'],
  ['blue', 'BLUE'],
  ['heart05', 'BLUE'],
  ['b_heart05', 'BLUE'],
  ['05', 'BLUE'],
  ['青', 'BLUE'],
  ['蓝', 'BLUE'],
  ['藍', 'BLUE'],
  ['purple', 'PURPLE'],
  ['heart06', 'PURPLE'],
  ['b_heart06', 'PURPLE'],
  ['06', 'PURPLE'],
  ['紫', 'PURPLE'],
  ['orange', 'ORANGE'],
  ['オレンジ', 'ORANGE'],
  ['橙', 'ORANGE'],
  ['gray', 'GRAY'],
  ['grey', 'GRAY'],
  ['colorless', 'GRAY'],
  ['all', 'RAINBOW'],
  ['any', 'RAINBOW'],
  ['rainbow', 'RAINBOW'],
  ['heart0', 'RAINBOW'],
  ['b_all', 'RAINBOW'],
  ['0', 'RAINBOW'],
  ['無', 'RAINBOW'],
  ['无', 'RAINBOW'],
  ['全', 'RAINBOW'],
]);

const SPECIAL_HEART_EFFECT_MAP = new Map<string, Exclude<BladeHeartEffect, 'HEART'>>([
  ['draw', 'DRAW'],
  ['ドロー', 'DRAW'],
  ['抽牌', 'DRAW'],
  ['score', 'SCORE'],
  ['bonus', 'SCORE'],
  ['スコア', 'SCORE'],
  ['分数', 'SCORE'],
  ['分數', 'SCORE'],
]);

let dotenvValues: Record<string, string> | null = null;

function parseArgs(argv: readonly string[]): Args {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let dryRun = false;
  let yes = false;
  let cloudbaseCollection = DEFAULT_CLOUDBASE_COLLECTION;
  let cloudbaseLimit: number | null = null;
  let cloudbaseBatchSize = DEFAULT_CLOUDBASE_BATCH_SIZE;
  let status: CardStatus = 'DRAFT';
  let imageMode: ImageMode = 'none';
  let overwriteImages = false;
  let allowMissingImages = false;
  let reportPath: string | null = null;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg.startsWith('--cloudbase-collection=')) {
      cloudbaseCollection = requireNonEmptyArg(arg, '--cloudbase-collection=');
    } else if (arg.startsWith('--cloudbase-limit=')) {
      cloudbaseLimit = parseNonNegativeIntegerArg(arg, '--cloudbase-limit=');
    } else if (arg.startsWith('--cloudbase-batch-size=')) {
      cloudbaseBatchSize = parsePositiveIntegerArg(arg, '--cloudbase-batch-size=');
    } else if (arg.startsWith('--status=')) {
      const value = arg.slice('--status='.length).toUpperCase();
      if (value !== 'DRAFT' && value !== 'PUBLISHED') {
        throw new Error(`Invalid --status value: ${value}. Expected DRAFT or PUBLISHED.`);
      }
      status = value;
    } else if (arg === '--upload-images') {
      imageMode = 'upload';
    } else if (arg === '--skip-images') {
      imageMode = 'skip';
    } else if (arg === '--overwrite-images') {
      overwriteImages = true;
    } else if (arg === '--allow-missing-images') {
      allowMissingImages = true;
    } else if (arg.startsWith('--report=')) {
      reportPath = requireNonEmptyArg(arg, '--report=');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (dryRun && imageMode === 'upload') {
    throw new Error('--upload-images cannot be used with --dry-run');
  }
  if (!dryRun && imageMode === 'none') {
    throw new Error('Formal import requires either --upload-images or --skip-images');
  }
  if (overwriteImages && imageMode !== 'upload') {
    throw new Error('--overwrite-images only applies with --upload-images');
  }

  return {
    dryRun,
    yes,
    cloudbaseCollection,
    cloudbaseLimit,
    cloudbaseBatchSize,
    status,
    imageMode,
    overwriteImages,
    allowMissingImages,
    reportPath,
  };
}

function printUsage(): void {
  console.log(`CloudBase new-card import

Usage:
  pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --cloudbase-collection=loveca --dry-run
  pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --cloudbase-collection=loveca --upload-images --yes
  pnpm exec tsx src/scripts/sync-cards-cloudbase-new.ts --cloudbase-collection=loveca --skip-images --yes

Options:
  --cloudbase-collection=<name>   CloudBase collection name. Default: loveca
  --cloudbase-limit=<n>           Limit source documents for connectivity tests.
  --cloudbase-batch-size=<n>      CloudBase page size. Default: 100
  --dry-run                       Read, transform, compare and report only.
  --status=DRAFT|PUBLISHED        New-card status. Default: DRAFT
  --upload-images                 Download CloudBase images, compress WebP, upload to MinIO.
  --skip-images                   Insert without image_filename; keeps image_source_uri and marks source_flags.imageSkipped.
  --allow-missing-images          With --upload-images, insert failed-image cards with source_flags.
  --overwrite-images              With --upload-images, overwrite existing objects.
  --report=<path>                 Write a machine-readable JSON report.
  --yes                           Confirm formal import in non-interactive environments.
`);
}

function requireNonEmptyArg(arg: string, prefix: string): string {
  const value = cleanString(arg.slice(prefix.length));
  if (!value) {
    throw new Error(`${prefix} requires a non-empty value`);
  }
  return value;
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

function readDotenvValues(): Record<string, string> {
  if (dotenvValues) {
    return dotenvValues;
  }
  try {
    dotenvValues = parseDotenv(fs.readFileSync('.env'));
  } catch {
    dotenvValues = {};
  }
  return dotenvValues ?? {};
}

function readEnvValue(name: string): string | null {
  return cleanString(process.env[name]) ?? cleanString(readDotenvValues()[name]);
}

function requiredEnv(name: string): string {
  const value = readEnvValue(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function cleanString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const stringValue =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : null;
  const trimmed = stringValue?.trim();
  return trimmed ? trimmed : null;
}

function stringifyFieldValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return cleanString(value);
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getField(document: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(document, alias)) {
      return document[alias];
    }
  }
  return undefined;
}

function getScalarField(
  document: Record<string, unknown>,
  aliases: readonly string[]
): string | null {
  return stringifyFieldValue(getField(document, aliases));
}

export interface CloudbaseCredentials {
  readonly envId: string;
  readonly secretId: string;
  readonly secretKey: string;
}

export function createCloudbaseAppWithCredentials(credentials: CloudbaseCredentials): CloudBaseApp {
  return cloudbaseSDK.init({
    env: credentials.envId,
    secretId: credentials.secretId,
    secretKey: credentials.secretKey,
  });
}

function createCloudbaseApp(): CloudBaseApp {
  return createCloudbaseAppWithCredentials({
    envId: requiredEnv('CLOUDBASE_ENV_ID'),
    secretId: requiredEnv('CLOUDBASE_SECRET_ID'),
    secretKey: requiredEnv('CLOUDBASE_SECRET_KEY'),
  });
}

export async function readCloudbaseDocuments(
  collection: CloudBaseCollection,
  limit: number | null,
  batchSize: number
): Promise<Record<string, unknown>[]> {
  const documents: Record<string, unknown>[] = [];
  let offset = 0;
  const query = collection.orderBy ? collection.orderBy('_id', 'asc') : collection;

  while (limit === null || documents.length < limit) {
    const remaining = limit === null ? batchSize : limit - documents.length;
    const pageSize = Math.min(batchSize, remaining);
    if (pageSize <= 0) {
      break;
    }

    const response = await query.skip(offset).limit(pageSize).get();
    const page = response.data ?? [];
    documents.push(...page.filter(isRecord));
    offset += page.length;

    if (page.length < pageSize) {
      break;
    }
  }

  return documents;
}

export function cloudbaseDocumentToRow(
  document: Record<string, unknown>,
  rowNumber: number
): SourceRow | InvalidSourceRow {
  const sourceId = getScalarField(document, FIELD_ALIASES.sourceExternalId);
  const rawCode = getScalarField(document, FIELD_ALIASES.cardCode);
  if (!rawCode) {
    return {
      rowNumber,
      sourceId,
      reason: 'missing card_code',
    };
  }

  const cardCode = normalizeCardCode(rawCode);
  const validation = validateCardCode(cardCode);
  if (!validation.valid) {
    return {
      rowNumber,
      sourceId,
      reason: `invalid card_code: ${validation.errors.join('; ')}`,
    };
  }

  return {
    rowNumber,
    document,
    cardCode,
    sourceId,
  };
}

export function summarizeDuplicateRows(rows: readonly SourceRow[]): Map<string, SourceRow[]> {
  const byCode = new Map<string, SourceRow[]>();
  for (const row of rows) {
    const list = byCode.get(row.cardCode) ?? [];
    list.push(row);
    byCode.set(row.cardCode, list);
  }
  return new Map([...byCode.entries()].filter(([, list]) => list.length > 1));
}

export function buildCloudbaseCardSnapshot(
  documents: readonly Record<string, unknown>[],
  status: CardStatus = 'DRAFT'
): CloudbaseCardSnapshot {
  const parsedRows = documents.map((document, index) =>
    cloudbaseDocumentToRow(document, index + 1)
  );
  const invalidRows = parsedRows.filter((row): row is InvalidSourceRow => !('document' in row));
  const sourceRows = parsedRows.filter((row): row is SourceRow => 'document' in row);
  const duplicateRows = summarizeDuplicateRows(sourceRows);
  const duplicateCodes = new Set(duplicateRows.keys());
  const transforms = sourceRows
    .filter((row) => !duplicateCodes.has(row.cardCode))
    .map((row) => transformRow(row, status));
  return { documents, invalidRows, sourceRows, duplicateRows, transforms };
}

export function mapCardInsertRecordToExport(record: CardInsertRecord): CardExportRecord {
  return {
    cardCode: record.card_code,
    cardType: record.card_type,
    nameJp: record.name_jp,
    nameCn: record.name_cn,
    workNames: record.work_names,
    groupNames: record.group_names,
    unitName: record.unit_name,
    unitNameRaw: record.unit_name_raw,
    cost: record.cost,
    blade: record.blade,
    hearts: record.hearts,
    bladeHearts: record.blade_hearts,
    score: record.score,
    requirements: record.requirements,
    cardTextJp: record.card_text_jp,
    cardTextCn: record.card_text_cn,
    imageFilename: record.image_filename,
    imageSourceUri: record.image_source_uri,
    rare: record.rare,
    product: record.product,
    productCode: record.product_code,
    sourceExternalId: record.source_external_id,
    sourceFlags: record.source_flags,
    status: record.status,
  };
}

function normalizeTypeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^cardtype\./, '');
}

function parseCardType(value: unknown): CardType | null {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }
  const direct = raw.toUpperCase();
  if (direct === 'MEMBER' || direct === 'LIVE' || direct === 'ENERGY') {
    return direct;
  }
  return TYPE_MAP.get(normalizeTypeToken(raw)) ?? null;
}

function parseIntegerField(
  value: unknown,
  context: string,
  warnings: string[],
  errors: string[]
): number | null {
  if (value == null || cleanString(value) == null) {
    return null;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    if (value < 0) errors.push(`${context}: expected a non-negative integer`);
    else warnings.push(`${context}: invalid integer ${JSON.stringify(value)}`);
    return null;
  }
  const raw = cleanString(value);
  if (raw && /^-?\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (Number.isSafeInteger(parsed)) {
      if (parsed >= 0) return parsed;
      errors.push(`${context}: expected a non-negative integer`);
      return null;
    }
  }
  warnings.push(`${context}: invalid integer ${JSON.stringify(value)}`);
  return null;
}

function parsePositiveIntegerCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  const raw = cleanString(value);
  if (raw && /^\d+$/.test(raw)) {
    const parsed = Number(raw);
    return parsed > 0 && Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseStringList(value: unknown, context: string, warnings: string[]): string[] | null {
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => cleanString(item)).filter((item): item is string => !!item);
    return items.length > 0 ? items : null;
  }

  const raw = cleanString(value);
  if (!raw) {
    return null;
  }
  const parsed = raw.startsWith('[') ? tryParseJson(raw) : undefined;
  if (Array.isArray(parsed)) {
    return parseStringList(parsed, context, warnings);
  }
  if (parsed !== undefined) {
    warnings.push(`${context}: expected JSON array`);
    return null;
  }

  const items = raw
    .split(/[\n,，、;；/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
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

function normalizeHeartToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[［[\]］【】「」]/g, '')
    .replace(/ハート|heart/g, 'heart')
    .replace(/\s+/g, '');
}

function parseHeartColor(value: unknown): HeartColor | null {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }
  const direct = raw.toUpperCase();
  if (
    direct === 'PINK' ||
    direct === 'RED' ||
    direct === 'YELLOW' ||
    direct === 'GREEN' ||
    direct === 'BLUE' ||
    direct === 'PURPLE' ||
    direct === 'ORANGE' ||
    direct === 'GRAY' ||
    direct === 'RAINBOW'
  ) {
    return direct;
  }
  const token = normalizeHeartToken(raw);
  return HEART_COLOR_MAP.get(token) ?? HEART_COLOR_MAP.get(token.replace(/heart$/, '')) ?? null;
}

function getRecordValue(record: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) {
      return record[alias];
    }
  }
  return undefined;
}

function parseHeartItems(value: unknown, context: string, warnings: string[]): HeartItem[] | null {
  if (value == null || cleanString(value) === '') {
    return null;
  }

  const trimmedValue = typeof value === 'string' ? value.trim() : '';
  const input =
    typeof value === 'string' && (trimmedValue.startsWith('[') || trimmedValue.startsWith('{'))
      ? tryParseJson(value)
      : value;
  const result: HeartItem[] = [];
  let hasError = false;

  if (Array.isArray(input)) {
    for (const [index, item] of input.entries()) {
      if (!isRecord(item)) {
        warnings.push(`${context}: heart item #${index + 1} is not an object`);
        hasError = true;
        continue;
      }
      const color = parseHeartColor(
        getRecordValue(item, ['color', 'heartColor', 'heart_color', 'type', 'name'])
      );
      const count = parsePositiveIntegerCount(getRecordValue(item, ['count', 'value', 'num']));
      if (!color || !count) {
        warnings.push(`${context}: invalid heart item #${index + 1}`);
        hasError = true;
        continue;
      }
      result.push({ color, count });
    }
  } else if (isRecord(input)) {
    for (const [rawKey, rawCount] of Object.entries(input)) {
      const color = parseHeartColor(rawKey);
      const count = parsePositiveIntegerCount(rawCount);
      if (!color || !count) {
        warnings.push(`${context}: invalid heart entry ${JSON.stringify(rawKey)}`);
        hasError = true;
        continue;
      }
      result.push({ color, count });
    }
  } else {
    const color = parseHeartColor(input);
    if (color) {
      result.push({ color, count: 1 });
    } else {
      warnings.push(`${context}: unsupported heart value`);
      hasError = true;
    }
  }

  if (hasError) {
    return null;
  }
  return result.length > 0 ? result : null;
}

function parseSpecialEffect(value: unknown): Exclude<BladeHeartEffect, 'HEART'> | null {
  const raw = cleanString(value);
  return raw ? (SPECIAL_HEART_EFFECT_MAP.get(normalizeHeartToken(raw)) ?? null) : null;
}

function parseBladeHeartColor(value: unknown): HeartColor | null {
  const raw = cleanString(value);
  if (raw) {
    const token = normalizeHeartToken(raw);
    const colorToken = token.replace(/heart$/, '');
    if (['gray', 'grey', 'colorless', '無色', '无色'].includes(colorToken)) {
      return 'GRAY';
    }
  }
  return parseHeartColor(value);
}

function appendBladeHeartRepeated(
  target: BladeHeartItem[],
  item: BladeHeartItem,
  count: number
): void {
  for (let index = 0; index < count; index++) {
    target.push(item);
  }
}

function parseBladeHeartCollection(
  value: unknown,
  context: string,
  warnings: string[]
): BladeHeartItem[] | null {
  if (value == null || cleanString(value) === '') {
    return null;
  }

  const trimmedValue = typeof value === 'string' ? value.trim() : '';
  const input =
    typeof value === 'string' && (trimmedValue.startsWith('[') || trimmedValue.startsWith('{'))
      ? tryParseJson(value)
      : value;
  const result: BladeHeartItem[] = [];
  let hasError = false;

  if (Array.isArray(input)) {
    for (const [index, item] of input.entries()) {
      if (typeof item === 'string') {
        if (appendDoubleGrayBladeHearts(result, item)) {
          continue;
        }
        const color = parseBladeHeartColor(item);
        const effect = parseSpecialEffect(item);
        if (color) {
          result.push({ effect: 'HEART', heartColor: color });
        } else if (effect) {
          result.push({ effect });
        } else {
          warnings.push(`${context}: invalid blade heart item #${index + 1}`);
          hasError = true;
        }
        continue;
      }
      if (!isRecord(item)) {
        warnings.push(`${context}: blade heart item #${index + 1} is not an object`);
        hasError = true;
        continue;
      }
      const effectRaw = getRecordValue(item, ['effect', 'type']);
      const effect =
        cleanString(effectRaw)?.toUpperCase() === 'HEART' ? 'HEART' : parseSpecialEffect(effectRaw);
      const colorRaw = getRecordValue(item, ['heartColor', 'heart_color', 'color', 'name']);
      const color = parseBladeHeartColor(colorRaw);
      const count = parsePositiveIntegerCount(getRecordValue(item, ['count', 'value', 'num'])) ?? 1;

      if (
        appendDoubleGrayBladeHearts(result, effectRaw, count) ||
        appendDoubleGrayBladeHearts(result, colorRaw, count)
      ) {
        continue;
      }
      if (effect === 'HEART' || (!effect && color)) {
        if (!color) {
          warnings.push(`${context}: missing heart color in blade heart item #${index + 1}`);
          hasError = true;
          continue;
        }
        appendBladeHeartRepeated(result, { effect: 'HEART', heartColor: color }, count);
      } else if (effect) {
        appendBladeHeartRepeated(result, { effect }, count);
      } else {
        warnings.push(`${context}: invalid blade heart item #${index + 1}`);
        hasError = true;
      }
    }
  } else if (isRecord(input)) {
    for (const [rawKey, rawCount] of Object.entries(input)) {
      const color = parseBladeHeartColor(rawKey);
      const effect = parseSpecialEffect(rawKey);
      const count = parsePositiveIntegerCount(rawCount);
      if (count && appendDoubleGrayBladeHearts(result, rawKey, count)) {
        continue;
      }
      if (!count || (!color && !effect)) {
        warnings.push(`${context}: invalid blade heart entry ${JSON.stringify(rawKey)}`);
        hasError = true;
        continue;
      }
      appendBladeHeartRepeated(
        result,
        color ? { effect: 'HEART', heartColor: color } : { effect: effect! },
        count
      );
    }
  } else {
    const color = parseBladeHeartColor(input);
    const effect = parseSpecialEffect(input);
    if (appendDoubleGrayBladeHearts(result, input)) {
      // `double` is one Blade Heart icon that produces two colorless Hearts.
    } else if (color) {
      result.push({ effect: 'HEART', heartColor: color });
    } else if (effect) {
      result.push({ effect });
    } else {
      warnings.push(`${context}: unsupported blade heart value`);
      hasError = true;
    }
  }

  if (hasError) {
    return null;
  }
  return result.length > 0 ? result : null;
}

function parseBladeHearts(
  bladeHeartValue: unknown,
  specialHeartValue: unknown,
  context: string,
  warnings: string[]
): BladeHeartItem[] | null {
  const result: BladeHeartItem[] = [];
  const bladeHearts = parseBladeHeartCollection(
    bladeHeartValue,
    `${context} blade_hearts`,
    warnings
  );
  const specialHearts = parseBladeHeartCollection(
    specialHeartValue,
    `${context} special_hearts`,
    warnings
  );
  if (bladeHearts) {
    result.push(...bladeHearts);
  }
  if (specialHearts) {
    result.push(...specialHearts);
  }
  return result.length > 0 ? result : null;
}

function parseSourceFlags(value: unknown, context: string, warnings: string[]): SourceFlags | null {
  if (value == null || cleanString(value) === '') {
    return null;
  }
  if (isRecord(value)) {
    return value as SourceFlags;
  }
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }
  const parsed = tryParseJson(raw);
  if (isRecord(parsed)) {
    return parsed as SourceFlags;
  }
  warnings.push(`${context}: source_flags is not a JSON object`);
  return null;
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

function hasImageExtension(filename: string): boolean {
  return /\.(jpg|jpeg|png|webp)$/i.test(filename);
}

function imageBaseNameFromFilename(filename: string | null): string | null {
  if (!filename) {
    return null;
  }
  return cleanString(filename.replace(/^.*[\\/]/, '').replace(/\.(jpg|jpeg|png|webp)$/i, ''));
}

function stringifyImageField(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = stringifyImageField(item);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }
  if (isRecord(value)) {
    return (
      getScalarField(value, ['fileID', 'fileId', 'cloudId', 'url', 'src', 'path', 'imageUrl']) ??
      null
    );
  }
  return cleanString(value);
}

function buildImagePlan(document: Record<string, unknown>, cardCode: string): ImagePlan {
  const rawImageFilename = stringifyImageField(getField(document, FIELD_ALIASES.imageFilename));
  const explicitImageSourceUri = stringifyImageField(
    getField(document, FIELD_ALIASES.imageSourceUri)
  );
  const imageSourceUri =
    explicitImageSourceUri ??
    (rawImageFilename && /^(https?:\/\/|cloud:\/\/)/i.test(rawImageFilename)
      ? rawImageFilename
      : null);
  const rawBasename = basenameFromUri(rawImageFilename) ?? rawImageFilename;
  const sourceBasename = basenameFromUri(imageSourceUri);

  let imageFilename: string | null = null;
  if (rawBasename) {
    imageFilename = hasImageExtension(rawBasename) ? rawBasename : `${rawBasename}.png`;
  } else if (sourceBasename && hasImageExtension(sourceBasename)) {
    imageFilename = sourceBasename;
  } else if (imageSourceUri) {
    imageFilename = `${cardCode}.png`;
  }

  const imageBaseName = imageBaseNameFromFilename(imageFilename);
  return {
    sourceUri: imageSourceUri,
    imageFilename,
    imageBaseName,
  };
}

function buildSourceFlags(
  sourceFlags: SourceFlags | null,
  missingRuleFields: readonly string[],
  warnings: readonly string[]
): SourceFlags {
  return {
    ...(sourceFlags ?? {}),
    cloudbaseOnly: true,
    importedBy: SCRIPT_NAME,
    ...(missingRuleFields.length > 0 ? { missingRuleFields: [...missingRuleFields] } : {}),
    ...(warnings.length > 0 ? { parseWarnings: [...warnings.slice(0, 20)] } : {}),
  };
}

export function transformRow(row: SourceRow, status: CardStatus): TransformResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const document = row.document;
  const context = `${row.cardCode} row ${row.rowNumber}`;
  const cardType = parseCardType(getField(document, FIELD_ALIASES.cardType));
  if (!cardType) {
    errors.push('missing or invalid card_type');
  }

  const nameJp = getScalarField(document, FIELD_ALIASES.nameJp);
  const nameCn = getScalarField(document, FIELD_ALIASES.nameCn);
  if (!nameJp && !nameCn) {
    errors.push('missing name_jp/name_cn');
  }

  const workNames = parseStringList(
    getField(document, FIELD_ALIASES.workNames),
    `${context} work_names`,
    warnings
  );
  const parsedGroupNames = parseStringList(
    getField(document, FIELD_ALIASES.groupNames),
    `${context} group_names`,
    warnings
  );
  const groupNames = parsedGroupNames ? normalizeCardSyncGroupNames(parsedGroupNames) : null;
  const unitNameRaw = getScalarField(document, FIELD_ALIASES.unitName);
  const unitName = normalizeUnitName(unitNameRaw);
  const sourceFlags = parseSourceFlags(
    getField(document, FIELD_ALIASES.sourceFlags),
    `${context} source_flags`,
    warnings
  );
  const imagePlan = buildImagePlan(document, row.cardCode);

  if (errors.length > 0 || !cardType) {
    return {
      row,
      record: null,
      imagePlan,
      warnings,
      errors,
    };
  }

  const cost =
    cardType === 'MEMBER'
      ? parseIntegerField(
          getField(document, FIELD_ALIASES.cost),
          `${context} cost`,
          warnings,
          errors
        )
      : null;
  const blade =
    cardType === 'MEMBER'
      ? parseIntegerField(
          getField(document, FIELD_ALIASES.blade),
          `${context} blade`,
          warnings,
          errors
        )
      : null;
  const score =
    cardType === 'LIVE'
      ? parseIntegerField(
          getField(document, FIELD_ALIASES.score),
          `${context} score`,
          warnings,
          errors
        )
      : null;
  const hearts =
    cardType === 'MEMBER'
      ? parseHeartItems(getField(document, FIELD_ALIASES.hearts), `${context} hearts`, warnings)
      : null;
  const requirements =
    cardType === 'LIVE'
      ? parseHeartItems(
          getField(document, FIELD_ALIASES.requirements),
          `${context} requirements`,
          warnings
        )
      : null;
  const bladeHearts = parseBladeHearts(
    getField(document, FIELD_ALIASES.bladeHearts),
    getField(document, FIELD_ALIASES.specialHearts),
    context,
    warnings
  );

  if (errors.length > 0) {
    return {
      row,
      record: null,
      imagePlan,
      warnings,
      errors,
    };
  }

  const missingRuleFields: string[] = [];
  if (cardType === 'MEMBER') {
    if (cost == null) missingRuleFields.push('cost');
    if (blade == null) missingRuleFields.push('blade');
    if (!hearts || hearts.length === 0) missingRuleFields.push('hearts');
  } else if (cardType === 'LIVE') {
    if (score == null) missingRuleFields.push('score');
    if (!requirements || requirements.length === 0) missingRuleFields.push('requirements');
  }

  const record: CardInsertRecord = {
    card_code: row.cardCode,
    card_type: cardType,
    name_jp: nameJp,
    name_cn: nameCn,
    work_names: workNames,
    group_names: groupNames,
    unit_name: unitName,
    unit_name_raw: unitNameRaw,
    cost,
    blade,
    hearts,
    blade_hearts: bladeHearts,
    score,
    requirements,
    card_text_jp: getScalarField(document, FIELD_ALIASES.cardTextJp),
    card_text_cn: getScalarField(document, FIELD_ALIASES.cardTextCn),
    image_filename: imagePlan.imageFilename,
    image_source_uri: imagePlan.sourceUri,
    rare: getScalarField(document, FIELD_ALIASES.rare),
    product: getScalarField(document, FIELD_ALIASES.product),
    product_code: getScalarField(document, FIELD_ALIASES.productCode),
    source_external_id: getScalarField(document, FIELD_ALIASES.sourceExternalId) ?? row.sourceId,
    source_flags: buildSourceFlags(sourceFlags, missingRuleFields, warnings),
    status,
  };

  return {
    row,
    record,
    imagePlan,
    warnings,
    errors,
  };
}

function createMinioClient(): { client: Minio.Client; bucket: string } {
  const endpoint = requiredEnv('MINIO_ENDPOINT');
  const port = Number(readEnvValue('MINIO_PORT') ?? '9000');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('MINIO_PORT must be an integer between 1 and 65535');
  }

  return {
    client: new Minio.Client({
      endPoint: endpoint,
      port,
      useSSL: readEnvValue('MINIO_USE_SSL') === 'true',
      accessKey: requiredEnv('MINIO_ACCESS_KEY'),
      secretKey: requiredEnv('MINIO_SECRET_KEY'),
    }),
    bucket: readEnvValue('MINIO_BUCKET') ?? 'loveca-cards',
  };
}

async function ensureBucketExists(client: Minio.Client, bucket: string): Promise<void> {
  if (!(await client.bucketExists(bucket))) {
    await client.makeBucket(bucket);
  }
}

interface StoredImageObject {
  readonly exists: boolean;
  readonly digest: string | null;
}

function metadataValue(metadata: Record<string, string>, key: string): string | null {
  const normalizedKey = key.toLowerCase();
  for (const [candidate, value] of Object.entries(metadata)) {
    const normalizedCandidate = candidate.toLowerCase().replace(/^x-amz-meta-/u, '');
    if (normalizedCandidate === normalizedKey && value.trim()) return value.trim().toLowerCase();
  }
  return null;
}

async function readStoredImageObject(
  client: Minio.Client,
  bucket: string,
  objectKey: string
): Promise<StoredImageObject> {
  try {
    const stat = await client.statObject(bucket, objectKey);
    return {
      exists: true,
      digest: metadataValue(
        (stat.metaData ?? {}) as Record<string, string>,
        IMAGE_DIGEST_METADATA_KEY
      ),
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NotFound' || code === 'NoSuchKey' || code === 'NoSuchObject') {
      return { exists: false, digest: null };
    }
    throw error;
  }
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && (b === 0 || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6Bytes(address: string): Uint8Array | null {
  const zoneIndex = address.indexOf('%');
  const withoutZone = zoneIndex >= 0 ? address.slice(0, zoneIndex) : address;
  const normalized = withoutZone.toLowerCase();
  const embeddedIpv4Match = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/u);
  let expanded = normalized;
  if (embeddedIpv4Match) {
    const ipv4 = embeddedIpv4Match[1]!;
    const octets = ipv4.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) return null;
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    expanded = normalized.slice(0, -ipv4.length) + `${high}:${low}`;
  }
  const halves = expanded.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0]!.split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function hasIpv6Prefix(bytes: Uint8Array, prefix: readonly number[], bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[fullBytes]! & mask) === (prefix[fullBytes]! & mask);
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6Bytes(address);
  if (!bytes) return false;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (allZero || loopback) return false;
  if (
    hasIpv6Prefix(
      bytes,
      [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff],
      96
    )
  ) {
    return false; // IPv4-mapped; use the separately validated IPv4 DNS answer instead
  }
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return false; // IPv4-compatible
  if (hasIpv6Prefix(bytes, [0xfc], 7)) return false; // unique local
  if (hasIpv6Prefix(bytes, [0xfe, 0x80], 10)) return false; // link local
  if (hasIpv6Prefix(bytes, [0xfe, 0xc0], 10)) return false; // deprecated site local
  if (hasIpv6Prefix(bytes, [0xff], 8)) return false; // multicast
  if (!hasIpv6Prefix(bytes, [0x20], 3)) return false; // normal global unicast only
  if (hasIpv6Prefix(bytes, [0x20, 0x01, 0x00, 0x00], 32)) return false; // Teredo
  if (hasIpv6Prefix(bytes, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00], 48)) return false; // benchmark
  if (hasIpv6Prefix(bytes, [0x20, 0x01, 0x00, 0x10], 28)) return false; // ORCHID
  if (hasIpv6Prefix(bytes, [0x20, 0x01, 0x00, 0x20], 28)) return false; // ORCHIDv2
  if (hasIpv6Prefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)) return false; // documentation
  if (hasIpv6Prefix(bytes, [0x20, 0x02], 16)) return false; // 6to4 embeds IPv4
  if (hasIpv6Prefix(bytes, [0x3f, 0xff, 0x00], 20)) return false; // documentation
  return true;
}

function isPublicImageAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export async function resolvePublicImageAddresses(
  hostname: string,
  resolver: ImageHostResolver = async (host) => {
    const addresses = await dnsLookup(host, { all: true, verbatim: true });
    return addresses.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    }));
  }
): Promise<readonly ResolvedImageAddress[]> {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/u, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('download failed: unsafe image URL');
  }
  const literalFamily = isIP(host);
  const addresses = literalFamily
    ? [{ address: host, family: literalFamily as 4 | 6 }]
    : await resolver(host);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicImageAddress(address))) {
    throw new Error('download failed: image host resolves to a private or reserved address');
  }
  return addresses;
}

function parseSafeImageUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('download failed: invalid image URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error('download failed: unsafe image URL');
  }
  return parsed;
}

function createPinnedLookup(addresses: readonly ResolvedImageAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const requestedFamily = options.family === 4 || options.family === 6 ? options.family : null;
    const eligible = requestedFamily
      ? addresses.filter(({ family }) => family === requestedFamily)
      : addresses;
    if (eligible.length === 0) {
      callback(
        Object.assign(new Error('no approved address for requested family'), { code: 'ENOTFOUND' }),
        '',
        0
      );
      return;
    }
    if (options.all) {
      callback(
        null,
        eligible.map(({ address, family }) => ({ address, family }))
      );
      return;
    }
    const selected = eligible[0]!;
    callback(null, selected.address, selected.family);
  };
}

async function readPinnedHttpsImage(
  url: URL,
  addresses: readonly ResolvedImageAddress[],
  signal?: AbortSignal
): Promise<Buffer> {
  const boundedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS)])
    : AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS);
  return new Promise<Buffer>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        lookup: createPinnedLookup(addresses),
        signal: boundedSignal,
        headers: { Accept: 'image/*' },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`download failed: HTTP ${status}`));
          return;
        }
        const declaredLength = Number(response.headers['content-length'] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > IMAGE_DOWNLOAD_MAX_BYTES) {
          response.destroy();
          reject(new Error('download failed: image exceeds size limit'));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer | Uint8Array | string) => {
          const buffer = Buffer.from(chunk);
          total += buffer.length;
          if (total > IMAGE_DOWNLOAD_MAX_BYTES) {
            response.destroy(new Error('download failed: image exceeds size limit'));
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => {
          if (total === 0) reject(new Error('download failed: empty response body'));
          else resolve(Buffer.concat(chunks, total));
        });
        response.on('error', reject);
      }
    );
    request.on('error', reject);
    request.end();
  });
}

async function downloadImageBuffer(
  cloudbase: CloudBaseApp,
  sourceUri: string,
  signal?: AbortSignal
): Promise<Buffer> {
  let url = sourceUri;
  if (!/^https?:\/\//i.test(sourceUri)) {
    const response = await cloudbase.getTempFileURL({
      fileList: [{ fileID: sourceUri, maxAge: 600 }],
    });
    const item = response.fileList?.[0];
    if (!item || item.code !== 'SUCCESS' || !item.tempFileURL) {
      throw new Error(item?.message ?? item?.code ?? 'CloudBase temp file URL failed');
    }
    url = item.tempFileURL;
  }

  const parsed = parseSafeImageUrl(url);
  const addresses = await resolvePublicImageAddresses(parsed.hostname);
  return readPinnedHttpsImage(parsed, addresses, signal);
}

async function compressImageBuffers(
  input: Buffer
): Promise<Record<keyof typeof IMAGE_SIZES, Buffer>> {
  const metadata = await sharp(input, { limitInputPixels: IMAGE_MAX_INPUT_PIXELS }).metadata();
  const isLandscape =
    metadata.width != null && metadata.height != null && metadata.width > metadata.height;
  const result = {} as Record<keyof typeof IMAGE_SIZES, Buffer>;

  for (const [sizeName, sizeConfig] of Object.entries(IMAGE_SIZES) as Array<
    [keyof typeof IMAGE_SIZES, (typeof IMAGE_SIZES)[keyof typeof IMAGE_SIZES]]
  >) {
    let pipeline = sharp(input, { limitInputPixels: IMAGE_MAX_INPUT_PIXELS });
    if (isLandscape) {
      pipeline = pipeline.rotate(90);
    }
    result[sizeName] = await pipeline
      .resize(sizeConfig.width, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: sizeConfig.quality })
      .toBuffer();
  }

  return result;
}

function buildVersionedImageBaseName(imageBaseName: string, objectVersion: string): string {
  const normalizedVersion = objectVersion.trim();
  if (!normalizedVersion) {
    throw new Error('image object version is required');
  }
  const suffix = createHash('sha256').update(normalizedVersion).digest('hex').slice(0, 24);
  return `${imageBaseName}-${suffix}`;
}

export async function processCandidateImage(
  candidate: PreparedCandidate,
  cloudbase: CloudBaseApp,
  minio: { client: Minio.Client; bucket: string },
  args: CardImageProcessingOptions
): Promise<ImageProcessResult> {
  const { imagePlan, record } = candidate;
  if (!imagePlan.sourceUri || !imagePlan.imageBaseName) {
    return {
      cardCode: record.card_code,
      ok: false,
      imageFilename: null,
      uploadedKeys: [],
      reusedKeys: [],
      cleanupFailures: [],
      error: 'missing image source',
      sourceFlag: 'missingImage',
    };
  }

  let versionedImageBaseName: string;
  try {
    versionedImageBaseName = buildVersionedImageBaseName(
      imagePlan.imageBaseName,
      args.imageObjectVersion
    );
  } catch (error) {
    return {
      cardCode: record.card_code,
      ok: false,
      imageFilename: null,
      uploadedKeys: [],
      reusedKeys: [],
      cleanupFailures: [],
      error: error instanceof Error ? error.message : String(error),
      sourceFlag: 'imageProcessFailed',
    };
  }
  const versionedImageFilename = `${versionedImageBaseName}.webp`;

  let input: Buffer;
  try {
    await args.assertCurrent?.();
    input = await (args.imageLoader ?? downloadImageBuffer)(
      cloudbase,
      imagePlan.sourceUri,
      args.signal
    );
    await args.assertCurrent?.();
  } catch (error) {
    return {
      cardCode: record.card_code,
      ok: false,
      imageFilename: null,
      uploadedKeys: [],
      reusedKeys: [],
      cleanupFailures: [],
      error: error instanceof Error ? error.message : String(error),
      sourceFlag: 'imageDownloadFailed',
    };
  }

  let compressed: Record<keyof typeof IMAGE_SIZES, Buffer>;
  try {
    compressed = await compressImageBuffers(input);
    await args.assertCurrent?.();
  } catch (error) {
    return {
      cardCode: record.card_code,
      ok: false,
      imageFilename: null,
      uploadedKeys: [],
      reusedKeys: [],
      cleanupFailures: [],
      error: error instanceof Error ? error.message : String(error),
      sourceFlag: 'imageProcessFailed',
    };
  }

  const uploadedKeys: string[] = [];
  const reusedKeys: string[] = [];
  try {
    for (const [sizeName, buffer] of Object.entries(compressed) as Array<
      [keyof typeof IMAGE_SIZES, Buffer]
    >) {
      await args.assertCurrent?.();
      const objectKey = `${sizeName}/${versionedImageBaseName}.webp`;
      const digest = createHash('sha256').update(buffer).digest('hex');
      const stored = await readStoredImageObject(minio.client, minio.bucket, objectKey);
      if (!args.overwriteImages && stored.exists) {
        if (stored.digest !== digest) {
          throw new Error(`image object conflict: ${objectKey}`);
        }
        reusedKeys.push(objectKey);
      } else {
        await minio.client.putObject(minio.bucket, objectKey, buffer, buffer.length, {
          'Content-Type': 'image/webp',
          'X-Amz-Meta-Loveca-Sha256': digest,
        });
        if (!stored.exists) uploadedKeys.push(objectKey);
      }
      await args.assertCurrent?.();
    }
  } catch (error) {
    const cleanupFailures = await cleanupObjectKeys(uploadedKeys, minio);
    return {
      cardCode: record.card_code,
      ok: false,
      imageFilename: null,
      uploadedKeys,
      reusedKeys,
      cleanupFailures,
      error: error instanceof Error ? error.message : String(error),
      sourceFlag: 'imageUploadFailed',
    };
  }

  return {
    cardCode: record.card_code,
    ok: true,
    imageFilename: versionedImageFilename,
    uploadedKeys,
    reusedKeys,
    cleanupFailures: [],
  };
}

async function cleanupObjectKeys(
  objectKeys: readonly string[],
  minio: { client: Minio.Client; bucket: string }
): Promise<string[]> {
  const failures: string[] = [];
  for (const objectKey of objectKeys) {
    try {
      await minio.client.removeObject(minio.bucket, objectKey);
    } catch {
      failures.push(objectKey);
    }
  }
  return failures;
}

async function cleanupUploadedImagesForFailedInserts(
  insertResults: readonly InsertResult[],
  imageResults: readonly ImageProcessResult[],
  minio: { client: Minio.Client; bucket: string } | null
): Promise<ImageCleanupFailure[]> {
  if (!minio) {
    return [];
  }
  const failures: ImageCleanupFailure[] = [];
  const failedCardCodes = new Set(
    insertResults.filter((result) => !result.inserted).map((result) => result.cardCode)
  );
  for (const imageResult of imageResults) {
    if (!failedCardCodes.has(imageResult.cardCode)) {
      continue;
    }
    for (const objectKey of imageResult.uploadedKeys) {
      const failedKeys = await cleanupObjectKeys([objectKey], minio);
      if (failedKeys.length > 0) {
        failures.push({
          cardCode: imageResult.cardCode,
          objectKey,
          message: 'failed to remove uploaded image after card insert failure',
        });
      }
    }
  }
  return failures;
}

function withSourceFlag(
  record: CardInsertRecord,
  flag: ImageFailureSourceFlag | 'imageSkipped'
): CardInsertRecord {
  return {
    ...record,
    image_filename: null,
    source_flags: {
      ...(record.source_flags ?? {}),
      [flag]: true,
    },
  };
}

async function insertCard(pool: Pool, record: CardInsertRecord): Promise<InsertResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ card_code: string }>(
      `
        INSERT INTO cards (
          card_code, card_type, name_jp, name_cn,
          work_names, group_names, unit_name, unit_name_raw,
          cost, blade, hearts, blade_hearts, score, requirements,
          card_text_jp, card_text_cn, image_filename, image_source_uri,
          rare, product, product_code, source_external_id, source_flags, status
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24
        )
        ON CONFLICT (card_code) DO NOTHING
        RETURNING card_code
      `,
      [
        record.card_code,
        record.card_type,
        record.name_jp,
        record.name_cn,
        record.work_names == null ? null : JSON.stringify(record.work_names),
        record.group_names == null ? null : JSON.stringify(record.group_names),
        record.unit_name,
        record.unit_name_raw,
        record.cost,
        record.blade,
        JSON.stringify(record.hearts ?? []),
        record.blade_hearts == null ? null : JSON.stringify(record.blade_hearts),
        record.score,
        JSON.stringify(record.requirements ?? []),
        record.card_text_jp,
        record.card_text_cn,
        record.image_filename,
        record.image_source_uri,
        record.rare,
        record.product,
        record.product_code,
        record.source_external_id,
        record.source_flags == null ? null : JSON.stringify(record.source_flags),
        record.status,
      ]
    );
    await client.query('COMMIT');
    return { cardCode: record.card_code, inserted: result.rowCount === 1 };
  } catch (error) {
    await client.query('ROLLBACK');
    return {
      cardCode: record.card_code,
      inserted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    client.release();
  }
}

function imageBaseNameForExisting(row: ExistingCardRow): string | null {
  return imageBaseNameFromFilename(row.image_filename);
}

export function buildPreparedCandidates(
  transforms: readonly TransformResult[],
  existingRows: readonly ExistingCardRow[]
): {
  readonly prepared: PreparedCandidate[];
  readonly skipped: SkippedCandidate[];
  readonly existingSkipped: SkippedCandidate[];
} {
  const existingCodes = new Set(existingRows.map((row) => row.card_code));
  const existingImageBases = new Map<string, string>();
  for (const row of existingRows) {
    const baseName = imageBaseNameForExisting(row);
    if (baseName) {
      existingImageBases.set(baseName, row.card_code);
    }
  }

  const newTransforms = transforms.filter(
    (item) => item.record && !existingCodes.has(item.record.card_code)
  );
  const existingSkipped = transforms
    .filter((item) => item.record && existingCodes.has(item.record.card_code))
    .map((item) => ({
      cardCode: item.record!.card_code,
      reason: 'alreadyExists',
    }));

  const imageBaseGroups = new Map<string, TransformResult[]>();
  for (const transform of newTransforms) {
    const baseName = transform.imagePlan.imageBaseName;
    if (!baseName) {
      continue;
    }
    const list = imageBaseGroups.get(baseName) ?? [];
    list.push(transform);
    imageBaseGroups.set(baseName, list);
  }
  const duplicateImageBases = new Set(
    [...imageBaseGroups.entries()].filter(([, list]) => list.length > 1).map(([base]) => base)
  );

  const prepared: PreparedCandidate[] = [];
  const skipped: SkippedCandidate[] = [];
  for (const transform of newTransforms) {
    if (!transform.record) {
      continue;
    }

    const baseName = transform.imagePlan.imageBaseName;
    if (baseName && duplicateImageBases.has(baseName)) {
      skipped.push({
        cardCode: transform.record.card_code,
        reason: 'duplicateImageBaseName',
        detail: baseName,
      });
      continue;
    }

    const existingCardForImage = baseName ? existingImageBases.get(baseName) : null;
    if (existingCardForImage) {
      skipped.push({
        cardCode: transform.record.card_code,
        reason: 'imageBaseNameAlreadyUsed',
        detail: `${baseName} used by ${existingCardForImage}`,
      });
      continue;
    }

    prepared.push({
      transform,
      record: transform.record,
      imagePlan: transform.imagePlan,
    });
  }

  return { prepared, skipped, existingSkipped };
}

function printSummary(
  args: Args,
  documents: readonly Record<string, unknown>[],
  invalidRows: readonly InvalidSourceRow[],
  duplicateRows: Map<string, SourceRow[]>,
  transforms: readonly TransformResult[],
  prepared: readonly PreparedCandidate[],
  skipped: readonly SkippedCandidate[],
  existingSkipped: readonly SkippedCandidate[]
): void {
  const transformInvalid = transforms.filter((item) => !item.record).length;
  const transformWarnings = transforms.reduce((sum, item) => sum + item.warnings.length, 0);
  const missingRuleFieldCards = transforms.filter(
    (item) =>
      item.record?.source_flags?.missingRuleFields &&
      item.record.source_flags.missingRuleFields.length > 0
  ).length;

  console.log('\nCloudBase new-card import summary:');
  console.log(`  Mode: ${args.dryRun ? 'DRY RUN' : 'FORMAL'}`);
  console.log(`  Collection: ${args.cloudbaseCollection}`);
  console.log(`  Source documents: ${documents.length}`);
  console.log(`  Rows missing card code: ${invalidRows.length}`);
  console.log(`  Duplicate card codes skipped: ${duplicateRows.size}`);
  console.log(`  Transform invalid cards: ${transformInvalid}`);
  console.log(`  Transform warnings: ${transformWarnings}`);
  console.log(`  Cards with missing rule fields: ${missingRuleFieldCards}`);
  console.log(`  Existing DB cards skipped: ${existingSkipped.length}`);
  console.log(`  New candidates skipped: ${skipped.length}`);
  console.log(`  Ready new candidates: ${prepared.length}`);

  if (prepared.length > 0) {
    console.log('\nSample ready candidates:');
    for (const candidate of prepared.slice(0, 30)) {
      const name = candidate.record.name_cn ?? candidate.record.name_jp ?? '';
      const missing = candidate.record.source_flags?.missingRuleFields;
      const suffix = missing?.length ? ` missing=${missing.join(',')}` : '';
      console.log(
        `  ${candidate.record.card_code} [${candidate.record.card_type}] ${name}${suffix}`
      );
    }
    if (prepared.length > 30) {
      console.log(`  ... and ${prepared.length - 30} more`);
    }
  }

  if (skipped.length > 0) {
    console.log('\nSkipped new candidates:');
    for (const item of skipped.slice(0, 30)) {
      console.log(`  ${item.cardCode}: ${item.reason}${item.detail ? ` (${item.detail})` : ''}`);
    }
    if (skipped.length > 30) {
      console.log(`  ... and ${skipped.length - 30} more`);
    }
  }
}

async function confirmFormalImport(count: number, args: Args): Promise<boolean> {
  if (count === 0) {
    return false;
  }
  if (args.yes) {
    return true;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Formal import confirmation requires a TTY. Use --yes to apply.');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question(
        `\nImport ${count} new CloudBase cards as ${args.status} with image mode ${args.imageMode}? [y/N] `
      )
    )
      .trim()
      .toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function reportTransform(transform: TransformResult): Record<string, unknown> {
  return {
    rowNumber: transform.row.rowNumber,
    sourceId: transform.row.sourceId,
    cardCode: transform.row.cardCode,
    cardType: transform.record?.card_type ?? null,
    nameJp: transform.record?.name_jp ?? null,
    nameCn: transform.record?.name_cn ?? null,
    status: transform.record?.status ?? null,
    imageFilename: transform.record?.image_filename ?? null,
    imageSourceUri: transform.record?.image_source_uri ?? null,
    imageBaseName: transform.imagePlan.imageBaseName,
    sourceFlags: transform.record?.source_flags ?? null,
    warnings: transform.warnings,
    errors: transform.errors,
  };
}

function writeReport(reportPath: string | null, report: Record<string, unknown>): void {
  if (!reportPath) {
    return;
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nReport written: ${reportPath}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`CloudBase new-card import${args.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  Collection: ${args.cloudbaseCollection}`);
  if (args.cloudbaseLimit !== null) {
    console.log(`  Limit: ${args.cloudbaseLimit}`);
  }
  console.log(`  New-card status: ${args.status}`);
  console.log(`  Image mode: ${args.imageMode}`);

  const cloudbase = createCloudbaseApp();
  const documents = await readCloudbaseDocuments(
    cloudbase.database().collection(args.cloudbaseCollection),
    args.cloudbaseLimit,
    args.cloudbaseBatchSize
  );
  const snapshot = buildCloudbaseCardSnapshot(documents, args.status);
  const { invalidRows, duplicateRows, transforms } = snapshot;

  let existingRows: ExistingCardRow[] = [];
  let prepared: PreparedCandidate[] = [];
  let candidateSkipped: SkippedCandidate[] = [];
  let existingSkipped: SkippedCandidate[] = [];
  let parseOnly = false;
  let imageResults: ImageProcessResult[] = [];
  let insertResults: InsertResult[] = [];
  let imageCleanupFailures: ImageCleanupFailure[] = [];

  const databaseUrl = readEnvValue('DATABASE_URL');
  if (!databaseUrl) {
    if (!args.dryRun) {
      throw new Error('DATABASE_URL is required for formal import');
    }
    parseOnly = true;
    console.log('\nNo DATABASE_URL provided; DB comparison skipped.');
  } else {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const response = await pool.query<ExistingCardRow>(
        'SELECT card_code, image_filename FROM cards ORDER BY card_code'
      );
      existingRows = response.rows;
      const built = buildPreparedCandidates(transforms, existingRows);
      prepared = built.prepared;
      candidateSkipped = built.skipped;
      existingSkipped = built.existingSkipped;

      printSummary(
        args,
        documents,
        invalidRows,
        duplicateRows,
        transforms,
        prepared,
        candidateSkipped,
        existingSkipped
      );

      if (args.dryRun) {
        console.log('\nDry run finished. No DB changes or image uploads applied.');
      } else if (await confirmFormalImport(prepared.length, args)) {
        let recordsToInsert = prepared.map((candidate) => candidate.record);
        let minioForCleanup: { client: Minio.Client; bucket: string } | null = null;

        if (args.imageMode === 'skip') {
          recordsToInsert = recordsToInsert.map((record) => withSourceFlag(record, 'imageSkipped'));
        } else if (args.imageMode === 'upload') {
          const minio = createMinioClient();
          minioForCleanup = minio;
          await ensureBucketExists(minio.client, minio.bucket);
          const imageObjectVersion = randomUUID();

          const recordsAfterImage: CardInsertRecord[] = [];
          for (const candidate of prepared) {
            const imageResult = await processCandidateImage(candidate, cloudbase, minio, {
              ...args,
              imageObjectVersion,
            });
            imageResults.push(imageResult);

            if (imageResult.ok) {
              if (!imageResult.imageFilename) {
                throw new Error(`${candidate.record.card_code}: image result has no filename`);
              }
              recordsAfterImage.push({
                ...candidate.record,
                image_filename: imageResult.imageFilename,
              });
            } else if (args.allowMissingImages && imageResult.sourceFlag) {
              recordsAfterImage.push(withSourceFlag(candidate.record, imageResult.sourceFlag));
            } else {
              candidateSkipped.push({
                cardCode: candidate.record.card_code,
                reason: imageResult.sourceFlag ?? 'imageFailed',
                detail: imageResult.error,
              });
            }
          }
          recordsToInsert = recordsAfterImage;
        }

        for (const record of recordsToInsert) {
          insertResults.push(await insertCard(pool, record));
        }
        imageCleanupFailures = await cleanupUploadedImagesForFailedInserts(
          insertResults,
          imageResults,
          minioForCleanup
        );

        const insertedCount = insertResults.filter((result) => result.inserted).length;
        const failedCount = insertResults.filter((result) => result.error).length;
        const alreadyInsertedCount = insertResults.filter(
          (result) => !result.inserted && !result.error
        ).length;
        console.log('\nFormal import finished:');
        console.log(`  Inserted: ${insertedCount}`);
        console.log(`  Already inserted by concurrent run: ${alreadyInsertedCount}`);
        console.log(`  Failed: ${failedCount}`);
      } else {
        console.log('Import cancelled.');
      }
    } finally {
      await pool.end();
    }
  }

  if (parseOnly) {
    printSummary(args, documents, invalidRows, duplicateRows, transforms, [], [], []);
    console.log(
      '\nParse-only dry run finished. Provide DATABASE_URL to compare DB-only/new cards.'
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    args: {
      dryRun: args.dryRun,
      cloudbaseCollection: args.cloudbaseCollection,
      cloudbaseLimit: args.cloudbaseLimit,
      cloudbaseBatchSize: args.cloudbaseBatchSize,
      status: args.status,
      imageMode: args.imageMode,
      overwriteImages: args.overwriteImages,
      allowMissingImages: args.allowMissingImages,
    },
    source: {
      documents: documents.length,
      rowsMissingCardCode: invalidRows,
      duplicateCardCodes: [...duplicateRows.entries()].map(([cardCode, rows]) => ({
        cardCode,
        rows: rows.map((row) => row.rowNumber),
        sourceIds: rows.map((row) => row.sourceId).filter(Boolean),
      })),
    },
    db: {
      compared: !parseOnly,
      existingCards: existingRows.length,
      existingSkipped,
    },
    transforms: transforms.map(reportTransform),
    readyCandidates: prepared.map((candidate) => candidate.record.card_code),
    skippedCandidates: candidateSkipped,
    imageResults,
    imageCleanupFailures,
    insertResults,
  };
  writeReport(args.reportPath, report);
}

const directEntry = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (directEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
