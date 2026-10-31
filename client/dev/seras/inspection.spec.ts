import { expect, test, type Page } from '@playwright/test';

async function state(page: Page) {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const s = useGameStore.getState().gameSession.state;
    return {
      hand: s.players[0].hand.cardIds,
      waiting: s.players[0].waitingRoom.cardIds,
      step: s.activeEffect?.stepId,
    };
  });
}
async function chooseAsOwner(page: Page) {
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const store = useGameStore.getState();
    const s = store.gameSession.state;
    const result = store.gameSession.executeCommand({
      type: 'CONFIRM_EFFECT_STEP',
      playerId: 'p1',
      effectId: s.activeEffect.id,
      selectedCardId: 'deck-0',
      timestamp: Date.now(),
    });
    if (!result.success) throw new Error(JSON.stringify(result));
    store.syncState();
  });
}

test('five private cards, legal selection, one public LIVE, automatic hand/waiting settlement', async ({
  page,
}) => {
  await page.goto('/?inspect');
  const panel = page.locator('.seras-theatre');
  await expect(panel.locator('.seras-score')).toHaveCount(5);
  await expect(panel.locator('[data-eligible="true"]')).toHaveCount(2);
  await expect(panel.getByRole('button', { name: '桂城泉', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await panel.getByRole('button', { name: '查看桂城泉详情', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '桂城泉 / 桂城泉 卡牌详情' })).toBeVisible();
  await panel.getByRole('button', { name: 'EdelinieN', exact: true }).click();
  await expect(panel).toHaveAttribute('data-seras-phase', 'reveal');
  await expect(panel.locator('.seras-score')).toHaveCount(1);
  const ratio = await panel
    .locator('.seras-score-card')
    .evaluate((e) => e.clientWidth / e.clientHeight);
  expect(ratio).toBeCloseTo(1.4, 1);
  expect((await state(page)).hand).not.toContain('deck-0');
  await expect(panel).toHaveCount(0, { timeout: 4000 });
  const settled = await state(page);
  expect(settled.hand).toContain('deck-0');
  expect(settled.waiting).toEqual(['deck-1', 'deck-2', 'deck-3', 'deck-4']);
});

test('skip and no eligible LIVE never create a reveal', async ({ page }) => {
  for (const url of ['/?inspect', '/?inspect&empty']) {
    await page.goto(url);
    const panel = page.locator('.seras-theatre');
    await expect(panel.locator('.seras-score')).toHaveCount(5);
    await panel.getByRole('button', { name: '全部放置入休息室', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect((await state(page)).waiting).toHaveLength(5);
    expect((await state(page)).hand).toEqual(['hand-izumi']);
  }
});

test('opponent sees no inspection faces and only the chosen card on reveal', async ({ page }) => {
  await page.goto('/?inspect&opponent');
  const panel = page.locator('.seras-theatre');
  await expect(panel.getByText('等待对方选曲')).toBeVisible();
  await expect(panel.locator('.seras-score img')).toHaveCount(0);
  await expect(panel).not.toContainText('EdelinieN');
  await expect(panel.locator('.seras-score')).toHaveCount(0);
  await chooseAsOwner(page);
  await expect(panel).toHaveAttribute('data-seras-phase', 'reveal');
  await expect(panel.locator('.seras-score')).toHaveCount(1);
  await expect(panel).toContainText('EdelinieN');
  await expect(panel.locator('.seras-score')).not.toContainText('桂城泉');
});

test('mobile: readable two columns, scroll to fifth card, fixed skip remains usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?inspect');
  const panel = page.locator('.seras-theatre');
  await expect(panel.locator('.seras-score')).toHaveCount(5);
  const gallery = await panel
    .locator('.seras-score-gallery')
    .evaluate((e) => ({
      cols: getComputedStyle(e).gridTemplateColumns.split(' ').length,
      width: e.scrollWidth,
      client: e.clientWidth,
    }));
  expect(gallery.cols).toBe(2);
  expect(gallery.width).toBeLessThanOrEqual(gallery.client);
  await panel.locator('.seras-score').last().scrollIntoViewIfNeeded();
  await expect(
    panel.getByRole('button', { name: '查看赛拉丝·柳田·利林费尔德详情', exact: true })
  ).toBeInViewport();
  await expect(
    panel.getByRole('button', { name: '全部放置入休息室', exact: true })
  ).toBeInViewport();
  await panel.getByRole('button', { name: '全部放置入休息室', exact: true }).click();
  expect((await state(page)).waiting).toHaveLength(5);
});

test('all rarities and reduced motion use the same flow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?inspect');
  await page.getByText('测试选项', { exact: true }).click();
  await page.getByRole('button', { name: '验证 R 罕度' }).click();
  await page.getByText('测试选项', { exact: true }).click();
  const panel = page.locator('.seras-theatre');
  await expect(panel).toHaveAttribute('data-reduced', 'true');
  expect(
    await panel.locator('.seras-curtain--left').evaluate((e) => getComputedStyle(e).animationName)
  ).toBe('none');
  await panel.getByRole('button', { name: 'Icy', exact: true }).click();
  await expect(panel).toHaveAttribute('data-seras-phase', 'reveal');
  expect(
    await panel.locator('.seras-score-art').evaluate((e) => getComputedStyle(e).animationName)
  ).toBe('none');
  await expect(panel).toHaveCount(0, { timeout: 4000 });
  expect((await state(page)).hand).toContain('deck-3');
});

test('effects off keeps the original controls and settlement', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
  await page.goto('/?inspect');
  await expect(page.locator('[data-battle-ui-anchor="active-effect-panel"]')).toBeVisible();
  await expect(page.locator('.seras-theatre')).toHaveCount(0);
  await page
    .locator('[data-battle-ui-anchor="active-effect-panel"]')
    .getByRole('button', { name: /EdelinieN/ })
    .click();
  await expect.poll(async () => (await state(page)).hand.includes('deck-0')).toBe(true);
});

test('free play: dragging Seras from hand opens the themed inspection', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('[data-object-id="obj_seras"]').first();
  const target = page.locator('[data-battle-ui-anchor="self-stage-center"]').first();
  await expect(card).toBeVisible();
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Missing card or stage');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 15, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.locator('.seras-theatre')).toHaveAttribute('data-seras-phase', 'inspection');
  expect((await state(page)).hand).not.toContain('seras');
});

test('reopening a public reveal joins the settled pose, then advances once', async ({ page }) => {
  await page.goto('/?inspect');
  const panel = page.locator('.seras-theatre');
  await panel.getByRole('button', { name: 'EdelinieN', exact: true }).click();
  await expect(panel).toHaveAttribute('data-seras-phase', 'reveal');
  await panel.getByRole('button', { name: '隐藏', exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: '展开效果', exact: true }).click();
  const delay = await panel
    .locator('.seras-score-art')
    .evaluate((e) => parseFloat(getComputedStyle(e).animationDelay));
  expect(delay).toBeLessThanOrEqual(-0.8);
  await expect(panel).toHaveCount(0, { timeout: 2500 });
  expect((await state(page)).hand.filter((id) => id === 'deck-0')).toHaveLength(1);
});
