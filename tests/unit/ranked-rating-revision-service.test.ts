import { describe, expect, it, vi } from 'vitest';
import { GLICKO1_PER_MATCH_V3 } from '../../src/server/rating/glicko';
import { buildRankedCompetitiveEnvironmentIdentity } from '../../src/server/rating/ranked-environment';
import {
  materializeRankedRatingLedger,
  type RankedRatingEvent,
} from '../../src/server/rating/ranked-ledger';
import {
  GLICKO1_PER_MATCH_V4,
  assertValidRankedRatingConfig,
  type RankedRatingConfig,
} from '../../src/server/rating/ranked-rating';
import {
  PostgresRankedRatingRevisionRepository,
  RankedRatingRevisionService,
  type RankedRatingRevisionSnapshot,
} from '../../src/server/services/ranked-rating-revision-service';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
}));

const CARD_CATALOG = {
  cardCatalogVersion: 'CATALOG_V1',
  cardCatalogHash: `sha256:${'a'.repeat(64)}`,
  publishedCardCount: 100,
};

const RATED_AT = new Date('2026-08-08T10:00:00.000Z');
const EVENT: RankedRatingEvent = {
  eventId: 'event-1',
  eventSequence: 1,
  eventType: 'SETTLEMENT',
  matchId: 'match-1',
  targetEventId: null,
  firstUserId: 'user-1',
  secondUserId: 'user-2',
  winnerSeat: 'FIRST',
  resultType: 'NORMAL',
  ratedAt: RATED_AT,
  algorithmVersion: GLICKO1_PER_MATCH_V3.algorithmVersion,
};

