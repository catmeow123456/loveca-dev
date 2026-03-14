/**
 * 游戏测试 Fixture
 * 提供 Page Object 模式的游戏页面封装
 */

import { test as base, Page, Locator, expect } from '@playwright/test';

/**
 * 游戏页面对象
 * 封装常用的定位器和操作方法
 */
export class GamePage {
  readonly page: Page;

  // 面板定位器
  readonly mulliganPanel: Locator;
  readonly judgmentPanel: Locator;
  readonly scorePanel: Locator;
  readonly effectWindow: Locator;
  readonly debugControl: Locator;

  // 阶段指示器
  readonly phaseIndicator: Locator;

  // 游戏日志
  readonly gameLog: Locator;

  // 成员槽位
  readonly slotLeft: Locator;
  readonly slotCenter: Locator;
  readonly slotRight: Locator;

  // Live 区域
  readonly liveZone: Locator;
  readonly successZone: Locator;

  // 能量区域
  readonly energyZone: Locator;

  // 卡组区域
  readonly mainDeck: Locator;
  readonly energyDeck: Locator;

  // 休息室
  readonly waitingRoom: Locator;

  // 手牌区域
  readonly handArea: Locator;

  constructor(page: Page) {
    this.page = page;

    // 面板定位器 - 基于标题文本定位
    this.mulliganPanel = page.locator('.fixed').filter({ hasText: '换牌阶段' });
    this.judgmentPanel = page.locator('.fixed').filter({ hasText: 'Live 判定确认' });
    this.scorePanel = page.locator('.fixed').filter({ hasText: 'Live 分数确认' });
    this.effectWindow = page.locator('.fixed').filter({ hasText: '效果发动' });
    this.debugControl = page.locator('text=调试模式').locator('..');

    // 阶段指示器
    this.phaseIndicator = page.locator('[class*="phase"]').first();

    // 游戏日志
    this.gameLog = page.locator('.overflow-y-auto').filter({ hasText: '游戏日志' });

    // 成员槽位 - 使用 DroppableZone 的 id（取最后一个匹配的，即己方槽位，因为对手区域在 DOM 中先渲染）
    this.slotLeft = page.locator('[id="slot-LEFT"]').last();
    this.slotCenter = page.locator('[id="slot-CENTER"]').last();
    this.slotRight = page.locator('[id="slot-RIGHT"]').last();

    // Live 区域
    this.liveZone = page.locator('[id="live-zone"]');
    this.successZone = page.locator('[id="success-zone"]');

    // 能量区域
    this.energyZone = page.locator('[id="energy-zone"]');

    // 卡组区域
    this.mainDeck = page.locator('[id="main-deck"]').last();
    this.energyDeck = page.locator('[id="energy-deck"]').last();

    // 休息室
    this.waitingRoom = page.locator('[id="waiting-room"]').last();

    // 手牌区域 - 己方手牌区内的可拖拽卡牌
    this.handArea = page.locator('[id="hand"] .cursor-grab');
  }

