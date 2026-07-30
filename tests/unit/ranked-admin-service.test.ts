import { describe, expect, it, vi } from 'vitest';
import {
  GLICKO1_PER_MATCH_V1,
  GLICKO1_PER_MATCH_V2,
  GLICKO1_PER_MATCH_SHADOW_V2,
  createInitialGlickoRatingState,
  rateGlickoHeadToHead,
  type Glicko1Config,
} from '../../src/server/rating/glicko';
import { RankedAdminService } from '../../src/server/services/ranked-admin-service';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

const FORMAL_CONFIG: Glicko1Config = {
  ...GLICKO1_PER_MATCH_SHADOW_V2,
  algorithmVersion: 'GLICKO1_PER_MATCH_TEST_V1',
};

const CATALOG = {
  cardCatalogVersion: 'CATALOG_V1',
  cardCatalogHash: `sha256:${'a'.repeat(64)}`,
  publishedCardCount: 100,
};

describe('RankedAdminService', () => {
  it('keeps prior algorithms available while preferring V2 for new seasons', async () => {
    const service = new RankedAdminService({
      getCardCatalogIdentity: vi.fn().mockResolvedValue(CATALOG),
      audit: vi.fn(),
    });

    const preview = await service.getEnvironmentPreview();

    expect(preview.persistentSeasonReady).toBe(true);
    expect(
      preview.algorithms.find((algorithm) => algorithm.status === 'FORMAL')?.algorithmVersion
    ).toBe(GLICKO1_PER_MATCH_V2.algorithmVersion);
    expect(preview.algorithms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          algorithmVersion: GLICKO1_PER_MATCH_SHADOW_V2.algorithmVersion,
          status: 'SHADOW_CANDIDATE',
        }),
        expect.objectContaining({
          algorithmVersion: GLICKO1_PER_MATCH_V2.algorithmVersion,
          status: 'FORMAL',
        }),
        expect.objectContaining({
          algorithmVersion: GLICKO1_PER_MATCH_V1.algorithmVersion,
          status: 'FORMAL',
        }),
      ])
    );
  });

  it('rejects draft creation with a shadow-only algorithm', async () => {
    const getCardCatalogIdentity = vi.fn().mockResolvedValue(CATALOG);
    const service = new RankedAdminService({
      getCardCatalogIdentity,
      audit: vi.fn(),
    });

    await expect(
      service.createDraft(
        {
          seasonKey: 'season-2026-01',
          name: '2026 第一赛季',
          platformTimeZone: 'Asia/Shanghai',
          openWindows: [{ weekdays: [1], startMinute: 1200, endMinute: 1320 }],
          startsAt: new Date('2026-08-01T00:00:00.000Z'),
          scheduledEndsAt: new Date('2026-09-01T00:00:00.000Z'),
          finalizingDeadlineAt: new Date('2026-09-03T00:00:00.000Z'),
          ratingAlgorithmVersion: GLICKO1_PER_MATCH_SHADOW_V2.algorithmVersion,
          leaderboardMinimumMatchCount: 10,
        },
        'admin-1'
      )
    ).rejects.toMatchObject({
      code: 'RANKED_FORMAL_ALGORITHM_UNAVAILABLE',
    });
    expect(getCardCatalogIdentity).not.toHaveBeenCalled();
  });

  it('previews a VOID by replaying the ledger without mutating the projection', async () => {
    const firstUserId = '11111111-1111-4111-8111-111111111111';
    const secondUserId = '22222222-2222-4222-8222-222222222222';
    const ratedAt = new Date('2026-08-01T12:00:00.000Z');
    const original = rateGlickoHeadToHead(
      createInitialGlickoRatingState(FORMAL_CONFIG),
      createInitialGlickoRatingState(FORMAL_CONFIG),
      1,
      ratedAt,
      FORMAL_CONFIG
    );
    const query = vi.fn((text: string) => {
      if (text.includes('FROM ranked_seasons')) {
        return Promise.resolve({
          rows: [
            {
              lifecycle: 'ACTIVE',
              ledger_revision: 1,
              rating_algorithm_version: FORMAL_CONFIG.algorithmVersion,
              rating_config: FORMAL_CONFIG,
            },
          ],
        });
      }
      if (text.includes('FROM ranked_rating_events')) {
        return Promise.resolve({
          rows: [
            {
              id: 'event-1',
              event_sequence: 1,
              event_type: 'SETTLEMENT',
              match_id: 'match-1',
              target_event_id: null,
              first_user_id: firstUserId,
              second_user_id: secondUserId,
              winner_seat: 'FIRST',
              rated_at: ratedAt,
              algorithm_version: FORMAL_CONFIG.algorithmVersion,
              reason: null,
              created_by: null,
              created_at: ratedAt,
            },
          ],
        });
      }
      if (text.includes('FROM ranked_player_ratings')) {
        return Promise.resolve({
          rows: [
            {
              user_id: firstUserId,
              rating: original.first.rating,
              rating_deviation: original.first.ratingDeviation,
              rated_match_count: original.first.ratedMatchCount,
              last_rated_at: original.first.lastRatedAt,
            },
            {
              user_id: secondUserId,
              rating: original.second.rating,
              rating_deviation: original.second.ratingDeviation,
              rated_match_count: original.second.ratedMatchCount,
              last_rated_at: original.second.lastRatedAt,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = new RankedAdminService({
      query,
      createId: () => 'event-preview',
      audit: vi.fn(),
    });

    const preview = await service.previewCorrection({
      seasonId: 'season-1',
      matchId: 'match-1',
      action: 'VOID',
    });

    expect(preview).toMatchObject({
      advisory: true,
      currentLedgerRevision: 1,
      projectedLedgerRevision: 2,
      materializedMatchCount: 0,
      affectedPlayerCount: 2,
    });
    expect(preview.playerChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: firstUserId,
          ratedMatchCountDelta: -1,
        }),
        expect.objectContaining({
          userId: secondUserId,
          ratedMatchCountDelta: -1,
        }),
      ])
    );
    expect(query).toHaveBeenCalledTimes(4);
  });
});