describe('RankedRatingRevisionService', () => {
  it('previews a V3 parameter revision without mutating data and clamps seed RD for a higher floor', async () => {
    const seeds = new Map([
      ['user-1', state(1500, 40, 0, null)],
      ['user-2', state(1500, 40, 0, null)],
    ]);
    const current = materializeRankedRatingLedger([EVENT], GLICKO1_PER_MATCH_V3, seeds).players;
    const snapshot = createSnapshot({
      config: GLICKO1_PER_MATCH_V3,
      events: [EVENT],
      seeds,
      currentRatings: current,
      queueAdmission: 'PAUSED',
    });
    const applyPlan = vi.fn();
    const repository = { loadSnapshot: vi.fn().mockResolvedValue(snapshot), applyPlan };
    const audit = vi.fn();
    const service = createService(repository, audit);

    const preview = await service.preview({
      seasonId: snapshot.season.id,
      parameters: {
        ratingScale: 900,
        minimumRatingDeviation: 100,
        placementMatchCount: 6,
      },
      reason: '调整波动并重新回放测试',
      adminUserId: 'admin-1',
    });

    expect(preview.targetAlgorithmVersion).toMatch(/^GLICKO1_PER_MATCH_V3_REV_[0-9a-f]{32}$/);
    expect(preview.targetConfig).toMatchObject({
      ratingScale: 900,
      minimumRatingDeviation: 100,
      placementMatchCount: 6,
      softResetMinimumDeviation: 200,
      growthPool: undefined,
      parameterRevision: { baseAlgorithmVersion: 'GLICKO1_PER_MATCH_V3' },
    });
    expect(preview).toMatchObject({
      sourceLedgerRevision: 1,
      projectedLedgerRevision: 2,
      materializedMatchCount: 1,
      seedDeviationClampCount: 2,
      canApply: true,
    });
    expect(preview.affectedPlayerCount).toBe(2);
    expect(preview.playerChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'user-1', playerName: '玩家一' }),
        expect.objectContaining({ userId: 'user-2', playerName: '玩家二' }),
      ])
    );
    expect(applyPlan).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'RANKED_RATING_REVISION_PREVIEWED' })
    );
  });

  it('supports bounded V4 growth parameters and preserves the published V4 identity', async () => {
    const snapshot = createSnapshot({
      config: GLICKO1_PER_MATCH_V4,
      queueAdmission: 'OPEN',
    });
    const service = createService({ loadSnapshot: vi.fn().mockResolvedValue(snapshot) });

    const preview = await service.preview({
      seasonId: snapshot.season.id,
      parameters: {
        ratingScale: 1000,
        minimumRatingDeviation: 120,
        placementMatchCount: 8,
        growthPool: {
          enabled: true,
          centerRating: 1850,
          maximumTotalAdjustment: 20,
          transitionWidth: 300,
          negativeWinnerShare: 0.8,
        },
      },
      reason: '预览 V4 成长池参数变化',
      adminUserId: 'admin-1',
    });

    expect(preview.targetConfig.growthPool).toMatchObject({
      enabled: true,
      centerRating: 1850,
      maximumTotalAdjustment: 20,
      transitionWidth: 300,
      negativeWinnerShare: 0.8,
      mode: 'POST_PLACEMENT_AVERAGE_CENTERED',
      positiveSplitMode: 'EQUAL',
    });
    expect(preview.canApply).toBe(false);
    expect(() => assertValidRankedRatingConfig(preview.targetConfig)).not.toThrow();
    expect(() => assertValidRankedRatingConfig(GLICKO1_PER_MATCH_V4)).not.toThrow();
    expect(GLICKO1_PER_MATCH_V4).toMatchObject({
      algorithmVersion: 'GLICKO1_PER_MATCH_V4',
      ratingScale: 800,
      minimumRatingDeviation: 100,
    });
  });

  it('can disable V4 growth without discarding the other growth settings', async () => {
    const snapshot = createSnapshot({
      config: GLICKO1_PER_MATCH_V4,
      queueAdmission: 'PAUSED',
    });
    const service = createService({ loadSnapshot: vi.fn().mockResolvedValue(snapshot) });

    const preview = await service.preview({
      seasonId: snapshot.season.id,
      parameters: {
        ...exactRevisionParameters(GLICKO1_PER_MATCH_V4),
        growthPool: {
          ...exactRevisionParameters(GLICKO1_PER_MATCH_V4).growthPool!,
          enabled: false,
        },
      },
      reason: '临时关闭成长补偿并保留原参数',
      adminUserId: 'admin-1',
    });

    expect(preview.targetConfig.growthPool).toEqual({
      ...GLICKO1_PER_MATCH_V4.growthPool,
      enabled: false,
    });
    expect(preview.canApply).toBe(true);
    expect(() => assertValidRankedRatingConfig(preview.targetConfig)).not.toThrow();
  });

  it('rejects adding V4 growth rules to the V3 formula family', async () => {
    const snapshot = createSnapshot({ config: GLICKO1_PER_MATCH_V3 });
    const service = createService({ loadSnapshot: vi.fn().mockResolvedValue(snapshot) });

    await expect(
      service.preview({
        seasonId: snapshot.season.id,
        parameters: {
          ratingScale: 800,
          minimumRatingDeviation: 100,
          placementMatchCount: 5,
          growthPool: {
            enabled: true,
            centerRating: 1800,
            maximumTotalAdjustment: 16,
            transitionWidth: 250,
            negativeWinnerShare: 0.75,
          },
        },
        reason: '不允许跨公式家族增加成长池',
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_GROWTH_UNSUPPORTED' });
  });

  it('rejects no-op revisions and a source competitive environment that cannot be rebuilt', async () => {
    const snapshot = createSnapshot({ config: GLICKO1_PER_MATCH_V4 });
    const repository = { loadSnapshot: vi.fn().mockResolvedValue(snapshot) };
    const service = createService(repository);
    await expect(
      service.preview({
        seasonId: snapshot.season.id,
        parameters: exactRevisionParameters(GLICKO1_PER_MATCH_V4),
        reason: '拒绝没有任何参数变化的修订',
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_NO_CHANGES' });

    repository.loadSnapshot.mockResolvedValueOnce({
      ...snapshot,
      season: { ...snapshot.season, competitiveEnvironmentId: 'sha256:damaged' },
    });
    await expect(
      service.preview({
        seasonId: snapshot.season.id,
        parameters: revisionParameters(GLICKO1_PER_MATCH_V4),
        reason: '拒绝无法重建的冻结竞技环境',
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_SOURCE_ENVIRONMENT_MISMATCH' });
  });

  it('applies only the signed current preview and delegates one atomic plan', async () => {
    const snapshot = createSnapshot({ config: GLICKO1_PER_MATCH_V4, queueAdmission: 'PAUSED' });
    const repository = {
      loadSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyPlan: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(repository);
    const preview = await service.preview({
      seasonId: snapshot.season.id,
      parameters: revisionParameters(GLICKO1_PER_MATCH_V4),
      reason: '在维护窗口应用已核对的参数',
      adminUserId: 'admin-1',
    });

    await expect(
      service.apply({
        seasonId: snapshot.season.id,
        previewToken: preview.previewToken,
        adminUserId: 'admin-2',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_PREVIEW_ADMIN_MISMATCH' });

    const result = await service.apply({
      seasonId: snapshot.season.id,
      previewToken: preview.previewToken,
      adminUserId: 'admin-1',
    });

    expect(result.targetAlgorithmVersion).toBe(preview.targetAlgorithmVersion);
    expect(repository.loadSnapshot).toHaveBeenLastCalledWith(snapshot.season.id, true);
    expect(repository.applyPlan).toHaveBeenCalledOnce();
    expect(repository.applyPlan.mock.calls[0]![0]).toMatchObject({
      targetConfig: { algorithmVersion: preview.targetAlgorithmVersion },
      reason: '在维护窗口应用已核对的参数',
    });
  });

  it('rejects tampered, expired, stale, open-queue, and blocked previews', async () => {
    let now = new Date('2026-08-08T00:00:00.000Z');
    const paused = createSnapshot({ config: GLICKO1_PER_MATCH_V4, queueAdmission: 'PAUSED' });
    const repository = {
      loadSnapshot: vi.fn().mockResolvedValue(paused),
      applyPlan: vi.fn(),
    };
    const service = createService(repository, vi.fn(), () => now);
    const preview = await service.preview({
      seasonId: paused.season.id,
      parameters: revisionParameters(GLICKO1_PER_MATCH_V4),
      reason: '验证预览令牌与应用防护',
      adminUserId: 'admin-1',
    });

    await expect(
      service.apply({
        seasonId: paused.season.id,
        previewToken: `${preview.previewToken.slice(0, -1)}x`,
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_PREVIEW_INVALID' });

    now = new Date('2026-08-08T00:16:00.000Z');
    await expect(
      service.apply({
        seasonId: paused.season.id,
        previewToken: preview.previewToken,
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_PREVIEW_EXPIRED' });

    now = new Date('2026-08-08T00:01:00.000Z');
    repository.loadSnapshot.mockResolvedValueOnce({
      ...paused,
      season: { ...paused.season, ledgerRevision: 1 },
    });
    await expect(
      service.apply({
        seasonId: paused.season.id,
        previewToken: preview.previewToken,
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_LEDGER_INVALID' });

    const changedRulesVersion = 'rules-v2';
    repository.loadSnapshot.mockResolvedValueOnce({
      ...paused,
      season: {
        ...paused.season,
        rulesVersion: changedRulesVersion,
        competitiveEnvironmentId: buildRankedCompetitiveEnvironmentIdentity(
          CARD_CATALOG,
          paused.season.ratingConfig,
          { rulesVersion: changedRulesVersion, deckPolicyVersion: paused.season.deckPolicyVersion }
        ).competitiveEnvironmentId,
      },
    });
    await expect(
      service.apply({
        seasonId: paused.season.id,
        previewToken: preview.previewToken,
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_PREVIEW_STALE' });

    repository.loadSnapshot.mockResolvedValueOnce({
      ...paused,
      season: { ...paused.season, queueAdmission: 'OPEN' },
    });
    await expect(
      service.apply({
        seasonId: paused.season.id,
        previewToken: preview.previewToken,
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_QUEUE_OPEN' });

    repository.loadSnapshot.mockResolvedValueOnce({
      ...paused,
      blockers: { ...paused.blockers, activeTickets: 1 },
    });
    await expect(
      service.apply({
        seasonId: paused.season.id,
        previewToken: preview.previewToken,
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ code: 'RANKED_RATING_REVISION_BLOCKED' });
    expect(repository.applyPlan).not.toHaveBeenCalled();
  });

  it('rejects a revision-looking algorithm without its exact immutable revision identity', () => {
    const fake: RankedRatingConfig = {
      ...GLICKO1_PER_MATCH_V4,
      algorithmVersion: `GLICKO1_PER_MATCH_V4_REV_${'b'.repeat(32)}`,
    };
    expect(() => assertValidRankedRatingConfig(fake)).toThrow(
      'revision algorithmVersion requires a matching parameterRevision identity'
    );
  });

  it('persists the immutable revision, directives, full steps, projections, matches, and season atomically', async () => {
    const seeds = new Map([
      ['user-1', state(1500, 300, 0, null)],
      ['user-2', state(1500, 300, 0, null)],
    ]);
    const current = materializeRankedRatingLedger([EVENT], GLICKO1_PER_MATCH_V3, seeds).players;
    const snapshot = createSnapshot({
      config: GLICKO1_PER_MATCH_V3,
      events: [EVENT],
      seeds,
      currentRatings: current,
      queueAdmission: 'PAUSED',
    });
    let capturedPlan: unknown;
    const planningRepository = {
      loadSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyPlan: vi.fn((plan) => {
        capturedPlan = plan;
        return Promise.resolve();
      }),
    };
    const service = createService(planningRepository);
    const preview = await service.preview({
      seasonId: snapshot.season.id,
      parameters: {
        ratingScale: 900,
        minimumRatingDeviation: 100,
        placementMatchCount: 6,
      },
      reason: '验证原子持久化完整边界',
      adminUserId: 'admin-1',
    });
    await service.apply({
      seasonId: snapshot.season.id,
      previewToken: preview.previewToken,
      adminUserId: 'admin-1',
    });

    const calls: { text: string; values: readonly unknown[] }[] = [];
    const client = {
      query: vi.fn((text: string, values: readonly unknown[] = []) => {
        calls.push({ text, values });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
    };
    const repository = new PostgresRankedRatingRevisionRepository(client as never);
    await repository.applyPlan(capturedPlan as never, 'admin-1');

    expect(calls.some((call) => call.text.includes('INSERT INTO ranked_rating_revisions'))).toBe(
      true
    );
    expect(calls.some((call) => call.text.includes('INSERT INTO ranked_rating_events'))).toBe(true);
    expect(calls.some((call) => call.text.includes('INSERT INTO ranked_rating_event_steps'))).toBe(
      true
    );
    expect(calls.some((call) => call.text.includes('DELETE FROM ranked_player_ratings'))).toBe(
      true
    );
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO ranked_player_ratings'))
    ).toHaveLength(2);
    expect(calls.some((call) => call.text.includes('UPDATE ranked_matches'))).toBe(true);
    expect(calls.some((call) => call.text.includes('ranked_player_seeds'))).toBe(false);
    expect(calls.some((call) => call.text.includes('active_rating_revision_id = $7'))).toBe(true);
  });
});

function createService(
  repository: Record<string, unknown>,
  audit = vi.fn(),
  now = () => new Date('2026-08-08T00:00:00.000Z')
) {
  return new RankedRatingRevisionService({
    transaction: async (callback) => callback(repository as never),
    createId: () => 'a'.repeat(32),
    now,
    previewSecret: 'test-preview-secret',
    audit,
  });
}

function createSnapshot({
  config,
  events = [],
  seeds = new Map(),
  currentRatings = new Map(),
  queueAdmission = 'PAUSED',
}: {
  config: RankedRatingConfig;
  events?: readonly RankedRatingEvent[];
  seeds?: ReadonlyMap<string, ReturnType<typeof state>>;
  currentRatings?: ReadonlyMap<string, ReturnType<typeof state>>;
  queueAdmission?: 'OPEN' | 'PAUSED';
}): RankedRatingRevisionSnapshot {
  return {
    season: {
      id: '11111111-1111-4111-8111-111111111111',
      lifecycle: 'ACTIVE',
      queueAdmission,
      competitiveEnvironmentId: buildRankedCompetitiveEnvironmentIdentity(CARD_CATALOG, config, {
        rulesVersion: 'rules-v1',
        deckPolicyVersion: 'deck-v1',
      }).competitiveEnvironmentId,
      rulesVersion: 'rules-v1',
      cardCatalogVersion: CARD_CATALOG.cardCatalogVersion,
      cardCatalogHash: CARD_CATALOG.cardCatalogHash,
      deckPolicyVersion: 'deck-v1',
      ratingAlgorithmVersion: config.algorithmVersion,
      ratingConfig: config,
      leaderboardMinimumMatchCount: config.placementMatchCount,
      ledgerRevision: events.length,
      activeRatingRevisionId: null,
    },
    blockers: {
      pendingMatches: 0,
      runningMatches: 0,
      activeTickets: 0,
      activeReservations: 0,
      activeParticipations: 0,
      matchEnvironmentMismatches: 0,
      matchRecordRulesMismatches: 0,
    },
    events,
    seeds,
    currentRatings,
    playerNames: new Map([
      ['user-1', '玩家一'],
      ['user-2', '玩家二'],
    ]),
    nextRevisionNumber: 1,
  };
}

function state(
  rating: number,
  ratingDeviation: number,
  ratedMatchCount: number,
  lastRatedAt: Date | null
) {
  return { rating, ratingDeviation, ratedMatchCount, lastRatedAt };
}

function revisionParameters(config: RankedRatingConfig) {
  return {
    ratingScale: config.ratingScale + 1,
    minimumRatingDeviation: config.minimumRatingDeviation,
    placementMatchCount: config.placementMatchCount,
    ...(config.growthPool
      ? {
          growthPool: {
            enabled: config.growthPool.enabled,
            centerRating: config.growthPool.centerRating,
            maximumTotalAdjustment: config.growthPool.maximumTotalAdjustment,
            transitionWidth: config.growthPool.transitionWidth,
            negativeWinnerShare: config.growthPool.negativeWinnerShare,
          },
        }
      : {}),
  };
}

function exactRevisionParameters(config: RankedRatingConfig) {
  return {
    ...revisionParameters(config),
    ratingScale: config.ratingScale,
  };
}
