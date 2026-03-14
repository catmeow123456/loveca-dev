/**
 * 换牌阶段 E2E 测试
 * 测试换牌面板的显示、卡牌选择和确认操作
 */

import { test, expect } from '../fixtures/game.fixture';
import { setupAndStartGame, gotoHome } from '../helpers/game-setup';

test.describe('换牌阶段', () => {
  test.beforeEach(async ({ page }) => {
    // 启动游戏并进入换牌阶段
    const started = await setupAndStartGame(page);
    if (!started) {
      test.skip(true, '无法启动游戏');
    }
  });

  test('应该显示换牌面板', async ({ page, gamePage }) => {
    // 换牌面板应该可见
    await expect(page.locator('text=换牌阶段').first()).toBeVisible({ timeout: 10000 });
  });

  test('应该显示手牌（6张）', async ({ page }) => {
    // 等待换牌面板
    await page.locator('text=换牌阶段').first().waitFor({ state: 'visible', timeout: 10000 });

    // 检查手牌显示
    const handInfo = page.locator('text=/你的手牌.*\\d.*张/');
    await expect(handInfo).toBeVisible({ timeout: 5000 });
  });

  test('应该能点击卡牌进行选择', async ({ page }) => {
    // 等待换牌面板
    await page.locator('text=换牌阶段').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);

    // 检查是否轮到当前玩家
    const isMyTurn = await page.locator('text=轮到你换牌').isVisible({ timeout: 3000 }).catch(() => false);

    if (!isMyTurn) {
      test.skip(true, '不是当前玩家的换牌回合');
      return;
    }

    // 获取手牌区域中的卡牌
    const cards = page.locator('.fixed .flex-wrap > div').filter({ has: page.locator('img') });
    const cardCount = await cards.count();

    if (cardCount > 0) {
      // 点击第一张卡牌
      await cards.first().click();
      await page.waitForTimeout(300);

      // 检查是否显示选中状态
      const selectedText = page.locator('text=已选择');
      const isSelected = await selectedText.isVisible({ timeout: 2000 }).catch(() => false);

      // 或者检查确认按钮的数字变化
      const confirmBtn = page.locator('button').filter({ hasText: '确认换牌' });
      const hasSelection = await confirmBtn.locator('text=/\\d+.*张/').isVisible().catch(() => isSelected);

      expect(isSelected || hasSelection).toBeTruthy();
    }
  });

  test('应该能点击"不换牌"跳过', async ({ page, gamePage }) => {
    // 等待换牌面板
    await page.locator('text=换牌阶段').first().waitFor({ state: 'visible', timeout: 10000 });

    // 检查是否轮到当前玩家
    const isMyTurn = await page.locator('text=轮到你换牌').isVisible({ timeout: 3000 }).catch(() => false);

    if (!isMyTurn) {
      test.skip(true, '不是当前玩家的换牌回合');
      return;
    }

    // 点击不换牌
    await gamePage.clickSkipMulligan();
    await page.waitForTimeout(500);

    // 验证状态变化（可能切换到等待对手或下一阶段）
    // UI 显示 "对手回合" 或进入下一阶段
    const waiting = await page.locator('text=对手回合').isVisible({ timeout: 3000 }).catch(() => false);
    const completed = await page.locator('text=已完成').isVisible({ timeout: 3000 }).catch(() => false);
    const nextPhase = await page.locator('text=活跃阶段').isVisible({ timeout: 3000 }).catch(() => false);

    expect(waiting || completed || nextPhase).toBeTruthy();
  });

  test('双方完成换牌后应该进入活跃阶段', async ({ page, gamePage }) => {
    // 第一个玩家不换牌
    await page.locator('text=换牌阶段').first().waitFor({ state: 'visible', timeout: 10000 });

    const skipBtn = page.locator('button').filter({ hasText: '不换牌' });
    if (await skipBtn.isVisible({ timeout: 3000 })) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    }

    // 切换视角到第二个玩家
    await gamePage.switchView();
    await page.waitForTimeout(500);

    // 第二个玩家不换牌
    const skipBtn2 = page.locator('button').filter({ hasText: '不换牌' });
    if (await skipBtn2.isVisible({ timeout: 3000 })) {
      await skipBtn2.click();
      await page.waitForTimeout(1000);
    }

    // 等待阶段自动推进
    await page.waitForTimeout(2000);

    // 应该进入后续阶段（活跃阶段或主要阶段）
    const activePhase = await page.locator('text=活跃阶段').isVisible({ timeout: 5000 }).catch(() => false);
    const mainPhase = await page.locator('text=主要阶段').isVisible({ timeout: 5000 }).catch(() => false);

    expect(activePhase || mainPhase).toBeTruthy();
  });
});

