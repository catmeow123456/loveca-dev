/**
 * 游戏初始化辅助函数
 * 提供快速启动游戏、跳过阶段等常用操作
 */

import { Page } from '@playwright/test';
import { injectTestDecksToStore } from '../fixtures/mock-data';

/**
 * 处理登录/离线模式
 * 如果出现登录页面，选择离线模式
 */
export async function handleAuth(page: Page): Promise<void> {
  // 等待页面内容加载完成（找 Loveca 文字表示 App 已渲染）
  await page.locator('text=Loveca').first().waitFor({ state: 'visible', timeout: 10000 });

  // 检查是否有离线模式按钮（在登录页面）
  const offlineBtn = page.locator('button').filter({ hasText: '离线模式' });
  const isVisible = await offlineBtn.isVisible({ timeout: 3000 }).catch(() => false);

  if (isVisible) {
    await offlineBtn.click();
    // 等待导航完成 - 主页应该出现"开始游戏"按钮或"卡组管理"
    await page.locator('button:has-text("开始游戏"), button:has-text("卡组管理")').first().waitFor({
      state: 'visible',
      timeout: 10000
    });
  }
}

/**
 * 导航到主页并处理认证
 * @param useMock 是否使用 mock 数据（默认 true）
 */
export async function gotoHome(page: Page, useMock: boolean = true): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
  await handleAuth(page);

  // 确保主页完全加载 - 等待"欢迎回来"文字出现
  await page.locator('text=欢迎回来').first().waitFor({ state: 'visible', timeout: 10000 });

  // 注入测试数据（在页面加载后）
  if (useMock) {
    const injected = await injectTestDecksToStore(page);
    if (!injected) {
      console.warn('无法注入测试卡组数据，store 可能未暴露');
    }
  }
}

/**
 * 点击"开始游戏"按钮
 * 主页上的按钮结构：button > div > h3 "开始游戏"
 */
