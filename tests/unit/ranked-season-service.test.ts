import { describe, expect, it, vi } from 'vitest';
import { GLICKO1_PER_MATCH_SHADOW_V2, type Glicko1Config } from '../../src/server/rating/glicko';
import {
  buildRankedCompetitiveEnvironmentIdentity,
  type RankedCompetitiveEnvironmentIdentity,
} from '../../src/server/rating/ranked-environment';
import {
  RankedSeasonService,
  getRankedQueueWindowTiming,
  isRankedQueueWindowOpen,
  type RankedSeasonQueryClient,
  type RankedSeasonQueryResult,
} from '../../src/server/services/ranked-season-service';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    connect: vi.fn(),
  },
}));

const CONFIG: Glicko1Config = {
  ...GLICKO1_PER_MATCH_SHADOW_V2,
  algorithmVersion: 'GLICKO1_PER_MATCH_TEST_V1',
};

const ENVIRONMENT: RankedCompetitiveEnvironmentIdentity = buildRankedCompetitiveEnvironmentIdentity(
  {
    cardCatalogVersion: 'CATALOG_V1',
    cardCatalogHash: `sha256:${'2'.repeat(64)}`,
    publishedCardCount: 100,
  },
  CONFIG,
  {
    rulesVersion: 'RULES_V1',
    deckPolicyVersion: 'DECK_POLICY_V1',
  }
);

function seasonRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: 'season-1',
    season_key: 'season-2026-01',
    name: '2026 第一赛季',
    lifecycle: 'DRAFT',
    queue_admission: 'PAUSED',
    competitive_environment_id: ENVIRONMENT.competitiveEnvironmentId,
    platform_time_zone: 'Asia/Shanghai',
    open_windows: [{ weekdays: [1], startMinute: 1200, endMinute: 1320 }],
    starts_at: new Date('2026-08-01T00:00:00.000Z'),
    scheduled_ends_at: new Date('2026-09-01T00:00:00.000Z'),
    finalizing_deadline_at: new Date('2026-09-03T00:00:00.000Z'),
    closed_at: null,
    rules_version: ENVIRONMENT.rulesVersion,
    card_catalog_version: ENVIRONMENT.cardCatalogVersion,
    card_catalog_hash: ENVIRONMENT.cardCatalogHash,
    deck_policy_version: ENVIRONMENT.deckPolicyVersion,
    rating_algorithm_version: CONFIG.algorithmVersion,
    rating_config: CONFIG,
    leaderboard_minimum_match_count: 10,
    ledger_revision: 0,
    ...overrides,
  };
}

function createHarness(
  responder: (text: string, values: readonly unknown[]) => readonly Record<string, unknown>[]
) {
  const calls: string[] = [];
  const client: RankedSeasonQueryClient = {
    async query<T = unknown>(
      text: string,
      values: readonly unknown[] = []
    ): Promise<RankedSeasonQueryResult<T>> {
      await Promise.resolve();
      calls.push(text);
      return { rows: responder(text, values) as T[] };
    },
  };
  const transaction = vi.fn(
    async <T>(callback: (queryClient: RankedSeasonQueryClient) => Promise<T>) => callback(client)
  );
  return {
    calls,
    service: new RankedSeasonService({ transaction }),
    transaction,
  };
}

describe('ranked season open windows', () => {
  it('projects the configured platform timezone with inclusive start and exclusive end', () => {
    const startsAt = new Date('2026-08-01T00:00:00.000Z');
    const endsAt = new Date('2026-09-01T00:00:00.000Z');
    const windows = [{ weekdays: [1], startMinute: 1200, endMinute: 1320 }];

    expect(
      isRankedQueueWindowOpen(
        new Date('2026-08-03T12:00:00.000Z'),
        'Asia/Shanghai',
        windows,
        startsAt,
        endsAt
      )
    ).toBe(true);
    expect(
      isRankedQueueWindowOpen(
        new Date('2026-08-03T13:59:59.000Z'),
        'Asia/Shanghai',
        windows,
        startsAt,
        endsAt
      )
    ).toBe(true);
    expect(
      isRankedQueueWindowOpen(
        new Date('2026-08-03T14:00:00.000Z'),
        'Asia/Shanghai',
        windows,
        startsAt,
        endsAt
      )
    ).toBe(false);
  });

  it('reports the current close and next opening in the configured timezone', () => {
    const timing = getRankedQueueWindowTiming(
      new Date('2026-08-03T12:30:00.000Z'),
      'Asia/Shanghai',
      [{ weekdays: [1, 3], startMinute: 1200, endMinute: 1320 }],
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z')
    );

    expect(timing.withinOpenWindow).toBe(true);
    expect(timing.currentWindowEndsAt?.toISOString()).toBe('2026-08-03T14:00:00.000Z');
    expect(timing.nextOpensAt?.toISOString()).toBe('2026-08-05T12:00:00.000Z');
  });
});

