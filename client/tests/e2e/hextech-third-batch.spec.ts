import { expect, test } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';

test.use({ serviceWorkers: 'block' });

test('第三批海克斯可在双人调试取得并查看完整说明', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installVisualApiMocks(page, true);
  await page.goto('/?page=game-setup');
  await page.getByRole('button', { name: '切换模式', exact: true }).click();
  await page.getByRole('option', { name: '双人调试', exact: true }).click();
  await page.getByText('海克斯测试 · 未启用', { exact: true }).click();
  const first = page.getByRole('group', { name: 'Player 1 的海克斯', exact: true });
  for (const name of ['小画家', '灵活单推']) {
    await first.getByRole('checkbox', { name: new RegExp(name) }).check();
  }
  await expect(page.getByText('海克斯测试 · 已选 2 项', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  const mulligan = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await expect(mulligan).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => name.includes('/src/store/gameStore.ts'))!;
        const { useGameStore } = await import(path);
        return useGameStore
          .getState()
          .getMatchView()
          .hextech?.owned.map((item) => item.name);
      })
    )
    .toEqual(['小画家', '灵活单推']);

  await page
    .locator('summary')
    .filter({ hasText: /^海克斯$/ })
    .click();
  const held = page.getByLabel('已持有海克斯', { exact: true });
  await expect(held.getByText('彩 · 小画家', { exact: true })).toBeVisible();
  await expect(held.getByText(/三色以上LIVE所需灰心清零/)).toBeVisible();
  await expect(held.getByText('彩 · 灵活单推', { exact: true })).toBeVisible();
  await expect(held.getByText(/虹ヶ咲：棒\+4/)).toBeVisible();
  const bounds = await held.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath('hextech-third-batch.png') });
});
