import { expect, test } from '@playwright/test';
import { prepareVisualPage, installVisualApiMocks } from '../visual/support/mockApp';

test.use({ serviceWorkers: 'block' });

test('黑暗池24项可筛选，最新代价和纵列规则可读', async ({ page }, info) => {
  await prepareVisualPage(page, 'dark', false);
  await page.goto('/?page=hextech-pool');
  await page.getByRole('tab', { name: '黑暗池', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(24);
  for (const rarity of ['银色', '金色', '彩色']) {
    await page.getByRole('tab', { name: rarity, exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(8);
  }
  await expect(page.getByRole('article').filter({ hasText: '突然断电' })).toContainText(
    '除本效果外'
  );
  await expect(page.getByRole('article').filter({ hasText: '寂静聚光灯' })).toContainText(
    '支付2能量并将1张手牌'
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true
  );
  await page.screenshot({ path: info.outputPath('dark-pool.png'), fullPage: true });
});

test('双人调试选择黑暗池，起动弃牌与最终支付走共享效果面板', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installVisualApiMocks(page, true);
  await page.goto('/?page=game-setup');
  await page.getByRole('button', { name: '切换模式', exact: true }).click();
  await page.getByRole('option', { name: '双人调试', exact: true }).click();
  await page.getByRole('combobox', { name: '海克斯卡池' }).selectOption('DARK');
  await page.getByText('海克斯测试 · 未启用', { exact: true }).click();
  await page
    .getByRole('group', { name: 'Player 1 的海克斯', exact: true })
    .getByRole('checkbox', { name: /先借再还/ })
    .check();
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  const mulligan = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await expect(mulligan).toHaveCount(0);
  await expect(page.locator('[data-phase-announcement]')).toHaveCount(0);
  const state = () =>
    page.evaluate(async () => {
      const path = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes('/src/store/gameStore.ts'))!;
      const { useGameStore } = await import(path);
      const game = useGameStore.getState().gameSession.state;
      return {
        hand: game.players[0].hand.cardIds.length,
        uses: game.hextech.uses?.length ?? 0,
        step: game.activeEffect?.stepId,
      };
    });
  const before = await state();
  await page
    .locator('summary')
    .filter({ hasText: /^黑暗海克斯$/ })
    .click();
  await page.getByRole('button', { name: '发动先借再还', exact: true }).click();
  await page.getByRole('button', { name: '确认发动', exact: true }).click();
  await expect.poll(async () => (await state()).step).toBe('HEXTECH_DISCARD');
  await page.screenshot({ path: info.outputPath('dark-activation-choice.png') });
  const candidates = page.getByRole('group', { name: '效果候选卡牌' }).getByRole('button');
  await candidates.first().click();
  await page.getByRole('button', { name: /^继续/ }).click();
  await expect.poll(async () => (await state()).step).toBe('HEXTECH_CONFIRM');
  await page.getByRole('button', { name: /^支付并发动/ }).click();
  await expect.poll(state).toEqual({ hand: before.hand + 3, uses: 1, step: undefined });
  await page
    .locator('summary')
    .filter({ hasText: /^黑暗海克斯$/ })
    .click();
  await expect(page.getByLabel('已持有海克斯')).toContainText('本局已使用');
  await expect(page.getByRole('button', { name: '发动先借再还', exact: true })).toHaveCount(0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: info.outputPath('dark-used.png'), animations: 'disabled' });
});
