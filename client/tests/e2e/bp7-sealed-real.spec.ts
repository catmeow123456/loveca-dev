import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import process from 'node:process';
import pg from 'pg';

// Opt-in: use an isolated local database with BP7 fixtures and two ordinary test users.
// Never points at production, creates account decks, or calls administrator endpoints.
test.skip(process.env.RUN_BP7_REAL !== '1', 'Requires an isolated BP7 local test server');
test.setTimeout(180_000);
test.describe.configure({ mode: 'serial' });
const api = process.env.BP7_TEST_API_URL ?? 'http://127.0.0.1:3019';
const password = 'bp7_browser_test_password';

async function fixtureUser(request: APIRequestContext, index: number) {
  const username = `bp7_browser_${index}`;
  let response = await request.post(`${api}/api/auth/login`, {
    data: { usernameOrEmail: username, password },
  });
  if (response.status() === 401) {
    const created = await request.post(`${api}/api/auth/register`, {
      data: { username, password, displayName: `开盒测试玩家 ${index}` },
    });
    expect(created.ok()).toBe(true);
    response = await request.post(`${api}/api/auth/login`, {
      data: { usernameOrEmail: username, password },
    });
  }
  expect(response.ok()).toBe(true);
  return {
    username,
    headers: { Authorization: `Bearer ${(await response.json()).data.accessToken}` },
  };
}
async function login(page: Page, username: string) {
  await page.goto('/?page=battle-lobby');
  await page.getByPlaceholder('输入你的用户名或邮箱').fill(username);
  await page.getByPlaceholder('输入你的密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /PT 不限/ }).check();
  await page.getByRole('button', { name: 'BP7 开盒赛', exact: true }).click();
}
async function selectMembers(page: Page) {
  for (let i = 0; i < 24; i++)
    await page
      .getByRole('button', { name: /^选择 /, pressed: false })
      .first()
      .click();
  await expect(page.getByRole('button', { name: '准备对战', exact: true })).toBeEnabled();
}
async function startBattle(first: Page, second: Page) {
  await first.getByRole('button', { name: '准备对战', exact: true }).click();
  await second.getByRole('button', { name: '准备对战', exact: true }).click();
  await first.getByRole('button', { name: '石头', exact: true }).click();
  await second.getByRole('button', { name: '剪刀', exact: true }).click();
  await first.getByRole('button', { name: '我先手', exact: true }).click();
  await Promise.all(
    [first, second].map(async (page) => {
      const skip = page.getByRole('button', { name: '跳过提示', exact: true });
      await skip
        .waitFor({ timeout: 12_000 })
        .then(() => skip.click())
        .catch(() => undefined);
      await expect(page.getByTitle('打开房间操作')).toBeVisible();
      await expect(
        page
          .getByText(/开盒赛 · 两首获胜/)
          .filter({ visible: true })
          .first()
      ).toBeVisible();
    })
  );
  await first.getByRole('button', { name: '保留手牌', exact: true }).click();
  await second.getByRole('button', { name: '保留手牌', exact: true }).click();
  for (const page of [first, second])
    await expect(page.getByRole('button', { name: '保留手牌', exact: true })).toHaveCount(0);
}

test('two players open, build, reconnect, battle, retain a pool and rebox on desktop/mobile', async ({
  browser,
  baseURL,
  request,
}, info) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  expect(new URL(api).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const users = [await fixtureUser(request, 1), await fixtureUser(request, 2)];
  const contexts = await Promise.all([
    browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } }),
    browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
  ]);
  const [first, second] = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  for (const page of [first, second]) page.on('pageerror', (error) => errors.push(error.message));
  const own = async (i: number) =>
    (await (await request.get(`${api}/api/casual-tables/me`, { headers: users[i].headers })).json())
      .data.table;
  async function endBattle() {
    const table = await own(0);
    const response = await request.post(
      `${api}/api/online/matches/${table.runtime.matchId}/command`,
      {
        headers: users[0].headers,
        data: {
          command: { type: 'SURRENDER', playerId: 'server-overwrites', timestamp: Date.now() },
        },
      }
    );
    expect(response.ok()).toBe(true);
    for (const page of [first, second])
      await page.getByRole('button', { name: '返回对战大厅，再战或选组', exact: true }).click();
  }
  try {
    for (let i = 0; i < 2; i++) {
      const prior = await own(i);
      if (prior?.runtime?.matchId)
        await request.post(`${api}/api/online/matches/${prior.runtime.matchId}/command`, {
          headers: users[i].headers,
          data: {
            command: { type: 'SURRENDER', playerId: 'server-overwrites', timestamp: Date.now() },
          },
        });
      if (prior) {
        const latest = await own(i);
        const cleaned = await request.post(
          `${api}/api/casual-tables/${latest.state === 'BOUND' ? 'leave' : 'cancel'}`,
          { headers: users[i].headers, data: { target: latest } }
        );
        expect(cleaned.ok(), await cleaned.text()).toBe(true);
      }
    }
    await login(first, users[0].username);
    await login(second, users[1].username);
    for (const [i, page] of [first, second].entries()) {
      await page.getByRole('button', { name: '找对手', exact: true }).click();
      await expect(page.getByRole('region', { name: '开盒赛玩法' })).toBeVisible();
      await page.screenshot({
        path: info.outputPath(i === 0 ? 'desktop-find-opponent.png' : 'mobile-find-opponent.png'),
      });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await first.getByRole('button', { name: '创建房间', exact: true }).click();
    await first
      .getByRole('dialog')
      .getByRole('button', { name: '创建开盒赛房间', exact: true })
      .click();
    await expect(first.getByRole('status', { name: '正在公开等人' })).toBeVisible();
    const code = (await first.locator('.casual-current-top .casual-code').innerText()).trim();
    await second.getByRole('button', { name: '输入房间号', exact: true }).click();
    await second.getByRole('dialog').getByLabel('房间号', { exact: true }).fill(code);
    await second.getByRole('dialog').getByRole('button', { name: '查找房间', exact: true }).click();
    await second
      .getByRole('dialog')
      .getByRole('button', { name: '加入开盒赛', exact: true })
      .click();
    await second.getByRole('dialog').getByRole('button', { name: '加入房间', exact: true }).click();
    await first.getByRole('button', { name: '确认开局', exact: true }).click();
    await second.getByRole('button', { name: '确认开局', exact: true }).click();
    await expect(first.getByRole('region', { name: 'BP7 开盒组牌' })).toBeVisible();
    const before = [await own(0), await own(1)];
    expect(before[0].sealedPool.poolId).not.toBe(before[1].sealedPool.poolId);
    await first.getByRole('button', { name: '打开第 1 包', exact: true }).click();
    await expect(first.locator('.sealed-card')).toHaveCount(5);
    await first.screenshot({ path: info.outputPath('desktop-open-pack.png'), fullPage: true });
    for (const [i, page] of [first, second].entries()) {
      await page.getByRole('button', { name: '全部打开并组牌', exact: true }).click();
      await expect
        .poll(() =>
          page
            .locator('.sealed-card-art img')
            .first()
            .evaluate((image) => (image as HTMLImageElement).naturalWidth)
        )
        .toBeGreaterThan(0);
      await page.getByRole('button', { name: '罕度', exact: true }).click();
      await page.screenshot({
        path: info.outputPath(i === 0 ? 'desktop-rarity-menu.png' : 'mobile-rarity-menu.png'),
      });
      await page.getByRole('option', { name: 'N', exact: true }).click();
      await expect(page.locator('.sealed-card-grid').first().locator('.sealed-card')).toHaveCount(
        20
      );
      await page.getByRole('button', { name: '罕度', exact: true }).click();
      await page.getByRole('option', { name: '全部罕度', exact: true }).click();
      const groupFilter = page.getByRole('button', { name: '团体', exact: true });
      await groupFilter.press('ArrowDown');
      await expect(page.getByRole('listbox', { name: '团体', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(groupFilter).toBeFocused();
      await page.locator('.sealed-info summary').click();
      await expect(page.locator('.sealed-info-content')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.sealed-info-content')).toBeHidden();
      await page.locator('.sealed-card-zoom').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const firstCard = page.getByRole('button', { name: /^选择 / }).first();
      await firstCard.click();
      await expect(firstCard).toHaveAttribute('aria-pressed', 'true');
      await firstCard.press('Space');
      await expect(firstCard).toHaveAttribute('aria-pressed', 'false');
      await selectMembers(page);
    }
    await second.reload();
    await expect(second.getByRole('button', { name: '准备对战', exact: true })).toBeEnabled();
    const restored = await own(1);
    expect(restored.sealedPool.poolId).toBe(before[1].sealedPool.poolId);
    expect(restored.confirmationExpiresAt).toBe(before[1].confirmationExpiresAt);
    expect(restored.sealedPool.selectedIndices).toHaveLength(24);
    await second.getByRole('button', { name: '已选成员 24', exact: true }).click();
    await expect(second.locator('.sealed-card-grid').first().locator('.sealed-card')).toHaveCount(
      24
    );
    for (const [i, page] of [first, second].entries()) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      const grid = await page.locator('.sealed-card-grid').first().boundingBox();
      expect(grid!.y).toBeLessThan(i === 0 ? 370 : 500);
      await page.screenshot({
        path: info.outputPath(i === 0 ? 'desktop-builder.png' : 'mobile-builder.png'),
      });
    }
    await first.setViewportSize({ width: 1920, height: 1080 });
    const wideGrid = await first.locator('.sealed-card-grid').first().boundingBox();
    expect(wideGrid!.width).toBeGreaterThan(1600);
    await first.screenshot({ path: info.outputPath('wide-builder.png') });
    await first.setViewportSize({ width: 1440, height: 1000 });
    await first.getByRole('button', { name: '切换到深色主题', exact: true }).click();
    await first.getByRole('button', { name: '罕度', exact: true }).click();
    await first.screenshot({
      path: info.outputPath('dark-builder-menu.png'),
      animations: 'disabled',
    });
    await first.keyboard.press('Escape');
    await first.getByRole('button', { name: '切换到浅色主题', exact: true }).click();
    await second.setViewportSize({ width: 320, height: 844 });
    expect(
      await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
    ).toBe(true);
    for (const label of await second.locator('.sealed-filter-menu .truncate').all()) {
      expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true
      );
    }
    await second.screenshot({ path: info.outputPath('narrow-builder.png') });
    await second.setViewportSize({ width: 390, height: 844 });
    await first.getByRole('button', { name: '准备对战', exact: true }).click();
    await expect(first.getByRole('button', { name: /^选择 / }).first()).toBeDisabled();
    await first.getByRole('button', { name: '取消准备', exact: true }).click();
    await startBattle(first, second);
    await second.screenshot({ path: info.outputPath('mobile-battle.png') });
    await endBattle();
    await first.getByRole('button', { name: '原牌池再战', exact: true }).click();
    await second.getByRole('button', { name: '同意', exact: true }).click();
    await expect(first.getByRole('button', { name: '准备对战', exact: true })).toBeEnabled();
    expect((await own(0)).sealedPool.poolId).toBe(before[0].sealedPool.poolId);
    expect((await own(0)).roundId).not.toBe(before[0].roundId);
    await startBattle(first, second);
    await endBattle();
    await first.getByRole('button', { name: '邀请重新开盒', exact: true }).click();
    expect((await own(0)).sealedPool.poolId).toBe(before[0].sealedPool.poolId);
    await second.getByRole('button', { name: '同意', exact: true }).click();
    await expect(first.getByRole('button', { name: '打开第 1 包', exact: true })).toBeVisible();
    for (let i = 0; i < 2; i++) {
      const after = await own(i);
      expect(after.sealedPool.poolId).not.toBe(before[i].sealedPool.poolId);
      expect(after.sealedPool.selectedIndices).toEqual([]);
    }
    await first.getByRole('button', { name: '退出本轮', exact: true }).click();
    await expect.poll(() => own(1)).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('random matchmaking cancels both builders at the shared deadline without creating a match', async ({
  browser,
  baseURL,
  request,
}) => {
  const databaseUrl = process.env.BP7_TEST_DATABASE_URL;
  test.skip(
    !databaseUrl,
    'Deadline simulation requires an explicit isolated bp7_browser_* database'
  );
  expect(new URL(databaseUrl!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  expect(new URL(databaseUrl!).pathname).toMatch(/^\/bp7_browser_[a-z0-9_]+$/);
  expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  expect(new URL(api).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const users = [await fixtureUser(request, 1), await fixtureUser(request, 2)];
  const contexts = await Promise.all([
    browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } }),
    browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
  ]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const before = (await client.query('SELECT count(*) FROM match_records')).rows[0].count;
    for (const [i, page] of pages.entries()) {
      await login(page, users[i].username);
      await page.getByRole('button', { name: '找对手', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '开始找对手', exact: true })
        .click();
    }
    for (const page of pages)
      await page.getByRole('button', { name: '确认开局', exact: true }).click();
    for (const page of pages)
      await expect(page.getByRole('region', { name: 'BP7 开盒组牌' })).toBeVisible();
    for (let pack = 1; pack <= 10; pack++) {
      await pages[0].getByRole('button', { name: `打开第 ${pack} 包`, exact: true }).click();
      await expect(pages[0].locator('.sealed-card')).toHaveCount(5);
    }
    await pages[0].getByRole('button', { name: '开始组牌', exact: true }).click();
    const state = (
      await (await request.get(`${api}/api/casual-tables/me`, { headers: users[0].headers })).json()
    ).data.table;
    // Only accelerate this test's deadline, never application clocks or another room.
    await client.query(
      "UPDATE casual_tables SET confirmation_expires_at=now()-interval '1 second' WHERE id=$1 AND round_id=$2 AND state='BUILDING'",
      [state.tableId, state.roundId]
    );
    for (const [i, page] of pages.entries()) {
      expect(
        (
          await (
            await request.get(`${api}/api/casual-tables/me`, { headers: users[i].headers })
          ).json()
        ).data.table
      ).toBeNull();
      await expect(
        page.getByText('15 分钟组牌时间已结束，本轮已取消，不计败北。', { exact: true })
      ).toBeVisible();
    }
    expect((await client.query('SELECT count(*) FROM match_records')).rows[0].count).toBe(before);
  } finally {
    await client.end();
    await Promise.all(contexts.map((context) => context.close()));
  }
});