export async function clickStartGame(page: Page): Promise<void> {
  // 使用 getByRole 或 text 定位器，等待按钮可见
  const startGameBtn = page.locator('button').filter({ hasText: '开始游戏' }).first();
  await startGameBtn.waitFor({ state: 'visible', timeout: 10000 });
  await startGameBtn.click({ force: true });
  // 等待游戏准备页面出现
  await page.locator('text=游戏准备').first().waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * 选择第一个有效卡组
 * @returns 是否成功选择
 */
export async function selectFirstValidDeck(page: Page): Promise<boolean> {
  // 等待卡组列表区域加载
  const deckList = page.locator('.grid.gap-3');
  await deckList.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

  // 等待动画完成
  await page.waitForTimeout(500);

  // 查找带有 "✓ 有效" 标记的卡组按钮
  // 卡组按钮结构：button > div > span "✓ 有效"
  const validDeckBtn = page.locator('button:has(span:has-text("✓ 有效"))').first();
  const isVisible = await validDeckBtn.isVisible({ timeout: 5000 }).catch(() => false);

  if (isVisible) {
    await validDeckBtn.click();
    return true;
  }

  // 如果没有有效卡组，尝试选择任意卡组按钮
  const anyDeckBtn = page.locator('.grid.gap-3 button').first();
  const anyVisible = await anyDeckBtn.isVisible({ timeout: 3000 }).catch(() => false);

  if (anyVisible) {
    await anyDeckBtn.click();
    return true;
  }

  // 检查是否显示空状态
  const emptyState = page.locator('text=没有可用的卡组');
  if (await emptyState.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.warn('卡组列表为空，请先创建有效卡组');
  }

  return false;
}

/**
 * 点击"下一步"按钮
 */
export async function clickNext(page: Page): Promise<void> {
  const nextBtn = page.locator('button').filter({ hasText: '下一步' });
  await nextBtn.waitFor({ state: 'visible', timeout: 5000 });
  await nextBtn.click();
  // 等待下一步的页面加载（Step 指示器更新）
  await page.waitForTimeout(300);
}

/**
 * 点击"开始游戏！"确认按钮
 */
export async function clickStartGameConfirm(page: Page): Promise<void> {
  // 等待 Step 3 的确认按钮出现 - 按钮文本是 "开始游戏！"
  const startBtn = page.locator('button').filter({ hasText: '开始游戏！' });
  await startBtn.waitFor({ state: 'visible', timeout: 10000 });
  await startBtn.click();
  await page.waitForTimeout(1000);
}

/**
 * 完整的游戏设置流程
 * 从主页开始，选择卡组并启动游戏
 */
export async function setupAndStartGame(page: Page): Promise<boolean> {
  try {
    // 1. 导航到主页
    await gotoHome(page);

    // 2. 点击开始游戏
    await clickStartGame(page);

    // 3. 选择玩家1卡组
    const p1Selected = await selectFirstValidDeck(page);
    if (!p1Selected) {
      console.warn('无法选择玩家1卡组');
      return false;
    }
    await clickNext(page);

    // 4. 选择玩家2卡组
    const p2Selected = await selectFirstValidDeck(page);
    if (!p2Selected) {
      console.warn('无法选择玩家2卡组');
      return false;
    }
    await clickNext(page);

    // 5. 确认并开始游戏
    await clickStartGameConfirm(page);

    // 6. 等待游戏界面加载 - 等待 VS 分隔线出现
    await page.locator('text=VS').waitFor({ state: 'visible', timeout: 15000 });

    return true;
  } catch (error) {
    console.error('游戏设置失败:', error);
    return false;
  }
}

/**
 * 快速跳过换牌阶段（双方都不换牌）
 */
export async function skipMulliganPhase(page: Page): Promise<void> {
  // 等待换牌面板
  await page.locator('text=换牌阶段').first().waitFor({ state: 'visible', timeout: 10000 });

  // 玩家1 不换牌
  const skipBtn1 = page.locator('button').filter({ hasText: '不换牌' });
  if (await skipBtn1.isVisible({ timeout: 3000 })) {
    await skipBtn1.click();
    await page.waitForTimeout(500);
  }

  // 切换视角（如果需要）
  const switchBtn = page.locator('button').filter({ hasText: '切换至' });
  if (await switchBtn.isVisible({ timeout: 2000 })) {
    await switchBtn.click();
    await page.waitForTimeout(500);
  }

  // 玩家2 不换牌
  const skipBtn2 = page.locator('button').filter({ hasText: '不换牌' });
  if (await skipBtn2.isVisible({ timeout: 3000 })) {
    await skipBtn2.click();
    await page.waitForTimeout(500);
  }
}

/**
 * 开始游戏并跳过到主要阶段
 * 包括：设置游戏 → 跳过换牌 → 等待自动推进到主要阶段
 */
export async function startGameAndSkipToMainPhase(page: Page): Promise<boolean> {
  const started = await setupAndStartGame(page);
  if (!started) return false;

  await skipMulliganPhase(page);

  // 等待自动推进完成（活跃→能量→抽卡→主要）
  await page.waitForTimeout(2000);

  // 验证是否到达主要阶段
  const isMainPhase = await page.locator('text=主要阶段').isVisible({ timeout: 10000 });
  return isMainPhase;
}

/**
 * 等待指定阶段出现
 */
export async function waitForPhase(page: Page, phaseName: string, timeout: number = 15000): Promise<void> {
  await page.locator(`text=${phaseName}`).first().waitFor({
    state: 'visible',
    timeout,
  });
}

/**
 * 检查游戏是否已结束
 */
export async function isGameEnded(page: Page): Promise<boolean> {
  return await page.locator('text=游戏结束').isVisible({ timeout: 2000 }).catch(() => false);
}

/**
 * 获取当前阶段名称
 */
export async function getCurrentPhaseName(page: Page): Promise<string | null> {
  const phaseTexts = ['换牌阶段', '活跃阶段', '能量阶段', '抽卡阶段', '主要阶段', 'Live 设置', '演出阶段', '胜败判定', '游戏结束'];

  for (const text of phaseTexts) {
    if (await page.locator(`text=${text}`).isVisible({ timeout: 1000 }).catch(() => false)) {
      return text;
    }
  }

  return null;
}
