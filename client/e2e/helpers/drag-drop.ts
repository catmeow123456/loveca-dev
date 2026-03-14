/**
 * @dnd-kit 拖拽模拟辅助函数
 * 提供在 Playwright 中模拟拖拽操作的方法
 */

import { Page, Locator } from '@playwright/test';

/**
 * 拖拽选项
 */
export interface DragOptions {
  /** 移动步数，越多越平滑，默认 10 */
  steps?: number;
  /** 每步之间的延迟（毫秒），默认 16 (约 60fps) */
  stepDelay?: number;
  /** 拖拽前的延迟（毫秒），默认 100 */
  startDelay?: number;
  /** 释放后的延迟（毫秒），默认 100 */
  endDelay?: number;
}

const DEFAULT_OPTIONS: Required<DragOptions> = {
  steps: 10,
  stepDelay: 16,
  startDelay: 100,
  endDelay: 100,
};

/**
 * 将卡牌拖拽到指定区域
 * 模拟 @dnd-kit 的拖拽行为
 *
 * @param page Playwright Page 对象
 * @param cardLocator 卡牌的定位器
 * @param targetZoneId 目标区域的 ID（如 "slot-CENTER", "live-zone"）
 * @param options 拖拽选项
 */
export async function dragCardToZone(
  page: Page,
  cardLocator: Locator,
  targetZoneId: string,
  options: DragOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  // 使用 .last() 因为对手的槽位在 DOM 中先渲染，己方槽位后渲染
  const targetZone = page.locator(`[id="${targetZoneId}"]`).last();

  // 获取元素边界框
  const cardBox = await cardLocator.boundingBox();
  const targetBox = await targetZone.boundingBox();

  if (!cardBox) {
    throw new Error(`无法获取卡牌元素的边界框`);
  }
  if (!targetBox) {
    throw new Error(`无法获取目标区域 "${targetZoneId}" 的边界框`);
  }

  // 计算中心点
  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  // 移动到起始位置
  await page.mouse.move(startX, startY);
  await page.waitForTimeout(opts.startDelay);

  // 按下鼠标
  await page.mouse.down();

  // 分步移动以触发 @dnd-kit 的拖拽检测
  for (let i = 1; i <= opts.steps; i++) {
    const ratio = i / opts.steps;
    const currentX = startX + (endX - startX) * ratio;
    const currentY = startY + (endY - startY) * ratio;
    await page.mouse.move(currentX, currentY);
    await page.waitForTimeout(opts.stepDelay);
  }

  // 释放鼠标
  await page.mouse.up();

  // 等待状态更新
  await page.waitForTimeout(opts.endDelay);
}

/**
 * 将卡牌拖拽到指定定位器位置
 *
 * @param page Playwright Page 对象
 * @param cardLocator 卡牌的定位器
 * @param targetLocator 目标位置的定位器
 * @param options 拖拽选项
 */
export async function dragCardToLocator(
  page: Page,
  cardLocator: Locator,
  targetLocator: Locator,
  options: DragOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const cardBox = await cardLocator.boundingBox();
  const targetBox = await targetLocator.boundingBox();

  if (!cardBox || !targetBox) {
    throw new Error('无法获取元素的边界框');
  }

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.waitForTimeout(opts.startDelay);
  await page.mouse.down();

  for (let i = 1; i <= opts.steps; i++) {
    const ratio = i / opts.steps;
    await page.mouse.move(startX + (endX - startX) * ratio, startY + (endY - startY) * ratio);
    await page.waitForTimeout(opts.stepDelay);
  }

  await page.mouse.up();
  await page.waitForTimeout(opts.endDelay);
}

/**
 * 开始拖拽但不释放（用于测试拖拽过程中的 UI 状态）
 *
 * @param page Playwright Page 对象
 * @param cardLocator 卡牌的定位器
 * @param offsetX 相对于起始位置的 X 偏移
 * @param offsetY 相对于起始位置的 Y 偏移
 */
export async function startDrag(
  page: Page,
  cardLocator: Locator,
  offsetX: number = 50,
  offsetY: number = 50
): Promise<{ x: number; y: number }> {
  const cardBox = await cardLocator.boundingBox();

  if (!cardBox) {
    throw new Error('无法获取卡牌元素的边界框');
  }

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.waitForTimeout(100);
  await page.mouse.down();

  // 移动一定距离以触发拖拽
  await page.mouse.move(startX + offsetX, startY + offsetY);

  return { x: startX + offsetX, y: startY + offsetY };
}

/**
 * 结束拖拽（释放鼠标）
 */
export async function endDrag(page: Page): Promise<void> {
  await page.mouse.up();
  await page.waitForTimeout(100);
}

/**
 * 使用键盘进行拖拽（无障碍方式）
 * 注意：需要目标组件支持键盘导航
 *
 * @param page Playwright Page 对象
 * @param cardLocator 卡牌的定位器
 */
export async function dragWithKeyboard(page: Page, cardLocator: Locator): Promise<void> {
  await cardLocator.focus();
  await page.keyboard.press('Space'); // 开始拖拽
  await page.keyboard.press('Tab'); // 导航到下一个可放置区域
  await page.keyboard.press('Space'); // 放置
}
