/* eslint-disable @typescript-eslint/require-await */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const imageMocks = vi.hoisted(() => ({
  normalize: vi.fn(async () => ({
    buffer: Buffer.from('normalized-badge'),
    width: 258,
    height: 234,
  })),
}));

vi.mock('../../src/server/services/activity-badge-image-service.js', () => ({
  normalizeActivityBadgeImage: imageMocks.normalize,
  withActivityBadgeProcessingSlot: <T>(operation: () => Promise<T>) => operation(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import {
  ActivityBadgeService,
  ActivityBadgeServiceError,
  type ActivityBadgeQueryClient,
} from '../../src/server/services/activity-badge-service';

const ACTIVITY_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const IMAGE_GROUP_ID = '33333333-3333-4333-8333-333333333333';

describe('ActivityBadgeService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an unconfigured ranked season without enabling an award rule', async () => {
    const service = new ActivityBadgeService({
      query: vi.fn(async (text: string) => {
        if (text.includes('FROM ranked_seasons')) {
          return { rows: [{ id: ACTIVITY_ID, activity_key: 'v4', name: '第四赛季' }] };
        }
        return { rows: [] };
      }) as never,
    });

    await expect(service.getAdmin('RANKED', ACTIVITY_ID)).resolves.toEqual({
      activityType: 'RANKED',
      activityId: ACTIVITY_ID,
      activityName: '第四赛季',
      badge: null,
      updatedAt: null,
    });
  });

  it('publishes a ranked badge, audits it, and backfills eligible players atomically', async () => {
    let row: Record<string, unknown> | null = null;
    const uploads: string[] = [];
    const deleted: string[] = [];
    const auditActions: string[] = [];
    const query = vi.fn(async (text: string) => {
      if (text.includes('FROM ranked_seasons')) return { rows: [activityRow()] };
      if (text.includes('FROM player_badge_rules')) return { rows: row ? [row] : [] };
      throw new Error(`Unexpected outer query: ${text}`);
    });
    const transaction = async <T>(operation: (client: ActivityBadgeQueryClient) => Promise<T>) =>
      operation({
        query: async (text: string, values?: readonly unknown[]) => {
          if (text.includes('FROM ranked_seasons')) return { rows: [activityRow()] };
          if (text.includes('FROM player_badge_rules')) return { rows: row ? [row] : [] };
          if (text.includes('INSERT INTO player_badge_rules')) {
            row = buildRuleRow(values ?? []);
            return { rows: [row] };
          }
          if (text.includes('INSERT INTO player_badges')) {
            return { rows: [{ user_id: '44444444-4444-4444-8444-444444444444' }] };
          }
          if (text.includes('INSERT INTO management_audit_logs')) {
            auditActions.push(String(values?.[3]));
            return { rows: [] };
          }
          throw new Error(`Unexpected transaction query: ${text}`);
        },
      });
    const service = new ActivityBadgeService({
      query: query as never,
      transaction,
      uploadObject: vi.fn(async (key: string) => uploads.push(key)),
      deleteObjects: vi.fn(async (keys: readonly string[]) => deleted.push(...keys)),
      createId: () => IMAGE_GROUP_ID,
      now: () => new Date('2026-08-26T12:00:00.000Z'),
    });

    const result = await service.save(saveInput());

    expect(result).toMatchObject({
      changed: true,
      awardedPlayerCount: 1,
      badge: {
        activityType: 'RANKED',
        activityId: ACTIVITY_ID,
        activityName: '第四赛季',
        badge: {
          revision: 1,
          minimumCompletedMatchCount: 3,
          imageUrl: `/images/activity-badges/${IMAGE_GROUP_ID}/badge.webp`,
        },
      },
    });
    expect(uploads).toEqual([`activity-badges/${IMAGE_GROUP_ID}/badge.webp`]);
    expect(deleted).toEqual([]);
    expect(auditActions).toEqual(['ACTIVITY_BADGE_PUBLISHED']);

    const retry = await service.save(saveInput());
    expect(retry).toMatchObject({ changed: false, awardedPlayerCount: 0 });
    expect(imageMocks.normalize).toHaveBeenCalledTimes(1);
  });

  it('rejects an obsolete revision before image processing or upload', async () => {
    const existing = buildRuleRow([
      `activity-ranked-${ACTIVITY_ID}`,
      ACTIVITY_ID,
      null,
      'RANKED_RATED_MATCH_COUNT',
      3,
      'RANKED_ACTIVITY_BADGE_THREE_MATCHES_V1',
      `activity-badges/${IMAGE_GROUP_ID}/badge.webp`,
      'a'.repeat(64),
      2,
      'previous-request',
      'b'.repeat(64),
      ACTOR_ID,
      new Date('2026-08-26T12:00:00.000Z'),
    ]);
    const upload = vi.fn();
    const service = new ActivityBadgeService({
      query: vi.fn(async (text: string) =>
        text.includes('FROM ranked_seasons') ? { rows: [activityRow()] } : { rows: [existing] }
      ) as never,
      uploadObject: upload,
    });

    await expect(
      service.save({ ...saveInput(), expectedRevision: 1, idempotencyKey: 'another-request' })
    ).rejects.toMatchObject({
      name: ActivityBadgeServiceError.name,
      code: 'ACTIVITY_BADGE_REVISION_CONFLICT',
      statusCode: 409,
    });
    expect(imageMocks.normalize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('rechecks the revision in the transaction when the uploaded image matched a stale read', async () => {
    const normalizedHash = createHash('sha256').update('normalized-badge').digest('hex');
    const stale = buildRuleRow([
      `activity-ranked-${ACTIVITY_ID}`,
      ACTIVITY_ID,
      null,
      'RANKED_RATED_MATCH_COUNT',
      3,
      'RANKED_ACTIVITY_BADGE_THREE_MATCHES_V1',
      `activity-badges/${IMAGE_GROUP_ID}/badge.webp`,
      normalizedHash,
      1,
      'previous-request',
      'b'.repeat(64),
      ACTOR_ID,
      new Date('2026-08-26T12:00:00.000Z'),
    ]);
    const locked = {
      ...stale,
      image_sha256: 'c'.repeat(64),
      revision: 2,
      last_idempotency_key: 'concurrent-request',
    };
    const uploaded: string[] = [];
    const deleted: string[] = [];
    const service = new ActivityBadgeService({
      query: vi.fn(async (text: string) =>
        text.includes('FROM ranked_seasons') ? { rows: [activityRow()] } : { rows: [stale] }
      ) as never,
      transaction: async (operation) =>
        operation({
          query: vi.fn(async (text: string) =>
            text.includes('FROM ranked_seasons') ? { rows: [activityRow()] } : { rows: [locked] }
          ) as never,
        }),
      uploadObject: vi.fn(async (key: string) => uploaded.push(key)),
      deleteObjects: vi.fn(async (keys: readonly string[]) => deleted.push(...keys)),
      createId: () => IMAGE_GROUP_ID,
    });

    await expect(
      service.save({
        ...saveInput(),
        expectedRevision: 1,
        idempotencyKey: 'same-image-stale-read',
      })
    ).rejects.toMatchObject({
      code: 'ACTIVITY_BADGE_REVISION_CONFLICT',
      statusCode: 409,
    });
    expect(uploaded).toEqual([`activity-badges/${IMAGE_GROUP_ID}/badge.webp`]);
    expect(deleted).toEqual(uploaded);
  });
});

function activityRow() {
  return { id: ACTIVITY_ID, activity_key: 'v4', name: '第四赛季' };
}

function saveInput() {
  return {
    activityType: 'RANKED' as const,
    activityId: ACTIVITY_ID,
    expectedRevision: 0,
    idempotencyKey: 'badge-request-1',
    upload: Buffer.from('source-badge'),
    actorUserId: ACTOR_ID,
    actorRole: 'season_admin' as const,
    requestId: 'request-12345678',
  };
}

function buildRuleRow(values: readonly unknown[]): Record<string, unknown> {
  return {
    badge_key: values[0],
    source_season_id: values[1],
    source_theme_table_version_id: values[2],
    criteria_type: values[3],
    minimum_value: values[4],
    criteria_version: values[5],
    image_object_key: values[6],
    image_sha256: values[7],
    revision: values[8],
    last_idempotency_key: values[9],
    last_request_fingerprint: values[10],
    updated_at: values[12],
  };
}
