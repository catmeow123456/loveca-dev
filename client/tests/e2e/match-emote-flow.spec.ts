import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import pg from 'pg';

const DATABASE_URL =
  process.env.MATCH_EMOTE_E2E_DATABASE_URL ?? 'postgres://loveca:loveca_dev@127.0.0.1:5432/loveca';
const DECK_NAME_PREFIX = 'E2E 快捷表情卡组';

interface LoginResult {
  readonly accessToken: string;
}

test.describe('联机对局快捷表情', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test.beforeEach(({ browser }, testInfo) => {
    void browser;
    test.skip(
      testInfo.project.name !== 'tablet-1024x768',
      '本用例在单个 project 内自行覆盖桌面、移动端与观战 context'
    );
  });

  test('双方与授权观战者共享有序表情流，桌面和移动端入口保持可用', async ({ request, browser }) => {
    await cleanupPlayerFixtures();
    const roomCode = `EM${Date.now().toString(36).slice(-6).toUpperCase()}`;
    let firstContext: BrowserContext | null = null;
    let secondContext: BrowserContext | null = null;
    let spectatorContext: BrowserContext | null = null;

    try {
      const deckIds = await seedPlayerDecks();
      firstContext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      secondContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      });
      const firstLogin = await login(firstContext.request, 'test_player_1', 'test_password_1');
      const secondLogin = await login(secondContext.request, 'test_player_2', 'test_password_2');
      const firstHeaders = bearer(firstLogin.accessToken);
      const secondHeaders = bearer(secondLogin.accessToken);

      await apiData(
        await request.post('/api/online/rooms', {
          headers: firstHeaders,
          data: { roomCode },
        })
      );
      await apiData(
        await request.post(`/api/online/rooms/${roomCode}/join`, {
          headers: secondHeaders,
        })
      );
      await apiData(
        await request.post(`/api/online/rooms/${roomCode}/deck`, {
          headers: firstHeaders,
          data: { deckId: deckIds.test_player_1 },
        })
      );
      await apiData(
        await request.post(`/api/online/rooms/${roomCode}/deck`, {
          headers: secondHeaders,
          data: { deckId: deckIds.test_player_2 },
        })
      );
      await apiData(
        await request.post(`/api/online/rooms/${roomCode}/ready-start`, {
          headers: firstHeaders,
        })
      );
      await apiData(
        await request.post(`/api/online/rooms/${roomCode}/ready-start`, {
          headers: secondHeaders,
        })
      );
      await apiData(
        await request.post(`/api/online/rooms/${roomCode}/opening-rps`, {
          headers: firstHeaders,
          data: { gesture: 'ROCK' },
        })
      );
      await apiData(
        await request.post(`/api/online/rooms/${roomCode}/opening-rps`, {
          headers: secondHeaders,
          data: { gesture: 'SCISSORS' },
        })
      );
      const started = await apiData<{ readonly matchId: string }>(
        await request.post(`/api/online/rooms/${roomCode}/opening-turn-order`, {
          headers: firstHeaders,
          data: { choice: 'SELF_FIRST' },
        })
      );

      const firstPage = await firstContext.newPage();
      const secondPage = await secondContext.newPage();
      await attachPlayerToRoom(firstPage, roomCode);
      await attachPlayerToRoom(secondPage, roomCode);
      await finishOpeningMulligan(firstPage, secondPage);

      const mobileOpponentStatus = secondPage.getByRole('button', {
        name: /Test Player 1，手牌 \d+ 张，查看对手战场/u,
      });
      const mobileSelfStatus = secondPage.getByRole('button', {
        name: /Test Player 2，手牌 \d+ 张，返回己方战场/u,
      });
      await expect(
        secondPage.locator('[data-mobile-player-status-seat][aria-pressed="true"]')
      ).toHaveCount(1);
      await expect(
        secondPage.locator('[data-mobile-player-status-seat][data-mobile-active-player="true"]')
      ).toHaveCount(1);
      await expect(mobileSelfStatus).toHaveAttribute('aria-pressed', 'true');
      await mobileOpponentStatus.click();
      await expect(secondPage.getByText('对手战场', { exact: true })).toBeVisible();
      await expect(mobileOpponentStatus).toHaveAttribute('aria-pressed', 'true');
      await mobileSelfStatus.click();
      await expect(secondPage.getByText('对手战场', { exact: true })).toBeHidden();
      await expect(mobileSelfStatus).toHaveAttribute('aria-pressed', 'true');

      const firstChatButton = firstPage.getByRole('button', { name: '局内聊天', exact: true });
      await firstChatButton.click();
      await expect(firstPage.getByLabel('局内聊天面板')).toBeVisible();
      await firstPage.getByRole('button', { name: '关闭聊天' }).click();
      const firstEmoteLauncher = firstPage.getByRole('button', {
        name: '快捷表情',
        exact: true,
      });
      const firstIdentity = firstPage
        .locator('[data-player-identity-seat]')
        .filter({ hasText: 'Test Player 1' });
      const firstHandCount = firstIdentity.locator('..').getByText(/^手牌: \d+$/u);
      await expect(firstHandCount).toBeVisible();
      await expectNearby(firstEmoteLauncher, firstIdentity, 100);
      await expectNoOverlap(firstEmoteLauncher, firstHandCount);
      await firstEmoteLauncher.click();
      const quickMenu = firstPage.getByRole('dialog', { name: '快捷表情' });
      await expect(quickMenu).toBeVisible();
      await expect(quickMenu.getByRole('button', { name: /^发送表情：/ })).toHaveCount(6);
      await firstPage.screenshot({
        path: '../output/playwright/match-emote-desktop-menu.png',
      });

      await quickMenu.getByRole('button', { name: '发送表情：深度思考中' }).click();
      const thinkingPreview = secondPage.getByRole('button', {
        name: /表情：深度思考中/,
      });
      await expect(thinkingPreview).toBeVisible();
      await expectNearby(
        thinkingPreview,
        secondPage.locator('[data-player-identity-seat]').filter({ hasText: 'Test Player 1' }),
        180
      );
      await secondPage.screenshot({
        path: '../output/playwright/match-emote-mobile-preview.png',
      });

      await thinkingPreview.click();
      const secondChat = secondPage.getByLabel('局内聊天面板');
      await expect(secondChat).toBeVisible();
      await expect(secondChat.getByText('深度思考中…', { exact: true })).toBeVisible();
      await secondChat.getByRole('button', { name: '关闭聊天' }).click();
      const secondEmoteLauncher = secondPage.getByRole('button', {
        name: '快捷表情',
        exact: true,
      });
      const secondChatButton = secondPage.getByRole('button', {
        name: '局内聊天',
        exact: true,
      });
      await expectContainedWithin(
        secondChatButton,
        secondPage.locator('[data-mobile-header-actions]')
      );
      const secondIdentity = secondPage
        .locator('[data-player-identity-seat]')
        .filter({ hasText: 'Test Player 2' });
      const secondHandCount = secondPage.locator('[data-mobile-player-hand-count="SECOND"]');
      await expect(secondHandCount).toBeVisible();
      await expect(secondHandCount).toHaveText(/^手牌 \d+$/u);
      await expectNearby(secondEmoteLauncher, secondIdentity, 100);
      await expectNoOverlap(secondEmoteLauncher, secondIdentity);
      await secondEmoteLauncher.click();
      await secondPage
        .getByRole('dialog', { name: '快捷表情' })
        .getByRole('button', { name: '发送表情：谢谢' })
        .click();

      const thankYouPreview = firstPage.getByRole('button', { name: /表情：谢谢/ });
      await expect(thankYouPreview).toBeVisible();
      await expect(thankYouPreview).toBeHidden({ timeout: 5_000 });
      await firstChatButton.click();
      const firstChat = firstPage.getByLabel('局内聊天面板');
      await expect(firstChat.getByText('深度思考中…', { exact: true })).toBeVisible();
      await expect(firstChat.getByText('谢谢！', { exact: true })).toBeVisible();

      const spectatorEntry = await apiData<{
        readonly seats: readonly { readonly seat: 'FIRST' | 'SECOND' }[];
      }>(await request.get(`/api/online/rooms/${roomCode}/spectator-entry`));
      expect(spectatorEntry.seats.length).toBeGreaterThan(0);
      const spectatorLink = await apiData<{ readonly token: string }>(
        await request.post(
          `/api/online/rooms/${roomCode}/spectator-entry/${spectatorEntry.seats[0]!.seat}/link`
        )
      );
      spectatorContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const spectatorPage = await spectatorContext.newPage();
      await spectatorPage.goto(`/online/spectate/${encodeURIComponent(spectatorLink.token)}`);
      const spectatorChatButton = spectatorPage.getByRole('button', { name: '观战聊天' });
      await expect(spectatorChatButton).toBeVisible();
      await expect(spectatorPage.getByRole('button', { name: '交流', exact: true })).toHaveCount(0);
      await spectatorChatButton.click();
      const spectatorChat = spectatorPage.getByLabel('观战聊天面板');
      await expect(spectatorChat.getByText('深度思考中…', { exact: true })).toBeVisible();
      await expect(spectatorChat.getByText('谢谢！', { exact: true })).toBeVisible();
      await expect(spectatorChat.getByRole('button', { name: '快捷表情' })).toHaveCount(0);

      await firstChat.getByRole('button', { name: '关闭聊天' }).click();
      await firstPage.emulateMedia({ reducedMotion: 'reduce' });
      await firstPage.getByRole('button', { name: '快捷表情', exact: true }).click();
      const reducedMotionDot = firstPage.locator('.match-emote-thinking-dot').first();
      await expect(reducedMotionDot).toBeVisible();
      await expect
        .poll(() =>
          reducedMotionDot.evaluate((element) => getComputedStyle(element).animationIterationCount)
        )
        .toBe('1');

      const response = await request.get(
        `/api/online/matches/${encodeURIComponent(started.matchId)}/chat/messages?afterSeq=0`,
        { headers: firstHeaders }
      );
      const entries = await apiData<{
        readonly messages: readonly { readonly kind: string; readonly messageSeq: number }[];
      }>(response);
      expect(entries.messages.map((entry) => [entry.messageSeq, entry.kind])).toEqual([
        [1, 'EMOTE'],
        [2, 'EMOTE'],
      ]);
    } finally {
      await firstContext?.close();
      await secondContext?.close();
      await spectatorContext?.close();
      await cleanupPlayerFixtures();
    }
  });
});

