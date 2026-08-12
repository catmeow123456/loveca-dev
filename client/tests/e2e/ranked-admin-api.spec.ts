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
const E2E_UI_SEASON_KEY = 'season-e2e-ui-draft';

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

async function seedE2eSeason(lifecycle: 'DRAFT' | 'ACTIVE' = 'ACTIVE'): Promise<void> {
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
    placementMatchCount: 10,
    displayDecimalPlaces: 0,
    softResetMode: 'RESET_TO_INITIAL',
    softResetCenter: 1500,
    softResetRetention: 0.5,
    softResetMinimumDeviation: 200,
  };
  await withLocalTestDatabase(async (client) => {
    await client.query('DELETE FROM ranked_seasons WHERE id = $1', [E2E_SEASON_ID]);
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
         'season-e2e-lifecycle',
         'E2E 生命周期赛季',
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
         10,
         profile.id,
         profile.id
       FROM profiles AS profile
       WHERE profile.username = 'test_admin'`,
      [
        E2E_SEASON_ID,
        competitiveEnvironmentId,
        JSON.stringify([{ weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 0, endMinute: 1440 }]),
        `sha256:${'c'.repeat(64)}`,
        ratingConfig.algorithmVersion,
        JSON.stringify(ratingConfig),
        lifecycle,
      ]
    );
  });
}

async function removeE2eSeason(): Promise<void> {
  await withLocalTestDatabase(async (client) => {
    await client.query('DELETE FROM ranked_seasons WHERE id = $1', [E2E_SEASON_ID]);
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

test.describe('赛季排位管理员 API', () => {
  test.describe.configure({ mode: 'serial' });

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

  test('真实数据库中的赛季可暂停、恢复匹配、结束赛季并完成结算', async ({ request }) => {
    await seedE2eSeason();
    try {
      const headers = bearer(await getAdminAccessToken(request));

      const operations = await request.put(
        `/api/admin/ranked/seasons/${E2E_SEASON_ID}/operations`,
        {
          headers,
          data: {
            name: 'E2E 晚间排位',
            openWindows: [
              {
                weekdays: [1, 2, 3, 4, 5, 6, 7],
                startMinute: 480,
                endMinute: 1320,
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
          name: 'E2E 晚间排位',
          openWindows: [
            {
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              startMinute: 480,
              endMinute: 1320,
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
      await openAuthenticatedAdminPage(page, request);
      await page.getByText('赛季排位管理').click();
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
    } finally {
      await removeE2eSeason();
    }
  });

  test('管理员可在页面创建并编辑未开始赛季', async ({ page, request }) => {
    await removeE2eUiSeason();
    try {
      await openAuthenticatedAdminPage(page, request);
      await page.getByText('赛季排位管理').click();
      await page.getByRole('tab', { name: '赛季' }).click();
      await page.getByRole('button', { name: '新建赛季' }).click();
      await page.getByLabel('赛季标识').fill(E2E_UI_SEASON_KEY);
      await page.getByLabel('名称').fill('E2E 页面草稿');
      await expect(page.getByLabel('进入排行榜所需场次')).toBeDisabled();
      await expect(page.getByLabel('进入排行榜所需场次')).toHaveValue('5');
      const createTimeInputs = page.locator('form input[type="time"]');
      await createTimeInputs.nth(0).fill('18:00');
      await createTimeInputs.nth(1).fill('01:00');
      await expect(page.getByText('— 次日', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '创建赛季' }).click();

      const createdSeason = page.getByText('E2E 页面草稿', { exact: true });
      await expect(page.getByText('每天 18:00–次日 01:00', { exact: true })).toBeVisible();
      const seasonCard = createdSeason.locator('xpath=ancestor::section');
      await seasonCard.getByRole('button', { name: '编辑' }).click();
      const editTimeInputs = page.locator('form input[type="time"]');
      await expect(editTimeInputs.nth(0)).toHaveValue('18:00');
      await expect(editTimeInputs.nth(1)).toHaveValue('01:00');
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
