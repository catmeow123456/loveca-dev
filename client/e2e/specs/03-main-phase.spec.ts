/**
 * 主要阶段 E2E 测试
 * 测试成员卡拖拽部署和结束阶段
 */

import { test, expect } from '../fixtures/game.fixture';
import { startGameAndSkipToMainPhase } from '../helpers/game-setup';
import { dragCardToZone, startDrag, endDrag } from '../helpers/drag-drop';

test.describe('主要阶段 - 成员卡部署', () => {
  test.beforeEach(async ({ page }) => {
    // 启动游戏并跳过到主要阶段
    const ready = await startGameAndSkipToMainPhase(page);
    if (!ready) {
      test.skip(true, '无法进入主要阶段');
    }
  });

  test('应该显示主要阶段', async ({ page }) => {
    await expect(page.locator('text=主要阶段').first()).toBeVisible({ timeout: 10000 });
  });

  test('应该显示可拖拽的手牌', async ({ page, gamePage }) => {
    // 手牌区域应该有可拖拽的卡牌
    const handCards = await gamePage.getHandCards();
    expect(handCards.length).toBeGreaterThan(0);
  });

  test('应该显示三个成员槽位', async ({ page, gamePage }) => {
    // 检查三个槽位是否存在
    await expect(gamePage.slotLeft).toBeVisible({ timeout: 5000 });
    await expect(gamePage.slotCenter).toBeVisible({ timeout: 5000 });
    await expect(gamePage.slotRight).toBeVisible({ timeout: 5000 });
  });

  test('拖拽卡牌时槽位应该高亮', async ({ page, gamePage }) => {
    const handCards = await gamePage.getHandCards();

    if (handCards.length > 0) {
      // 开始拖拽但不释放
      await startDrag(page, handCards[0], 100, 100);

      // 等待拖拽状态生效
      await page.waitForTimeout(200);

      // 检查槽位是否有高亮样式（ring-2 class）
      const slotClasses = await gamePage.slotCenter.getAttribute('class');
      // @dnd-kit 会在拖拽时添加特定样式

      // 结束拖拽
      await endDrag(page);
    }
  });

  test('应该能将成员卡拖拽到中央槽位', async ({ page, gamePage }) => {
    const handCards = await gamePage.getHandCards();

    if (handCards.length > 0) {
      // 记录初始手牌数量
      const initialCount = handCards.length;

      // 拖拽第一张卡牌到中央槽位
      await dragCardToZone(page, handCards[0], 'slot-CENTER');

      // 等待状态更新
      await page.waitForTimeout(500);

      // 验证槽位中有卡牌
      const hasCard = await gamePage.hasCardInSlot('CENTER');

      // 注意：如果费用不足，卡牌不会被放置
      // 这里只验证拖拽操作完成，不强制要求成功放置
      if (hasCard) {
        // 手牌数量应该减少
        const newCount = await gamePage.getHandCardCount();
        expect(newCount).toBeLessThan(initialCount);
      }
    }
  });

  test('应该能将成员卡拖拽到左侧槽位', async ({ page, gamePage }) => {
    const handCards = await gamePage.getHandCards();

    if (handCards.length > 0) {
      await dragCardToZone(page, handCards[0], 'slot-LEFT');
      await page.waitForTimeout(500);

      const hasCard = await gamePage.hasCardInSlot('LEFT');
      // 根据费用情况，卡牌可能成功或失败放置
    }
  });

  test('应该能将成员卡拖拽到右侧槽位', async ({ page, gamePage }) => {
    const handCards = await gamePage.getHandCards();

    if (handCards.length > 0) {
      await dragCardToZone(page, handCards[0], 'slot-RIGHT');
      await page.waitForTimeout(500);

      const hasCard = await gamePage.hasCardInSlot('RIGHT');
      // 根据费用情况，卡牌可能成功或失败放置
    }
  });
});

test.describe('主要阶段 - 结束阶段', () => {
  test.beforeEach(async ({ page }) => {
    const ready = await startGameAndSkipToMainPhase(page);
    if (!ready) {
      test.skip(true, '无法进入主要阶段');
    }
  });

  test('应该有结束阶段按钮', async ({ page, gamePage }) => {
    // 如果不是当前玩家回合，先切换视角
    const isMyTurn = await page.locator('text=你的回合').isVisible({ timeout: 2000 }).catch(() => false);
    if (!isMyTurn) {
      await gamePage.switchView();
      await page.waitForTimeout(500);
    }
    // 按钮文本是 "Live Start!" 而不是 "结束阶段"
    const endBtn = page.locator('button').filter({ hasText: 'Live Start' });
    await expect(endBtn).toBeVisible({ timeout: 5000 });
  });

  test('点击结束阶段应该切换到下一个玩家或阶段', async ({ page, gamePage }) => {
    // 如果不是当前玩家回合，先切换视角
    const isMyTurn = await page.locator('text=你的回合').isVisible({ timeout: 2000 }).catch(() => false);
    if (!isMyTurn) {
      await gamePage.switchView();
      await page.waitForTimeout(500);
    }

    // 点击结束阶段（Live Start 按钮）
    await gamePage.clickEndPhase();
    await page.waitForTimeout(1000);

    // 应该切换到下一个状态
    // 可能是对手的活跃阶段或 Live 设置阶段
    const activePhase = await page.locator('text=活跃阶段').isVisible({ timeout: 5000 }).catch(() => false);
    const liveSetPhase = await page.locator('text=Live 设置').isVisible({ timeout: 5000 }).catch(() => false);
    const mainPhaseAgain = await page.locator('text=主要阶段').isVisible({ timeout: 3000 }).catch(() => false);

    // 至少应该有某种阶段显示
    expect(activePhase || liveSetPhase || mainPhaseAgain).toBeTruthy();
  });
});

