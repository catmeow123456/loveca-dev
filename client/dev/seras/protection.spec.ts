import { expect, test, type Page } from '@playwright/test';

const badgeSelector = '[data-izumi-protection="obj_hand-izumi"]';
async function state(page: Page) {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const store = useGameStore.getState();
    return {
      izumi: store.playerViewState.objects['obj_hand-izumi'],
      entrance: store.gameSession.state.entranceRuntime?.pending,
      effect: store.playerViewState.activeEffect,
    };
  });
}

test('a real partner move blooms the rose without gating actions; release and immediate reapply are safe', async ({
  page,
}) => {
  await page.goto('/?protect');
  const badge = page.locator(badgeSelector);
  await expect(
    page.getByRole('button', { name: '赛拉丝入场 · 开启保护', exact: true })
  ).toBeEnabled();
  await expect(badge).toHaveCount(0);
  await page.addStyleTag({
    content:
      '.izumi-protection-forming, .izumi-protection[data-phase="releasing"] .izumi-protection-flower { animation-duration: 10s !important; }',
  });
  await page.getByRole('button', { name: '赛拉丝入场 · 开启保护', exact: true }).click();
  await expect(badge).toHaveAttribute('data-phase', 'forming');
  expect((await state(page)).izumi.opponentWaitProtection).toBe('IZUMI_EDELNOTE');
  expect((await state(page)).entrance).toBeFalsy();
  expect((await state(page)).effect).toBeFalsy();
  await page.getByRole('button', { name: '泉横置／转正', exact: true }).click();
  expect((await state(page)).izumi.orientation).toBe('WAITING');
  await expect(badge).toHaveAttribute('data-phase', 'forming');
  await page.getByRole('button', { name: '赛拉丝离场 · 解除保护', exact: true }).click();
  await expect(badge).toHaveCount(0);
  await expect(page.locator('[data-izumi-protection-release]')).toHaveCount(1);
  expect((await state(page)).izumi.opponentWaitProtection).toBeUndefined();
  await page.getByRole('button', { name: '赛拉丝入场 · 开启保护', exact: true }).click();
  await expect(badge).toHaveAttribute('data-phase', 'forming');
  await expect(page.locator('[data-izumi-protection-release]')).toHaveCount(0);
  await badge.evaluate((el) =>
    el
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .forEach((a) => a.finish())
  );
  await expect(badge).toHaveAttribute('data-phase', 'protected');
});

test('existing protection is static on load, perspective switch and reload', async ({ page }) => {
  await page.goto('/?lock&active');
  const badge = page.locator(badgeSelector);
  await expect(badge).toHaveAttribute('data-phase', 'protected');
  await page.getByRole('button', { name: /切换至 对手/ }).click();
  await expect(badge).toHaveAttribute('data-phase', 'protected');
  await expect(page.locator('.izumi-protection-forming')).toHaveCount(0);
  await page.reload();
  await expect(badge).toHaveAttribute('data-phase', 'protected');
});

test('R print, reduced motion and narrow layout keep the static rose on the card', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?protect');
  await page.getByText('测试选项', { exact: true }).click();
  await page.getByRole('button', { name: '验证 R 罕度', exact: true }).click();
  await page.getByText('测试选项', { exact: true }).click();
  await page.getByRole('button', { name: '赛拉丝入场 · 开启保护', exact: true }).click();
  const badge = page.locator(badgeSelector);
  await expect(badge).toHaveAttribute('data-phase', 'protected');
  expect((await state(page)).izumi.frontInfo.cardCode).toBe('PL!HS-bp8-008-R');
  expect(
    await badge.evaluate((el) => {
      const card = el.getBoundingClientRect();
      const rose = el.querySelector('.izumi-protection-flower')!.getBoundingClientRect();
      return {
        pointer: getComputedStyle(el).pointerEvents,
        fits: rose.left >= card.left && rose.right <= card.right && rose.bottom <= card.bottom,
        animations: el.getAnimations({ subtree: true }).length,
      };
    })
  ).toEqual({ pointer: 'none', fits: true, animations: 0 });
  await page.screenshot({ path: 'output/playwright/izumi-protection-mobile.png' });
  await page.getByRole('button', { name: '赛拉丝离场 · 解除保护', exact: true }).click();
  await expect(page.locator('.izumi-protection')).toHaveCount(0);
});

