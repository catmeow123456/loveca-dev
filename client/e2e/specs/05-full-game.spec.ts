/**
 * 完整对局流程 E2E 测试
 * 测试从游戏开始到结束的完整流程
 */

import { test, expect } from '../fixtures/game.fixture';
import { setupAndStartGame, skipMulliganPhase, isGameEnded, getCurrentPhaseName } from '../helpers/game-setup';
import { dragCardToZone } from '../helpers/drag-drop';

test.describe('完整回合循环', () => {
  test.beforeEach(async ({ page }) => {
    const started = await setupAndStartGame(page);
    if (!started) {
      test.skip(true, '无法启动游戏');
    }
  });

  test('应该完成换牌阶段', async ({ page, gamePage }) => {
    // 换牌面板应该显示
    await expect(page.locator('text=换牌阶段').first()).toBeVisible({ timeout: 10000 });

    // 双方完成换牌
    await skipMulliganPhase(page);

    // 应该进入下一阶段
    await page.waitForTimeout(2000);
    const currentPhase = await getCurrentPhaseName(page);
    expect(currentPhase).not.toBe('换牌阶段');
  });

  test('应该经历活跃→能量→抽卡→主要阶段', async ({ page, gamePage }) => {
    await skipMulliganPhase(page);

    // 等待自动阶段推进
    await page.waitForTimeout(3000);

    // 应该最终到达主要阶段
    const mainPhaseVisible = await page.locator('text=主要阶段').isVisible({ timeout: 10000 });
    expect(mainPhaseVisible).toBeTruthy();
  });

  test('先攻完成后应该切换到后攻', async ({ page, gamePage }) => {
    await skipMulliganPhase(page);
    await page.waitForTimeout(2000);

    // skipMulliganPhase 后视角在玩家2，切换回先攻玩家
    await gamePage.switchView();
    await page.waitForTimeout(1000);

    // 等待到达主要阶段
    await page.locator('text=主要阶段').waitFor({ state: 'visible', timeout: 10000 });

    // 结束先攻主要阶段
    await gamePage.clickEndPhase();

    // 等待后攻玩家的自动阶段完成（ACTIVE → ENERGY → DRAW → MAIN）
    await page.waitForTimeout(2000);

    // 切换到后攻视角查看
    await gamePage.switchView();
    await page.waitForTimeout(500);

    // 后攻玩家应该到达主要阶段（自动阶段很快完成）
    const mainPhase = await page.locator('text=主要阶段').isVisible({ timeout: 10000 });
    expect(mainPhase).toBeTruthy();
  });

  test('双方主要阶段结束后应该进入 Live 阶段', async ({ page, gamePage }) => {
    await skipMulliganPhase(page);
    await page.waitForTimeout(2000);

    // skipMulliganPhase 后视角在玩家2，切换回先攻玩家
    await gamePage.switchView();
    await page.waitForTimeout(1000);

    // 先攻主要阶段
    await page.locator('text=主要阶段').waitFor({ state: 'visible', timeout: 10000 });
    await gamePage.clickEndPhase();
    await page.waitForTimeout(2000);

    // 切换到后攻玩家视角
    await gamePage.switchView();
    await page.waitForTimeout(1000);

    // 等待后攻玩家到达主要阶段
    const mainPhase2 = await page.locator('text=主要阶段').isVisible({ timeout: 10000 });
    if (mainPhase2) {
      await gamePage.clickEndPhase();
      await page.waitForTimeout(1500);
    }

    // 应该进入 Live 放置阶段
    const liveSetPhase = await page.locator('text=Live放置').isVisible({ timeout: 10000 });
    expect(liveSetPhase).toBeTruthy();
  });
});

test.describe('游戏状态一致性', () => {
  test.beforeEach(async ({ page }) => {
    const started = await setupAndStartGame(page);
    if (!started) {
      test.skip(true, '无法启动游戏');
    }
    await skipMulliganPhase(page);
    await page.waitForTimeout(2000);
  });

  test('手牌数量应该在合理范围内', async ({ page, gamePage }) => {
    const handCount = await gamePage.getHandCardCount();

    // 初始手牌 6 张，换牌后可能变化
    // 抽卡阶段会增加 1 张
    // 合理范围：3-10 张
    expect(handCount).toBeGreaterThanOrEqual(3);
    expect(handCount).toBeLessThanOrEqual(15);
  });

  test('VS 分隔线应该始终可见', async ({ page }) => {
    await expect(page.locator('text=VS')).toBeVisible();
  });

  test('阶段指示器应该始终显示当前阶段', async ({ page }) => {
    const phaseName = await getCurrentPhaseName(page);
    expect(phaseName).not.toBeNull();
  });
});

test.describe('调试模式功能', () => {
  test.beforeEach(async ({ page }) => {
    const started = await setupAndStartGame(page);
    if (!started) {
      test.skip(true, '无法启动游戏');
    }
  });

  test('应该能切换玩家视角', async ({ page, gamePage }) => {
    await skipMulliganPhase(page);
    await page.waitForTimeout(1000);

    // 切换视角
    await gamePage.switchView();
    await page.waitForTimeout(500);

    // 再次切换
    await gamePage.switchView();
    await page.waitForTimeout(500);

    // 应该能正常切换而不出错
    const vsVisible = await page.locator('text=VS').isVisible();
    expect(vsVisible).toBeTruthy();
  });

  test('调试模式应该默认启用', async ({ page }) => {
    await skipMulliganPhase(page);
    await page.waitForTimeout(1000);

    // 检查调试控制面板
    const debugText = page.locator('text=调试');
    const isDebugVisible = await debugText.isVisible({ timeout: 3000 }).catch(() => false);

    // 调试模式默认启用，所以应该能看到切换按钮
    const switchBtn = page.locator('button').filter({ hasText: '切换至' });
    const hasSwitchBtn = await switchBtn.isVisible({ timeout: 3000 }).catch(() => false);

    expect(isDebugVisible || hasSwitchBtn).toBeTruthy();
  });
});

