import { expect, test, type Page } from '@playwright/test';

const recovered = (page: Page, id = 'a') =>
  page.locator(`[data-recovery-hand-card="obj_recover-${id}"] [data-object-id]`);
const flight = (page: Page) => page.locator('[data-effect-recovery-card]');
async function prepare(page: Page, scenario = 'single') {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeVisible();
  if (scenario !== 'single') await page.getByLabel('验收场景').selectOption(scenario);
  await expect(page.locator('[data-object-id="obj_source"]').first()).toBeVisible();
}
async function step(page: Page) {
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('status', { name: '验收结果' })).toContainText('已执行真实命令');
}
async function recover(page: Page, multiple = false) {
  if (!multiple) await step(page); // activate
  await step(page); // discard
  // Let the existing public selection presentation advance itself, at its real deadline.
  await expect(
    page.getByText(
      multiple ? '选择要加入手牌的 Cerise Bouquet 成员 / 莲之空 LIVE' : '选择加入手牌的虹咲LIVE',
      { exact: true }
    )
  ).toBeVisible();
  await recordRecoveryFrames(page);
  if (multiple) await step(page);
  else
    await page
      .getByRole('button', { name: 'Dream with You 4分 Dream with You', exact: true })
      .click();
  // Public presentation still advances at its real deadline.
  await page.waitForFunction(() => !!(window as any).__recoveryFrames?.length);
}

