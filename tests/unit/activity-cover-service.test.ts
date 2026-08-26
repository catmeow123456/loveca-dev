/* eslint-disable @typescript-eslint/require-await */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const imageMocks = vi.hoisted(() => ({
  normalize: vi.fn(async () => ({ buffer: Buffer.from('master'), width: 2400, height: 1350 })),
  render: vi.fn(async (_master: unknown, layout: 'WIDE' | 'COMPACT') =>
    layout === 'WIDE'
      ? { buffer: Buffer.from('wide'), width: 1920, height: 840 }
      : { buffer: Buffer.from('compact'), width: 960, height: 720 }
  ),
}));

vi.mock('../../src/server/services/activity-cover-image-service.js', () => ({
  normalizeActivityCoverSource: imageMocks.normalize,
  renderActivityCoverLayout: imageMocks.render,
  validateActivityCoverFocus: vi.fn(),
  withActivityCoverProcessingSlot: <T>(operation: () => Promise<T>) => operation(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import {
  ActivityCoverService,
  ActivityCoverServiceError,
  type ActivityCoverQueryClient,
} from '../../src/server/services/activity-cover-service';

const ACTIVITY_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';

describe('ActivityCoverService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes an unconfigured activity to DEFAULT revision 0', async () => {
    const service = new ActivityCoverService({
      query: vi.fn(async (text: string) => {
        if (text.includes('FROM ranked_seasons')) return { rows: [{ id: ACTIVITY_ID }] };
        return { rows: [] };
      }) as never,
    });

    await expect(service.getAdmin('RANKED', ACTIVITY_ID)).resolves.toEqual({
      activityType: 'RANKED',
      activityId: ACTIVITY_ID,
      mode: 'DEFAULT',
      revision: 0,
      maskLevel: 'STANDARD',
      wide: null,
      compact: null,
      source: null,
      wideCrop: null,
      wideSourceFocus: null,
      compactCrop: null,
      compactSourceFocus: null,
      updatedAt: null,
    });
  });

  it('projects source-space focus into the rendered asset while preserving admin edit data', async () => {
    const existing = buildConfigRow([
      'RANKED',
      ACTIVITY_ID,
      1,
      'STANDARD',
      'activity-covers/33333333-3333-4333-8333-333333333333/master.webp',
      2400,
      1350,
      'a'.repeat(64),
      'activity-covers/33333333-3333-4333-8333-333333333333/wide.webp',
      JSON.stringify({ x: 0, y: 1 / 9, width: 1, height: 7 / 9 }),
      JSON.stringify({ x: 0.9, y: 0.2 }),
      'activity-covers/33333333-3333-4333-8333-333333333333/compact.webp',
      JSON.stringify({ x: 0.125, y: 0, width: 0.75, height: 1 }),
      JSON.stringify({ x: 0.8, y: 0.2 }),
      'previous-key',
      'c'.repeat(64),
      ACTOR_ID,
      new Date('2026-08-26T08:00:00.000Z'),
    ]);
    const service = new ActivityCoverService({
      query: vi.fn(async (text: string) =>
        text.includes('FROM ranked_seasons')
          ? { rows: [{ id: ACTIVITY_ID }] }
          : { rows: [existing] }
      ) as never,
    });

    const cover = await service.getAdmin('RANKED', ACTIVITY_ID);

    expect(cover.wideSourceFocus).toEqual({ x: 0.9, y: 0.2 });
    expect(cover.wide?.focus).toEqual({ x: 0.9, y: expect.closeTo(4 / 35) });
    expect(cover.compactSourceFocus).toEqual({ x: 0.8, y: 0.2 });
    expect(cover.compact?.focus).toEqual({ x: 0.9, y: 0.2 });
  });

  it('publishes all immutable candidates with the config and audit in one transaction', async () => {
    let row: Record<string, unknown> | null = null;
    const uploads: string[] = [];
    const auditActions: string[] = [];
    const transactionQueries: string[] = [];
    const query = vi.fn(async (text: string) => {
      if (text.includes('FROM ranked_seasons')) return { rows: [{ id: ACTIVITY_ID }] };
      if (text.includes('FROM activity_cover_configs')) return { rows: row ? [row] : [] };
      throw new Error(`Unexpected outer query: ${text}`);
    });
    const transaction = async <T>(operation: (client: ActivityCoverQueryClient) => Promise<T>) =>
      operation({
        query: async (text: string, values?: readonly unknown[]) => {
          transactionQueries.push(text);
          if (text.includes('FROM ranked_seasons')) return { rows: [{ id: ACTIVITY_ID }] };
          if (text.includes('FROM activity_cover_configs')) return { rows: row ? [row] : [] };
          if (text.includes('INSERT INTO activity_cover_configs')) {
            row = buildConfigRow(values ?? []);
            return { rows: [row] };
          }
          if (text.includes('INSERT INTO management_audit_logs')) {
            auditActions.push(String(values?.[3]));
            return { rows: [] };
          }
          throw new Error(`Unexpected transaction query: ${text}`);
        },
      });
    const service = new ActivityCoverService({
      query: query as never,
      transaction,
      uploadObject: vi.fn(async (key: string) => {
        uploads.push(key);
      }),
      deleteObjects: vi.fn(async () => undefined),
      createId: () => '33333333-3333-4333-8333-333333333333',
      now: () => new Date('2026-08-26T08:00:00.000Z'),
    });
    const input = saveInput();

    const first = await service.save(input);

    expect(first.changed).toBe(true);
    expect(first.cover).toMatchObject({
      mode: 'CUSTOM',
      revision: 1,
      maskLevel: 'STANDARD',
      wide: { url: '/images/activity-covers/33333333-3333-4333-8333-333333333333/wide.webp' },
      compact: {
        url: '/images/activity-covers/33333333-3333-4333-8333-333333333333/compact.webp',
      },
    });
    expect(uploads).toHaveLength(3);
    expect(auditActions).toEqual(['ACTIVITY_COVER_PUBLISHED']);
    expect(
      transactionQueries.some(
        (text) => text.includes('FROM ranked_seasons') && text.includes('FOR UPDATE')
      )
    ).toBe(true);

    const retry = await service.save(input);

    expect(retry).toMatchObject({ changed: false, cover: { revision: 1, mode: 'CUSTOM' } });
    expect(uploads).toHaveLength(3);
    expect(imageMocks.normalize).toHaveBeenCalledTimes(1);
    expect(auditActions).toHaveLength(1);

    const noOp = await service.save({
      ...input,
      expectedRevision: 1,
      idempotencyKey: 'cover-request-2',
    });

    expect(noOp).toMatchObject({ changed: false, cover: { revision: 1, mode: 'CUSTOM' } });
    expect(uploads).toHaveLength(3);
    expect(auditActions).toHaveLength(1);
  });

  it('rejects an obsolete revision before creating candidate objects', async () => {
    const existing = buildConfigRow([
      'RANKED',
      ACTIVITY_ID,
      2,
      'STANDARD',
      'activity-covers/33333333-3333-4333-8333-333333333333/master.webp',
      2400,
      1350,
      'a'.repeat(64),
      'activity-covers/33333333-3333-4333-8333-333333333333/wide.webp',
      JSON.stringify({ x: 0, y: 1 / 9, width: 1, height: 7 / 9 }),
      JSON.stringify({ x: 0.5, y: 0.5 }),
      'activity-covers/33333333-3333-4333-8333-333333333333/compact.webp',
      JSON.stringify({ x: 0.125, y: 0, width: 0.75, height: 1 }),
      JSON.stringify({ x: 0.5, y: 0.5 }),
      'previous-key',
      'c'.repeat(64),
      ACTOR_ID,
      new Date('2026-08-26T08:00:00.000Z'),
    ]);
    const upload = vi.fn();
    const service = new ActivityCoverService({
      query: vi.fn(async (text: string) =>
        text.includes('FROM ranked_seasons')
          ? { rows: [{ id: ACTIVITY_ID }] }
          : { rows: [existing] }
      ) as never,
      uploadObject: upload,
    });

    await expect(
      service.save({ ...saveInput(), idempotencyKey: 'new-key-123', expectedRevision: 1 })
    ).rejects.toMatchObject({
      name: ActivityCoverServiceError.name,
      code: 'ACTIVITY_COVER_REVISION_CONFLICT',
      statusCode: 409,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects a source-space focus outside its crop before processing images', async () => {
    const service = new ActivityCoverService({ query: vi.fn() as never });

    await expect(
      service.save({
        ...saveInput(),
        wide: {
          crop: { x: 0.4, y: 0, width: 0.5, height: 1 },
          focus: { x: 0.2, y: 0.5 },
        },
      })
    ).rejects.toMatchObject({
      code: 'ACTIVITY_COVER_INVALID_FOCUS',
    });
    expect(imageMocks.normalize).not.toHaveBeenCalled();
  });
});

function saveInput() {
  return {
    activityType: 'RANKED' as const,
    activityId: ACTIVITY_ID,
    expectedRevision: 0,
    idempotencyKey: 'cover-request-1',
    source: 'UPLOAD' as const,
    upload: Buffer.from('source'),
    maskLevel: 'STANDARD' as const,
    wide: {
      crop: { x: 0, y: 1 / 9, width: 1, height: 7 / 9 },
      focus: { x: 0.5, y: 0.5 },
    },
    compact: {
      crop: { x: 0.125, y: 0, width: 0.75, height: 1 },
      focus: { x: 0.5, y: 0.5 },
    },
    actorUserId: ACTOR_ID,
    actorRole: 'season_admin' as const,
    requestId: 'request-12345678',
  };
}

function buildConfigRow(values: readonly unknown[]): Record<string, unknown> {
  return {
    activity_type: values[0],
    activity_id: values[1],
    mode: 'CUSTOM',
    revision: values[2],
    mask_level: values[3],
    master_object_key: values[4],
    master_width: values[5],
    master_height: values[6],
    master_sha256: values[7],
    wide_object_key: values[8],
    wide_crop: JSON.parse(String(values[9])),
    wide_focus: JSON.parse(String(values[10])),
    compact_object_key: values[11],
    compact_crop: JSON.parse(String(values[12])),
    compact_focus: JSON.parse(String(values[13])),
    last_idempotency_key: values[14],
    last_request_fingerprint: values[15],
    updated_at: values[17],
  };
}
