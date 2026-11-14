import { expect, test, type Page } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';

test.use({ serviceWorkers: 'block' });

async function readState(page: Page) {
  return page.evaluate(async () => {
    const path = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/store/gameStore.ts'))!;
    const { useGameStore } = await import(path);
    const store = useGameStore.getState();
    const state = store.gameSession.state;
    return {
      phase: state.currentPhase,
      counts: state.players.map(
        (player: { hand: { cardIds: string[] } }) => player.hand.cardIds.length
      ),
      owned: store.getMatchView().hextech?.owned.map((item: { name: string }) => item.name) ?? [],
    };
  });
}

test('双人调试指定首批海克斯，换牌后取得并能查看；重开保留配置且重新授予一次', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installVisualApiMocks(page, true);
  await page.goto('/?page=game-setup');
  await page.getByRole('button', { name: '切换模式', exact: true }).click();
  await page.getByRole('option', { name: '双人调试', exact: true }).click();
  await page.getByText('海克斯测试 · 未启用', { exact: true }).click();
  const first = page.getByRole('group', { name: 'Player 1 的海克斯', exact: true });
  for (const name of [
    '草莓樱桃冰淇淋',
    '芒果蓝莓冰淇淋',
    '青提葡萄冰淇淋',
    '冰淇淋盲盒',
    '原味冰淇淋',
    '强欲之壶',
    '强强欲之壶',
    '强强强欲之壶',
  ]) {
    await first.getByRole('checkbox', { name: new RegExp(`^[银金彩] · ${name}`) }).check();
  }
  await expect(page.getByText('海克斯测试 · 已选 8 项', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('hextech-setup.png'), fullPage: true });
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  const mulligan = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  await expect(mulligan).toBeVisible();
  expect(await readState(page)).toMatchObject({ counts: [6, 6], owned: [] });
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await expect(mulligan).toHaveCount(0);
  await expect.poll(() => readState(page)).toMatchObject({ phase: 'MAIN_PHASE', counts: [16, 6] });
  expect((await readState(page)).owned).toHaveLength(8);
  await page
    .locator('summary')
    .filter({ hasText: /^海克斯$/ })
    .click();
  const held = page.getByLabel('已持有海克斯', { exact: true });
  await expect(page.locator('[data-phase-announcement]')).toHaveCount(0);
  await expect(held.getByText('银 · 草莓樱桃冰淇淋', { exact: true })).toBeVisible();
  await expect(held.getByText('粉心+1，红心+1', { exact: true })).toBeVisible();
  await held.getByText('彩 · 强强强欲之壶', { exact: true }).scrollIntoViewIfNeeded();
  await expect(held.getByText('彩 · 强强强欲之壶', { exact: true })).toBeVisible();
  const bounds = await held.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath('hextech-board.png') });
  await page.keyboard.press('Escape');
  await expect(held).toHaveCount(0);
  const restarted = await page.evaluate(async () => {
    const path = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/store/gameStore.ts'))!;
    const { useGameStore } = await import(path);
    return useGameStore.getState().restartCurrentGame();
  });
  expect(restarted.success).toBe(true);
  await expect(mulligan).toBeVisible();
  expect(await readState(page)).toMatchObject({ counts: [6, 6], owned: [] });
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await mulligan.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await expect.poll(() => readState(page)).toMatchObject({ phase: 'MAIN_PHASE', counts: [16, 6] });
  expect((await readState(page)).owned).toHaveLength(8);
});
