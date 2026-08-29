import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

interface LoginResult {
  readonly accessToken: string;
}

let adminAccessToken: string | null = null;
let adminSessionCookies: Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'] | null =
  null;

async function login(
  request: APIRequestContext,
  usernameOrEmail: string,
  password: string
): Promise<LoginResult> {
  const response = await request.post('/api/auth/login', {
    data: { usernameOrEmail, password },
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {
    data: { accessToken: string };
  };
  expect(payload.data.accessToken).toBeTruthy();
  return payload.data;
}

function bearer(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function getAdminAccessToken(request: APIRequestContext): Promise<string> {
  if (!adminAccessToken) {
    adminAccessToken = (await login(request, 'test_admin', 'test_admin_password')).accessToken;
    adminSessionCookies = (await request.storageState()).cookies;
  }
  return adminAccessToken;
}

const E2E_SEASON_ID = '99999999-9999-4999-8999-999999999999';
const E2E_SECOND_SEASON_ID = '99999999-9999-4999-8999-999999999998';
const E2E_UI_SEASON_KEY = 'season-e2e-ui-draft';
const RANKED_ADMIN_DB_PROJECT = 'tablet-1024x768';
const E2E_RANKED_OPPONENT_ID = '88888888-0000-4000-8000-000000000099';
const E2E_RANKED_PLAYER_FIXTURES = [
  { id: '88888888-0000-4000-8000-000000000001', rating: 1900, ratedMatchCount: 12 },
  { id: '88888888-0000-4000-8000-000000000002', rating: 1800, ratedMatchCount: 12 },
  { id: '88888888-0000-4000-8000-000000000003', rating: 1800, ratedMatchCount: 12 },
  { id: '88888888-0000-4000-8000-000000000004', rating: 1700, ratedMatchCount: 12 },
  { id: '88888888-0000-4000-8000-000000000005', rating: 1600, ratedMatchCount: 12 },
  { id: '88888888-0000-4000-8000-000000000006', rating: 1500, ratedMatchCount: 12 },
  { id: '88888888-0000-4000-8000-000000000007', rating: 1400, ratedMatchCount: 12 },
  { id: '88888888-0000-4000-8000-000000000008', rating: 1300, ratedMatchCount: 7 },
  { id: '88888888-0000-4000-8000-000000000009', rating: 2000, ratedMatchCount: 4 },
  { id: '88888888-0000-4000-8000-000000000010', rating: 2100, ratedMatchCount: null },
] as const;
const E2E_RANKED_TARGET_ID = E2E_RANKED_PLAYER_FIXTURES[3].id;
const E2E_RANKED_PLACEMENT_ELIGIBLE_ID = E2E_RANKED_PLAYER_FIXTURES[7].id;
const E2E_RANKED_PLACEMENT_INELIGIBLE_ID = E2E_RANKED_PLAYER_FIXTURES[8].id;
const E2E_RANKED_SECOND_SEASON_PLAYER_ID = E2E_RANKED_PLAYER_FIXTURES[9].id;

async function withLocalTestDatabase<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const databaseUrl =
    process.env.RANKED_E2E_DATABASE_URL ?? 'postgres://loveca:loveca_dev@127.0.0.1:5432/loveca';
  const parsed = new URL(databaseUrl);
  if (
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    (parsed.port || '5432') !== '5432' ||
    parsed.pathname !== '/loveca'
  ) {
    throw new Error('排位 E2E 只允许连接本机 5432 端口的 loveca 测试数据库');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function removeRankedMatchFacts(
  client: pg.PoolClient,
  seasonIds: readonly string[]
): Promise<void> {
  const deletedMatches = await client.query<{ match_id: string }>(
    `DELETE FROM ranked_matches
     WHERE season_id = ANY($1::uuid[])
     RETURNING match_id`,
    [seasonIds]
  );
  if (deletedMatches.rowCount) {
    await client.query('DELETE FROM match_records WHERE match_id = ANY($1::text[])', [
      deletedMatches.rows.map((row) => row.match_id),
    ]);
  }
}

async function seedSettledRankedMatches(
  client: pg.PoolClient,
  input: {
    readonly seasonId: string;
    readonly playerId: string;
    readonly matchCount: number;
    readonly matchIdPrefix: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO match_records (
       match_id,
       room_code,
       match_mode,
       automation_game_mode,
       origin_kind,
       origin_label,
       status,
       completeness,
       started_at,
       ended_at,
       sealed_at,
       first_user_id,
       second_user_id,
       winner_seat,
       end_reason,
       rules_version,
       card_data_version,
       card_data_hash
     )
     SELECT
       $1 || '-' || match_ordinal::text,
       'ranked-admin-e2e',
       'ONLINE',
       'DEBUG',
       'RANKED',
       '排位管理 E2E',
       'COMPLETED',
       'METADATA_ONLY',
       NOW(),
       NOW(),
       NOW(),
       $2,
       $3,
       CASE WHEN match_ordinal % 2 = 0 THEN 'FIRST' ELSE 'SECOND' END,
       'NORMAL',
       'E2E_RULES_V1',
       'E2E_CATALOG_V1',
       $4
     FROM generate_series(1, $5::integer) AS match_ordinal`,
    [
      input.matchIdPrefix,
      input.playerId,
      E2E_RANKED_OPPONENT_ID,
      `sha256:${'c'.repeat(64)}`,
      input.matchCount,
    ]
  );
  await client.query(
    `INSERT INTO ranked_matches (
       match_id,
       season_id,
       first_user_id,
       second_user_id,
       rating_status,
       winner_seat,
       result_type,
       rules_version,
       card_catalog_version,
       card_catalog_hash,
       deck_policy_version,
       rating_algorithm_version,
       ended_at,
       settled_at
     )
     SELECT
       $1 || '-' || match_ordinal::text,
       $2,
       $3,
       $4,
       'SETTLED',
       CASE WHEN match_ordinal % 2 = 0 THEN 'FIRST' ELSE 'SECOND' END,
       'NORMAL',
       'E2E_RULES_V1',
       'E2E_CATALOG_V1',
       $5,
       'E2E_DECK_POLICY_V1',
       'GLICKO1_PER_MATCH_E2E_V1',
       NOW(),
       NOW()
     FROM generate_series(1, $6::integer) AS match_ordinal`,
    [
      input.matchIdPrefix,
      input.seasonId,
      input.playerId,
      E2E_RANKED_OPPONENT_ID,
      `sha256:${'c'.repeat(64)}`,
      input.matchCount,
    ]
  );
}

async function seedE2eSeason(
  lifecycle: 'DRAFT' | 'ACTIVE' = 'ACTIVE',
  options: {
    readonly seasonId?: string;
    readonly seasonKey?: string;
    readonly name?: string;
    readonly placementMatchCount?: number;
    readonly leaderboardMinimumMatchCount?: number;
  } = {}
): Promise<void> {
  const seasonId = options.seasonId ?? E2E_SEASON_ID;
  const seasonKey = options.seasonKey ?? 'season-e2e-lifecycle';
  const name = options.name ?? 'E2E 生命周期赛季';
  const placementMatchCount = options.placementMatchCount ?? 10;
  const leaderboardMinimumMatchCount = options.leaderboardMinimumMatchCount ?? 10;
  const competitiveEnvironmentId = `sha256:${randomBytes(32).toString('hex')}`;
  const ratingConfig = {
    algorithmVersion: 'GLICKO1_PER_MATCH_E2E_V1',
    ratingPeriodMode: 'PER_MATCH',
    ratingScale: 400,
    initialRating: 1500,
    initialRatingDeviation: 350,
    minimumRatingDeviation: 30,
    maximumRatingDeviation: 350,
    inactivityTimeUnitMs: 86_400_000,
    deviationIncreasePerTimeUnit: 18.71887638718005,
    placementMatchCount,
    displayDecimalPlaces: 0,
    softResetMode: 'RESET_TO_INITIAL',
    softResetCenter: 1500,
    softResetRetention: 0.5,
    softResetMinimumDeviation: 200,
  };
  await withLocalTestDatabase(async (client) => {
    await removeRankedMatchFacts(client, [seasonId]);
    await client.query('DELETE FROM ranked_seasons WHERE id = $1', [seasonId]);
    await client.query(
      `INSERT INTO ranked_seasons (
         id,
         season_key,
         name,
         competitive_environment_id,
         lifecycle,
         queue_admission,
         platform_time_zone,
         open_windows,
         starts_at,
         scheduled_ends_at,
         finalizing_deadline_at,
         rules_version,
         card_catalog_version,
         card_catalog_hash,
         deck_policy_version,
         rating_algorithm_version,
         rating_config,
         leaderboard_minimum_match_count,
         created_by,
         updated_by
       )
       SELECT
         $1,
         $8,
         $9,
         $2,
         $7,
         'PAUSED',
         'Asia/Shanghai',
         $3::jsonb,
         '2026-01-01T00:00:00.000Z',
         '2027-01-01T00:00:00.000Z',
         '2027-01-03T00:00:00.000Z',
         'E2E_RULES_V1',
         'E2E_CATALOG_V1',
         $4,
         'E2E_DECK_POLICY_V1',
         $5,
         $6::jsonb,
         $10,
         profile.id,
         profile.id
       FROM profiles AS profile
       WHERE profile.username = 'test_admin'`,
      [
        seasonId,
        competitiveEnvironmentId,
        JSON.stringify([{ weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 0, endMinute: 1440 }]),
        `sha256:${'c'.repeat(64)}`,
        ratingConfig.algorithmVersion,
        JSON.stringify(ratingConfig),
        lifecycle,
        seasonKey,
        name,
        leaderboardMinimumMatchCount,
      ]
    );
  });
}

async function removeE2eSeason(): Promise<void> {
  await withLocalTestDatabase(async (client) => {
    await removeRankedMatchFacts(client, [E2E_SEASON_ID]);
    await client.query('DELETE FROM ranked_seasons WHERE id = $1', [E2E_SEASON_ID]);
  });
}

async function seedE2eRankedPlayerRatings(): Promise<void> {
  await withLocalTestDatabase(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [...E2E_RANKED_PLAYER_FIXTURES.map((fixture) => fixture.id), E2E_RANKED_OPPONENT_ID],
      ]);
      await client.query(
        `INSERT INTO users (id, email, password_hash, email_verified)
         VALUES ($1, 'ranked-context-e2e-opponent@example.invalid', 'unused-ranked-e2e-password', TRUE)`,
        [E2E_RANKED_OPPONENT_ID]
      );
      await client.query(
        `INSERT INTO profiles (id, username, display_name)
         VALUES ($1, 'ranked_context_e2e_opponent', '排位上下文对手')`,
        [E2E_RANKED_OPPONENT_ID]
      );
      for (const [index, fixture] of E2E_RANKED_PLAYER_FIXTURES.entries()) {
        const ordinal = index + 1;
        await client.query(
          `INSERT INTO users (id, email, password_hash, email_verified)
           VALUES ($1, $2, 'unused-ranked-e2e-password', TRUE)`,
          [fixture.id, `ranked-context-e2e-${ordinal}@example.invalid`]
        );
        await client.query(
          `INSERT INTO profiles (id, username, display_name)
           VALUES ($1, $2, $3)`,
          [
            fixture.id,
            ordinal === 4 ? 'ranked_context_e2e' : `ranked_context_e2e_${ordinal}`,
            ordinal === 4 ? '排位上下文目标%_' : `排位上下文玩家 ${ordinal}`,
          ]
        );
        if (fixture.ratedMatchCount !== null) {
          await client.query(
            `INSERT INTO ranked_player_ratings (
               season_id,
               user_id,
               rating,
               rating_deviation,
               rated_match_count,
               last_rated_at,
               ledger_revision
             ) VALUES ($1, $2, $3, 80, $4, NOW(), 0)`,
            [E2E_SEASON_ID, fixture.id, fixture.rating, fixture.ratedMatchCount]
          );
          await seedSettledRankedMatches(client, {
            seasonId: E2E_SEASON_ID,
            playerId: fixture.id,
            matchCount: fixture.ratedMatchCount,
            matchIdPrefix: `ranked-admin-e2e-primary-${index + 1}`,
          });
        }
      }
      const secondSeasonPlayer = E2E_RANKED_PLAYER_FIXTURES[9];
      await client.query(
        `INSERT INTO ranked_player_ratings (
           season_id,
           user_id,
           rating,
           rating_deviation,
           rated_match_count,
           last_rated_at,
           ledger_revision
         ) VALUES ($1, $2, $3, 80, 12, NOW(), 0)`,
        [E2E_SECOND_SEASON_ID, secondSeasonPlayer.id, secondSeasonPlayer.rating]
      );
      await seedSettledRankedMatches(client, {
        seasonId: E2E_SECOND_SEASON_ID,
        playerId: secondSeasonPlayer.id,
        matchCount: 12,
        matchIdPrefix: 'ranked-admin-e2e-secondary-10',
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function removeE2eRankedPlayerFixtures(): Promise<void> {
  await withLocalTestDatabase(async (client) => {
    await removeRankedMatchFacts(client, [E2E_SEASON_ID, E2E_SECOND_SEASON_ID]);
    await client.query('DELETE FROM ranked_seasons WHERE id = ANY($1::uuid[])', [
      [E2E_SEASON_ID, E2E_SECOND_SEASON_ID],
    ]);
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
      [...E2E_RANKED_PLAYER_FIXTURES.map((fixture) => fixture.id), E2E_RANKED_OPPONENT_ID],
    ]);
  });
}

async function removeE2eUiSeason(): Promise<void> {
  await withLocalTestDatabase(async (client) => {
    await client.query('DELETE FROM ranked_seasons WHERE season_key = $1', [E2E_UI_SEASON_KEY]);
  });
}

async function openAuthenticatedAdminPage(page: Page, request: APIRequestContext): Promise<void> {
  await getAdminAccessToken(request);
  if (!adminSessionCookies) {
    throw new Error('管理员 E2E 会话 cookie 未初始化');
  }
  await page.context().addCookies(adminSessionCookies);
  const sessionRestored = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/refresh') && response.ok()
  );
  await page.goto('/');
  await sessionRestored;
  adminSessionCookies = await page.context().cookies();
}

async function openRankedAdminPage(page: Page, request: APIRequestContext): Promise<void> {
  await openAuthenticatedAdminPage(page, request);
  await page.getByRole('button', { name: /运营管理中心/u }).click();
  await page.getByRole('button', { name: /赛季排位/u }).click();
  await expect(page.getByRole('heading', { name: '赛季排位管理' })).toBeVisible();
}

test.describe('赛季排位管理员 API', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(({ request }, testInfo) => {
    void request;
    test.skip(
      testInfo.project.name !== RANKED_ADMIN_DB_PROJECT,
      '本文件会修改共享的本地 PostgreSQL fixture，仅在单一 Playwright project 中执行'
    );
  });

  test('未登录和普通玩家不能访问排位管理能力', async ({ request }) => {
    const anonymous = await request.get('/api/admin/ranked/environment');
    expect(anonymous.status()).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });

    const player = await login(request, 'test_player_1', 'test_password_1');
    const forbidden = await request.get('/api/admin/ranked/environment', {
      headers: bearer(player.accessToken),
    });
    expect(forbidden.status()).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    });

    const anonymousPlayers = await request.get(
      `/api/admin/ranked/players?seasonId=${E2E_SEASON_ID}`
    );
    expect(anonymousPlayers.status()).toBe(401);

    const forbiddenStatistics = await request.get(
      `/api/admin/ranked/deck-statistics?seasonId=${E2E_SEASON_ID}`,
      { headers: bearer(player.accessToken) }
    );
    expect(forbiddenStatistics.status()).toBe(403);
  });

  test('管理员可读取真实竞技环境并用正式算法创建赛季草稿', async ({ request }) => {
    const headers = bearer(await getAdminAccessToken(request));

    const environmentResponse = await request.get('/api/admin/ranked/environment', {
      headers,
    });
    expect(environmentResponse.ok()).toBe(true);
    const environment = (await environmentResponse.json()) as {
      data: {
        persistentSeasonReady: boolean;
        catalog: { publishedCardCount: number; cardCatalogHash: string };
        algorithms: Array<{
          algorithmVersion: string;
          status: string;
          environment: { competitiveEnvironmentId: string };
        }>;
      };
    };
    expect(environment.data.persistentSeasonReady).toBe(true);
    expect(environment.data.catalog.publishedCardCount).toBeGreaterThan(0);
    expect(environment.data.catalog.cardCatalogHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(environment.data.algorithms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          algorithmVersion: 'GLICKO1_PER_MATCH_SHADOW_V2',
          status: 'SHADOW_CANDIDATE',
        }),
        expect.objectContaining({
          algorithmVersion: 'GLICKO1_PER_MATCH_V4',
          status: 'FORMAL',
          environment: expect.objectContaining({
            competitiveEnvironmentId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          }),
        }),
        expect.objectContaining({
          algorithmVersion: 'GLICKO1_PER_MATCH_V3',
          status: 'FORMAL',
          environment: expect.objectContaining({
            competitiveEnvironmentId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          }),
        }),
        expect.objectContaining({
          algorithmVersion: 'GLICKO1_PER_MATCH_V2',
          status: 'FORMAL',
          environment: expect.objectContaining({
            competitiveEnvironmentId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          }),
        }),
        expect.objectContaining({
          algorithmVersion: 'GLICKO1_PER_MATCH_V1',
          status: 'FORMAL',
          environment: expect.objectContaining({
            competitiveEnvironmentId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          }),
        }),
      ])
    );

    const shadowResponse = await request.post('/api/admin/ranked/seasons', {
      headers,
      data: {
        seasonKey: 'season-e2e-2026-01',
        name: 'E2E 第一赛季',
        platformTimeZone: 'Asia/Shanghai',
        openWindows: [{ weekdays: [1, 3, 5], startMinute: 1200, endMinute: 1320 }],
        startsAt: '2026-08-01T00:00:00.000Z',
        scheduledEndsAt: '2026-09-01T00:00:00.000Z',
        finalizingDeadlineAt: '2026-09-03T00:00:00.000Z',
        ratingAlgorithmVersion: 'GLICKO1_PER_MATCH_SHADOW_V2',
        softReset: {
          mode: 'RESET_TO_INITIAL',
          center: 1500,
          retention: 0.5,
          minimumDeviation: 200,
        },
        leaderboardMinimumMatchCount: 10,
      },
    });
    expect(shadowResponse.status()).toBe(409);
    await expect(shadowResponse.json()).resolves.toMatchObject({
      error: { code: 'RANKED_FORMAL_ALGORITHM_UNAVAILABLE' },
    });

    const createResponse = await request.post('/api/admin/ranked/seasons', {
      headers,
      data: {
        seasonKey: 'season-e2e-formal-draft',
        name: 'E2E 正式算法草稿',
        platformTimeZone: 'Asia/Shanghai',
        openWindows: [{ weekdays: [1, 3, 5], startMinute: 1200, endMinute: 1320 }],
        startsAt: '2026-08-01T00:00:00.000Z',
        scheduledEndsAt: '2026-09-01T00:00:00.000Z',
        finalizingDeadlineAt: '2026-09-03T00:00:00.000Z',
        ratingAlgorithmVersion: 'GLICKO1_PER_MATCH_V1',
        softReset: {
          mode: 'RESET_TO_INITIAL',
          center: 1500,
          retention: 0.5,
          minimumDeviation: 200,
        },
        leaderboardMinimumMatchCount: 7,
      },
    });
    expect(createResponse.status()).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      data: {
        lifecycle: 'DRAFT',
        ratingAlgorithmVersion: 'GLICKO1_PER_MATCH_V1',
        leaderboardMinimumMatchCount: 7,
      },
    });
    await withLocalTestDatabase(async (client) => {
      await client.query(`DELETE FROM ranked_seasons WHERE season_key = 'season-e2e-formal-draft'`);
    });
  });

  test('管理员可读取赛季、对局处理和监控基线', async ({ request }) => {
    const headers = bearer(await getAdminAccessToken(request));

    const seasons = await request.get('/api/admin/ranked/seasons', { headers });
    expect(seasons.ok()).toBe(true);
    const seasonPayload = (await seasons.json()) as {
      data: unknown[];
      total: number;
      error: null;
    };
    expect(Array.isArray(seasonPayload.data)).toBe(true);
    expect(seasonPayload.total).toBe(seasonPayload.data.length);
    expect(seasonPayload.error).toBeNull();

    const matches = await request.get('/api/admin/ranked/matches?ratingStatus=PENDING&limit=20', {
      headers,
    });
    expect(matches.ok()).toBe(true);
    const matchPayload = (await matches.json()) as {
      data: unknown[];
      total: number;
      error: null;
    };
    expect(Array.isArray(matchPayload.data)).toBe(true);
    expect(matchPayload.total).toBeGreaterThanOrEqual(matchPayload.data.length);
    expect(matchPayload.error).toBeNull();

    const monitoring = await request.get('/api/admin/ranked/monitoring/summary', {
      headers,
    });
    expect(monitoring.ok()).toBe(true);
    const monitoringPayload = (await monitoring.json()) as {
      data: { byStatus: Record<string, number> };
      error: null;
    };
    expect(typeof monitoringPayload.data.byStatus).toBe('object');
    expect(monitoringPayload.error).toBeNull();
  });

  test('管理员可读取指定赛季的运行健康与经营概览', async ({ request }) => {
    await seedE2eSeason('DRAFT');
    try {
      const headers = bearer(await getAdminAccessToken(request));
      const response = await request.get(`/api/admin/ranked/overview?seasonId=${E2E_SEASON_ID}`, {
        headers,
      });

      expect(response.ok()).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          seasonId: E2E_SEASON_ID,
          generatedAt: expect.any(String),
          health: {
            waitingTickets: 0,
            activeReservations: 0,
            runningMatches: 0,
            pendingMatches: 0,
            oldestPendingEndedAt: null,
          },
          statistics: {
            totalParticipants: 0,
            placementCompletedPlayers: 0,
            leaderboardPlayers: 0,
            totalSettledMatches: 0,
            matchesToday: 0,
            matchesLast7Days: 0,
            activePlayersLast7Days: 0,
            averageMatchesPerPlayer: 0,
            leaderboardCutoffRating: null,
          },
          matchCountDistribution: [
            { label: '1–4', playerCount: 0 },
            { label: '5–9', playerCount: 0 },
            { label: '10–19', playerCount: 0 },
            { label: '20–39', playerCount: 0 },
            { label: '40+', playerCount: 0 },
          ],
          ratingDistribution: [],
        },
        error: null,
      });
    } finally {
      await removeE2eSeason();
    }
  });

  test('玩家搜索与排名上下文会在真实数据库执行并沿用公开榜排序', async ({ request }) => {
    try {
      await seedE2eSeason('DRAFT', { leaderboardMinimumMatchCount: 5 });
      await seedE2eSeason('DRAFT', {
        seasonId: E2E_SECOND_SEASON_ID,
        seasonKey: 'season-e2e-player-isolation',
        name: 'E2E 玩家隔离赛季',
      });
      await seedE2eRankedPlayerRatings();
      const headers = bearer(await getAdminAccessToken(request));

      const invalidPlayerListRequests = [
        `/api/admin/ranked/players?seasonId=not-a-uuid`,
        `/api/admin/ranked/players?seasonId=${E2E_SEASON_ID}&q=%20`,
        `/api/admin/ranked/players?seasonId=${E2E_SEASON_ID}&limit=0`,
        `/api/admin/ranked/players?seasonId=${E2E_SEASON_ID}&limit=101`,
        `/api/admin/ranked/players?seasonId=${E2E_SEASON_ID}&offset=-1`,
        `/api/admin/ranked/players?seasonId=${E2E_SEASON_ID}&unexpected=true`,
      ];
      for (const path of invalidPlayerListRequests) {
        const invalidResponse = await request.get(path, { headers });
        expect(invalidResponse.status(), path).toBe(400);
      }

      const firstPageResponse = await request.get(
        `/api/admin/ranked/players?seasonId=${E2E_SEASON_ID}&limit=3&offset=0`,
        { headers }
      );
      expect(firstPageResponse.ok()).toBe(true);
      const firstPagePayload = (await firstPageResponse.json()) as {
        data: {
          seasonId: string;
          ledgerRevision: number;
          placementRequired: number;
          leaderboardMinimumMatchCount: number;
          classificationRelease: { id: string; version: number } | null;
          query: string;
          limit: number;
          offset: number;
          total: number;
          players: Array<{
            userId: string;
            listPosition: number;
            rank: number | null;
            leaderboardEligible: boolean;
            ratedMatchCount: number;
            wins: number;
            losses: number;
          }>;
        };
      };
      expect(firstPagePayload.data).toMatchObject({
        seasonId: E2E_SEASON_ID,
        ledgerRevision: 0,
        placementRequired: 10,
        leaderboardMinimumMatchCount: 5,
        query: '',
        limit: 3,
        offset: 0,
        total: E2E_RANKED_PLAYER_FIXTURES.length - 1,
      });
      expect(
        firstPagePayload.data.classificationRelease === null ||
          (typeof firstPagePayload.data.classificationRelease.id === 'string' &&
            Number.isSafeInteger(firstPagePayload.data.classificationRelease.version))
      ).toBe(true);
      expect(
        firstPagePayload.data.players.map(({ userId, listPosition, rank }) => ({
          userId,
          listPosition,
          rank,
        }))
      ).toEqual(
        E2E_RANKED_PLAYER_FIXTURES.slice(0, 3).map((fixture, index) => ({
          userId: fixture.id,
          listPosition: index + 1,
          rank: index + 1,
        }))
      );

      const allPagedPlayers = [...firstPagePayload.data.players];
      for (const offset of [3, 6]) {
        const pageResponse = await request.get(
          `/api/admin/ranked/players?seasonId=${E2E_SEASON_ID}&limit=3&offset=${offset}`,
          { headers }
        );
        expect(pageResponse.ok()).toBe(true);
        const pagePayload = (await pageResponse.json()) as typeof firstPagePayload;
        expect(pagePayload.data.total).toBe(E2E_RANKED_PLAYER_FIXTURES.length - 1);
        allPagedPlayers.push(...pagePayload.data.players);
      }
      expect(allPagedPlayers.map((player) => player.userId)).toEqual(
        E2E_RANKED_PLAYER_FIXTURES.slice(0, 9).map((fixture) => fixture.id)
      );
      expect(new Set(allPagedPlayers.map((player) => player.userId)).size).toBe(
        allPagedPlayers.length
      );
      expect(allPagedPlayers.map((player) => player.listPosition)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
      for (const player of allPagedPlayers) {
        expect(player.wins + player.losses).toBe(player.ratedMatchCount);
      }
      expect(allPagedPlayers.at(-1)).toMatchObject({
        userId: E2E_RANKED_PLACEMENT_INELIGIBLE_ID,
        leaderboardEligible: false,
        rank: null,
      });

      const emptyPageResponse = await request.get(
        `/api/admin/ranked/players?seasonId=${E2E_SEASON_ID}&limit=3&offset=9`,
        { headers }
      );
      expect(emptyPageResponse.ok()).toBe(true);
      await expect(emptyPageResponse.json()).resolves.toMatchObject({
        data: { total: 9, offset: 9, players: [] },
      });

      const rankedTargetQuery = new URLSearchParams({
        seasonId: E2E_SEASON_ID,
        q: 'ranked_context_e2e',
        limit: '3',
      });
      const filteredPlayersResponse = await request.get(
        `/api/admin/ranked/players?${rankedTargetQuery.toString()}`,
        { headers }
      );
      expect(filteredPlayersResponse.ok()).toBe(true);
      const filteredPlayersPayload =
        (await filteredPlayersResponse.json()) as typeof firstPagePayload;
      expect(filteredPlayersPayload.data).toMatchObject({
        total: E2E_RANKED_PLAYER_FIXTURES.length - 1,
        query: 'ranked_context_e2e',
      });
      expect(filteredPlayersPayload.data.players).toHaveLength(3);
      expect(filteredPlayersPayload.data.players[0]).toMatchObject({
        userId: E2E_RANKED_TARGET_ID,
        listPosition: 4,
        rank: 4,
      });

      const literalWildcardQuery = new URLSearchParams({
        seasonId: E2E_SEASON_ID,
        q: '%_',
      });
      const literalWildcardResponse = await request.get(
        `/api/admin/ranked/players?${literalWildcardQuery.toString()}`,
        { headers }
      );
      expect(literalWildcardResponse.ok()).toBe(true);
      await expect(literalWildcardResponse.json()).resolves.toMatchObject({
        data: {
          total: 1,
          query: '%_',
          players: [{ userId: E2E_RANKED_TARGET_ID, listPosition: 4, rank: 4 }],
        },
      });

      const isolatedPlayerListResponse = await request.get(
        `/api/admin/ranked/players?seasonId=${E2E_SECOND_SEASON_ID}`,
        { headers }
      );
      expect(isolatedPlayerListResponse.ok()).toBe(true);
      await expect(isolatedPlayerListResponse.json()).resolves.toMatchObject({
        data: {
          seasonId: E2E_SECOND_SEASON_ID,
          total: 1,
          players: [{ userId: E2E_RANKED_SECOND_SEASON_PLAYER_ID, listPosition: 1, rank: 1 }],
        },
      });

      const missingSeasonResponse = await request.get(
        '/api/admin/ranked/players?seasonId=77777777-7777-4777-8777-777777777777',
        { headers }
      );
      expect(missingSeasonResponse.status()).toBe(404);

      const emptyQuery = await request.get(
        `/api/admin/ranked/players/search?seasonId=${E2E_SEASON_ID}&q=%20`,
        { headers }
      );
      expect(emptyQuery.status()).toBe(400);

      const oversizedLimit = await request.get(
        `/api/admin/ranked/players/search?seasonId=${E2E_SEASON_ID}&q=排位上下文&limit=11`,
        { headers }
      );
      expect(oversizedLimit.status()).toBe(400);

      const searchResponse = await request.get(
        `/api/admin/ranked/players/search?seasonId=${E2E_SEASON_ID}&q=排位上下文&limit=10`,
        { headers }
      );
      expect(searchResponse.ok()).toBe(true);
      const searchPayload = (await searchResponse.json()) as {
        data: Array<{ userId: string; username: string; displayName: string | null }>;
      };
      expect(searchPayload.data).toHaveLength(E2E_RANKED_PLAYER_FIXTURES.length - 1);
      expect(searchPayload.data).toContainEqual({
        userId: E2E_RANKED_TARGET_ID,
        username: 'ranked_context_e2e',
        displayName: '排位上下文目标%_',
      });
      expect(searchPayload.data).not.toContainEqual(
        expect.objectContaining({ userId: E2E_RANKED_SECOND_SEASON_PLAYER_ID })
      );

      const secondSeasonSearchResponse = await request.get(
        `/api/admin/ranked/players/search?seasonId=${E2E_SECOND_SEASON_ID}&q=排位上下文&limit=10`,
        { headers }
      );
      expect(secondSeasonSearchResponse.ok()).toBe(true);
      await expect(secondSeasonSearchResponse.json()).resolves.toMatchObject({
        data: [{ userId: E2E_RANKED_SECOND_SEASON_PLAYER_ID }],
      });

      const contextResponse = await request.get(
        `/api/admin/ranked/players/${E2E_RANKED_TARGET_ID}/context?seasonId=${E2E_SEASON_ID}`,
        { headers }
      );
      expect(contextResponse.ok()).toBe(true);
      const contextPayload = (await contextResponse.json()) as {
        data: {
          seasonId: string;
          generatedAt: string;
          ledgerRevision: number;
          placementRequired: number;
          leaderboardMinimumMatchCount: number;
          player: {
            userId: string;
            rating: number;
            ratedMatchCount: number;
            wins: number;
            losses: number;
            placementCompleted: boolean;
            leaderboardEligible: boolean;
            status: string;
            rank: number | null;
          };
          neighbors: {
            rows: Array<{ userId: string; rank: number; isTarget: boolean }>;
          };
        };
      };
      expect(contextPayload.data).toMatchObject({
        seasonId: E2E_SEASON_ID,
        generatedAt: expect.any(String),
        ledgerRevision: 0,
        placementRequired: 10,
        leaderboardMinimumMatchCount: 5,
        player: {
          userId: E2E_RANKED_TARGET_ID,
          rating: 1700,
          ratedMatchCount: 12,
          wins: 6,
          losses: 6,
          placementCompleted: true,
          leaderboardEligible: true,
          status: 'RANKED',
          rank: 4,
        },
      });
      expect(
        contextPayload.data.neighbors.rows.map(({ userId, rank, isTarget }) => ({
          userId,
          rank,
          isTarget,
        }))
      ).toEqual(
        E2E_RANKED_PLAYER_FIXTURES.slice(0, 7).map((fixture, index) => ({
          userId: fixture.id,
          rank: index + 1,
          isTarget: fixture.id === E2E_RANKED_TARGET_ID,
        }))
      );

      const placementEligibleResponse = await request.get(
        `/api/admin/ranked/players/${E2E_RANKED_PLACEMENT_ELIGIBLE_ID}/context?seasonId=${E2E_SEASON_ID}`,
        { headers }
      );
      expect(placementEligibleResponse.ok()).toBe(true);
      await expect(placementEligibleResponse.json()).resolves.toMatchObject({
        data: {
          player: {
            userId: E2E_RANKED_PLACEMENT_ELIGIBLE_ID,
            ratedMatchCount: 7,
            wins: 3,
            losses: 4,
            placementCompleted: false,
            leaderboardEligible: true,
            status: 'PLACEMENT',
            rank: 8,
          },
          neighbors: {
            rows: [
              { rank: 5 },
              { rank: 6 },
              { rank: 7 },
              { userId: E2E_RANKED_PLACEMENT_ELIGIBLE_ID, rank: 8, isTarget: true },
            ],
          },
        },
      });

      const placementIneligibleResponse = await request.get(
        `/api/admin/ranked/players/${E2E_RANKED_PLACEMENT_INELIGIBLE_ID}/context?seasonId=${E2E_SEASON_ID}`,
        { headers }
      );
      expect(placementIneligibleResponse.ok()).toBe(true);
      await expect(placementIneligibleResponse.json()).resolves.toMatchObject({
        data: {
          player: {
            userId: E2E_RANKED_PLACEMENT_INELIGIBLE_ID,
            ratedMatchCount: 4,
            wins: 2,
            losses: 2,
            placementCompleted: false,
            leaderboardEligible: false,
            status: 'PLACEMENT',
            rank: null,
          },
          neighbors: { rows: [] },
        },
      });
    } finally {
      await removeE2eRankedPlayerFixtures();
    }
  });

  test('真实数据库拒绝非法运营操作，并可恢复匹配、结束赛季及完成结算', async ({ request }) => {
    await seedE2eSeason();
    try {
      const headers = bearer(await getAdminAccessToken(request));

      const deleteActive = await request.delete(`/api/admin/ranked/seasons/${E2E_SEASON_ID}`, {
        headers,
      });
      expect(deleteActive.status()).toBe(409);
      await expect(deleteActive.json()).resolves.toMatchObject({
        error: { code: 'RANKED_SEASON_DRAFT_DELETE_CONFLICT' },
      });

      const overlappingWindows = await request.put(
        `/api/admin/ranked/seasons/${E2E_SEASON_ID}/operations`,
        {
          headers,
          data: {
            name: 'E2E 重叠时段',
            openWindows: [
              { weekdays: [1], startMinute: 600, endMinute: 720 },
              { weekdays: [1], startMinute: 660, endMinute: 780 },
            ],
            leaderboardMinimumMatchCount: 8,
          },
        }
      );
      expect(overlappingWindows.status()).toBe(400);
      await expect(overlappingWindows.json()).resolves.toMatchObject({
        error: { code: 'RANKED_OPEN_WINDOW_OVERLAP' },
      });

      const operations = await request.put(
        `/api/admin/ranked/seasons/${E2E_SEASON_ID}/operations`,
        {
          headers,
          data: {
            name: 'E2E 全天排位',
            openWindows: [
              {
                weekdays: [1, 2, 3, 4, 5, 6, 7],
                startMinute: 0,
                endMinute: 1440,
              },
            ],
            leaderboardMinimumMatchCount: 8,
          },
        }
      );
      expect(operations.ok()).toBe(true);
      await expect(operations.json()).resolves.toMatchObject({
        data: {
          lifecycle: 'ACTIVE',
          name: 'E2E 全天排位',
          openWindows: [
            {
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              startMinute: 0,
              endMinute: 1440,
            },
          ],
          leaderboardMinimumMatchCount: 8,
          ratingAlgorithmVersion: 'GLICKO1_PER_MATCH_E2E_V1',
        },
      });

      const open = await request.put(`/api/admin/ranked/seasons/${E2E_SEASON_ID}/admission`, {
        headers,
        data: { admission: 'OPEN' },
      });
      expect(open.ok()).toBe(true);
      await expect(open.json()).resolves.toMatchObject({
        data: {
          lifecycle: 'ACTIVE',
          queueAdmission: 'OPEN',
          withinOpenWindow: true,
          effectiveQueueOpen: true,
        },
      });

      const finalizing = await request.post(`/api/admin/ranked/seasons/${E2E_SEASON_ID}/finalize`, {
        headers,
      });
      expect(finalizing.ok()).toBe(true);
      await expect(finalizing.json()).resolves.toMatchObject({
        data: {
          lifecycle: 'FINALIZING',
          queueAdmission: 'PAUSED',
          effectiveQueueOpen: false,
        },
      });

      const closed = await request.post(`/api/admin/ranked/seasons/${E2E_SEASON_ID}/close`, {
        headers,
      });
      expect(closed.ok()).toBe(true);
      await expect(closed.json()).resolves.toMatchObject({
        data: {
          lifecycle: 'CLOSED',
          queueAdmission: 'PAUSED',
          closedAt: expect.any(String),
        },
      });
    } finally {
      await removeE2eSeason();
    }
  });

  test('管理员可在页面修改进行中赛季的运营设置', async ({ page, request }) => {
    await seedE2eSeason();
    try {
      await openRankedAdminPage(page, request);
      await page.getByRole('tab', { name: '赛季' }).click();
      const seasonName = page.getByText('E2E 生命周期赛季', { exact: true });
      await expect(seasonName).toBeVisible();
      await seasonName
        .locator('xpath=ancestor::section')
        .getByRole('button', { name: '编辑' })
        .click();

      await page.getByLabel('名称').fill('E2E 晚间排位');
      await page.getByLabel('进入排行榜所需场次').fill('8');
      const timeInputs = page.locator('form input[type="time"]');
      await timeInputs.nth(0).fill('18:00');
      await timeInputs.nth(1).fill('01:00');
      await expect(page.getByText('— 次日', { exact: true })).toBeVisible();
      await page.screenshot({ path: '/tmp/loveca-ranked-admin-active-edit.png', fullPage: true });
      const updateResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().includes(`/api/admin/ranked/seasons/${E2E_SEASON_ID}/operations`)
      );
      await page.getByRole('button', { name: '保存', exact: true }).click();
      expect((await updateResponse).ok()).toBe(true);

      await withLocalTestDatabase(async (client) => {
        const result = await client.query<{
          name: string;
          open_windows: Array<{ weekdays: number[]; startMinute: number; endMinute: number }>;
          rating_algorithm_version: string;
          leaderboard_minimum_match_count: number;
        }>(
          `SELECT name, open_windows, rating_algorithm_version, leaderboard_minimum_match_count
           FROM ranked_seasons
           WHERE id = $1`,
          [E2E_SEASON_ID]
        );
        expect(result.rows[0]).toMatchObject({
          name: 'E2E 晚间排位',
          open_windows: [
            {
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              startMinute: 1080,
              endMinute: 1440,
            },
            {
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              startMinute: 0,
              endMinute: 60,
            },
          ],
          rating_algorithm_version: 'GLICKO1_PER_MATCH_E2E_V1',
          leaderboard_minimum_match_count: 8,
        });
      });

      await expect(page.getByText('每天 18:00–次日 01:00', { exact: true })).toBeVisible();
      await page
        .getByText('E2E 晚间排位', { exact: true })
        .locator('xpath=ancestor::section')
        .getByRole('button', { name: '编辑' })
        .click();
      const restoredTimeInputs = page.locator('form input[type="time"]');
      await expect(restoredTimeInputs.nth(0)).toHaveValue('18:00');
      await expect(restoredTimeInputs.nth(1)).toHaveValue('01:00');
      await expect(page.getByText('— 次日', { exact: true })).toBeVisible();
      await page.getByLabel('名称').fill('E2E 跨日排位');
      const roundTripResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().includes(`/api/admin/ranked/seasons/${E2E_SEASON_ID}/operations`)
      );
      await page.getByRole('button', { name: '保存', exact: true }).click();
      expect((await roundTripResponse).ok()).toBe(true);

      await withLocalTestDatabase(async (client) => {
        const result = await client.query<{
          name: string;
          open_windows: Array<{ weekdays: number[]; startMinute: number; endMinute: number }>;
        }>('SELECT name, open_windows FROM ranked_seasons WHERE id = $1', [E2E_SEASON_ID]);
        expect(result.rows[0]).toEqual({
          name: 'E2E 跨日排位',
          open_windows: [
            {
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              startMinute: 1080,
              endMinute: 1440,
            },
            {
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              startMinute: 0,
              endMinute: 60,
            },
          ],
        });
      });

      await page
        .getByText('E2E 跨日排位', { exact: true })
        .locator('xpath=ancestor::section')
        .getByRole('button', { name: '编辑' })
        .click();
      await page.getByRole('button', { name: '添加开放时段' }).click();
      const secondOpenWindow = page.getByRole('region', { name: '开放时段 2' });
      await secondOpenWindow.getByLabel('开始时间').fill('10:00');
      await secondOpenWindow.getByLabel('结束时间').fill('12:00');
      const multipleWindowsResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().includes(`/api/admin/ranked/seasons/${E2E_SEASON_ID}/operations`)
      );
      await page.getByRole('button', { name: '保存', exact: true }).click();
      expect((await multipleWindowsResponse).ok()).toBe(true);

      await page
        .getByText('E2E 跨日排位', { exact: true })
        .locator('xpath=ancestor::section')
        .getByRole('button', { name: '编辑' })
        .click();
      await expect(page.getByRole('region', { name: /^开放时段 \d+$/ })).toHaveCount(3);
      const restoredIndependentWindow = page.getByRole('region', { name: '开放时段 3' });
      await expect(restoredIndependentWindow.getByLabel('开始时间')).toHaveValue('10:00');
      await expect(restoredIndependentWindow.getByLabel('结束时间')).toHaveValue('12:00');
      await restoredIndependentWindow.getByLabel('结束时间').fill('12:30');
      const multipleWindowsEditResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().includes(`/api/admin/ranked/seasons/${E2E_SEASON_ID}/operations`)
      );
      await page.getByRole('button', { name: '保存', exact: true }).click();
      expect((await multipleWindowsEditResponse).ok()).toBe(true);

      await withLocalTestDatabase(async (client) => {
        const result = await client.query<{
          open_windows: Array<{ weekdays: number[]; startMinute: number; endMinute: number }>;
        }>('SELECT open_windows FROM ranked_seasons WHERE id = $1', [E2E_SEASON_ID]);
        expect(result.rows[0]?.open_windows).toEqual([
          {
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            startMinute: 1080,
            endMinute: 1440,
          },
          {
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            startMinute: 0,
            endMinute: 60,
          },
          { weekdays: [1], startMinute: 600, endMinute: 750 },
        ]);
      });
    } finally {
      await removeE2eSeason();
    }
  });

  test('管理员可在页面创建并编辑未开始赛季', async ({ page, request }) => {
    await removeE2eUiSeason();
    try {
      await openRankedAdminPage(page, request);
      await page.getByRole('tab', { name: '赛季' }).click();
      await page.getByRole('button', { name: '新建赛季' }).click();
      await page.getByLabel('赛季标识').fill(E2E_UI_SEASON_KEY);
      await page.getByLabel('名称').fill('E2E 页面草稿');
      await expect(page.getByLabel('进入排行榜所需场次')).toBeDisabled();
      await expect(page.getByLabel('进入排行榜所需场次')).toHaveValue('5');
      const createTimeInputs = page.locator('form input[type="time"]');
      await createTimeInputs.nth(0).fill('10:00');
      await createTimeInputs.nth(1).fill('12:00');
      await page.getByRole('button', { name: '添加开放时段' }).click();
      await page.getByRole('button', { name: '创建赛季' }).click();

      const createdSeason = page.getByText('E2E 页面草稿', { exact: true });
      await expect(page.getByText('每天 10:00–12:00 等 2 个时段', { exact: true })).toBeVisible();
      const seasonCard = createdSeason.locator('xpath=ancestor::section');
      await seasonCard.getByRole('button', { name: '编辑' }).click();
      await expect(page.getByRole('region', { name: /^开放时段 \d+$/ })).toHaveCount(2);
      const secondDraftWindow = page.getByRole('region', { name: '开放时段 2' });
      await expect(secondDraftWindow.getByLabel('开始时间')).toHaveValue('18:00');
      await expect(secondDraftWindow.getByLabel('结束时间')).toHaveValue('22:00');
      await secondDraftWindow.getByLabel('结束时间').fill('23:00');
      await page.getByLabel('名称').fill('E2E 页面草稿已编辑');
      const updateResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().includes('/api/admin/ranked/seasons/') &&
          response.url().endsWith('/draft')
      );
      await page.getByRole('button', { name: '保存', exact: true }).click();
      expect((await updateResponse).ok()).toBe(true);

      await withLocalTestDatabase(async (client) => {
        const result = await client.query<{
          name: string;
          leaderboard_minimum_match_count: number;
          open_windows: Array<{ weekdays: number[]; startMinute: number; endMinute: number }>;
        }>(
          `SELECT name, leaderboard_minimum_match_count, open_windows
           FROM ranked_seasons
           WHERE season_key = $1`,
          [E2E_UI_SEASON_KEY]
        );
        expect(result.rows[0]).toMatchObject({
          name: 'E2E 页面草稿已编辑',
          leaderboard_minimum_match_count: 5,
          open_windows: [
            {
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              startMinute: 600,
              endMinute: 720,
            },
            {
              weekdays: [1],
              startMinute: 1080,
              endMinute: 1380,
            },
          ],
        });
      });

      const editedSeason = page.getByText('E2E 页面草稿已编辑', { exact: true });
      const editedSeasonCard = editedSeason.locator('xpath=ancestor::section');
      await editedSeasonCard.getByRole('button', { name: '删除赛季' }).click();
      const deleteDialog = page.getByRole('dialog', { name: '删除未开始赛季？' });
      await expect(deleteDialog).toBeVisible();
      await expect(deleteDialog).toContainText(E2E_UI_SEASON_KEY);
      const deleteResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          response.url().includes('/api/admin/ranked/seasons/')
      );
      await deleteDialog.getByRole('button', { name: '确认删除' }).click();
      expect((await deleteResponse).ok()).toBe(true);
      await expect(editedSeason).toHaveCount(0);

      await withLocalTestDatabase(async (client) => {
        const result = await client.query<{ count: string }>(
          'SELECT COUNT(*) AS count FROM ranked_seasons WHERE season_key = $1',
          [E2E_UI_SEASON_KEY]
        );
        expect(Number(result.rows[0]?.count ?? 0)).toBe(0);
      });
    } finally {
      await removeE2eUiSeason();
    }
  });
});