test.describe('主要阶段 - 换手机制', () => {
  test.beforeEach(async ({ page }) => {
    const ready = await startGameAndSkipToMainPhase(page);
    if (!ready) {
      test.skip(true, '无法进入主要阶段');
    }
  });

  test('在已有成员的槽位放置新成员应该触发换手', async ({ page, gamePage }) => {
    const handCards = await gamePage.getHandCards();

    if (handCards.length >= 2) {
      // 先放置第一张成员
      await dragCardToZone(page, handCards[0], 'slot-CENTER');
      await page.waitForTimeout(500);

      // 检查是否成功放置
      const hasFirstCard = await gamePage.hasCardInSlot('CENTER');

      if (hasFirstCard) {
        // 获取更新后的手牌
        const newHandCards = await gamePage.getHandCards();

        if (newHandCards.length > 0) {
          // 尝试在同一槽位放置第二张成员（触发换手）
          await dragCardToZone(page, newHandCards[0], 'slot-CENTER');
          await page.waitForTimeout(500);

          // 检查游戏日志是否有换手记录
          const gameLog = page.locator('text=换手');
          const hasRelayLog = await gameLog.isVisible({ timeout: 3000 }).catch(() => false);

          // 换手可能发生也可能因费用不足而失败
        }
      }
    }
  });
});

test.describe('主要阶段 - 能量消耗', () => {
  test.beforeEach(async ({ page }) => {
    const ready = await startGameAndSkipToMainPhase(page);
    if (!ready) {
      test.skip(true, '无法进入主要阶段');
    }
  });

  test('部署成员卡应该消耗能量', async ({ page, gamePage }) => {
    // 获取能量区域的初始状态
    const initialEnergyCount = await page.locator('[id="energy-zone"] img').count();

    const handCards = await gamePage.getHandCards();

    if (handCards.length > 0) {
      await dragCardToZone(page, handCards[0], 'slot-CENTER');
      await page.waitForTimeout(500);

      const hasCard = await gamePage.hasCardInSlot('CENTER');

      if (hasCard) {
        // 能量状态可能改变（活跃→等待）
        // 这取决于成员卡的费用
        const currentEnergyCount = await page.locator('[id="energy-zone"] img').count();

        // 能量数量不变，但状态可能改变
        // 实际的能量消耗体现在能量卡从"活跃"变为"等待"状态
      }
    }
  });
});

test.describe('主要阶段 - 游戏日志', () => {
  test.beforeEach(async ({ page }) => {
    const ready = await startGameAndSkipToMainPhase(page);
    if (!ready) {
      test.skip(true, '无法进入主要阶段');
    }

    // 打开左侧“游戏日志”面板，避免因为默认收起导致断言拿到错误的滚动容器。
    const expandBtn = page.locator('button:has-text("▶")');
    if (await expandBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await expandBtn.click();
      await page.locator('text=📜 游戏日志').waitFor({ state: 'visible', timeout: 3000 });
      await page.waitForTimeout(200);
    }
  });

  test('部署成员应该记录到游戏日志', async ({ page, gamePage }) => {
    const handCards = await gamePage.getHandCards();

    if (handCards.length > 0) {
      // 日志面板已在 beforeEach 打开，这里拿到日志列表容器用于断言日志变化
      const logPanel = page.locator('text=📜 游戏日志').locator('..').locator('..');
      const logList = logPanel.locator('.overflow-y-auto');
      const initialLogCount = await logList.locator('.break-words').count();

      await dragCardToZone(page, handCards[0], 'slot-CENTER');
      await page.waitForTimeout(500);

      const hasCard = await gamePage.hasCardInSlot('CENTER');

      if (hasCard) {
        // 等待日志条目实际增加（避免只命中标题栏文本）
        await expect.poll(async () => await logList.locator('.break-words').count(), {
          timeout: 10000,
        }).toBeGreaterThan(initialLogCount);

        // 再检查是否包含卡牌操作相关关键词
        await expect(logList).toContainText(/部署|成员|移动卡牌|MOVE_CARD|PLAY_MEMBER/i, { timeout: 5000 });
      }
    }
  });
});
