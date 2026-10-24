import { expect, test, type Page } from '@playwright/test';
import { DECK_RECORD, installVisualApiMocks } from '../visual/support/mockApp';

test.use({ serviceWorkers: 'block' });

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installVisualApiMocks(page, true);
  await page.goto('/?page=game-setup');
  await expect(page.getByRole('heading', { name: '选择己方卡组' })).toBeVisible();
  await expect(page.getByRole('list', { name: '对局准备步骤' })).toHaveCount(0);
  await expect(page.getByRole('option')).toHaveCount(0);
}

async function openDebug(page: Page) {
  await prepare(page);
  await page.getByRole('button', { name: '切换模式', exact: true }).click();
  await page.getByRole('option', { name: '双人调试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 1 的卡组' })).toBeVisible();
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '换牌阶段', exact: true })).toBeVisible();
}

async function readMatch(page: Page) {
  return page.evaluate(async () => {
    const path = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/store/gameStore.ts'))!;
    const { useGameStore } = await import(path);
    const state = useGameStore.getState();
    const match = state.getMatchView();
    return { phase: match.phase, subPhase: match.subPhase, viewer: match.viewerSeat };
  });
}

test('换牌卡牌支持重复空格和回车，焦点仅进入阶段面板与开放工具区，双方命令能完成开局', async ({
  page,
}) => {
  await openDebug(page);
  const panel = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  const card = panel.locator('[data-battle-ui-object-id]').first();
  await card.focus();
  for (const key of ['Space', 'Enter']) {
    await page.keyboard.press(key);
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press(key);
    await expect(card).toHaveAttribute('aria-pressed', 'false');
  }
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() =>
        Boolean(
          document.activeElement?.closest(
            '[data-battle-ui-anchor="mulligan-panel"], [data-battle-phase-access]'
          )
        )
      )
    ).toBe(true);
  }
  if (page.viewportSize()!.width >= 1024) {
    await card.hover();
    const detail = page.getByRole('complementary', { name: '手牌详情' });
    await expect(detail).toBeVisible();
    const button = panel.getByRole('button', { name: '保留全部手牌', exact: true });
    const [a, b] = await Promise.all([detail.boundingBox(), button.boundingBox()]);
    expect(
      Math.max(0, Math.min(a!.x + a!.width, b!.x + b!.width) - Math.max(a!.x, b!.x)) *
        Math.max(0, Math.min(a!.y + a!.height, b!.y + b!.height) - Math.max(a!.y, b!.y))
    ).toBe(0);
    await expect(page.locator('aside[aria-label$="卡牌详情"]')).toHaveCount(0);
  }
  const first = await readMatch(page);
  await card.focus();
  await page.keyboard.press('Space');
  await panel.getByRole('button', { name: '更换 1 张', exact: true }).click();
  await expect
    .poll(() => readMatch(page))
    .toEqual({
      phase: 'MULLIGAN_PHASE',
      subPhase: 'MULLIGAN_SECOND_PLAYER',
      viewer: first.viewer === 'FIRST' ? 'SECOND' : 'FIRST',
    });
  await panel.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await expect.poll(async () => (await readMatch(page)).phase).toBe('MAIN_PHASE');
  await expect(panel).toHaveCount(0);
});

test('操作提示可以重开，页签支持方向键，翻页重置滚动且关闭后回到换牌任务', async ({ page }) => {
  await openDebug(page);
  await page.getByRole('button', { name: '对战设置', exact: true }).click();
  await page.getByRole('button', { name: '操作提示', exact: true }).click();
  const help = page.getByRole('dialog', { name: '双人调试操作提示' });
  const first = help.getByRole('tab', { name: '阶段重点', exact: true });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  const areas = help.getByRole('tab', { name: '区域操作', exact: true });
  await expect(areas).toHaveAttribute('aria-selected', 'true');
  await expect(areas).toBeFocused();
  await help
    .locator('.ui-dialog-body')
    .evaluate((element) => (element.scrollTop = element.scrollHeight));
  await help.getByRole('button', { name: '下一页：效果和调试' }).click();
  await expect
    .poll(() => help.locator('.ui-dialog-body').evaluate((element) => element.scrollTop))
    .toBe(0);
  await expect(help.getByRole('tab', { name: '效果和调试' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() =>
      Boolean(
        document.activeElement?.closest(
          '[data-battle-ui-anchor="mulligan-panel"], [data-battle-phase-access]'
        )
      )
    )
  ).toBe(true);
});

test('选组页直接开局，说明不推移主操作；失败保留卡组并可重试', async ({ page }) => {
  const longName = '长名称卡组 · 成员登场与 LIVE 结算的完整选择确认检查';
  await installVisualApiMocks(page, true);
  await page.route('**/api/decks', (route) =>
    route.fulfill({
      json: {
        data: [{ ...DECK_RECORD, name: longName }],
        error: null,
      },
    })
  );
  await page.route('**/api/battle/solitaire-matches', (route) =>
    route.fulfill({
      status: 503,
      json: {
        data: null,
        error: { code: 'UNAVAILABLE', message: '暂时无法开始，请重试' },
      },
    })
  );
  await page.goto('/?page=game-setup');
  const title = page.locator('.game-setup-selection').getByText(longName, { exact: true });
  await expect(title).toBeVisible();
  await expect(page.getByText('记录：保存至历史')).toBeHidden();
  const before = await page.getByRole('button', { name: '开始对局', exact: true }).boundingBox();
  await page.getByText('对局说明', { exact: true }).click();
  await expect(page.getByText('记录：保存至历史')).toBeVisible();
  expect(await page.getByRole('button', { name: '开始对局', exact: true }).boundingBox()).toEqual(
    before
  );
  expect(await title.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await expect(page.getByRole('heading', { name: '选择己方卡组' })).toBeVisible();
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '暂时无法开始' })).toBeVisible();
  await expect(title).toBeVisible();
  await expect(page.getByRole('button', { name: '开始对局', exact: true })).toBeEnabled();
});

