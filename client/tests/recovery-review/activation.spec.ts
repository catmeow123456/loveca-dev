import { test, expect, type Page } from '@playwright/test';
const source = (page: Page, id = 'source') =>
  page.locator(`[data-ability-activation-source="${id}"]`).first();
const ink = (page: Page) => page.locator('[data-ability-activation-ink]');
const floor = (page: Page) => page.locator('[data-ability-activation-floor]');
const menu = (page: Page) => page.getByRole('button', { name: /^起动/ }).last();
const snapshot = (page: Page) =>
  page.evaluate(async () => (await import('./activationProbe.ts')).snapshot());
async function prepare(page: Page) {
  await page.goto('/activation.html');
  await expect(source(page)).toBeVisible();
  await page.waitForFunction(() =>
    [...document.images]
      .filter((i) => i.src.includes('/images/'))
      .every((i) => i.complete && i.naturalWidth)
  );
  await page.waitForTimeout(300);
}
async function activate(page: Page, id = 'source') {
  await source(page, id).click();
  await expect(menu(page)).toBeVisible();
  await menu(page).click();
}
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.activationFrames = [];
    let first: number | undefined;
    const tick = (now: number) => {
      const card = document.querySelector('[data-ability-activation-source="source"]');
      const ink = card?.querySelector<HTMLCanvasElement>('[data-ability-activation-ink]');
      // Sample the rendered wash just outside the left edge, rather than its drawing commands.
      const strip = ink?.getContext('2d')?.getImageData(52, 60, 1, 288).data;
      if (ink) first ??= now;
      if (first !== undefined)
        w.activationFrames.push({
          elapsed: now - first,
          ink: !!ink,
          transform: card && getComputedStyle(card).transform,
          processing: document
            .querySelector('.review-bar [role="status"]')
            ?.textContent?.includes('已进入'),
          progress: ink?.dataset.progress,
          inkDensity: strip?.reduce((sum, value, i) => sum + (i % 4 === 3 ? value : 0), 0),
        });
      if (first === undefined || now - first < 1300) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

test('real activation: original card lifts, ink evolves, then exactly one command processes', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await prepare(page);
  await record(page);
  await page.screenshot({ path: info.outputPath('before.png') });
  const before = await snapshot(page);
  await activate(page);
  await expect(ink(page)).toHaveCount(1);
  expect((await snapshot(page)).seq).toBe(before.seq);
  await expect
    .poll(async () => (await snapshot(page)).activationCount)
    .toBe(before.activationCount + 1);
  await expect(ink(page)).toHaveCount(0);
  await expect(floor(page)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('settled.png') });
  const frames = await page.evaluate(() => (window as any).activationFrames);
  expect(frames.some((f: any) => f.ink && f.transform.startsWith('matrix3d'))).toBe(true);
  expect(frames.filter((f: any) => f.ink).every((f: any) => !f.processing)).toBe(true);
  expect(frames.find((f: any) => f.processing).elapsed).toBeGreaterThan(930);
  expect(
    new Set(frames.filter((f: any) => f.ink).map((f: any) => f.inkDensity)).size
  ).toBeGreaterThan(3);
  expect(await source(page).getAttribute('data-ability-activation')).toBeNull();
  expect(errors).toEqual([]);
});

for (const narrow of [false, true])
  test(`paused visual sample at 450ms, ${narrow ? 'mobile' : 'desktop'}`, async ({
    page,
  }, info) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page);
    await source(page).click();
    const restingBounds = (await source(page).boundingBox())!;
    const clockStart = new Date('2026-01-01T00:00:00Z');
    await page.clock.install({ time: clockStart });
    // Pause in the installed clock's future, independent of host/browser clock skew.
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1000));
    await menu(page).dispatchEvent('click');
    await page.clock.runFor(450);
    await expect(ink(page)).toHaveCount(1);
    await source(page).evaluate((node) =>
      node.getAnimations().forEach((a) => {
        if (a.effect?.getTiming().duration === 1000) {
          a.pause();
          a.currentTime = 450;
        }
      })
    );
    const raised = (await source(page).boundingBox())!;
    const footprint = (await floor(page).boundingBox())!;
    // A parallel lift magnifies both axes equally; no corner tips towards the viewer.
    expect(raised.width / restingBounds.width).toBeGreaterThan(1.12);
    expect(raised.width / raised.height).toBeCloseTo(restingBounds.width / restingBounds.height, 3);
    expect(footprint.width).toBeLessThan(raised.width / 1.12);
    expect(
      Math.hypot(
        raised.x + raised.width / 2 - footprint.x - footprint.width / 2,
        raised.y + raised.height / 2 - footprint.y - footprint.height / 2
      )
    ).toBeGreaterThan(restingBounds.height * 0.1);
    await expect(source(page).locator('[data-card-effect-outline]')).toHaveCSS('opacity', '0');
    await page.screenshot({ path: info.outputPath('ink-paused.png') });
    if (!narrow)
      await page.screenshot({
        path: info.outputPath('ink-detail.png'),
        clip: {
          x: raised.x - 45,
          y: raised.y - 40,
          width: raised.width + 110,
          height: raised.height + 85,
        },
      });
    if (!narrow) {
      await page.clock.runFor(300);
      await source(page).evaluate((node) =>
        node.getAnimations().forEach((a) => {
          if (a.effect?.getTiming().duration === 1000) a.currentTime = 750;
        })
      );
      await page.screenshot({
        path: info.outputPath('ink-diffusing-750ms.png'),
        clip: {
          x: raised.x - 45,
          y: raised.y - 40,
          width: raised.width + 110,
          height: raised.height + 85,
        },
      });
    }
  });

