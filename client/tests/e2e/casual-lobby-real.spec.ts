import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import process from 'node:process';

// Reuses the running local environment and pre-authorized player deck fixtures.
// RUN_CASUAL_REAL=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 pnpm --dir client exec playwright test tests/e2e/casual-lobby-real.spec.ts --project=tablet-1024x768 --workers=1
// No account deck writes, database resets, production hosts or admin endpoints.
test.skip(process.env.RUN_CASUAL_REAL !== '1', 'Requires the explicit local test environment');
test.setTimeout(150_000);

async function login(page: Page, index: number) {
  await page.goto('/?page=battle-lobby');
  await page.getByPlaceholder('输入你的用户名或邮箱').fill(`test_player_${index}`);
  await page.getByPlaceholder('输入你的密码').fill(`test_password_${index}`);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
}
async function dismissBriefing(page: Page) {
  const skip = page.getByRole('button', { name: '跳过提示', exact: true });
  await skip
    .waitFor({ timeout: 12_000 })
    .then(() => skip.click())
    .catch(() => undefined);
}
async function opening(first: Page, second: Page) {
  await first.getByRole('button', { name: '确认开局', exact: true }).click();
  await second.getByRole('button', { name: '确认开局', exact: true }).click();
  await first.getByRole('button', { name: '石头', exact: true }).click();
  await second.getByRole('button', { name: '剪刀', exact: true }).click();
  await first.getByRole('button', { name: '我先手', exact: true }).click();
  await Promise.all([dismissBriefing(first), dismissBriefing(second)]);
  await expect(first.getByTitle('打开房间操作')).toBeVisible();
}
async function assertFit(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  ).toBe(true);
}

for (const exitViaHome of [false, true]) {
  test(`two players: rematch and continued waiting after ${exitViaHome ? 'home abandonment' : 'room surrender'}`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    const api = process.env.CASUAL_TEST_API_URL ?? 'http://127.0.0.1:3007';
    expect(new URL(api).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    const contexts: BrowserContext[] = await Promise.all([
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
    try {
      await login(first, 1);
      await login(second, 2);
      await expect(first.getByRole('button', { name: '创建房间', exact: true })).toBeEnabled();
      await first.getByRole('button', { name: '创建房间', exact: true }).click();
      await first
        .getByRole('dialog')
        .getByLabel('房间备注（可选，最多 40 字）')
        .fill('本地大厅生命周期验收');
      await first.getByRole('dialog').getByRole('checkbox', { name: '开放我的观战视角' }).check();
      await first
        .getByRole('dialog')
        .getByRole('button', { name: '创建普通房间', exact: true })
        .click();
      await expect(first.getByRole('heading', { name: '正在公开等人' })).toBeVisible();
      const code = (await first.locator('.casual-current-top .casual-code').innerText()).trim();
      await first.screenshot({ path: testInfo.outputPath('desktop-waiting.png'), fullPage: true });
      await second.getByRole('button', { name: '输入房间号', exact: true }).click();
      await second.getByRole('dialog').getByLabel('房间号', { exact: true }).fill(code);
      await second
        .getByRole('dialog')
        .getByRole('button', { name: '查找房间', exact: true })
        .click();
      await second
        .getByRole('dialog')
        .getByRole('button', { name: '选择卡组并加入', exact: true })
        .click();
      await second
        .getByRole('dialog')
        .getByRole('button', { name: '加入房间', exact: true })
        .click();
      await expect(second.getByRole('button', { name: '确认开局', exact: true })).toBeVisible();
      await assertFit(second);
      await second.screenshot({ path: testInfo.outputPath('mobile-confirm.png'), fullPage: true });
      await opening(first, second);

      // End through the real authority command without the UI's separate leave action,
      // so both players remain for the same post-match negotiation used after a scored win.
      const authResponse = await first.request.post(`${api}/api/auth/login`, {
        data: { usernameOrEmail: 'test_player_1', password: 'test_password_1' },
      });
      expect(authResponse.ok()).toBe(true);
      const { data: auth } = await authResponse.json();
      const headers = { Authorization: `Bearer ${auth.accessToken}` };
      const currentResponse = await first.request.get(`${api}/api/casual-tables/me`, { headers });
      const { data: before } = await currentResponse.json();
      const oldRound = before.table.roundId;
      const commandResponse = await first.request.post(
        `${api}/api/online/matches/${before.table.runtime.matchId}/command`,
        {
          headers,
          data: {
            command: { type: 'SURRENDER', playerId: 'server-overwrites', timestamp: Date.now() },
          },
        }
      );
      expect(commandResponse.ok()).toBe(true);
      for (const page of [first, second])
        await page.getByRole('button', { name: '返回对战大厅，再战或选组', exact: true }).click();
      await first.getByRole('button', { name: '再来一局', exact: true }).click();
      await first.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
      await second.getByRole('button', { name: '同意并选组', exact: true }).click();
      await second.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
      await expect(first.getByRole('button', { name: '确认开局', exact: true })).toBeVisible();
      const next = await (
        await first.request.get(`${api}/api/casual-tables/me`, { headers })
      ).json();
      expect(next.data.table.roundId).not.toBe(oldRound);
      expect(
        next.data.table.members.every((member: { confirmed: boolean }) => !member.confirmed)
      ).toBe(true);
      await opening(first, second);
      if (exitViaHome) {
        await first.getByTitle('打开房间操作').click();
        await first.getByRole('button', { name: '返回大厅', exact: true }).click();
        await first.getByRole('button', { name: '返回首页', exact: true }).click();
        await first
          .getByRole('region', { name: '当前房间', exact: true })
          .getByText('其他操作', { exact: true })
          .click();
        await first.getByRole('button', { name: '另开本地对局', exact: true }).click();
        await expect(
          first.getByRole('heading', { name: '选择己方卡组', exact: true })
        ).toBeVisible();
      } else {
        await first.getByTitle('打开房间操作').click();
        await first.getByRole('button', { name: '认输并退出房间', exact: true }).click();
        await first
          .getByRole('dialog')
          .getByRole('button', { name: '认输并退出房间', exact: true })
          .click();
        await expect(first.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
      }
      await expect(second.getByText('对方已认输。', { exact: false })).toBeVisible();
      const left = await (
        await first.request.get(`${api}/api/casual-tables/me`, { headers })
      ).json();
      expect(left.data.table).toBeNull();
      expect(left.data.otherParticipation).toBeNull();
      await second.getByRole('button', { name: '返回对战大厅，再战或选组', exact: true }).click();
      await second.getByRole('button', { name: '继续公开找人', exact: true }).click();
      await second.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
      await expect(second.getByRole('heading', { name: '正在公开等人' })).toBeVisible();
      expect((await second.locator('.casual-current-top .casual-code').innerText()).trim()).toBe(
        code
      );
      await second.getByRole('button', { name: '取消等待', exact: true }).click();
      await second
        .getByRole('dialog')
        .getByRole('button', { name: '确认取消', exact: true })
        .click();
      await expect(second.getByRole('button', { name: '找对手', exact: true })).toBeEnabled();
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}