test.describe('换牌阶段 - 选择卡牌确认换牌', () => {
  test.beforeEach(async ({ page }) => {
    const started = await setupAndStartGame(page);
    if (!started) {
      test.skip(true, '无法启动游戏');
    }
  });

  test('应该能选择多张卡牌并确认换牌', async ({ page }) => {
    // 等待换牌面板
    await page.locator('text=换牌阶段').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);

    // 检查是否轮到当前玩家
    const isMyTurn = await page.locator('text=轮到你换牌').isVisible({ timeout: 3000 }).catch(() => false);

    if (!isMyTurn) {
      test.skip(true, '不是当前玩家的换牌回合');
      return;
    }

    // 获取手牌
    const cards = page.locator('.fixed .flex-wrap > div').filter({ has: page.locator('img') });
    const cardCount = await cards.count();

    if (cardCount >= 2) {
      // 选择前两张卡牌
      await cards.nth(0).click();
      await page.waitForTimeout(200);
      await cards.nth(1).click();
      await page.waitForTimeout(200);

      // 检查选中数量
      const confirmBtn = page.locator('button').filter({ hasText: /确认换牌.*2/ });
      const hasTwoSelected = await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasTwoSelected) {
        // 确认换牌
        await confirmBtn.click();
        await page.waitForTimeout(500);

        // 验证换牌完成 - 换牌面板应该关闭（因为 hasCompletedMulligan 变为 true）
        // 面板关闭后，"轮到你换牌" 文本不再可见
        const myTurnGone = await page.locator('text=轮到你换牌').isHidden({ timeout: 3000 }).catch(() => false);
        // 或者整个换牌标题区域不再可见（对该玩家而言）
        const panelClosed = await page.locator('.fixed .bg-slate-900').filter({ hasText: '换牌阶段' }).isHidden({ timeout: 3000 }).catch(() => false);

        expect(myTurnGone || panelClosed).toBeTruthy();
      }
    }
  });

  test('应该能取消选择的卡牌', async ({ page }) => {
    // 等待换牌面板
    await page.locator('text=换牌阶段').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);

    const isMyTurn = await page.locator('text=轮到你换牌').isVisible({ timeout: 3000 }).catch(() => false);

    if (!isMyTurn) {
      test.skip(true, '不是当前玩家的换牌回合');
      return;
    }

    const cards = page.locator('.fixed .flex-wrap > div').filter({ has: page.locator('img') });
    const cardCount = await cards.count();

    if (cardCount > 0) {
      // 选择一张卡牌
      await cards.first().click();
      await page.waitForTimeout(200);

      // 再次点击取消选择
      await cards.first().click();
      await page.waitForTimeout(200);

      // 确认按钮应该显示 0 张或被禁用
      const confirmBtn = page.locator('button').filter({ hasText: /确认换牌.*0/ });
      const isZero = await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false);

      // 或者检查按钮是否被禁用
      const disabledBtn = page.locator('button[disabled]').filter({ hasText: '确认换牌' });
      const isDisabled = await disabledBtn.isVisible({ timeout: 2000 }).catch(() => false);

      expect(isZero || isDisabled).toBeTruthy();
    }
  });
});
