import { expect, test } from '@playwright/test';

test('real paid drag plays the new portrait, lands the real card, then opens private inspection', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
  const entrance = page.locator('.card-entrance-presentation[data-profile="seras-bp8"]');
  await expect(entrance).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('.seras-theatre')).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'output/playwright/seras-bp8-portrait-desktop.png' });
  await page.waitForTimeout(450);
  await page.screenshot({ path: 'output/playwright/seras-bp8-portrait-settled.png' });
  await expect(entrance).toHaveCount(0);
  await expect(page.locator('.seras-theatre')).toHaveAttribute('data-seras-phase', 'inspection');
  await expect(page.locator('.seras-score')).toHaveCount(5);
  await page.getByRole('button', { name: '全部放置入休息室', exact: true }).click();
  await expect(target.locator('[data-object-id="obj_seras"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('390px portrait/name stay usable; skip releases the card and repeat starts a new real entry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?entrance');
  const entrance = page.locator('.card-entrance-presentation[data-profile="seras-bp8"]');
  await expect(entrance).toHaveAttribute('data-phase', 'playing');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'output/playwright/seras-bp8-portrait-mobile.png' });
  await expect(page.getByRole('button', { name: '跳过演出', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '跳过演出', exact: true }).click();
  await expect(page.locator('.seras-score')).toHaveCount(5);
  await page.getByRole('button', { name: '登场预览', exact: true }).click();
  await expect(entrance).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('.seras-theatre')).toHaveCount(0);
  await expect(page.locator('.seras-score')).toHaveCount(5);
});

test('reduced motion and disabled effects both reach the same selection without flight', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?entrance');
  await expect(page.locator('.seras-score')).toHaveCount(5);
  await expect(page.locator('.card-landing')).toHaveCount(0);
  await expect(page.locator('.card-entrance-presentation')).toHaveCount(0);
  await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
  await page.goto('/?entrance');
  await expect(page.locator('.card-entrance-presentation')).toHaveCount(0);
  const effect = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
  await expect(effect).toBeVisible();
  await expect(page.locator('.seras-theatre')).toHaveCount(0);
  await expect(effect.getByRole('button', { name: /EdelinieN/ })).toBeVisible();
});

test('first-play portrait loading deadline releases inspection and late art never replays', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/seras-bp8.png*', async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('button', { name: '登场预览', exact: true }).click();
  const entrance = page.locator('.card-entrance-presentation[data-profile="seras-bp8"]');
  await expect(entrance).toHaveAttribute('data-phase', 'loading');
  await expect(page.locator('.seras-score')).toHaveCount(5, { timeout: 3500 });
  await expect(entrance).toHaveCount(0);
  release();
  await page.waitForTimeout(400);
  await expect(entrance).toHaveCount(0);
  await expect(page.locator('.seras-score')).toHaveCount(5);
});