async function attachPlayerToRoom(page: Page, roomCode: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '前往大厅' })).toBeVisible();
  await page.evaluate(({ storageKey, room }) => window.sessionStorage.setItem(storageKey, room), {
    storageKey: 'loveca.online.room',
    room: roomCode,
  });
  await page.goto('/?page=online-room');
  const briefingCloseButton = page.getByRole('button', { name: '关闭玩前须知' });
  await briefingCloseButton.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
  if (await briefingCloseButton.isVisible()) {
    await briefingCloseButton.click();
  }
  await expect(page.getByRole('button', { name: '局内聊天', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '快捷表情', exact: true })).toBeVisible();
}

async function finishOpeningMulligan(firstPage: Page, secondPage: Page): Promise<void> {
  const firstKeepHand = firstPage.getByRole('button', { name: '保留手牌' });
  await expect(firstKeepHand).toBeEnabled();
  await firstKeepHand.click();

  const secondKeepHand = secondPage.getByRole('button', { name: '保留手牌' });
  await expect(secondKeepHand).toBeEnabled();
  await secondKeepHand.click();

  await expect(firstPage.getByText('换牌阶段', { exact: true })).toBeHidden();
  await expect(secondPage.getByText('换牌阶段', { exact: true })).toBeHidden();
}

async function login(
  request: APIRequestContext,
  usernameOrEmail: string,
  password: string
): Promise<LoginResult> {
  return apiData<LoginResult>(
    await request.post('/api/auth/login', {
      data: { usernameOrEmail, password },
    })
  );
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function apiData<T>(response: APIResponse): Promise<T> {
  const payload = (await response.json()) as {
    readonly data: T | null;
    readonly error: { readonly message: string } | null;
  };
  expect(response.ok(), payload.error?.message).toBe(true);
  expect(payload.data).not.toBeNull();
  return payload.data as T;
}

async function seedPlayerDecks(): Promise<Record<'test_player_1' | 'test_player_2', string>> {
  return withDatabase(async (client) => {
    const deckIds: Partial<Record<'test_player_1' | 'test_player_2', string>> = {};
    for (const username of ['test_player_1', 'test_player_2'] as const) {
      const inserted = await client.query<{ readonly id: string }>(
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
      const deckId = inserted.rows[0]?.id;
      if (!deckId) {
        throw new Error(`无法为 ${username} 创建快捷表情测试卡组`);
      }
      deckIds[username] = deckId;
    }
    return deckIds as Record<'test_player_1' | 'test_player_2', string>;
  });
}

async function cleanupPlayerFixtures(): Promise<void> {
  await withDatabase(async (client) => {
    await client.query(
      `DELETE FROM gameplay_participations
       WHERE user_id IN (
         SELECT id FROM profiles WHERE username IN ('test_player_1', 'test_player_2')
       )`
    );
    await client.query(`DELETE FROM decks WHERE name LIKE $1`, [`${DECK_NAME_PREFIX}%`]);
  });
}

async function withDatabase<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const parsed = new URL(DATABASE_URL);
  if (
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    (parsed.port || '5432') !== '5432' ||
    parsed.pathname !== '/loveca'
  ) {
    throw new Error('快捷表情 E2E 只允许连接本机 loveca 测试数据库');
  }
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function expectNearby(first: Locator, second: Locator, maxDistance: number): Promise<void> {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  const horizontalGap = Math.max(
    0,
    secondBox!.x - (firstBox!.x + firstBox!.width),
    firstBox!.x - (secondBox!.x + secondBox!.width)
  );
  const verticalGap = Math.max(
    0,
    secondBox!.y - (firstBox!.y + firstBox!.height),
    firstBox!.y - (secondBox!.y + secondBox!.height)
  );
  expect(Math.hypot(horizontalGap, verticalGap)).toBeLessThanOrEqual(maxDistance);
}

async function expectNoOverlap(first: Locator, second: Locator): Promise<void> {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  const overlapWidth = Math.max(
    0,
    Math.min(firstBox!.x + firstBox!.width, secondBox!.x + secondBox!.width) -
      Math.max(firstBox!.x, secondBox!.x)
  );
  const overlapHeight = Math.max(
    0,
    Math.min(firstBox!.y + firstBox!.height, secondBox!.y + secondBox!.height) -
      Math.max(firstBox!.y, secondBox!.y)
  );
  expect(overlapWidth * overlapHeight).toBe(0);
}

async function expectContainedWithin(inner: Locator, outer: Locator): Promise<void> {
  const innerBox = await inner.boundingBox();
  const outerBox = await outer.boundingBox();
  expect(innerBox).not.toBeNull();
  expect(outerBox).not.toBeNull();
  expect(innerBox!.x).toBeGreaterThanOrEqual(outerBox!.x);
  expect(innerBox!.y).toBeGreaterThanOrEqual(outerBox!.y);
  expect(innerBox!.x + innerBox!.width).toBeLessThanOrEqual(outerBox!.x + outerBox!.width);
  expect(innerBox!.y + innerBox!.height).toBeLessThanOrEqual(outerBox!.y + outerBox!.height);
}