  /**
   * 导航到主页
   */
  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  /**
   * 等待游戏主板加载完成
   * 通过检测 "VS" 分隔线判断
   */
  async waitForGameBoard(): Promise<void> {
    await this.page.locator('text=VS').waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * 等待指定阶段出现
   * @param phaseName 阶段名称，如 "换牌阶段"、"主要阶段"
   */
  async waitForPhase(phaseName: string): Promise<void> {
    await this.page.locator(`text=${phaseName}`).first().waitFor({
      state: 'visible',
      timeout: 15000,
    });
  }

  /**
   * 等待换牌面板出现
   */
  async waitForMulliganPanel(): Promise<void> {
    await this.page.locator('text=换牌阶段').first().waitFor({
      state: 'visible',
      timeout: 10000,
    });
  }

  /**
   * 获取手牌中的所有可拖拽卡牌
   */
  async getHandCards(): Promise<Locator[]> {
    return await this.handArea.all();
  }

  /**
   * 获取手牌数量
   */
  async getHandCardCount(): Promise<number> {
    return await this.handArea.count();
  }

  /**
   * 点击调试视角切换按钮
   */
  async switchView(): Promise<void> {
    const switchBtn = this.page.locator('button').filter({ hasText: '切换至' });
    if (await switchBtn.isVisible({ timeout: 2000 })) {
      await switchBtn.click();
      // 等待视角切换完成
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * 点击"不换牌"按钮
   */
  async clickSkipMulligan(): Promise<void> {
    await this.page.locator('button').filter({ hasText: '不换牌' }).click();
  }

  /**
   * 点击"确认换牌"按钮
   */
  async clickConfirmMulligan(): Promise<void> {
    await this.page.locator('button').filter({ hasText: '确认换牌' }).click();
  }

  /**
   * 点击"结束阶段"按钮（实际文本是 "Live Start!"）
   */
  async clickEndPhase(): Promise<void> {
    await this.page.locator('button').filter({ hasText: 'Live Start' }).click();
  }

  /**
   * 点击判定确认按钮
   */
  async clickConfirmJudgment(): Promise<void> {
    await this.page.locator('button').filter({ hasText: '确认判定' }).click();
  }

  /**
   * 点击分数确认按钮
   */
  async clickConfirmScore(): Promise<void> {
    await this.page.locator('button').filter({ hasText: '确认分数' }).click();
  }

  /**
   * 检查是否在换牌阶段
   */
  async isInMulliganPhase(): Promise<boolean> {
    return await this.page.locator('text=换牌阶段').isVisible({ timeout: 2000 });
  }

  /**
   * 检查是否在主要阶段
   */
  async isInMainPhase(): Promise<boolean> {
    return await this.page.locator('text=主要阶段').isVisible({ timeout: 2000 });
  }

  /**
   * 检查某个槽位是否有卡牌
   * @param slot 槽位位置 LEFT | CENTER | RIGHT
   */
  async hasCardInSlot(slot: 'LEFT' | 'CENTER' | 'RIGHT'): Promise<boolean> {
    const slotLocator = this.page.locator(`[id="slot-${slot}"]`);
    const cardCount = await slotLocator.locator('img').count();
    return cardCount > 0;
  }

  /**
   * 获取区域内的卡牌数量
   * @param zoneId 区域 ID
   */
  async getCardCountInZone(zoneId: string): Promise<number> {
    const zone = this.page.locator(`[id="${zoneId}"]`).last();
    return await zone.locator('img').count();
  }

  /**
   * 获取区域内的可拖拽卡牌
   * @param zoneId 区域 ID
   */
  async getDraggableCardsInZone(zoneId: string): Promise<Locator[]> {
    const zone = this.page.locator(`[id="${zoneId}"]`).last();
    return await zone.locator('.cursor-grab').all();
  }

  /**
   * 获取休息室内的卡牌数量
   */
  async getWaitingRoomCardCount(): Promise<number> {
    return await this.getCardCountInZone('waiting-room');
  }

  /**
   * 获取 Live 区的卡牌数量
   */
  async getLiveZoneCardCount(): Promise<number> {
    return await this.getCardCountInZone('live-zone');
  }

  /**
   * 获取能量区的卡牌数量
   */
  async getEnergyZoneCardCount(): Promise<number> {
    return await this.getCardCountInZone('energy-zone');
  }

  /**
   * 获取成功 Live 区的卡牌数量
   */
  async getSuccessLiveCount(): Promise<number> {
    // 成功区域通常有特定的样式或位置
    const successCards = this.page.locator('[data-zone="success"] img, .success-zone img');
    return await successCards.count();
  }

  /**
   * 等待动画完成
   * @param ms 等待毫秒数，默认 500ms
   */
  async waitForAnimation(ms: number = 500): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
}

/**
 * 扩展的测试 fixture
 * 自动注入 gamePage 实例
 */
export const test = base.extend<{ gamePage: GamePage }>({
  gamePage: async ({ page }, use) => {
    const gamePage = new GamePage(page);
    await use(gamePage);
  },
});

// 导出 expect 以便测试文件使用
export { expect };
