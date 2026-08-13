import { createHash, randomUUID } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import sharp from 'sharp';
import type {
  OnlineMatchEmoteCatalog,
  OnlineMatchEmoteDefinition,
  OnlineMatchEmoteSnapshot,
} from '../../online/chat-types.js';
import { pool } from '../db/pool.js';
import { getObject, objectExists, uploadObject } from './minio-service.js';

const MAX_CATALOG_ITEMS = 12;
const MAX_LABEL_CODE_POINTS = 40;
const MAX_SHORT_LABEL_CODE_POINTS = 12;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 512;
const MAX_FRAMES = 48;
const MAX_DURATION_MS = 6000;
const MAX_DECODED_PIXELS = 12 * 1024 * 1024;
const SUPPORTED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp']);
const EMOTE_ID_PATTERN = /^(?:[A-Z][A-Z0-9_]{1,63}|EMOTE_[0-9A-F]{32})$/u;

interface StoredCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
  readonly assetId: string;
}

interface CatalogRow {
  version_id: string;
  entries: unknown;
}

interface AssetRow {
  id: string;
  content_fingerprint: string;
  static_object_key: string;
  animated_object_key: string | null;
  width: number;
  height: number;
  frame_count: number;
  duration_ms: number;
  static_bytes: number;
  animated_bytes: number | null;
  created_at: Date | string;
}

export interface AdminMatchEmoteAsset {
  readonly id: string;
  readonly assetRevision: string;
  readonly staticImageUrl: string;
  readonly animatedImageUrl: string | null;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly staticBytes: number;
  readonly animatedBytes: number | null;
  readonly createdAt: string;
}

export interface AdminMatchEmoteEntry {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
  readonly asset: AdminMatchEmoteAsset;
}

export interface AdminMatchEmoteCatalog {
  readonly version: string;
  readonly items: readonly AdminMatchEmoteEntry[];
}

export interface SaveMatchEmoteCatalogInput {
  readonly expectedVersion: string;
  readonly items: readonly StoredCatalogEntry[];
}

export class MatchEmoteCatalogServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'MatchEmoteCatalogServiceError';
  }
}

export class MatchEmoteCatalogService {
  async getPublicCatalog(): Promise<OnlineMatchEmoteCatalog> {
    const catalog = await this.readCatalog(pool);
    return {
      version: catalog.version,
      items: catalog.items
        .filter((item) => item.enabled)
        .sort(compareCatalogEntries)
        .map(toPublicDefinition),
    };
  }

  async getAdminCatalog(): Promise<AdminMatchEmoteCatalog> {
    const catalog = await this.readCatalog(pool);
    return {
      version: catalog.version,
      items: catalog.items.sort(compareCatalogEntries),
    };
  }

  async resolveActiveEmote(
    emoteId: string,
    expectedCatalogVersion: string
  ): Promise<OnlineMatchEmoteSnapshot | null> {
    try {
      const catalog = await this.getPublicCatalog();
      if (catalog.version !== expectedCatalogVersion) {
        return null;
      }
      const emote = catalog.items.find((item) => item.id === emoteId);
      return emote ? toSnapshot(emote) : null;
    } catch (error) {
      if (error instanceof MatchEmoteCatalogServiceError) throw error;
      console.error('[MatchEmoteCatalog] Failed to resolve active emote:', error);
      throw serviceError('MATCH_EMOTE_CATALOG_UNAVAILABLE', '快捷表情目录暂时不可用', 503);
    }
  }