test('effects disabled removes only decoration, preserving the authoritative protection', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
  await page.goto('/?protect');
  await page.getByRole('button', { name: '赛拉丝入场 · 开启保护', exact: true }).click();
  await expect(page.locator(badgeSelector)).toHaveCount(0);
  expect((await state(page)).izumi.opponentWaitProtection).toBe('IZUMI_EDELNOTE');
  await page.getByRole('button', { name: '赛拉丝离场 · 解除保护', exact: true }).click();
  expect((await state(page)).izumi.opponentWaitProtection).toBeUndefined();
});

test('the rose follows a waiting card during dragging and normal release removes the visual', async ({
  page,
}) => {
  await page.goto('/?protect');
  await page.getByRole('button', { name: '赛拉丝入场 · 开启保护', exact: true }).click();
  const badge = page.locator(badgeSelector);
  await expect(badge).toHaveAttribute('data-phase', 'protected');
  await page.screenshot({ path: 'output/playwright/izumi-protection-desktop.png' });
  await page.getByRole('button', { name: '泉横置／转正', exact: true }).click();
  const card = page.locator(
    '[data-battle-ui-anchor="self-stage-left"] [data-object-id="obj_hand-izumi"]'
  );
  await expect(card).toHaveCSS('rotate', '90deg');
  await expect(card.locator(badgeSelector)).toHaveCount(1);
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing Izumi card');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 - 40, { steps: 6 });
  await expect(page.locator(`[data-battle-drag-card="hand-izumi"] ${badgeSelector}`)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-battle-drag-card="hand-izumi"]')).toHaveCount(0);
  await page.getByRole('button', { name: '赛拉丝离场 · 解除保护', exact: true }).click();
  await expect(page.locator('.izumi-protection')).toHaveCount(0);
});

test('an arriving Izumi unfolds after landing and can still be tapped during the cosmetic animation', async ({
  page,
}) => {
  await page.goto('/?protect');
  await page.getByRole('button', { name: '赛拉丝入场 · 开启保护', exact: true }).click();
  await expect(page.locator(badgeSelector)).toHaveAttribute('data-phase', 'protected');
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => e.name.includes('/src/store/gameStore.ts'))!.name;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const result = useGameStore
      .getState()
      .movePublicCardToHand('hand-izumi', 'MEMBER_SLOT', 'LEFT');
    if (!result.success) throw new Error(JSON.stringify(result));
  });
  await expect(page.locator(badgeSelector)).toHaveCount(0);
  const handCard = page.locator('[data-object-id="obj_hand-izumi"]');
  const target = page.locator('[data-battle-ui-anchor="self-stage-left"]');
  await expect(handCard).toBeVisible();
  const from = await handCard.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Missing hand card or stage');
  await page.evaluate(() => {
    (window as Window & { izumiLanding?: Promise<number> }).izumiLanding = new Promise(
      (resolve) => {
        const sample = () => {
          const card = document.querySelector(
            '[data-battle-ui-anchor="self-stage-left"] [data-object-id="obj_hand-izumi"]'
          );
          if (!card || getComputedStyle(card).visibility !== 'visible') {
            requestAnimationFrame(sample);
            return;
          }
          const animations =
            card.querySelector('[data-izumi-protection]')?.getAnimations({ subtree: true }) ?? [];
          const opening = animations.find(
            (a) => (a as CSSAnimation).animationName === 'izumi-protection-form'
          );
          animations.forEach((a) => a.pause());
          resolve(opening ? Number(opening.currentTime) : Infinity);
        };
        requestAnimationFrame(sample);
      }
    );
  });
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 15, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(target.locator('[data-object-id="obj_hand-izumi"]')).toBeVisible();
  const elapsed = await page.evaluate(
    () => (window as Window & { izumiLanding?: Promise<number> }).izumiLanding
  );
  expect(elapsed).toBeLessThan(80);
  await expect(page.locator(badgeSelector)).toHaveAttribute('data-phase', 'forming');
  await page.getByRole('button', { name: '泉横置／转正', exact: true }).click();
  expect((await state(page)).izumi.orientation).toBe('WAITING');
  expect((await state(page)).entrance).toBeFalsy();
  expect((await state(page)).effect).toBeFalsy();
});