describe('RankedSeasonService lifecycle', () => {
  it('creates a paused draft with a frozen competitive environment', async () => {
    const { calls, service } = createHarness((text) =>
      text.includes('INSERT INTO ranked_seasons') ? [seasonRow()] : []
    );

    const season = await service.createDraft({
      seasonKey: 'season-2026-01',
      name: '2026 第一赛季',
      platformTimeZone: 'Asia/Shanghai',
      openWindows: [{ weekdays: [1], startMinute: 1200, endMinute: 1320 }],
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      scheduledEndsAt: new Date('2026-09-01T00:00:00.000Z'),
      finalizingDeadlineAt: new Date('2026-09-03T00:00:00.000Z'),
      environment: ENVIRONMENT,
      ratingConfig: CONFIG,
      leaderboardMinimumMatchCount: 12,
      adminUserId: '11111111-1111-4111-8111-111111111111',
    });

    expect(season).toMatchObject({
      lifecycle: 'DRAFT',
      queueAdmission: 'PAUSED',
      competitiveEnvironmentId: ENVIRONMENT.competitiveEnvironmentId,
      leaderboardMinimumMatchCount: 10,
    });
    expect(calls.some((text) => text.includes('rating_config'))).toBe(true);
  });

  it('activates only when the current deployment still matches the frozen environment', async () => {
    const { service } = createHarness((text) => {
      if (text.includes('SELECT *') && text.includes('FOR UPDATE')) {
        return [seasonRow()];
      }
      if (text.includes('UPDATE ranked_seasons')) {
        return [seasonRow({ lifecycle: 'ACTIVE' })];
      }
      return [];
    });

    const season = await service.activate(
      'season-1',
      ENVIRONMENT,
      CONFIG,
      '11111111-1111-4111-8111-111111111111',
      new Date('2026-08-01T01:00:00.000Z')
    );

    expect(season.lifecycle).toBe('ACTIVE');
    expect(season.queueAdmission).toBe('PAUSED');
  });

  it('rejects activation while another season is active or finalizing', async () => {
    const { calls, service } = createHarness((text) => {
      if (text.includes('SELECT *') && text.includes('FOR UPDATE')) {
        return [seasonRow()];
      }
      if (text.includes("lifecycle IN ('ACTIVE', 'FINALIZING')")) {
        return [{ id: 'season-existing' }];
      }
      return [];
    });

    await expect(
      service.activate(
        'season-1',
        ENVIRONMENT,
        CONFIG,
        '11111111-1111-4111-8111-111111111111',
        new Date('2026-08-01T01:00:00.000Z')
      )
    ).rejects.toMatchObject({
      code: 'RANKED_SEASON_ALREADY_ACTIVE',
      statusCode: 409,
    });
    expect(calls.some((text) => text.includes('UPDATE ranked_seasons'))).toBe(false);
  });

  it('materializes soft-reset seeds from the latest closed season when activating', async () => {
    let seedValues: readonly unknown[] = [];
    const { calls, service } = createHarness((text, values) => {
      if (text.includes('SELECT *') && text.includes('FOR UPDATE')) {
        return [seasonRow()];
      }
      if (text.includes('UPDATE ranked_seasons')) {
        return [seasonRow({ lifecycle: 'ACTIVE' })];
      }
      if (text.includes("WHERE lifecycle = 'CLOSED'")) {
        return [{ id: 'previous-season' }];
      }
      if (text.includes('INSERT INTO ranked_player_seeds')) {
        seedValues = values;
      }
      return [];
    });

    await service.activate(
      'season-1',
      ENVIRONMENT,
      CONFIG,
      '11111111-1111-4111-8111-111111111111',
      new Date('2026-08-01T01:00:00.000Z')
    );

    expect(calls.some((text) => text.includes('INSERT INTO ranked_player_seeds'))).toBe(true);
    expect(calls.some((text) => text.includes('INSERT INTO ranked_player_ratings'))).toBe(true);
    expect(seedValues).toEqual([
      'season-1',
      'previous-season',
      'RESET_TO_INITIAL',
      CONFIG.initialRating,
      CONFIG.initialRatingDeviation,
      CONFIG.softResetCenter,
      CONFIG.softResetRetention,
      CONFIG.softResetMinimumDeviation,
      CONFIG.maximumRatingDeviation,
    ]);
  });

  it('does not close while a formed ranked pairing has not started', async () => {
    const { service } = createHarness((text) => {
      if (text.includes('SELECT *') && text.includes('FOR UPDATE')) {
        return [seasonRow({ lifecycle: 'FINALIZING' })];
      }
      if (text.includes('FROM ranked_matches')) {
        return [{ pending_count: 0 }];
      }
      if (text.includes('FROM public_table_reservations')) {
        return [{ reservation_count: 1 }];
      }
      return [];
    });

    await expect(
      service.close(
        'season-1',
        '11111111-1111-4111-8111-111111111111',
        new Date('2026-09-02T00:00:00.000Z')
      )
    ).rejects.toMatchObject({
      code: 'RANKED_SEASON_UNSTARTED_RESERVATIONS',
      statusCode: 409,
    });
  });

  it('allows admission to be restored ahead of a window while effective entry remains closed', async () => {
    const { calls, service } = createHarness((text) =>
      text.includes('SELECT *') && text.includes('FOR UPDATE')
        ? [seasonRow({ lifecycle: 'ACTIVE' })]
        : text.includes('SET queue_admission = $2')
          ? [seasonRow({ lifecycle: 'ACTIVE', queue_admission: 'OPEN' })]
          : []
    );

    const season = await service.setQueueAdmission(
      'season-1',
      'OPEN',
      '11111111-1111-4111-8111-111111111111'
    );

    expect(season.queueAdmission).toBe('OPEN');
    expect(
      isRankedQueueWindowOpen(
        new Date('2026-08-03T11:59:00.000Z'),
        season.platformTimeZone,
        season.openWindows,
        season.startsAt,
        season.scheduledEndsAt
      )
    ).toBe(false);
    expect(calls.some((text) => text.includes('SET queue_admission = $2'))).toBe(true);
  });

  it('allows an active season to update its operational settings', async () => {
    const { calls, service } = createHarness((text) => {
      if (text.includes('SELECT *') && text.includes('FOR UPDATE')) {
        return [seasonRow({ lifecycle: 'ACTIVE' })];
      }
      if (text.includes('SET name = $2')) {
        return [
          seasonRow({
            lifecycle: 'ACTIVE',
            name: '晚间排位',
            open_windows: [{ weekdays: [5, 6], startMinute: 1140, endMinute: 1320 }],
            leaderboard_minimum_match_count: 8,
          }),
        ];
      }
      return [];
    });

    const season = await service.updateActiveOperations('season-1', {
      name: '晚间排位',
      openWindows: [{ weekdays: [5, 6], startMinute: 1140, endMinute: 1320 }],
      leaderboardMinimumMatchCount: 8,
      adminUserId: '11111111-1111-4111-8111-111111111111',
    });

    expect(season).toMatchObject({
      lifecycle: 'ACTIVE',
      name: '晚间排位',
      openWindows: [{ weekdays: [5, 6], startMinute: 1140, endMinute: 1320 }],
      leaderboardMinimumMatchCount: 8,
      competitiveEnvironmentId: ENVIRONMENT.competitiveEnvironmentId,
      scheduledEndsAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const update = calls.find((text) => text.includes('SET name = $2'));
    expect(update).toContain('open_windows = $3::jsonb');
    expect(update).toContain('leaderboard_minimum_match_count = $4');
    expect(update).not.toContain('rating_config =');
    expect(update).not.toContain('scheduled_ends_at =');
    expect(update).not.toContain('competitive_environment_id =');
  });

  it('rejects operational edits before activation', async () => {
    const { service } = createHarness((text) =>
      text.includes('SELECT *') && text.includes('FOR UPDATE') ? [seasonRow()] : []
    );

    await expect(
      service.updateActiveOperations('season-1', {
        name: '尚未开始',
        openWindows: [{ weekdays: [1], startMinute: 1200, endMinute: 1320 }],
        leaderboardMinimumMatchCount: 10,
        adminUserId: '11111111-1111-4111-8111-111111111111',
      })
    ).rejects.toMatchObject({
      code: 'RANKED_SEASON_ACTIVE_UPDATE_CONFLICT',
    });
  });

  it('rejects SHADOW algorithms before opening a persistent season transaction', async () => {
    const { service, transaction } = createHarness(() => []);

    await expect(
      service.createDraft({
        seasonKey: 'season-shadow',
        name: '影子赛季',
        platformTimeZone: 'Asia/Shanghai',
        openWindows: [{ weekdays: [1], startMinute: 1200, endMinute: 1320 }],
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        scheduledEndsAt: new Date('2026-09-01T00:00:00.000Z'),
        finalizingDeadlineAt: new Date('2026-09-03T00:00:00.000Z'),
        environment: {
          ...ENVIRONMENT,
          ratingAlgorithmVersion: GLICKO1_PER_MATCH_SHADOW_V2.algorithmVersion,
        },
        ratingConfig: GLICKO1_PER_MATCH_SHADOW_V2,
        leaderboardMinimumMatchCount: 10,
        adminUserId: '11111111-1111-4111-8111-111111111111',
      })
    ).rejects.toMatchObject({
      code: 'RANKED_FORMAL_ALGORITHM_REQUIRED',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a leaderboard match threshold outside the supported range', async () => {
    const { service, transaction } = createHarness(() => []);

    await expect(
      service.createDraft({
        seasonKey: 'season-invalid-threshold',
        name: '无效门槛赛季',
        platformTimeZone: 'Asia/Shanghai',
        openWindows: [{ weekdays: [1], startMinute: 1200, endMinute: 1320 }],
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        scheduledEndsAt: new Date('2026-09-01T00:00:00.000Z'),
        finalizingDeadlineAt: new Date('2026-09-03T00:00:00.000Z'),
        environment: ENVIRONMENT,
        ratingConfig: CONFIG,
        leaderboardMinimumMatchCount: 0,
        adminUserId: '11111111-1111-4111-8111-111111111111',
      })
    ).rejects.toMatchObject({
      code: 'RANKED_LEADERBOARD_MINIMUM_MATCH_COUNT_INVALID',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
