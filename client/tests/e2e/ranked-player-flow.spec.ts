import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

const DATABASE_URL =
  process.env.RANKED_E2E_DATABASE_URL ?? 'postgres://loveca:loveca_dev@127.0.0.1:5432/loveca';
const SEASON_KEY = 'season-e2e-player-flow';
const DECK_NAME_PREFIX = 'E2E 排位卡组';

interface LoginResult {
  accessToken: string;
}

function assertLocalDatabase(): void {
  const parsed = new URL(DATABASE_URL);
  if (
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    (parsed.port || '5432') !== '5432' ||
    parsed.pathname !== '/loveca'
  ) {
    throw new Error('排位玩家 E2E 只允许连接本机 loveca 测试数据库');
  }
}

async function withDatabase<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  assertLocalDatabase();
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function login(
  request: APIRequestContext,
  usernameOrEmail: string,
  password: string
): Promise<LoginResult> {
  const response = await request.post('/api/auth/login', {
    data: { usernameOrEmail, password },
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { data: LoginResult };
  return payload.data;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function apiData<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  const payload = (await response.json()) as {
    data: T | null;
    error: { code: string; message: string } | null;
  };
  expect(response.ok(), payload.error?.message).toBe(true);
  expect(payload.data).not.toBeNull();
  return payload.data as T;
}

async function cleanupFixtures(): Promise<void> {
  await withDatabase(async (client) => {
    const season = await client.query<{ id: string }>(
      'SELECT id FROM ranked_seasons WHERE season_key = $1',
      [SEASON_KEY]
    );
    const seasonId = season.rows[0]?.id;
    await client.query(
      `DELETE FROM gameplay_participations
       WHERE user_id IN (
         SELECT id FROM profiles WHERE username IN ('test_player_1', 'test_player_2')
       )`
    );
    if (seasonId) {
      await client.query(`DELETE FROM public_table_reservations WHERE season_id = $1`, [seasonId]);
      await client.query(`DELETE FROM public_table_tickets WHERE season_id = $1`, [seasonId]);
      await client.query(
        `DELETE FROM ranked_rating_event_steps
         WHERE event_id IN (SELECT id FROM ranked_rating_events WHERE season_id = $1)`,
        [seasonId]
      );
      await client.query(`DELETE FROM ranked_rating_events WHERE season_id = $1`, [seasonId]);
      await client.query(`DELETE FROM ranked_player_ratings WHERE season_id = $1`, [seasonId]);
      await client.query(`DELETE FROM ranked_matches WHERE season_id = $1`, [seasonId]);
      await client.query(`DELETE FROM ranked_seasons WHERE id = $1`, [seasonId]);
    }
    await client.query(`DELETE FROM decks WHERE name LIKE $1`, [`${DECK_NAME_PREFIX}%`]);
  });
}

async function seedPlayerDecks(): Promise<Record<'test_player_1' | 'test_player_2', string>> {
  return withDatabase(async (client) => {
    const result: Partial<Record<'test_player_1' | 'test_player_2', string>> = {};
    for (const username of ['test_player_1', 'test_player_2'] as const) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO decks (
           user_id, name, description, main_deck, energy_deck,
           is_valid, validation_errors, is_public
         )
         SELECT
           player.id, $2, source.description, source.main_deck, source.energy_deck,
           source.is_valid, source.validation_errors, false
         FROM profiles AS player
         CROSS JOIN LATERAL (
           SELECT *
           FROM decks
           WHERE user_id = (SELECT id FROM profiles WHERE username = 'test_admin')
             AND is_valid = true
           ORDER BY updated_at DESC
           LIMIT 1
         ) AS source
         WHERE player.username = $1
         RETURNING id`,
        [username, `${DECK_NAME_PREFIX} ${username}`]
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error(`无法为 ${username} 创建排位测试卡组`);
      result[username] = id;
    }
    return result as Record<'test_player_1' | 'test_player_2', string>;
  });
}

async function createActiveSeason(request: APIRequestContext, adminToken: string): Promise<string> {
  const startsAt = new Date(Date.now() - 5 * 60_000);
  const scheduledEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  const finalizingDeadlineAt = new Date(scheduledEndsAt.getTime() + 2 * 24 * 60 * 60_000);
  const created = await apiData<{ id: string }>(
    await request.post('/api/admin/ranked/seasons', {
      headers: bearer(adminToken),
      data: {
        seasonKey: SEASON_KEY,
        name: 'E2E 排位赛季',
        platformTimeZone: 'Asia/Shanghai',
        openWindows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 0, endMinute: 1440 }],
        startsAt: startsAt.toISOString(),
        scheduledEndsAt: scheduledEndsAt.toISOString(),
        finalizingDeadlineAt: finalizingDeadlineAt.toISOString(),
        ratingAlgorithmVersion: 'GLICKO1_PER_MATCH_V2',
        softReset: {
          mode: 'RESET_TO_INITIAL',
          center: 1500,
          retention: 0.5,
          minimumDeviation: 200,
        },
        leaderboardMinimumMatchCount: 10,
      },
    })
  );
  await apiData(
    await request.post(`/api/admin/ranked/seasons/${created.id}/activate`, {
      headers: bearer(adminToken),
    })
  );
  await apiData(
    await request.put(`/api/admin/ranked/seasons/${created.id}/admission`, {
      headers: bearer(adminToken),
      data: { admission: 'OPEN' },
    })
  );
  return created.id;
}

async function loginUi(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByPlaceholder('输入你的用户名或邮箱').fill(username);
  await page.getByPlaceholder('输入你的密码').fill(password);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/auth/login')
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await loginResponse).ok()).toBe(true);
}

test.describe('赛季排位玩家闭环', () => {
  test.describe.configure({ mode: 'serial' });

  test('双账号从匹配到权威计分，并在玩家页显示积分结果', async ({ request, browser }) => {
    await cleanupFixtures();
    try {
      const deckIds = await seedPlayerDecks();
      const admin = await login(request, 'test_admin', 'test_admin_password');
      const player1 = await login(request, 'test_player_1', 'test_password_1');
      const player2 = await login(request, 'test_player_2', 'test_password_2');
      const seasonId = await createActiveSeason(request, admin.accessToken);
      const player1Headers = bearer(player1.accessToken);
      const player2Headers = bearer(player2.accessToken);

      const firstJoin = await apiData<{ state: string }>(
        await request.post('/api/ranked/queue/join', {
          headers: player1Headers,
          data: { deckId: deckIds.test_player_1 },
        })
      );
      expect(firstJoin.state).toBe('WAITING');
      const secondJoin = await apiData<{ state: string }>(
        await request.post('/api/ranked/queue/join', {
          headers: player2Headers,
          data: { deckId: deckIds.test_player_2 },
        })
      );
      expect(secondJoin.state).toBe('PENDING_CONFIRMATION');

      await apiData(await request.post('/api/ranked/queue/confirm', { headers: player1Headers }));
      await apiData(await request.post('/api/ranked/queue/confirm', { headers: player2Headers }));

      const firstOverview = await apiData<{
        queue: { state: string; roomCode: string };
      }>(await request.get('/api/ranked/overview', { headers: player1Headers }));
      const secondOverview = await apiData<{
        queue: { state: string; roomCode: string };
      }>(await request.get('/api/ranked/overview', { headers: player2Headers }));
      expect(firstOverview.queue.state).toBe('MATCHED');
      expect(secondOverview.queue.roomCode).toBe(firstOverview.queue.roomCode);
      const roomCode = firstOverview.queue.roomCode;

      const firstRoom = await apiData<{
        originKind: string;
        currentUserId: string;
      }>(
        await request.get(`/api/online/rooms/${roomCode}`, {
          headers: player1Headers,
        })
      );
      const secondRoom = await apiData<{ currentUserId: string }>(
        await request.get(`/api/online/rooms/${roomCode}`, {
          headers: player2Headers,
        })
      );
      expect(firstRoom.originKind).toBe('RANKED');

      await apiData(
        await request.post(`/api/online/rooms/${roomCode}/opening-rps`, {
          headers: player1Headers,
          data: { gesture: 'ROCK' },
        })
      );
      const revealed = await apiData<{
        openingRps: { winnerUserId: string };
      }>(
        await request.post(`/api/online/rooms/${roomCode}/opening-rps`, {
          headers: player2Headers,
          data: { gesture: 'SCISSORS' },
        })
      );
      expect(revealed.openingRps.winnerUserId).toBe(firstRoom.currentUserId);

      const started = await apiData<{ status: string; matchId: string }>(
        await request.post(`/api/online/rooms/${roomCode}/opening-turn-order`, {
          headers: player1Headers,
          data: { choice: 'SELF_FIRST' },
        })
      );
      expect(started.status).toBe('IN_GAME');
      expect(started.matchId).toBeTruthy();

      const restart = await request.post(`/api/online/rooms/${roomCode}/restart-request`, {
        headers: player1Headers,
      });
      expect(restart.status()).toBe(409);
      await expect(restart.json()).resolves.toMatchObject({
        error: { code: 'RANKED_RESTART_FORBIDDEN' },
      });

      const surrendered = await apiData<{ success: boolean }>(
        await request.post(`/api/online/matches/${started.matchId}/command`, {
          headers: player2Headers,
          data: {
            command: {
              type: 'SURRENDER',
              playerId: secondRoom.currentUserId,
              timestamp: Date.now(),
              idempotencyKey: `e2e-surrender-${started.matchId}`,
            },
          },
        })
      );
      expect(surrendered.success).toBe(true);

      await expect
        .poll(async () =>
          withDatabase(async (client) => {
            const result = await client.query<{
              rating_status: string;
              origin_kind: string;
            }>(
              `SELECT ranked_match.rating_status, record.origin_kind
               FROM ranked_matches AS ranked_match
               JOIN match_records AS record ON record.match_id = ranked_match.match_id
               WHERE ranked_match.match_id = $1
                 AND ranked_match.season_id = $2`,
              [started.matchId, seasonId]
            );
            return result.rows[0] ?? null;
          })
        )
        .toEqual({ rating_status: 'SETTLED', origin_kind: 'RANKED' });

      await request.post(`/api/online/rooms/${roomCode}/leave`, {
        headers: player1Headers,
      });
      await request.post(`/api/online/rooms/${roomCode}/leave`, {
        headers: player2Headers,
      });

      const ratedOverview = await apiData<{
        player: {
          placement: boolean;
          placementCompleted: number;
          rating: number | null;
          rank: number | null;
        };
        recentMatches: {
          result: string;
          opponentDisplayName: string;
          ratingDelta: number | null;
        }[];
      }>(await request.get('/api/ranked/overview', { headers: player1Headers }));
      expect(ratedOverview.player).toMatchObject({
        placement: true,
        placementCompleted: 1,
        rating: expect.any(Number),
        rank: null,
      });
      expect(ratedOverview.recentMatches[0]?.result).toBe('WIN');
      expect(ratedOverview.recentMatches[0]?.ratingDelta).toEqual(expect.any(Number));

      await verifyPlayerPage(
        browser,
        ratedOverview.player.rating!,
        ratedOverview.recentMatches[0]!.opponentDisplayName,
        ratedOverview.recentMatches[0]!.ratingDelta!
      );
      await verifyCorrectionDialog(browser);
    } finally {
      await cleanupFixtures();
    }
  });
});

async function verifyCorrectionDialog(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginUi(page, 'test_admin', 'test_admin_password');
    await page.getByText('赛季排位管理').click();
    await page.getByRole('button', { name: '对局处理' }).click();
    const matchCard = page
      .getByText('Test Player 1 vs Test Player 2', { exact: true })
      .locator('xpath=ancestor::section');
    await matchCard.getByRole('button', { name: '改判' }).click();

    const dialog = page.getByRole('heading', { name: '改判结果' }).locator('xpath=..');
    await expect(dialog.getByText('Test Player 1', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Test Player 2', { exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/loveca-ranked-correction-preview.png', fullPage: true });
    await dialog.getByPlaceholder('填写原因（至少 5 个字）').fill('E2E 验证改判执行');
    await dialog.getByRole('button', { name: '确认执行' }).click();
    await expect(page.getByRole('heading', { name: '改判结果' })).toBeHidden();
  } finally {
    await context.close();
  }
}

async function verifyPlayerPage(
  browser: Browser,
  rating: number,
  opponentDisplayName: string,
  ratingDelta: number
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginUi(page, 'test_player_1', 'test_password_1');
    await page.getByText('赛季排位', { exact: true }).click();
    await expect(page.getByText('E2E 排位赛季', { exact: true }).last()).toBeVisible();
    await expect(page.getByText(String(rating), { exact: true })).toBeVisible();
    await expect(page.getByText(opponentDisplayName)).toBeVisible();
    await expect(
      page.getByText(`${ratingDelta >= 0 ? '+' : ''}${ratingDelta}`, { exact: false })
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/loveca-ranked-player.png', fullPage: true });
  } finally {
    await context.close();
  }
}
