import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  CardImageCatalogService,
  toCardImageCatalogItem,
  type CardImageCatalogRow,
} from '../../src/server/services/card-image-catalog-service.js';

const baseRow: CardImageCatalogRow = {
  card_code: 'PL!-sd1-001-SD',
  card_type: 'MEMBER',
  name_cn: '高坂穗乃果',
  name_jp: '高坂穂乃果',
  cost: 3,
  score: null,
  status: 'PUBLISHED',
  image_filename: 'PL!-sd1-001-SD.webp',
  source_flags: null,
  updated_at: '2026-10-05T00:00:00.000Z',
};

describe('card image catalog', () => {
  it('uses the existing image filename basename and exposes all three compatible URLs', () => {
    const item = toCardImageCatalogItem(baseRow);
    expect(item.baseName).toBe('PL!-sd1-001-SD');
    expect(item.urls).toEqual({
      thumb: '/images/thumb/PL!-sd1-001-SD.webp',
      medium: '/images/medium/PL!-sd1-001-SD.webp',
      large: '/images/large/PL!-sd1-001-SD.webp',
    });
    expect(item.warning).toBeNull();
  });

  it('marks missing filenames without inventing a storage object', () => {
    const item = toCardImageCatalogItem({ ...baseRow, image_filename: null });
    expect(item.usesCardCodeFallback).toBe(true);
    expect(item.baseName).toBe('PL!-sd1-001-SD');
    expect(item.urls.large).toBe('/images/large/PL!-sd1-001-SD.webp');
  });

  it('does not read object contents for a normal detail request', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [baseRow] });
    const stat = vi.fn().mockResolvedValue({
      size: 1234,
      etag: 'etag',
      lastModified: new Date('2026-10-05T00:00:00.000Z'),
    });
    const read = vi.fn();
    const service = new CardImageCatalogService(query, { stat, read });

    const detail = await service.detail(baseRow.card_code);

    expect(detail?.objects.every((object) => object.status === 'AVAILABLE')).toBe(true);
    expect(stat).toHaveBeenCalledTimes(3);
    expect(read).not.toHaveBeenCalled();
  });

  it('deduplicates storage checks when multiple cards use the same basename', async () => {
    const second = {
      ...baseRow,
      card_code: 'PL!-sd1-001-P',
      image_filename: baseRow.image_filename,
    };
    const query = vi.fn().mockResolvedValue({ rows: [baseRow, second] });
    const stat = vi.fn().mockResolvedValue({ size: 1234, etag: 'etag', lastModified: new Date() });
    const service = new CardImageCatalogService(query, { stat, read: vi.fn() });

    const inventory = await service.inventory();

    expect(inventory.summary.cards).toBe(2);
    expect(inventory.summary.objects).toBe(3);
    expect(stat).toHaveBeenCalledTimes(3);
    expect(inventory.objects[0]?.cardCodes).toEqual([baseRow.card_code, second.card_code]);
  });

  it('verifies WebP content and reports missing objects separately', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [baseRow] });
    const webp = await import('sharp').then((module) =>
      module
        .default({
          create: { width: 1, height: 1, channels: 3, background: 'white' },
        })
        .webp()
        .toBuffer()
    );
    const stat = vi.fn().mockImplementation((key: string) => {
      if (key.startsWith('large/')) {
        throw Object.assign(new Error('not found'), { code: 'NoSuchKey' });
      }
      return {
        size: webp.length,
        etag: 'etag',
        lastModified: new Date('2026-10-05T00:00:00.000Z'),
      };
    });
    const read = vi.fn().mockImplementation(async () => Readable.from([webp]));
    const service = new CardImageCatalogService(query, { stat, read });

    const detail = await service.detail(baseRow.card_code, true);

    expect(detail?.objects.slice(0, 2).every((object) => object.contentVerified)).toBe(true);
    expect(detail?.objects[2]?.status).toBe('MISSING');
  });

  it('reports corrupt image content as an error without a verified hash', async () => {
    const bytes = Buffer.from('not a WebP image');
    const stat = vi
      .fn()
      .mockResolvedValue({ size: bytes.length, etag: 'etag', lastModified: new Date() });
    const read = vi.fn().mockImplementation(async () => Readable.from([bytes]));
    const service = new CardImageCatalogService(vi.fn(), { stat, read });

    const object = await service.inspect(toCardImageCatalogItem(baseRow), 'thumb', true);

    expect(object.status).toBe('ERROR');
    expect(object.contentVerified).toBe(false);
    expect(object.sha256).toBeNull();
  });

  it('rejects oversized objects before reading their contents', async () => {
    const stat = vi
      .fn()
      .mockResolvedValue({ size: 10 * 1024 * 1024 + 1, etag: 'etag', lastModified: new Date() });
    const read = vi.fn();
    const service = new CardImageCatalogService(vi.fn(), { stat, read });

    const object = await service.inspect(toCardImageCatalogItem(baseRow), 'thumb', true);

    expect(object.status).toBe('ERROR');
    expect(object.contentVerified).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('matches the existing encoded object key fallback', async () => {
    const item = toCardImageCatalogItem({ ...baseRow, image_filename: 'folder/card+sample.jpg' });
    const stat = vi.fn().mockImplementation(async (key: string) => {
      if (key === 'thumb/card+sample.webp')
        throw Object.assign(new Error('missing'), { code: 'NoSuchKey' });
      return { size: 100, etag: 'etag', lastModified: new Date() };
    });
    const read = vi.fn();
    const service = new CardImageCatalogService(vi.fn(), { stat, read });

    const object = await service.inspect(item, 'thumb');

    expect(object.status).toBe('AVAILABLE');
    expect(object.objectKey).toBe('thumb/card%2Bsample.webp');
    expect(object.url).toBe('/images/thumb/card%2Bsample.webp');
    expect(read).not.toHaveBeenCalled();
  });
});
