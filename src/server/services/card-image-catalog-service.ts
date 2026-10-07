import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { inspectCardImageVersionMetadata } from '../../shared/card-image-version-metadata.js';
import {
  CARD_IMAGE_SIZES,
  type CardImageCatalogItem,
  type CardImageCatalogFilters,
  type CardImageCatalogPage,
  type CardImageCatalogDetail,
  type CardImageObjectCheck,
  type CardImageSize,
  type CardImageInventory,
} from '../../shared/game-assets.js';

export interface CardImageCatalogRow {
  readonly card_code: string;
  readonly card_type: CardImageCatalogItem['cardType'];
  readonly name_cn: string | null;
  readonly name_jp: string | null;
  readonly cost: number | null;
  readonly score: number | null;
  readonly status: CardImageCatalogItem['cardStatus'];
  readonly image_filename: string | null;
  readonly source_flags: Record<string, unknown> | null;
  readonly updated_at: Date | string;
}

export interface CardImageCatalogStorage {
  stat(key: string): Promise<{
    size: number;
    etag: string;
    lastModified: Date;
  }>;
  read(key: string): Promise<Readable>;
}

type Query = <T extends Record<string, unknown>>(
  sql: string,
  values?: unknown[]
) => Promise<{ rows: T[] }>;

const CARD_COLUMNS = `card_code, card_type, name_cn, name_jp, cost, score, status,
  image_filename, source_flags, updated_at`;
// Match the existing imageService basename rule, including legacy folder prefixes.
const BASENAME_SQL = `CASE WHEN image_filename IS NULL OR image_filename = '' THEN card_code
  ELSE regexp_replace(regexp_replace(image_filename, '^.*/', ''), '\\.(jpg|jpeg|png|webp)$', '', 'i') END`;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const STORAGE_TIMEOUT_MS = 10_000;

class InspectionError extends Error {}