test('触控点选只切换一次，长按查看不选牌，关闭详情后恢复选牌焦点', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, '仅触控项目验证长按');
  await page.setViewportSize({ width: 390, height: 844 });
  await openDebug(page);
  const card = page.locator('[data-battle-ui-anchor="mulligan-cards"] button').first();
  await card.tap();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await card.tap();
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  const box = await card.boundingBox();
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }],
  });
  await expect(page.getByRole('button', { name: '关闭卡牌详情', exact: true })).toBeVisible();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '关闭卡牌详情', exact: true }).tap();
  await expect(page.getByRole('button', { name: '关闭卡牌详情', exact: true })).toHaveCount(0);
  await expect(card).toBeFocused();
  await session.detach();
});

test('悬停、选牌与展开说明不改变换牌框、卡牌或确认按钮的位置，底部保留留白', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDebug(page);
  const panel = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  await expect(panel).toHaveCSS('opacity', '1');
  const card = panel.locator('[data-battle-ui-object-id]').first();
  const confirm = panel.locator('[data-battle-ui-anchor="mulligan-confirm"]');
  const positions = async () => ({
    panel: await panel.boundingBox(),
    card: await card.boundingBox(),
    confirm: await confirm.boundingBox(),
  });
  const before = await positions();
  await panel.getByText('换牌说明', { exact: true }).click();
  await expect(page.getByRole('note')).toBeVisible();
  expect(await positions()).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('note')).toHaveCount(0);
  await card.hover();
  const details = page.getByRole('complementary', { name: '手牌详情' });
  await expect(details).toBeVisible();
  expect(await positions()).toEqual(before);
  await card.click();
  await expect(confirm).toHaveText('更换 1 张');
  expect(await positions()).toEqual(before);
  await page.getByRole('button', { name: '关闭手牌详情', exact: true }).click();
  await expect(details).toHaveCount(0);
  expect(await positions()).toEqual(before);
  const footer = panel.locator('.mulligan-footer');
  expect(
    await footer.evaluate((e) => parseFloat(getComputedStyle(e).paddingBottom))
  ).toBeGreaterThanOrEqual(16);
  const [a, b] = await Promise.all([footer.boundingBox(), confirm.boundingBox()]);
  expect(a!.y + a!.height - b!.y - b!.height).toBeGreaterThanOrEqual(16);
});

test('窄屏选牌与清空不移动主操作，短屏仍可确认', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openDebug(page);
  const panel = page.getByRole('dialog', { name: '换牌阶段', exact: true });
  await expect(panel).toHaveCSS('opacity', '1');
  const card = panel.locator('[data-battle-ui-object-id]').first();
  const confirm = panel.locator('[data-battle-ui-anchor="mulligan-confirm"]');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 568 });
    const tools = await page.locator('.battle-mobile-header').boundingBox();
    const heading = await panel
      .getByRole('heading', { name: '换牌阶段', exact: true })
      .boundingBox();
    expect(heading!.y).toBeGreaterThan(tools!.y + tools!.height);
    const before = await confirm.boundingBox();
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(await confirm.boundingBox()).toEqual(before);
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await panel.getByRole('button', { name: '清空选择', exact: true }).click();
    await expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(await confirm.boundingBox()).toEqual(before);
    await panel.getByText('换牌说明', { exact: true }).click();
    await expect(page.getByRole('note')).toBeVisible();
    expect(await confirm.boundingBox()).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(confirm).toBeInViewport({ ratio: 1 });
    expect(await panel.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  }
});