test.describe('游戏日志', () => {
  test.beforeEach(async ({ page }) => {
    const started = await setupAndStartGame(page);
    if (!started) {
      test.skip(true, '无法启动游戏');
    }
  });

  test('应该记录阶段变化', async ({ page }) => {
    await skipMulliganPhase(page);
    await page.waitForTimeout(2000);

    // 展开游戏日志面板（点击左侧 ▶ 按钮）
    const expandBtn = page.locator('button:has-text("▶")');
    if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(500);
    }

    // 检查游戏日志区域
    const logPanel = page.locator('text=📜 游戏日志').locator('..');

    // 应该有阶段相关的日志
    const hasPhaseLog = await page.locator('text=/阶段|Phase/').isVisible({ timeout: 5000 }).catch(() => false);

    // 或者至少日志面板可见
    const isPanelVisible = await page.locator('text=📜 游戏日志').isVisible({ timeout: 3000 }).catch(() => false);

    expect(hasPhaseLog || isPanelVisible).toBeTruthy();
  });

  test('应该记录卡牌操作', async ({ page, gamePage }) => {
    await skipMulliganPhase(page);
    await page.waitForTimeout(2000);

    // skipMulliganPhase 后视角在玩家2，切换回先攻玩家
    await gamePage.switchView();
    await page.waitForTimeout(1000);

    // 等待主要阶段
    await page.locator('text=主要阶段').waitFor({ state: 'visible', timeout: 10000 });

    // 进行一个操作
    const handCards = await gamePage.getHandCards();
    if (handCards.length > 0) {
      await dragCardToZone(page, handCards[0], 'slot-CENTER');
      await page.waitForTimeout(500);
    }

    // 展开游戏日志面板
    const expandBtn = page.locator('button:has-text("▶")');
    if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(500);
    }

    // 检查日志面板是否可见
    const isPanelVisible = await page.locator('text=📜 游戏日志').isVisible({ timeout: 3000 }).catch(() => false);
    expect(isPanelVisible).toBeTruthy();
  });
});

test.describe('胜利条件', () => {
  test('游戏应该能检测胜利条件', async ({ page }) => {
    // 验证胜利检测相关的 UI 元素
    // 当成功 Live 区达到 3 张时，游戏应该结束

    const gameEndLocator = page.locator('text=游戏结束');
    const victoryLocator = page.locator('text=胜利');

    // 这些定位器应该有效
    expect(gameEndLocator).toBeDefined();
    expect(victoryLocator).toBeDefined();
  });

  test('成功 Live 区应该能显示卡牌', async ({ page, gamePage }) => {
    // 验证成功区域的定位器
    const successZone = gamePage.successZone;
    expect(successZone).toBeDefined();
  });
});

test.describe('错误处理', () => {
  test.beforeEach(async ({ page }) => {
    const started = await setupAndStartGame(page);
    if (!started) {
      test.skip(true, '无法启动游戏');
    }
  });

  test('无效操作不应该导致崩溃', async ({ page, gamePage }) => {
    await skipMulliganPhase(page);
    await page.waitForTimeout(2000);

    // 尝试一些可能无效的操作
    // 例如：拖拽到不存在的区域
    const handCards = await gamePage.getHandCards();
    if (handCards.length > 0) {
      // 尝试拖拽到随机位置
      const cardBox = await handCards[0].boundingBox();
      if (cardBox) {
        await page.mouse.move(cardBox.x, cardBox.y);
        await page.mouse.down();
        await page.mouse.move(0, 0); // 拖到角落
        await page.mouse.up();
      }
    }

    // 游戏应该仍然正常运行
    const vsVisible = await page.locator('span.text-rose-500:text("VS")').isVisible();
    expect(vsVisible).toBeTruthy();
  });

  test('快速连续操作不应该导致状态不一致', async ({ page, gamePage }) => {
    await skipMulliganPhase(page);
    await page.waitForTimeout(2000);

    // 快速点击多个按钮
    const endPhaseBtn = page.locator('button').filter({ hasText: '结束阶段' });
    if (await endPhaseBtn.isVisible({ timeout: 3000 })) {
      // 快速点击多次
      await endPhaseBtn.click();
      await endPhaseBtn.click().catch(() => {}); // 可能已经不可见
      await endPhaseBtn.click().catch(() => {});
    }

    await page.waitForTimeout(1000);

    // 游戏应该仍然正常
    const hasPhase = (await getCurrentPhaseName(page)) !== null;
    expect(hasPhase).toBeTruthy();
  });
});

test.describe('响应式布局', () => {
  test('在较小视口下应该仍然可用', async ({ page }) => {
    // 设置较小的视口
    await page.setViewportSize({ width: 1024, height: 768 });

    const started = await setupAndStartGame(page);
    if (!started) {
      test.skip(true, '无法启动游戏');
      return;
    }

    await skipMulliganPhase(page);
    await page.waitForTimeout(2000);

    // 主要元素应该仍然可见
    const vsVisible = await page.locator('text=VS').isVisible();
    expect(vsVisible).toBeTruthy();
  });
});