test('double click submits once; undo and same-card activation work again', async ({ page }) => {
  await prepare(page);
  const before = await snapshot(page);
  await source(page).click();
  await menu(page).evaluate((button) => {
    (button as HTMLElement).click();
    (button as HTMLElement).click();
  });
  await expect
    .poll(async () => (await snapshot(page)).activationCount)
    .toBe(before.activationCount + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).active).toBe(false);
  await activate(page);
  await expect(ink(page)).toHaveCount(1);
  await expect
    .poll(async () => (await snapshot(page)).activationCount)
    .toBe(before.activationCount + 2);
});

for (const mode of ['perspective', 'match', 'command'] as const)
  test(`cancels without late execution when ${mode} changes`, async ({ page }) => {
    await prepare(page);
    const before = await snapshot(page);
    await activate(page);
    await expect(ink(page)).toHaveCount(1);
    if (mode === 'perspective')
      await page.getByRole('button', { name: '切换视角', exact: true }).click();
    if (mode === 'match') await page.getByRole('button', { name: '重新准备' }).click();
    if (mode === 'command')
      await page.evaluate(async () => (await import('./activationProbe.ts')).tapSource());
    await expect(ink(page)).toHaveCount(0);
    await expect(floor(page)).toHaveCount(0);
    await page.waitForTimeout(1150);
    expect((await snapshot(page)).activationCount).toBe(before.activationCount);
    if (mode === 'perspective')
      await page.getByRole('button', { name: '切换视角', exact: true }).click();
    await expect(source(page)).toBeVisible();
    expect(await source(page).getAttribute('data-ability-activation')).toBeNull();
  });

test('reduced motion does not lift and reaches the command without a 1000ms delay', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await record(page);
  await activate(page);
  await expect.poll(async () => (await snapshot(page)).active).toBe(true);
  const frames = await page.evaluate(() => (window as any).activationFrames);
  expect(
    frames.filter((f: any) => f.ink).every((f: any) => !f.transform.startsWith('matrix3d'))
  ).toBe(true);
  expect(frames.find((f: any) => f.processing).elapsed).toBeLessThan(180);
  await expect(ink(page)).toHaveCount(0);
  await expect(floor(page)).toHaveCount(0);
});

test('resize follows the real card and leaves no transform or hidden card', async ({ page }) => {
  await prepare(page);
  await activate(page);
  await expect(ink(page)).toHaveCount(1);
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect.poll(async () => (await snapshot(page)).active).toBe(true);
  await expect(ink(page)).toHaveCount(0);
  await expect(floor(page)).toHaveCount(0);
  await expect(source(page)).toHaveCSS('visibility', 'visible');
  await expect(source(page)).not.toHaveAttribute('data-ability-activation');
});

test('waiting-room activation keeps the source mounted until submission', async ({ page }) => {
  await prepare(page);
  await page.getByLabel('起动来源').selectOption('waiting');
  await page.locator('[data-animation-zone-id="seat-FIRST::waiting-room"]').click();
  await expect(page.getByRole('dialog', { name: '休息室', exact: true })).toBeVisible();
  await activate(page, 'waiting-source');
  await expect(ink(page)).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: '休息室', exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).active).toBe(true);
  await expect(page.getByRole('dialog', { name: '休息室', exact: true })).toHaveCount(0);
  await expect(ink(page)).toHaveCount(0);
  await expect(floor(page)).toHaveCount(0);
});

test('hand activation preserves identity until the real discard/draw command', async ({ page }) => {
  await prepare(page);
  await page.getByLabel('起动来源').selectOption('hand');
  const before = await snapshot(page);
  expect(before.hand).toContain('hand-source');
  await activate(page, 'hand-source');
  await expect(ink(page)).toHaveCount(1);
  expect((await snapshot(page)).hand).toContain('hand-source');
  await expect
    .poll(async () => (await snapshot(page)).activationCount)
    .toBe(before.activationCount + 1);
  const after = await snapshot(page);
  expect(after.hand).not.toContain('hand-source');
  expect(after.waiting).toContain('hand-source');
  expect(after.hand.length).toBe(before.hand.length);
  await expect(ink(page)).toHaveCount(0);
  await expect(floor(page)).toHaveCount(0);
});
