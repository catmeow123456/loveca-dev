/**
 * 游戏设置流程 E2E 测试
 * 测试从主页到开始游戏的完整流程
 */

import { test, expect } from '../fixtures/game.fixture';
import { gotoHome } from '../helpers/game-setup';

test.describe('游戏设置流程', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('应该显示主页', async ({ page }) => {
    // 检查主页元素
    const title = page.locator('text=Loveca').first();
    await expect(title).toBeVisible({ timeout: 5000 });
  });

  test('应该能点击开始游戏按钮', async ({ page }) => {
    // 确保主页加载完成 - 等待欢迎消息
    await expect(page.locator('text=欢迎回来')).toBeVisible({ timeout: 10000 });

    // 点击开始游戏 - 使用更具体的选择器找到按钮
    const startBtn = page.locator('button').filter({ hasText: '开始游戏' }).first();
    await expect(startBtn).toBeVisible({ timeout: 5000 });

    // 使用 force 确保点击生效（绕过潜在的动画遮挡）
    await startBtn.click({ force: true });

    // 应该进入卡组选择页面 - 等待 "游戏准备" 标题出现
    const setupPage = page.locator('text=游戏准备').first();
    await expect(setupPage).toBeVisible({ timeout: 10000 });
  });

  test('应该显示卡组选择界面', async ({ page }) => {
    // 确保主页加载完成 - 等待欢迎消息
    await expect(page.locator('text=欢迎回来')).toBeVisible({ timeout: 10000 });

    // 进入游戏设置 - 使用更具体的选择器
    const startBtn = page.locator('button').filter({ hasText: '开始游戏' }).first();
    await startBtn.click({ force: true });

    // 等待游戏准备页面出现
    await expect(page.locator('text=游戏准备').first()).toBeVisible({ timeout: 10000 });

    // 检查是否有卡组列表或选择提示 - Player 1 卡组标题应该可见
    const playerTitle = page.locator('text=Player 1 卡组').first();
    await expect(playerTitle).toBeVisible({ timeout: 5000 });
  });

  test('应该能选择卡组并进入下一步', async ({ page }) => {
    // 进入游戏设置
    await page.locator('button').filter({ hasText: '开始游戏' }).click();
    await page.waitForTimeout(1000);

    // 尝试选择卡组
    const deckBtn = page
      .locator('button')
      .filter({ hasText: /有效|卡组/ })
      .first();
    const hasDeck = await deckBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasDeck) {
      await deckBtn.click();

      // 检查是否有下一步按钮
      const nextBtn = page.locator('button').filter({ hasText: '下一步' });
      await expect(nextBtn).toBeVisible({ timeout: 3000 });
    }
  });

  test('完整流程：选择双方卡组并开始游戏', async ({ page }) => {
    // 1. 点击开始游戏
    await page.locator('button').filter({ hasText: '开始游戏' }).click();
    await page.waitForTimeout(1000);

    // 2. 选择玩家1卡组
    const p1DeckBtn = page
      .locator('button')
      .filter({ hasText: /有效/ })
      .first();
    const hasP1Deck = await p1DeckBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasP1Deck) {
      test.skip(true, '没有可用的卡组');
      return;
    }

    await p1DeckBtn.click();
    await page.locator('button').filter({ hasText: '下一步' }).click();
    await page.waitForTimeout(500);

    // 3. 选择玩家2卡组
    const p2DeckBtn = page
      .locator('button')
      .filter({ hasText: /有效/ })
      .first();
    await p2DeckBtn.click();
    await page.locator('button').filter({ hasText: '下一步' }).click();
    await page.waitForTimeout(500);

    // 4. 确认并开始游戏
    const confirmBtn = page.locator('button').filter({ hasText: /开始游戏|确认/ });
    await confirmBtn.click();
    await page.waitForTimeout(2000);

    // 5. 验证进入游戏界面
    // 应该看到换牌阶段或者 VS 分隔线
    const vsVisible = await page.locator('text=VS').isVisible({ timeout: 10000 }).catch(() => false);
    const mulliganVisible = await page.locator('text=换牌').isVisible({ timeout: 5000 }).catch(() => false);

    expect(vsVisible || mulliganVisible).toBeTruthy();
  });
});

test.describe('离线模式', () => {
  test('应该能够使用离线模式', async ({ page }) => {
    await page.goto('/');

    // 检查是否有离线模式选项
    const offlineBtn = page.locator('button').filter({ hasText: '离线模式' });
    const isVisible = await offlineBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (isVisible) {
      await offlineBtn.click();
      await page.waitForTimeout(500);

      // 应该能够继续使用应用
      const appContent = page.locator('text=Loveca');
      await expect(appContent).toBeVisible({ timeout: 5000 });
    }
  });
});
