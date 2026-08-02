import { describe, expect, it, vi } from 'vitest';
import {
  GLICKO1_PER_MATCH_V1,
  GLICKO1_PER_MATCH_V2,
  GLICKO1_PER_MATCH_V3,
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
  it('lists all ranked matches with user search, stable pagination, and a separate total', async () => {
    const createdAt = new Date('2026-08-02T10:00:00.000Z');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: '41' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            match_id: 'match-21',
            season_id: 'season-1',
            season_key: 'season-2026-01',
            rating_status: 'SETTLED',
            winner_seat: 'SECOND',
            result_type: 'NORMAL',
            prior_result_type: 'NORMAL',
            first_user_id: 'user-1',
            first_username: 'player_one',
            first_display_name: '玩家一',
            second_user_id: 'user-2',
            second_username: 'player_two',
            second_display_name: '玩家二',
            record_status: 'COMPLETED',
            completeness: 'FULL',
            sealed_at: createdAt,
            ended_at: createdAt,
            settled_at: createdAt,
            created_at: createdAt,
          },
        ],
      });
    const service = new RankedAdminService({ query, audit: vi.fn() });

    const page = await service.listMatches({
      userQuery: 'player_100%',
      limit: 20,
      offset: 20,
    });

    expect(page).toMatchObject({
      total: 41,
      matches: [
        {
          matchId: 'match-21',
          winnerSeat: 'SECOND',
          firstPlayer: { username: 'player_one' },
          secondPlayer: { username: 'player_two' },
        },
      ],
    });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('SELECT COUNT(*) AS total'), [
      '%player\\_100\\%%',
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('LIMIT $2 OFFSET $3'), [
      '%player\\_100\\%%',
      20,
      20,
    ]);
  });

  it('keeps prior algorithms available while preferring V3 for new seasons', async () => {
    const service = new RankedAdminService({
      getCardCatalogIdentity: vi.fn().mockResolvedValue(CATALOG),
      audit: vi.fn(),
    });

    const preview = await service.getEnvironmentPreview();

    expect(preview.persistentSeasonReady).toBe(true);
    expect(
      preview.algorithms.find((algorithm) => algorithm.status === 'FORMAL')?.algorithmVersion
    ).toBe(GLICKO1_PER_MATCH_V3.algorithmVersion);
    expect(preview.algorithms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          algorithmVersion: GLICKO1_PER_MATCH_SHADOW_V2.algorithmVersion,
          status: 'SHADOW_CANDIDATE',
        }),
        expect.objectContaining({
          algorithmVersion: GLICKO1_PER_MATCH_V3.algorithmVersion,
          status: 'FORMAL',
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
          softReset: {
            mode: 'RESET_TO_INITIAL',
            center: 1500,
            retention: 0.5,
            minimumDeviation: 200,
          },
          leaderboardMinimumMatchCount: 10,
        },
        'admin-1'
      )
    ).rejects.toMatchObject({
      code: 'RANKED_FORMAL_ALGORITHM_UNAVAILABLE',
    });
    expect(getCardCatalogIdentity).not.toHaveBeenCalled();
  });

  it('freezes administrator-selected soft-reset parameters into the season config', async () => {
    const createDraft = vi.fn(async (input) => ({
      id: 'season-1',
      seasonKey: input.seasonKey,
      name: input.name,
      lifecycle: 'DRAFT' as const,
      queueAdmission: 'PAUSED' as const,
      competitiveEnvironmentId: input.environment.competitiveEnvironmentId,
      platformTimeZone: input.platformTimeZone,
      openWindows: input.openWindows,
      startsAt: input.startsAt,
      scheduledEndsAt: input.scheduledEndsAt,
      finalizingDeadlineAt: input.finalizingDeadlineAt,
      closedAt: null,
      rulesVersion: input.environment.rulesVersion,
      cardCatalogVersion: input.environment.cardCatalogVersion,
      cardCatalogHash: input.environment.cardCatalogHash,
      deckPolicyVersion: input.environment.deckPolicyVersion,
      ratingAlgorithmVersion: input.ratingConfig.algorithmVersion,
      ratingConfig: input.ratingConfig,
      leaderboardMinimumMatchCount: input.leaderboardMinimumMatchCount,
      ledgerRevision: 0,
    }));
    const service = new RankedAdminService({
      seasonService: { createDraft } as never,
      getCardCatalogIdentity: vi.fn().mockResolvedValue(CATALOG),
      audit: vi.fn(),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });

    await service.createDraft(
      {
        seasonKey: 'season-2026-01',
        name: '2026 第一赛季',
        platformTimeZone: 'Asia/Shanghai',
        openWindows: [{ weekdays: [1], startMinute: 1200, endMinute: 1320 }],
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        scheduledEndsAt: new Date('2026-09-01T00:00:00.000Z'),
        finalizingDeadlineAt: new Date('2026-09-03T00:00:00.000Z'),
        ratingAlgorithmVersion: GLICKO1_PER_MATCH_V2.algorithmVersion,
        softReset: {
          mode: 'RETAIN_TOWARD_CENTER',
          center: 1600,
          retention: 0.25,
          minimumDeviation: 220,
        },
        leaderboardMinimumMatchCount: 10,
      },
      'admin-1'
    );

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ratingConfig: expect.objectContaining({
          softResetMode: 'RETAIN_TOWARD_CENTER',
          softResetCenter: 1600,
          softResetRetention: 0.25,
          softResetMinimumDeviation: 220,
        }),
        environment: expect.objectContaining({
          competitiveEnvironmentId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        }),
      })
    );
  });

  it('rejects soft-reset parameters outside the selected algorithm range', async () => {
    const service = new RankedAdminService({
      getCardCatalogIdentity: vi.fn().mockResolvedValue(CATALOG),
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
          ratingAlgorithmVersion: GLICKO1_PER_MATCH_V2.algorithmVersion,
          softReset: {
            mode: 'RETAIN_TOWARD_CENTER',
            center: 1500,
            retention: 0.5,
            minimumDeviation: 500,
          },
          leaderboardMinimumMatchCount: 10,
        },
        'admin-1'
      )
    ).rejects.toMatchObject({
      code: 'RANKED_SOFT_RESET_CONFIG_INVALID',
      statusCode: 400,
    });
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
              result_type: 'NORMAL',
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
      targetEventId: 'event-1',
      previewToken: expect.any(String),
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

  it('rejects execution parameters that do not match the signed preview', async () => {
    const correctMatch = vi.fn();
    const service = new RankedAdminService({
      ratingService: { correctMatch } as never,
      previewSecret: 'ranked-preview-test-secret',
      audit: vi.fn(),
    });

    await expect(
      service.executeCorrection({
        seasonId: 'season-1',
        matchId: 'match-1',
        action: 'REPLACE',
        replacementWinnerSeat: 'SECOND',
        replacementResultType: 'NORMAL',
        reason: '裁定原胜方记录错误',
        adminUserId: 'admin-1',
        idempotencyKey: 'replace-match-1',
        expectedLedgerRevision: 1,
        expectedTargetEventId: 'event-1',
        previewToken: 'not-the-preview-token',
      })
    ).rejects.toMatchObject({
      code: 'RANKED_CORRECTION_PREVIEW_MISMATCH',
      statusCode: 409,
    });
    expect(correctMatch).not.toHaveBeenCalled();
  });
});