async function recordRecoveryFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__recoveryFrames = [];
    w.__recoveryFinished = false;
    let start: number | undefined;
    function frame(now: number) {
      const flying = document.querySelector<HTMLElement>('[data-effect-recovery-card]');
      const hand = document.querySelector<HTMLElement>(
        '[data-recovery-hand-card="obj_recover-a"] [data-object-id]'
      );
      if (flying && hand) {
        start ??= now;
        const f = flying.getBoundingClientRect(),
          h = hand.getBoundingClientRect();
        const style = getComputedStyle(flying);
        w.__recoveryFrames.push({
          elapsed: now - start,
          hidden: getComputedStyle(hand).visibility === 'hidden',
          width: parseFloat(style.width),
          opacity: Number(style.opacity),
          error: Math.max(
            Math.abs(f.left - h.left),
            Math.abs(f.top - h.top),
            Math.abs(f.width - h.width),
            Math.abs(f.height - h.height)
          ),
          glow: Number(
            getComputedStyle(document.querySelector('[data-recovery-source-glow]')!).opacity
          ),
        });
      } else if (start !== undefined) {
        w.__recoveryFinished = true;
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

test('real A recovery, hand occlusion, undo and same-A recovery again', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await prepare(page);
  await recover(page);
  await page.waitForFunction(() => (window as any).__recoveryFrames.at(-1)?.elapsed >= 300);
  await expect(recovered(page)).toHaveCSS('visibility', 'hidden');
  await page.screenshot({ path: info.outputPath('hover.png') });
  await page.waitForFunction(() => (window as any).__recoveryFinished);
  const frames = await page.evaluate(
    () =>
      (window as any).__recoveryFrames as {
        elapsed: number;
        hidden: boolean;
        width: number;
        opacity: number;
        rotation: number;
        error: number;
        glow: number;
      }[]
  );
  expect(frames.at(-1)!.elapsed).toBeGreaterThan(1000);
  expect(frames.every((f) => f.hidden)).toBe(true);
  const hover = frames.filter((f) => f.elapsed > 280 && f.elapsed < 600);
  expect(hover.length).toBeGreaterThan(3);
  expect(
    Math.max(...hover.map((f) => f.width)) - Math.min(...hover.map((f) => f.width))
  ).toBeLessThan(0.1);
  expect(frames.at(-1)!.error).toBeLessThan(1);
  expect(frames.at(-1)!.glow).toBe(0);
  await expect(recovered(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath('settled.png') });
  await page.getByRole('banner').getByRole('button', { name: '撤销上一步', exact: true }).click();
  await expect(recovered(page)).toHaveCount(0);
  await expect(flight(page)).toHaveCount(0);
  await step(page);
  await expect(flight(page)).toHaveCount(1);
  await expect(recovered(page)).toHaveCSS('visibility', 'hidden');
  await expect(flight(page)).toHaveCount(0);
  await expect(recovered(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('two recovered cards stagger and both settle after the shared selection closes', async ({
  page,
}) => {
  await prepare(page, 'multiple');
  await recover(page, true);
  await expect(flight(page)).toHaveCount(2);
  await expect(recovered(page, 'a')).toHaveCSS('visibility', 'hidden');
  await expect(recovered(page, 'b')).toHaveCSS('visibility', 'hidden');
  await expect(flight(page)).toHaveCount(0);
  await expect(recovered(page, 'a')).toBeVisible();
  await expect(recovered(page, 'b')).toBeVisible();
});

test('resize during hover follows the real hand; view and match changes clean up', async ({
  page,
}, info) => {
  await prepare(page);
  await recover(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => (window as any).__recoveryFinished);
  expect(await page.evaluate(() => (window as any).__recoveryFrames.at(-1).error)).toBeLessThan(1);
  await expect(flight(page)).toHaveCount(0);
  await expect(recovered(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath('narrow-settled.png') });
  await page.getByRole('banner').getByRole('button', { name: '撤销上一步', exact: true }).click();
  await step(page);
  await expect(flight(page)).toHaveCount(1);
  await page.getByRole('button', { name: '切换视角', exact: true }).click();
  await expect(flight(page)).toHaveCount(0);
  await expect(page.locator('[data-recovery-hand-card="obj_recover-a"]')).toHaveCount(0);
  await page.getByRole('button', { name: '重新准备', exact: true }).click();
  await recover(page);
  await page.getByRole('button', { name: '重新准备', exact: true }).click();
  await expect(flight(page)).toHaveCount(0);
  await expect(page.locator('[data-recovery-hand-card] .invisible')).toHaveCount(0);
});

test('reduced motion leaves the real card visible and starts no flying overlay', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await step(page);
  await step(page);
  await expect(page.getByText('选择加入手牌的虹咲LIVE', { exact: true })).toBeVisible();
  await step(page);
  await expect(recovered(page)).toBeVisible();
  await expect(flight(page)).toHaveCount(0);
});

test('invalid choice and no-target resolution never start a recovery', async ({ page }) => {
  await prepare(page, 'no-target');
  await step(page);
  await page.getByRole('button', { name: '尝试非法选择', exact: true }).click();
  await expect(page.getByRole('status', { name: '验收结果' })).toContainText('未执行');
  await expect(flight(page)).toHaveCount(0);
  await step(page);
  await expect(page.getByRole('button', { name: '加入手牌', exact: true })).toHaveCount(0);
  await expect(flight(page)).toHaveCount(0);
  await expect(recovered(page)).toHaveCount(0);
});

test('undo during hover cancels the old card and cannot release a newly replayed card early', async ({
  page,
}) => {
  await prepare(page);
  await recover(page);
  await page.waitForFunction(() => (window as any).__recoveryFrames.at(-1)?.elapsed >= 280);
  await page.getByRole('banner').getByRole('button', { name: '撤销上一步', exact: true }).click();
  await expect(flight(page)).toHaveCount(0);
  await expect(recovered(page)).toHaveCount(0);
  await recordRecoveryFrames(page);
  await step(page);
  await page.waitForFunction(() => (window as any).__recoveryFinished);
  const frames = await page.evaluate(
    () => (window as any).__recoveryFrames as { elapsed: number; hidden: boolean }[]
  );
  expect(frames.at(-1)!.elapsed).toBeGreaterThan(1000);
  expect(frames.every((frame) => frame.hidden)).toBe(true);
  await expect(recovered(page)).toBeVisible();
});