  createEmoteId(): string {
    return `EMOTE_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  }

  async saveCatalog(
    input: SaveMatchEmoteCatalogInput,
    adminUserId: string
  ): Promise<AdminMatchEmoteCatalog> {
    const entries = normalizeCatalogEntries(input.items);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query<CatalogRow>(
        `SELECT config.active_version_id AS version_id, version.entries
         FROM match_emote_catalog_config config
         JOIN match_emote_catalog_versions version ON version.id = config.active_version_id
         WHERE config.id = 'default'
         FOR UPDATE OF config`
      );
      const current = currentResult.rows[0];
      if (!current) {
        throw serviceError('MATCH_EMOTE_CATALOG_MISSING', '快捷表情目录尚未初始化', 503);
      }
      if (current.version_id !== input.expectedVersion) {
        throw serviceError(
          'MATCH_EMOTE_CATALOG_VERSION_CONFLICT',
          '快捷表情目录已由其他管理员更新，请重新载入后再保存',
          409
        );
      }

      const currentEntries = normalizeStoredEntries(current.entries);
      const nextIds = new Set(entries.map((entry) => entry.id));
      const omittedPublishedEntry = currentEntries.find((entry) => !nextIds.has(entry.id));
      if (omittedPublishedEntry) {
        throw serviceError(
          'MATCH_EMOTE_CATALOG_ENTRY_REMOVED',
          `已发布表情 ${omittedPublishedEntry.id} 只能停用，不能从目录中删除`,
          422
        );
      }

      const assetIds = [...new Set(entries.map((entry) => entry.assetId))];
      const assets = await readAssets(client, assetIds);
      if (assets.size !== assetIds.length) {
        throw serviceError('MATCH_EMOTE_ASSET_NOT_FOUND', '目录引用了不存在的表情资源', 422);
      }

      const versionResult = await client.query<{ id: string }>(
        `INSERT INTO match_emote_catalog_versions (entries, created_by, previous_version_id)
         VALUES ($1::jsonb, $2, $3)
         RETURNING id`,
        [JSON.stringify(entries), adminUserId, current.version_id]
      );
      const versionId = versionResult.rows[0]?.id;
      if (!versionId) {
        throw serviceError('MATCH_EMOTE_CATALOG_SAVE_FAILED', '快捷表情目录保存失败', 500);
      }
      await client.query(
        `UPDATE match_emote_catalog_config
         SET active_version_id = $1, updated_by = $2, updated_at = now()
         WHERE id = 'default'`,
        [versionId, adminUserId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return this.getAdminCatalog();
  }

  async uploadAsset(input: Buffer, adminUserId: string): Promise<AdminMatchEmoteAsset> {
    if (input.length === 0 || input.length > MAX_UPLOAD_BYTES) {
      throw serviceError('MATCH_EMOTE_ASSET_TOO_LARGE', '表情源文件必须小于 2 MB', 413);
    }

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(input, {
        animated: true,
        failOn: 'warning',
        limitInputPixels: MAX_DECODED_PIXELS,
      }).metadata();
    } catch {
      throw serviceError('MATCH_EMOTE_ASSET_INVALID', '无法解码表情图片', 422);
    }

    if (!metadata.format || !SUPPORTED_INPUT_FORMATS.has(metadata.format)) {
      throw serviceError(
        'MATCH_EMOTE_ASSET_FORMAT_INVALID',
        '表情源文件只接受 PNG、JPEG 或 WebP',
        422
      );
    }

    const width = metadata.width ?? 0;
    const frameHeight = metadata.pageHeight ?? metadata.height ?? 0;
    const frameCount = metadata.pages ?? 1;
    const delays = metadata.delay ?? [];
    const durationMs = frameCount > 1 ? delays.reduce((sum, delay) => sum + delay, 0) : 0;
    if (width < 1 || frameHeight < 1 || width > MAX_DIMENSION || frameHeight > MAX_DIMENSION) {
      throw serviceError(
        'MATCH_EMOTE_ASSET_DIMENSIONS_INVALID',
        `表情尺寸必须在 1×1 至 ${MAX_DIMENSION}×${MAX_DIMENSION} 像素之间`,
        422
      );
    }
    if (frameCount > MAX_FRAMES || width * frameHeight * frameCount > MAX_DECODED_PIXELS) {
      throw serviceError('MATCH_EMOTE_ASSET_FRAMES_INVALID', '表情动画帧数或解码体积超出限制', 422);
    }
    if (frameCount > 1 && metadata.format !== 'webp') {
      throw serviceError('MATCH_EMOTE_ASSET_ANIMATION_FORMAT_INVALID', '动画表情只接受 WebP', 422);
    }
    if (
      frameCount > 1 &&
      (delays.length === 0 || durationMs <= 0 || durationMs > MAX_DURATION_MS)
    ) {
      throw serviceError(
        'MATCH_EMOTE_ASSET_DURATION_INVALID',
        '表情动画总时长必须不超过 6 秒',
        422
      );
    }

    let staticBuffer: Buffer;
    let animatedBuffer: Buffer | null = null;
    let outputWidth = width;
    let outputHeight = frameHeight;
    let outputFrameCount = frameCount;
    let outputDurationMs = durationMs;
    try {
      if (frameCount > 1) {
        animatedBuffer = await sharp(input, {
          animated: true,
          failOn: 'warning',
          limitInputPixels: MAX_DECODED_PIXELS,
        })
          .webp({ quality: 84, alphaQuality: 100, effort: 5, loop: 0 })
          .toBuffer();
        const outputMetadata = await sharp(animatedBuffer, { animated: true }).metadata();
        outputWidth = outputMetadata.width ?? outputWidth;
        outputHeight = outputMetadata.pageHeight ?? outputMetadata.height ?? outputHeight;
        outputFrameCount = outputMetadata.pages ?? outputFrameCount;
        outputDurationMs = (outputMetadata.delay ?? []).reduce((sum, delay) => sum + delay, 0);
      }
      staticBuffer = await sharp(animatedBuffer ?? input, {
        page: 0,
        failOn: 'warning',
        limitInputPixels: MAX_DECODED_PIXELS,
      })
        .webp({ quality: 88, alphaQuality: 100 })
        .toBuffer();
    } catch {
      throw serviceError('MATCH_EMOTE_ASSET_PROCESSING_FAILED', '表情图片处理失败', 422);
    }

    const staticHash = sha256(staticBuffer);
    const animatedHash = animatedBuffer ? sha256(animatedBuffer) : null;
    const contentFingerprint = `sha256:${sha256(
      Buffer.from(`${staticHash}:${animatedHash ?? ''}`)
    )}`;
    const staticObjectKey = `emotes/${staticHash}.webp`;
    const animatedObjectKey = animatedHash ? `emotes/${animatedHash}.webp` : null;

    await uploadIfMissing(staticObjectKey, staticBuffer);
    if (animatedObjectKey && animatedBuffer) {
      await uploadIfMissing(animatedObjectKey, animatedBuffer);
    }

    const inserted = await pool.query<AssetRow>(
      `INSERT INTO match_emote_assets (
         content_fingerprint, static_object_key, animated_object_key, width, height,
         frame_count, duration_ms, static_bytes, animated_bytes, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (content_fingerprint) DO UPDATE
       SET content_fingerprint = EXCLUDED.content_fingerprint
       RETURNING *`,
      [
        contentFingerprint,
        staticObjectKey,
        animatedObjectKey,
        outputWidth,
        outputHeight,
        outputFrameCount,
        outputDurationMs,
        staticBuffer.length,
        animatedBuffer?.length ?? null,
        adminUserId,
      ]
    );
    const row = inserted.rows[0];
    if (!row) {
      throw serviceError('MATCH_EMOTE_ASSET_SAVE_FAILED', '表情资源登记失败', 500);
    }
    return mapAssetRow(row);
  }

  private async readCatalog(queryable: Queryable): Promise<{
    version: string;
    items: AdminMatchEmoteEntry[];
  }> {
    const result = await queryable.query<CatalogRow>(
      `SELECT config.active_version_id AS version_id, version.entries
       FROM match_emote_catalog_config config
       JOIN match_emote_catalog_versions version ON version.id = config.active_version_id
       WHERE config.id = 'default'`
    );
    const row = result.rows[0];
    if (!row) {
      throw serviceError('MATCH_EMOTE_CATALOG_MISSING', '快捷表情目录尚未初始化', 503);
    }
    const entries = normalizeStoredEntries(row.entries);
    const assets = await readAssets(queryable, [...new Set(entries.map((entry) => entry.assetId))]);
    const items = entries.map((entry) => {
      const asset = assets.get(entry.assetId);
      if (!asset) {
        throw serviceError('MATCH_EMOTE_ASSET_NOT_FOUND', '快捷表情目录引用的资源不存在', 503);
      }
      return { ...entry, asset };
    });
    return { version: row.version_id, items };
  }
}

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<R>>;
}

function normalizeCatalogEntries(items: readonly StoredCatalogEntry[]): StoredCatalogEntry[] {
  if (items.length < 1 || items.length > MAX_CATALOG_ITEMS) {
    throw serviceError('MATCH_EMOTE_CATALOG_SIZE_INVALID', '快捷表情目录必须包含 1 至 12 项', 422);
  }
  const ids = new Set<string>();
  const sortOrders = new Set<number>();
  const normalized = items.map((item, index) => {
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const label = normalizeSingleLine(item.label, MAX_LABEL_CODE_POINTS, '完整名称');
    const shortLabel = normalizeSingleLine(
      item.shortLabel,
      MAX_SHORT_LABEL_CODE_POINTS,
      '菜单短名称'
    );
    const assetId = typeof item.assetId === 'string' ? item.assetId.trim() : '';
    const sortOrder = Number.isSafeInteger(item.sortOrder) ? item.sortOrder : index;
    if (!EMOTE_ID_PATTERN.test(id)) {
      throw serviceError('MATCH_EMOTE_ID_INVALID', '快捷表情 ID 非法', 422);
    }
    if (!/^[0-9a-f-]{36}$/u.test(assetId)) {
      throw serviceError('MATCH_EMOTE_ASSET_ID_INVALID', '快捷表情资源 ID 非法', 422);
    }
    if (sortOrder < 0 || sortOrder >= MAX_CATALOG_ITEMS || sortOrders.has(sortOrder)) {
      throw serviceError('MATCH_EMOTE_SORT_ORDER_INVALID', '快捷表情排序非法或重复', 422);
    }
    if (ids.has(id)) {
      throw serviceError('MATCH_EMOTE_ID_DUPLICATE', `快捷表情 ID 重复：${id}`, 422);
    }
    ids.add(id);
    sortOrders.add(sortOrder);
    return { id, label, shortLabel, sortOrder, enabled: item.enabled === true, assetId };
  });
  if (!normalized.some((item) => item.enabled)) {
    throw serviceError('MATCH_EMOTE_CATALOG_EMPTY', '至少需要启用 1 个快捷表情', 422);
  }
  return normalized.sort(compareCatalogEntries);
}

function normalizeStoredEntries(value: unknown): StoredCatalogEntry[] {
  if (!Array.isArray(value)) {
    throw serviceError('MATCH_EMOTE_CATALOG_CORRUPT', '快捷表情目录数据损坏', 503);
  }
  return normalizeCatalogEntries(value as StoredCatalogEntry[]);
}

function normalizeSingleLine(value: unknown, maxCodePoints: number, field: string): string {
  const normalized = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (
    !normalized ||
    [...normalized].length > maxCodePoints ||
    containsControlCharacter(normalized)
  ) {
    throw serviceError(
      'MATCH_EMOTE_LABEL_INVALID',
      `${field}不能为空、不能换行，且不得超过 ${maxCodePoints} 个字符`,
      422
    );
  }
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

async function readAssets(
  queryable: Queryable,
  assetIds: readonly string[]
): Promise<Map<string, AdminMatchEmoteAsset>> {
  if (assetIds.length === 0) {
    return new Map();
  }
  const result = await queryable.query<AssetRow>(
    `SELECT * FROM match_emote_assets WHERE id = ANY($1::uuid[])`,
    [assetIds]
  );
  return new Map(result.rows.map((row) => [row.id, mapAssetRow(row)]));
}

function mapAssetRow(row: AssetRow): AdminMatchEmoteAsset {
  return {
    id: row.id,
    assetRevision: row.content_fingerprint,
    staticImageUrl: publicImageUrl(row.static_object_key),
    animatedImageUrl: row.animated_object_key ? publicImageUrl(row.animated_object_key) : null,
    width: row.width,
    height: row.height,
    frameCount: row.frame_count,
    durationMs: row.duration_ms,
    staticBytes: row.static_bytes,
    animatedBytes: row.animated_bytes,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toPublicDefinition(item: AdminMatchEmoteEntry): OnlineMatchEmoteDefinition {
  return {
    id: item.id,
    label: item.label,
    shortLabel: item.shortLabel,
    staticImageUrl: item.asset.staticImageUrl,
    animatedImageUrl: item.asset.animatedImageUrl,
    assetRevision: item.asset.assetRevision,
  };
}

function toSnapshot(emote: OnlineMatchEmoteDefinition): OnlineMatchEmoteSnapshot {
  return {
    label: emote.label,
    staticImageUrl: emote.staticImageUrl,
    animatedImageUrl: emote.animatedImageUrl,
    assetRevision: emote.assetRevision,
  };
}

function compareCatalogEntries(
  left: Pick<StoredCatalogEntry, 'sortOrder' | 'id'>,
  right: Pick<StoredCatalogEntry, 'sortOrder' | 'id'>
): number {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}

function publicImageUrl(objectKey: string): string {
  return `/images/${objectKey}`;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function uploadIfMissing(objectKey: string, value: Buffer): Promise<void> {
  if (await objectExists(objectKey)) {
    const expectedHash = sha256(value);
    const remoteHash = createHash('sha256');
    let remoteBytes = 0;
    for await (const chunk of await getObject(objectKey)) {
      const candidate: unknown = chunk;
      if (typeof candidate !== 'string' && !(candidate instanceof Uint8Array)) {
        throw serviceError('MATCH_EMOTE_ASSET_OBJECT_INVALID', '对象存储返回了无效的表情资源', 503);
      }
      const buffer = Buffer.from(candidate);
      remoteBytes += buffer.length;
      if (remoteBytes > value.length) {
        throw serviceError(
          'MATCH_EMOTE_ASSET_OBJECT_CONFLICT',
          '对象存储中的同名表情资源与内容哈希不一致',
          503
        );
      }
      remoteHash.update(buffer);
    }
    if (remoteBytes !== value.length || remoteHash.digest('hex') !== expectedHash) {
      throw serviceError(
        'MATCH_EMOTE_ASSET_OBJECT_CONFLICT',
        '对象存储中的同名表情资源与内容哈希不一致',
        503
      );
    }
    return;
  }
  await uploadObject(objectKey, value, 'image/webp');
}

function serviceError(code: string, message: string, statusCode: number) {
  return new MatchEmoteCatalogServiceError(code, message, statusCode);
}

export const matchEmoteCatalogService = new MatchEmoteCatalogService();
