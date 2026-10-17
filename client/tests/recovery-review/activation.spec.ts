import { test, expect, type Page } from '@playwright/test';
const source = (page: Page, id = 'source') =>
  page.locator(`[data-ability-activation-source="${id}"]`).first();
const ink = (page: Page) => page.locator('[data-ability-activation-ink]');
const floor = (page: Page) => page.locator('[data-ability-activation-floor]');
const menu = (page: Page) => page.getByRole('button', { name: /^起动/ }).last();
const snapshot = (page: Page) =>
  page.evaluate(async () => (await import('./activationProbe.ts')).snapshot());
type EdgeStyle = 'flow' | 'flow-original' | 'ink';
async function prepare(page: Page, style?: EdgeStyle) {
  await page.goto(`/activation.html${style ? `?edge=${style}` : ''}`);
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
async function pauseLiftAt(page: Page, time: number) {
  await source(page).evaluate(
    (node, currentTime) =>
      node.getAnimations().forEach((animation) => {
        if (animation.effect?.getTiming().duration === 1000) {
          animation.pause();
          animation.currentTime = currentTime;
        }
      }),
    time
  );
}
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.activationFrames = [];
    let first: number | undefined;
    const tick = (now: number) => {
      const card = document.querySelector('[data-ability-activation-source="source"]');
      const ink = document.querySelector<HTMLCanvasElement>('[data-ability-activation-ink]');
      // Sample close to the card edge so both the narrow flow and wider ink wash are covered.
      const strip = ink?.getContext('2d')?.getImageData(60, 60, 1, 288).data;
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

test('real activation: original card lifts, flow evolves, then exactly one command processes', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await prepare(page);
  await expect(page.getByLabel('边缘特效')).toHaveValue('flow');
  await record(page);
  await page.screenshot({ path: info.outputPath('before.png') });
  const before = await snapshot(page);
  await activate(page);
  await expect(ink(page)).toHaveCount(1);
  await expect(ink(page)).toHaveAttribute('data-ability-activation-style', 'flow');
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

for (const style of ['flow', 'ink'] as const)
  for (const narrow of [false, true])
    test(`${style}: paused visual samples at ${style === 'flow' ? '250/450/650/800' : '450/750'}ms, ${narrow ? 'mobile' : 'desktop'}`, async ({
      page,
    }, info) => {
      if (narrow) await page.setViewportSize({ width: 390, height: 844 });
      await prepare(page, style);
      await expect(page.getByLabel('边缘特效')).toHaveValue(style);
      await source(page).click();
      const restingBounds = (await source(page).boundingBox())!;
      const clockStart = new Date('2026-01-01T00:00:00Z');
      await page.clock.install({ time: clockStart });
      // Pause in the installed clock's future, independent of host/browser clock skew.
      await page.clock.pauseAt(new Date(clockStart.getTime() + 1000));
      await menu(page).dispatchEvent('click');
      const captureFrame = async (time: number, bounds: typeof restingBounds) => {
        await page.screenshot({ path: info.outputPath(`${style}-paused-${time}ms.png`) });
        if (!narrow) {
          const canvasBounds = (await ink(page).boundingBox())!;
          const viewport = page.viewportSize()!;
          const x = Math.max(0, canvasBounds.x);
          const y = Math.max(0, canvasBounds.y);
          await page.screenshot({
            path: info.outputPath(`${style}-detail-${time}ms.png`),
            clip:
              style === 'flow'
                ? {
                    x,
                    y,
                    width: Math.min(viewport.width, canvasBounds.x + canvasBounds.width) - x,
                    height: Math.min(viewport.height, canvasBounds.y + canvasBounds.height) - y,
                  }
                : {
                    x: bounds.x - 45,
                    y: bounds.y - 40,
                    width: bounds.width + 110,
                    height: bounds.height + 85,
                  },
          });
        }
      };
      if (style === 'flow') {
        await page.clock.runFor(250);
        await pauseLiftAt(page, 250);
        await captureFrame(250, (await source(page).boundingBox())!);
      }
      await page.clock.runFor(style === 'flow' ? 200 : 450);
      await expect(ink(page)).toHaveCount(1);
      await expect(ink(page)).toHaveAttribute('data-ability-activation-style', style);
      if (style === 'flow') {
        const coverage = await ink(page).evaluate((node) => {
          const context = (node as HTMLCanvasElement).getContext('2d')!;
          const hasPaint = (x: number, y: number, width: number, height: number) =>
            context
              .getImageData(x, y, width, height)
              .data.some((value, i) => i % 4 === 3 && value > 0);
          // Both painters use the same 328x408 canvas: card bounds are
          // x=64..264, y=64..344. Keep this test clear of the antialiased edge.
          return {
            inside: hasPaint(84, 84, 160, 240),
            sides: [
              hasPaint(20, 88, 42, 232),
              hasPaint(266, 88, 42, 232),
              hasPaint(88, 20, 152, 42),
              hasPaint(88, 346, 152, 42),
            ],
          };
        });
        expect(coverage.inside).toBe(false);
        // Two moving wakes occupy parts of the perimeter; a complete glowing rim is not expected.
        expect(coverage.sides.filter(Boolean).length).toBeGreaterThanOrEqual(2);
      }
      await pauseLiftAt(page, 450);
      const raised = (await source(page).boundingBox())!;
      const footprint = (await floor(page).boundingBox())!;
      // A parallel lift magnifies both axes equally; no corner tips towards the viewer.
      expect(raised.width / restingBounds.width).toBeGreaterThan(1.26);
      expect(raised.width / restingBounds.width).toBeLessThan(1.37);
      expect(raised.width / raised.height).toBeCloseTo(
        restingBounds.width / restingBounds.height,
        3
      );
      expect(footprint.width).toBeLessThan(raised.width / 1.12);
      expect(
        Math.hypot(
          raised.x + raised.width / 2 - footprint.x - footprint.width / 2,
          raised.y + raised.height / 2 - footprint.y - footprint.height / 2
        )
      ).toBeGreaterThan(restingBounds.height * 0.1);
      await expect(source(page).locator('[data-card-effect-outline]')).toHaveCSS('opacity', '0');
      await captureFrame(450, raised);
      let previousTime = 450;
      for (const time of style === 'flow' ? [650, 800] : [750]) {
        // Advance the same canvas through every intervening frame, as in real playback.
        await page.clock.runFor(time - previousTime);
        await pauseLiftAt(page, time);
        await captureFrame(time, raised);
        previousTime = time;
      }
    });

test('ink and both ribbon speeds keep identical lift, execute once at 1000ms, and clean up', async ({
  page,
}) => {
  await prepare(page, 'ink');
  await expect(page.getByLabel('边缘特效')).toHaveValue('ink');
  const restingBounds = (await source(page).boundingBox())!;
  const clockStart = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 1000));
  let inkBounds = restingBounds;
  for (const style of ['ink', 'flow-original', 'flow'] as const) {
    if (style !== 'ink') await page.getByLabel('边缘特效').selectOption(style);
    const before = await snapshot(page);
    await source(page).dispatchEvent('click');
    await expect(menu(page)).toBeVisible();
    await menu(page).evaluate((button) => {
      (button as HTMLElement).click();
      (button as HTMLElement).click();
    });
    await expect(ink(page)).toHaveAttribute('data-ability-activation-style', style);
    await page.clock.runFor(450);
    await pauseLiftAt(page, 450);
    const raised = (await source(page).boundingBox())!;
    if (style === 'ink') inkBounds = raised;
    else {
      expect(raised.width).toBeCloseTo(inkBounds.width, 2);
      expect(raised.height).toBeCloseTo(inkBounds.height, 2);
      expect(raised.x).toBeCloseTo(inkBounds.x, 2);
      expect(raised.y).toBeCloseTo(inkBounds.y, 2);
    }
    await page.clock.runFor(549);
    expect((await snapshot(page)).seq).toBe(before.seq);
    expect((await snapshot(page)).activationCount).toBe(before.activationCount);
    await expect(ink(page)).toHaveCount(1);
    await page.clock.runFor(1);
    await expect
      .poll(async () => (await snapshot(page)).activationCount)
      .toBe(before.activationCount + 1);
    await expect(ink(page)).toHaveCount(0);
    await expect(floor(page)).toHaveCount(0);
    await expect(source(page)).not.toHaveAttribute('data-ability-activation');
    const settled = (await source(page).boundingBox())!;
    expect(settled.width).toBeCloseTo(restingBounds.width, 2);
    expect(settled.height).toBeCloseTo(restingBounds.height, 2);
    await page.clock.runFor(1100);
    expect((await snapshot(page)).activationCount).toBe(before.activationCount + 1);
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

for (const mode of ['perspective', 'match', 'command', 'edge-style'] as const)
  test(`cancels without late execution when ${mode} changes`, async ({ page }) => {
    await prepare(page);
    const before = await snapshot(page);
    await activate(page);
    await expect(ink(page)).toHaveCount(1);
    if (mode === 'perspective')
      await page.getByRole('button', { name: '切换视角', exact: true }).click();
    if (mode === 'match') await page.getByRole('button', { name: '重新准备' }).click();
    if (mode === 'edge-style') {
      await page.getByLabel('边缘特效').selectOption('ink');
      await expect(page.getByLabel('边缘特效')).toHaveValue('ink');
    }
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

for (const narrow of [false, true]) {
  test(`waiting-room activation keeps the source mounted until submission, ${narrow ? 'mobile' : 'desktop'}`, async ({
    page,
  }, info) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page);
    await page.getByLabel('起动来源').selectOption('waiting');
    await page.locator('[data-animation-zone-id="seat-FIRST::waiting-room"]').click();
    await expect(page.getByRole('dialog', { name: '休息室', exact: true })).toBeVisible();
    await activate(page, 'waiting-source');
    await expect(ink(page)).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: '休息室', exact: true })).toBeVisible();
    await page.waitForTimeout(350);
    const hovering = (await source(page, 'waiting-source').boundingBox())!;
    const scrollBounds = (await page
      .getByRole('dialog', { name: '休息室', exact: true })
      .locator('.touch-scroll')
      .boundingBox())!;
    expect(hovering.y).toBeGreaterThanOrEqual(scrollBounds.y);
    expect(hovering.y + hovering.height).toBeLessThanOrEqual(scrollBounds.y + scrollBounds.height);
    await page.screenshot({ path: info.outputPath('waiting-hover.png') });
    await expect.poll(async () => (await snapshot(page)).active).toBe(true);
    await expect(page.getByRole('dialog', { name: '休息室', exact: true })).toHaveCount(0);
    await expect(ink(page)).toHaveCount(0);
    await expect(floor(page)).toHaveCount(0);
  });

  test(`hand activation preserves identity until the real discard/draw command, ${narrow ? 'mobile' : 'desktop'}`, async ({
    page,
  }, info) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page);
    await page.getByLabel('起动来源').selectOption('hand');
    const before = await snapshot(page);
    expect(before.hand).toContain('hand-source');
    await activate(page, 'hand-source');
    await expect(ink(page)).toHaveCount(1);
    expect((await snapshot(page)).hand).toContain('hand-source');
    await page.waitForTimeout(350);
    const hovering = (await source(page, 'hand-source').boundingBox())!;
    expect(hovering.y + hovering.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.screenshot({ path: info.outputPath('hand-hover.png') });
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
}
