import { expect, test } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';

const NEXT_BUILD_ID = 'e2e-next-build';

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

    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documentRequests.push(request.url());
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Loveca 在线对战' })).toBeVisible();

    const updateNotice = page.locator('aside[role="status"]');
    await expect(updateNotice).toBeVisible();
    expect(documentRequests).toHaveLength(1);

    await updateNotice.getByRole('button', { name: '立即更新' }).click();
    const confirmDialog = page.getByRole('dialog', { name: '立即更新 Loveca？' });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '取消' }).click();
    await expect(confirmDialog).toHaveCount(0);
    expect(documentRequests).toHaveLength(1);

    await updateNotice.getByRole('button', { name: '稍后' }).click();
    await expect(updateNotice).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('loveca.app.update.deferred-build')))
      .toBe(NEXT_BUILD_ID);
    expect(documentRequests).toHaveLength(1);
  });

  test('大厅与准备页复用卡组快照，过期刷新期间仍可继续开始对战', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '跨层闭环只需在一个浏览器尺寸执行');

    await page.clock.setFixedTime(new Date('2026-08-25T12:00:00.000Z'));
    await installVisualApiMocks(page, true);

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
  });
});
