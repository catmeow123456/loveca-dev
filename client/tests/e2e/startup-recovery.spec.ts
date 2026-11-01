import { expect, test } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';

// Run against a production preview: dev mode intentionally permits empty local
// fixtures when the API is absent, and cannot verify this failure boundary.
test.skip(!process.env.PLAYWRIGHT_BASE_URL, '需要生产构建 preview 的 PLAYWRIGHT_BASE_URL');
test.use({ serviceWorkers: 'block' });

test('卡池持续失败后原地恢复原页面，重复点击不重复加载且保留用户数据', async ({
  page,
}, testInfo) => {
  await installVisualApiMocks(page, true);
  let documentCount = 0;
  let authCount = 0;
  let recoveryCount = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentCount++;
    if (request.url().includes('/api/auth/refresh')) authCount++;
    if (request.url().includes('/solitaire-matches/recovery-fixture/snapshot')) recoveryCount++;
  });
  const localDecks = JSON.stringify({
    version: 1,
    decks: [
      {
        id: 'local-test',
        name: '保留的本地卡组',
        updatedAt: '2026-11-02T00:00:00.000Z',
        config: { player_name: '测试', main_deck: { members: [], lives: [] }, energy_deck: [] },
      },
    ],
  });
  await page.addInitScript((decks) => {
    localStorage.setItem('loveca.local-decks.v1', decks);
    localStorage.setItem('loveca-theme', 'light');
    sessionStorage.setItem('loveca.solitaire.match', 'recovery-fixture');
  }, localDecks);
  await page.route('**/api/battle/solitaire-matches/recovery-fixture/snapshot*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ data: null, error: { code: 'UNAVAILABLE', message: '稍后恢复' } }),
    })
  );
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/cards/published', async (route) => {
    calls++;
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().headers().cookie).toBeUndefined();
    if (calls <= 2) await route.abort('connectionreset');
    else {
      await gate;
      await route.fallback();
    }
  });

  await page.goto('/?page=deck-manager');
  await expect(page.getByRole('heading', { name: '服务暂时不可用' })).toBeVisible();
  expect(calls).toBe(2);
  expect(recoveryCount).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('startup-error.png'), fullPage: true });
  await page.getByRole('button', { name: '复制诊断', exact: true }).click();
  await expect(
    page
      .getByRole('button', { name: '诊断已复制' })
      .or(page.getByRole('textbox', { name: '诊断信息' }))
  ).toBeVisible();
  await page
    .getByRole('button', { name: '重试加载', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect.poll(() => calls).toBe(3);
  await expect(page.getByText('加载卡牌数据...', { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: '卡组管理', exact: true })).toBeVisible();
  expect(calls).toBe(3);
  expect(documentCount).toBe(1);
  expect(authCount).toBe(1);
  await expect.poll(() => recoveryCount).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('loveca.solitaire.match'))).toBe(
    'recovery-fixture'
  );
  expect(await page.evaluate(() => localStorage.getItem('loveca.local-decks.v1'))).toBe(localDecks);
  expect(await page.evaluate(() => localStorage.getItem('loveca-theme'))).toBe('light');
  await page.screenshot({ path: testInfo.outputPath('startup-recovered.png'), fullPage: true });
});

test('配置失败可原地重查，维护状态始终阻止认证与卡池加载', async ({ page }) => {
  await installVisualApiMocks(page, false);
  let cardCalls = 0;
  let authCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/cards/published')) cardCalls++;
    if (request.url().includes('/api/auth/refresh')) authCalls++;
  });
  let configAvailable = false;
  await page.route('**/api/config', async (route) => {
    if (!configAvailable)
      await route.fulfill({ status: 503, contentType: 'text/html', body: 'unavailable' });
    else await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '暂时无法入场' })).toBeVisible();
  expect(authCalls).toBe(0);
  expect(cardCalls).toBe(0);
  configAvailable = true;
  await page.route('**/site-status.json?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        availability: 'MAINTENANCE',
        generatedAt: new Date().toISOString(),
        maintenance: {
          id: 'test',
          title: '测试维护',
          summary: '稍后恢复',
          impactScopes: [],
          restrictions: [],
        },
      }),
    })
  );
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '幕间维护' })).toBeVisible();
  expect(authCalls).toBe(0);
  expect(cardCalls).toBe(0);
  await page.unroute('**/site-status.json?*');
  await page.route('**/site-status.json?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        availability: 'OPEN',
        generatedAt: new Date().toISOString(),
        maintenance: null,
      }),
    })
  );
  await page.getByRole('button', { name: '再试一次', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Loveca 在线对战' })).toBeVisible();
  await expect.poll(() => cardCalls).toBe(1);
  expect(authCalls).toBe(1);
});

test('完整但无效的卡池不自动循环重试，游客可继续浏览并手动恢复', async ({ page }) => {
  await installVisualApiMocks(page, false);
  let valid = false;
  let calls = 0;
  await page.route('**/api/cards/published', async (route) => {
    calls++;
    if (valid) await route.fallback();
    else
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: { schemaVersion: 1, cards: [] }, error: null }),
      });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Loveca 在线对战' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重试加载卡牌' })).toBeVisible();
  expect(calls).toBe(1);
  valid = true;
  await page.getByRole('button', { name: '重试加载卡牌' }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByRole('button', { name: '重试加载卡牌' })).toHaveCount(0);
});
