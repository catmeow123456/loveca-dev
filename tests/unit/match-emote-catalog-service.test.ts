import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getObjectMock, objectExistsMock, poolConnectMock, poolQueryMock, uploadObjectMock } =
  vi.hoisted(() => ({
    getObjectMock: vi.fn(),
    objectExistsMock: vi.fn(),
    poolConnectMock: vi.fn(),
    poolQueryMock: vi.fn(),
    uploadObjectMock: vi.fn(),
  }));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: poolQueryMock,
    connect: poolConnectMock,
  },
}));

vi.mock('../../src/server/services/minio-service.js', () => ({
  getObject: getObjectMock,
  objectExists: objectExistsMock,
  uploadObject: uploadObjectMock,
}));

import {
  MatchEmoteCatalogService,
  MatchEmoteCatalogServiceError,
} from '../../src/server/services/match-emote-catalog-service';

const VERSION_ID = '00000000-0000-4000-8000-000000000201';
const ASSET_A_ID = '00000000-0000-4000-8000-000000000101';
const ASSET_B_ID = '00000000-0000-4000-8000-000000000102';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

describe('MatchEmoteCatalogService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns only enabled entries from the active version in configured order', async () => {
    poolQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            version_id: VERSION_ID,
            entries: [
              catalogEntry('SECOND', ASSET_B_ID, 1, false),
              catalogEntry('FIRST', ASSET_A_ID, 0, true),
            ],
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [assetRow(ASSET_A_ID, 'a'), assetRow(ASSET_B_ID, 'b')],
      } as never);

    const catalog = await new MatchEmoteCatalogService().getPublicCatalog();

    expect(catalog).toEqual({
      version: VERSION_ID,
      items: [
        expect.objectContaining({
          id: 'FIRST',
          label: 'FIRST full',
          shortLabel: 'FIRST',
          staticImageUrl: `/images/emotes/${'a'.repeat(64)}.webp`,
        }),
      ],
    });
  });

  it('rejects a directory that disables every published entry before opening a transaction', async () => {
    await expect(
      new MatchEmoteCatalogService().saveCatalog(
        {
          expectedVersion: VERSION_ID,
          items: [catalogEntry('FIRST', ASSET_A_ID, 0, false)],
        },
        ADMIN_ID
      )
    ).rejects.toMatchObject({ code: 'MATCH_EMOTE_CATALOG_EMPTY', statusCode: 422 });

    expect(poolConnectMock).not.toHaveBeenCalled();
  });

  it('rolls back when expectedVersion is no longer active', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            version_id: '00000000-0000-4000-8000-000000000299',
            entries: [catalogEntry('FIRST', ASSET_A_ID, 0, true)],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    poolConnectMock.mockResolvedValue({ query, release } as never);

    await expect(
      new MatchEmoteCatalogService().saveCatalog(
        {
          expectedVersion: VERSION_ID,
          items: [catalogEntry('FIRST', ASSET_A_ID, 0, true)],
        },
        ADMIN_ID
      )
    ).rejects.toMatchObject({
      code: 'MATCH_EMOTE_CATALOG_VERSION_CONFLICT',
      statusCode: 409,
    });

    expect(query.mock.calls.map((call) => String(call[0]))).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE OF config'),
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('re-encodes animated WebP and registers metadata from the platform output', async () => {
    const input = await createAnimatedWebp();
    objectExistsMock.mockResolvedValue(false);
    poolQueryMock.mockImplementation((_sql: string, values?: readonly unknown[]) =>
      Promise.resolve({
        rows: [
          {
            id: ASSET_A_ID,
            content_fingerprint: values?.[0],
            static_object_key: values?.[1],
            animated_object_key: values?.[2],
            width: values?.[3],
            height: values?.[4],
            frame_count: values?.[5],
            duration_ms: values?.[6],
            static_bytes: values?.[7],
            animated_bytes: values?.[8],
            created_at: new Date('2026-08-13T00:00:00.000Z'),
          },
        ],
      } as never)
    );

    const asset = await new MatchEmoteCatalogService().uploadAsset(input, ADMIN_ID);

    expect(asset).toMatchObject({
      id: ASSET_A_ID,
      width: 24,
      height: 24,
      frameCount: 4,
      durationMs: 400,
    });
    expect(asset.animatedImageUrl).toMatch(/^\/images\/emotes\/[0-9a-f]{64}\.webp$/u);
    expect(uploadObjectMock).toHaveBeenCalledTimes(2);
    const insertedValues = poolQueryMock.mock.calls[0]?.[1] as readonly unknown[] | undefined;
    expect(insertedValues?.slice(3, 7)).toEqual([24, 24, 4, 400]);
  });

  it('rejects SVG input instead of allowing Sharp to rasterize an unapproved format', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>'
    );

    await expect(new MatchEmoteCatalogService().uploadAsset(svg, ADMIN_ID)).rejects.toEqual(
      expect.objectContaining<Partial<MatchEmoteCatalogServiceError>>({
        code: 'MATCH_EMOTE_ASSET_FORMAT_INVALID',
        statusCode: 422,
      })
    );
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it('verifies an existing content-addressed object before reusing it', async () => {
    const input = await sharp({
      create: { width: 12, height: 12, channels: 4, background: '#7c5cff' },
    })
      .png()
      .toBuffer();
    objectExistsMock.mockResolvedValue(true);
    getObjectMock.mockResolvedValue(Readable.from([Buffer.from('wrong object')]) as never);

    await expect(new MatchEmoteCatalogService().uploadAsset(input, ADMIN_ID)).rejects.toMatchObject(
      {
        code: 'MATCH_EMOTE_ASSET_OBJECT_CONFLICT',
        statusCode: 503,
      }
    );
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});

function catalogEntry(id: string, assetId: string, sortOrder: number, enabled: boolean) {
  return {
    id,
    label: `${id} full`,
    shortLabel: id,
    sortOrder,
    enabled,
    assetId,
  };
}

function assetRow(id: string, hashCharacter: string) {
  return {
    id,
    content_fingerprint: `sha256:${hashCharacter.repeat(64)}`,
    static_object_key: `emotes/${hashCharacter.repeat(64)}.webp`,
    animated_object_key: null,
    width: 192,
    height: 192,
    frame_count: 1,
    duration_ms: 0,
    static_bytes: 100,
    animated_bytes: null,
    created_at: new Date('2026-08-13T00:00:00.000Z'),
  };
}

async function createAnimatedWebp(): Promise<Buffer> {
  const frames = await Promise.all(
    ['#7c5cff', '#ff4da6', '#f5b83d', '#2bd9b6'].map((background) =>
      sharp({ create: { width: 24, height: 24, channels: 4, background } })
        .png()
        .toBuffer()
    )
  );
  return sharp(frames, { join: { animated: true } })
    .webp({ delay: [100, 100, 100, 100], loop: 0, lossless: true })
    .toBuffer();
}