export function toCardImageCatalogItem(row: CardImageCatalogRow): CardImageCatalogItem {
  const fallback = !row.image_filename;
  const rawBase = fallback
    ? row.card_code
    : row.image_filename!.replace(/^.*\//u, '').replace(/\.(jpg|jpeg|png|webp)$/iu, '');
  const hasUnsafeCharacter = Array.from(rawBase).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  const validBase =
    rawBase.length > 0 &&
    rawBase !== '.' &&
    rawBase !== '..' &&
    !rawBase.includes('\\') &&
    !rawBase.includes('/') &&
    !hasUnsafeCharacter &&
    rawBase.trim() === rawBase;
  const baseName = validBase ? rawBase : null;
  const metadata = inspectCardImageVersionMetadata(row.image_filename, row.source_flags);
  return {
    cardCode: row.card_code,
    cardType: row.card_type,
    name: row.name_cn?.trim() || row.name_jp?.trim() || row.card_code,
    cost: row.cost,
    score: row.score,
    cardStatus: row.status,
    imageFilename: row.image_filename,
    baseName,
    usesCardCodeFallback: fallback,
    version:
      metadata.status === 'VALID'
        ? 'VERSIONED'
        : metadata.status === 'INVALID'
          ? 'INVALID'
          : 'UNVERSIONED',
    warning: !validBase
      ? '文件名不能映射为安全的卡图路径'
      : metadata.status === 'INVALID'
        ? metadata.reason
        : null,
    updatedAt: new Date(row.updated_at).toISOString(),
    urls: Object.fromEntries(
      CARD_IMAGE_SIZES.map((size) => [
        size,
        baseName ? `/images/${size}/${encodeURIComponent(baseName)}.webp` : null,
      ])
    ) as Record<CardImageSize, string | null>,
  };
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new InspectionError('存储检查超时，请稍后重试')),
          STORAGE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class CardImageCatalogService {
  constructor(
    private readonly query: Query,
    private readonly storage: CardImageCatalogStorage
  ) {}

  async list(filters: CardImageCatalogFilters): Promise<CardImageCatalogPage> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filters.query) {
      values.push(`%${filters.query.replace(/[\\%_]/gu, '\\$&')}%`);
      conditions.push(`(card_code ILIKE $${values.length} ESCAPE '\\' OR name_cn ILIKE $${values.length} ESCAPE '\\'
        OR name_jp ILIKE $${values.length} ESCAPE '\\' OR image_filename ILIKE $${values.length} ESCAPE '\\')`);
    }
    if (filters.cardType) {
      values.push(filters.cardType);
      conditions.push(`card_type = $${values.length}`);
    }
    if (filters.cardStatus) {
      values.push(filters.cardStatus);
      conditions.push(`status = $${values.length}`);
    }
    if (filters.filename) {
      conditions.push(
        `(image_filename IS NOT NULL AND image_filename <> '') = ${filters.filename === 'SET' ? 'true' : 'false'}`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [count, list] = await Promise.all([
      this.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM cards ${where}`, values),
      this.query<CardImageCatalogRow & Record<string, unknown>>(
        `SELECT ${CARD_COLUMNS} FROM cards ${where} ORDER BY card_code LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.pageSize, (filters.page - 1) * filters.pageSize]
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: list.rows.map(toCardImageCatalogItem),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      totalPages: Math.ceil(total / filters.pageSize),
    };
  }

  async detail(cardCode: string, verifyContent = false): Promise<CardImageCatalogDetail | null> {
    const result = await this.query<CardImageCatalogRow & Record<string, unknown>>(
      `SELECT ${CARD_COLUMNS} FROM cards WHERE card_code = $1`,
      [cardCode]
    );
    if (!result.rows[0]) return null;
    const card = toCardImageCatalogItem(result.rows[0]);
    const references = card.baseName
      ? await this.query<CardImageCatalogRow & Record<string, unknown>>(
          `SELECT ${CARD_COLUMNS} FROM cards WHERE ${BASENAME_SQL} = $1 ORDER BY card_code`,
          [card.baseName]
        )
      : { rows: [] };
    const objects = await Promise.all(
      CARD_IMAGE_SIZES.map((size) => this.inspect(card, size, verifyContent))
    );
    return {
      card,
      references: references.rows.map(toCardImageCatalogItem),
      objects,
      checkedAt: new Date().toISOString(),
    };
  }

  async inspect(
    card: CardImageCatalogItem,
    size: CardImageSize,
    verifyContent = false
  ): Promise<CardImageObjectCheck> {
    const objectKeyCandidates = card.baseName
      ? [
          ...new Set([
            `${size}/${card.baseName}.webp`,
            `${size}/${encodeURIComponent(card.baseName)}.webp`,
          ]),
        ]
      : [];
    const result: CardImageObjectCheck = {
      size,
      objectKey: objectKeyCandidates[0] ?? null,
      url: card.urls[size],
      status: 'ERROR',
      bytes: null,
      etag: null,
      lastModified: null,
      sha256: null,
      width: null,
      height: null,
      contentVerified: false,
      message: null,
    };
    if (objectKeyCandidates.length === 0) return { ...result, message: card.warning };
    let properties = result;
    try {
      let objectKey: string | null = null;
      let stat: Awaited<ReturnType<CardImageCatalogStorage['stat']>> | null = null;
      for (const candidate of objectKeyCandidates) {
        try {
          stat = await withTimeout(this.storage.stat(candidate));
          objectKey = candidate;
          break;
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (!['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(code ?? '')) throw error;
        }
      }
      if (!objectKey || !stat) {
        return { ...result, status: 'MISSING', message: '对象存储中没有该尺寸卡图' };
      }
      properties = {
        ...result,
        objectKey,
        bytes: stat.size,
        etag: stat.etag,
        lastModified: stat.lastModified.toISOString(),
      };
      if (!verifyContent) return { ...properties, status: 'AVAILABLE' };
      if (stat.size > MAX_IMAGE_BYTES) throw new InspectionError('文件超过 10 MiB 内容校验上限');
      const buffer = await this.readBounded(objectKey);
      const image = sharp(buffer, { limitInputPixels: 36_000_000, failOn: 'warning' });
      const metadata = await image.metadata();
      if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
        throw new InspectionError('对象内容不是有效的 WebP 卡图');
      }
      // Reading metadata does not decode the WebP pixel data.
      await image.timeout({ seconds: 10 }).raw().toBuffer();
      const after = await withTimeout(this.storage.stat(objectKey));
      if (
        buffer.length !== stat.size ||
        after.etag !== stat.etag ||
        after.size !== stat.size ||
        after.lastModified.getTime() !== stat.lastModified.getTime()
      ) {
        throw new InspectionError('校验期间卡图发生变化，请重新检查');
      }
      return {
        ...properties,
        status: 'AVAILABLE',
        sha256: createHash('sha256').update(buffer).digest('hex'),
        width: metadata.width,
        height: metadata.height,
        contentVerified: true,
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(code ?? '')) {
        return { ...properties, status: 'MISSING', message: '对象存储中没有该尺寸卡图' };
      }
      return {
        ...properties,
        status: 'ERROR',
        message:
          error instanceof InspectionError
            ? error.message
            : '无法检查卡图，请检查对象存储连接、读取权限或文件内容',
      };
    }
  }

  private async readBounded(key: string): Promise<Buffer> {
    let stream: Readable | undefined;
    let expired = false;
    const reading = (async () => {
      stream = await this.storage.read(key);
      if (expired) {
        stream.destroy();
        throw new InspectionError('存储检查超时，请稍后重试');
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of stream) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_IMAGE_BYTES) throw new InspectionError('文件超过 10 MiB 内容校验上限');
        chunks.push(buffer);
      }
      return Buffer.concat(chunks);
    })();
    try {
      return await withTimeout(reading);
    } finally {
      expired = true;
      stream?.destroy();
    }
  }

  async inventory(verifyContent = false): Promise<CardImageInventory> {
    const rows = await this.query<CardImageCatalogRow & Record<string, unknown>>(
      `SELECT ${CARD_COLUMNS} FROM cards ORDER BY card_code`
    );
    const cards = rows.rows.map(toCardImageCatalogItem);
    const grouped = new Map<
      string,
      { card: CardImageCatalogItem; size: CardImageSize; codes: string[] }
    >();
    for (const card of cards) {
      if (!card.baseName) continue;
      for (const size of CARD_IMAGE_SIZES) {
        const key = card.urls[size]!;
        const group = grouped.get(key);
        if (group) group.codes.push(card.cardCode);
        else grouped.set(key, { card, size, codes: [card.cardCode] });
      }
    }
    // Sequential inspection bounds storage traffic and makes repeat runs predictable.
    const objects: CardImageInventory['objects'][number][] = [];
    for (const group of grouped.values()) {
      objects.push({
        ...(await this.inspect(group.card, group.size, verifyContent)),
        cardCodes: group.codes,
      });
    }
    return {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      verifyContent,
      cards,
      objects,
      summary: {
        cards: cards.length,
        objects: objects.length,
        available: objects.filter((o) => o.status === 'AVAILABLE').length,
        missing: objects.filter((o) => o.status === 'MISSING').length,
        errors: objects.filter((o) => o.status === 'ERROR').length,
        verified: objects.filter((o) => o.contentVerified).length,
        invalidCards: cards.filter((c) => c.warning !== null).length,
      },
    };
  }
}
