import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { installVisualApiMocks } from '../visual/support/mockApp';

const NEXT_BUILD_ID = 'e2e-next-build';

type RequestBaseline = {
  readonly documentUrls: string[];
  readonly apiCounts: Map<string, number>;
};

function observeRequests(page: Page): RequestBaseline {
  const baseline: RequestBaseline = { documentUrls: [], apiCounts: new Map() };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === 'document') {
      baseline.documentUrls.push(url.pathname + url.search);
    }
    if (url.pathname.startsWith('/api/')) {
      const key = `${request.method()} ${url.pathname}`;
      baseline.apiCounts.set(key, (baseline.apiCounts.get(key) ?? 0) + 1);
    }
  });
  return baseline;
}

async function readPerformanceBaseline(page: Page) {
  return page.evaluate(() => {
    return performance
      .getEntries()
      .filter((entry) => entry.name.startsWith('loveca:'))
      .map((entry) => ({
        name: entry.name,
        entryType: entry.entryType,
        startTime: Number(entry.startTime.toFixed(3)),
        duration: Number(entry.duration.toFixed(3)),
        detail: (entry as PerformanceMark | PerformanceMeasure).detail ?? null,
      }));
  });
}

async function attachArchitectureBaseline(
  page: Page,
  testInfo: TestInfo,
  scenario: string,
  requests: RequestBaseline
) {
  const performanceEntries = await readPerformanceBaseline(page);
  const outputPath = testInfo.outputPath(`frontend-architecture-${scenario}.json`);
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        scenario,
        project: testInfo.project.name,
        viewport: page.viewportSize(),
        documentNavigationCount: requests.documentUrls.length,
        documentUrls: requests.documentUrls,
        apiRequestCounts: Object.fromEntries([...requests.apiCounts].sort()),
        performanceEntries,
      },
      null,
      2
    ),
    'utf8'
  );
  await testInfo.attach(`frontend-architecture-${scenario}.json`, {
    contentType: 'application/json',
    path: outputPath,
  });
  return performanceEntries;
}

test.describe('前端外层稳定性闭环', () => {
  test('后台发现更新只提示，取消或稍后处理都不会触发页面导航', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '跨层闭环只需在一个浏览器尺寸执行');

    await installVisualApiMocks(page, false);
    await page.route('**/version.json*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 'e2e', buildId: NEXT_BUILD_ID }),
      });
    });

    const requests = observeRequests(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Loveca 在线对战' })).toBeVisible();

    const updateNotice = page.locator('aside[role="status"]');
    await expect(updateNotice).toBeVisible();
    expect(requests.documentUrls).toHaveLength(1);

    await updateNotice.getByRole('button', { name: '立即更新' }).click();
    const confirmDialog = page.getByRole('dialog', { name: '立即更新 Loveca？' });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '取消' }).click();
    await expect(confirmDialog).toHaveCount(0);
    expect(requests.documentUrls).toHaveLength(1);

    await updateNotice.getByRole('button', { name: '稍后' }).click();
    await expect(updateNotice).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('loveca.app.update.deferred-build')))
      .toBe(NEXT_BUILD_ID);
    expect(requests.documentUrls).toHaveLength(1);
    await attachArchitectureBaseline(page, testInfo, 'safe-update', requests);
  });

  test('大厅与准备页复用卡组快照，过期刷新期间仍可继续开始对战', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '跨层闭环只需在一个浏览器尺寸执行');

    await page.clock.setFixedTime(new Date('2026-08-25T12:00:00.000Z'));
    await installVisualApiMocks(page, true);
    const requests = observeRequests(page);

    let deckRequestCount = 0;
    let releaseSecondDeckRequest = () => undefined;
    const secondDeckRequestGate = new Promise<void>((resolve) => {
      releaseSecondDeckRequest = resolve;
    });

    await page.route('**/api/decks*', async (route) => {
      deckRequestCount += 1;
      if (deckRequestCount === 2) await secondDeckRequestGate;
      await route.fallback();
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '欢迎回来，视觉验收玩家' })).toBeVisible();
    await expect(page.getByText('视觉回归标准卡组', { exact: true }).first()).toBeVisible();
    await expect.poll(() => deckRequestCount).toBe(1);

    const battleNavigation = page
      .getByRole('navigation', { name: '主要导航' })
      .getByRole('button', { name: '对战' });
    await expect(battleNavigation).toBeEnabled();
    await battleNavigation.click();
    await expect(page.getByRole('heading', { name: '选择对战方式' })).toBeVisible();
    await page.getByRole('button', { name: '返回大厅' }).click();
    await expect(battleNavigation).toBeEnabled();
    expect(deckRequestCount).toBe(1);

    await battleNavigation.click();
    await expect(page.getByRole('heading', { name: '选择对战方式' })).toBeVisible();
    await page.clock.setFixedTime(new Date('2026-08-25T12:00:31.000Z'));
    await page.getByRole('button', { name: '返回大厅' }).click();

    await expect.poll(() => deckRequestCount).toBe(2);
    await expect(battleNavigation).toBeEnabled();
    await expect(page.getByText('视觉回归标准卡组', { exact: true }).first()).toBeVisible();

    releaseSecondDeckRequest();
    await expect.poll(() => deckRequestCount).toBe(2);

    await attachArchitectureBaseline(page, testInfo, 'deck-session-return', requests);
    expect(requests.documentUrls).toHaveLength(1);
    expect(requests.apiCounts.get('GET /api/decks')).toBe(2);
  });

  test('大厅到本地对局再返回准备页保持单文档并形成完整 timing trace', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '架构基线只需在标准视口执行');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installVisualApiMocks(page, true);
    const requests = observeRequests(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '欢迎回来，视觉验收玩家' })).toBeVisible();
    await page.evaluate(() => {
      performance.clearMarks();
      performance.clearMeasures();
    });

    const battleNavigation = page
      .getByRole('navigation', { name: '主要导航' })
      .getByRole('button', { name: '对战' });
    await battleNavigation.click();
    await expect(page.getByRole('heading', { name: '选择对战方式' })).toBeVisible();
    await page.getByRole('button', { name: /双人调试/ }).click();
    await page.getByRole('button', { name: '下一步：选择 P1 卡组' }).click();
    await page.getByRole('button', { name: '下一步：选择 P2 卡组' }).click();
    await page.getByRole('button', { name: '下一步：确认对局' }).click();
    await page.getByRole('button', { name: '开始对局' }).click();

    const leaveBattle = page.getByRole('button', { name: '离开房间' });
    await expect(leaveBattle).toBeVisible();
    await leaveBattle.click();
    await expect(page.getByRole('heading', { name: '选择对战方式' })).toBeVisible();

    const performanceEntries = await attachArchitectureBaseline(
      page,
      testInfo,
      'lobby-local-battle-return',
      requests
    );
    const readySurfaces = performanceEntries
      .filter((entry) => entry.name === 'loveca:measure:navigation-to-surface')
      .map((entry) => (entry.detail as { surface?: string } | null)?.surface);
    const readyDataSources = performanceEntries
      .filter((entry) => entry.name === 'loveca:measure:navigation-to-data')
      .map((entry) => (entry.detail as { source?: string } | null)?.source);

    expect(readySurfaces).toEqual(expect.arrayContaining(['game-setup', 'game']));
    expect(readyDataSources).toContain('battle-view');
    expect(requests.documentUrls).toHaveLength(1);
    expect(requests.apiCounts.get('GET /api/decks')).toBe(1);
  });
});
