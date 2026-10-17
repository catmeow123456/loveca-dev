import { expect, test, type Page } from '@playwright/test';

const badges = (page: Page) => page.locator('[data-effect-feedback-badge]');
const art = (page: Page) => page.locator('[data-effect-result-art]');
const snapshot = (page: Page) =>
  page.evaluate(async () => (await import('./feedbackProbe')).snapshot());
async function sampleMotionAt(page: Page, time: number) {
  // The JS clock drives lifecycle; browser-native animation timelines need their own sample.
  await page.evaluate((currentTime) => {
    for (const animation of document.getAnimations()) {
      const node = (animation.effect as KeyframeEffect | null)?.target;
      if (
        node instanceof Element &&
        (node.closest('[data-effect-result-art]') || node.matches('[data-effect-feedback-badge]'))
      ) {
        animation.pause();
        animation.currentTime = currentTime;
      }
    }
  }, time);
}
async function prepare(page: Page, scenario = 'heart') {
  await page.goto('/feedback.html');
  await page.getByLabel('验收场景').selectOption(scenario);
  await expect(page.locator('[data-object-id="obj_source"]').first()).toBeVisible();
  await page.waitForFunction(() =>
    [...document.images]
      .filter((img) => img.getBoundingClientRect().width > 0)
      .every((img) => img.complete && img.naturalWidth > 0)
  );
}
async function pauseClock(page: Page) {
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
}
async function resolveGain(page: Page) {
  for (let i = 0; i < 10; i++) {
    const state = await snapshot(page);
    if (state.events.length) return state;
    if (state.deadline) {
      const remaining = await page.evaluate(
        (deadline) => Math.max(0, deadline - Date.now()),
        state.deadline
      );
      await page.clock.runFor(remaining + 20);
      if ((await snapshot(page)).events.length) return snapshot(page);
    }
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.clock.runFor(32);
  }
  throw new Error('Real commands did not produce a member gain');
}

for (const narrow of [false, true])
  for (const scenario of ['heart', 'multi', 'mixed']) {
    test(`${scenario} on ${narrow ? 'mobile' : 'desktop'}: real gain, visual and settled state`, async ({
      page,
    }, info) => {
      if (narrow) await page.setViewportSize({ width: 390, height: 844 });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await prepare(page, scenario);
      await pauseClock(page);
      await expect(badges(page)).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('before.png') });
      const state = await resolveGain(page);
      const count = scenario === 'multi' ? 3 : 1;
      await expect(badges(page)).toHaveCount(count);
      await expect(art(page)).toHaveCount(count);
      if (scenario === 'mixed') {
        await expect(page.locator('[data-effect-gain-radiance="heart"]')).toHaveCount(1);
        await expect(page.locator('[data-effect-gain-radiance="blade"]')).toHaveCount(1);
        await expect(badges(page).locator('img')).toHaveCount(2);
      }
      expect(state.events.flatMap((event) => event.targets)).toHaveLength(count);
      await page.clock.runFor(450);
      await sampleMotionAt(page, 450);
      if (narrow && scenario === 'mixed') {
        const target = (await page.locator('[data-object-id="obj_source"]').first().boundingBox())!;
        const label = (await badges(page).boundingBox())!;
        expect(label.width).toBeLessThanOrEqual(target.width * 1.1);
        expect(label.x).toBeGreaterThanOrEqual(target.x - 4);
        expect(label.x + label.width).toBeLessThanOrEqual(target.x + target.width + 4);
      }
      for (const badge of await badges(page).all()) {
        const box = (await badge.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        expect(box.y).toBeGreaterThanOrEqual(0);
      }
      await page.screenshot({ path: info.outputPath('gain-450ms.png') });
      await page.clock.runFor(1300);
      await expect(badges(page)).toHaveCount(0);
      await expect(art(page)).toHaveCount(0);
      await expect(page.locator('[data-object-id="obj_source"]').first()).toBeVisible();
      expect((await snapshot(page)).events).toEqual(state.events);
      await page.screenshot({ path: info.outputPath('settled.png') });
      expect(errors).toEqual([]);
    });
  }

test('sideways target and opposite seat: light follows card, label stays upright', async ({
  page,
}, info) => {
  await prepare(page);
  await page.getByLabel('横置左侧成员').check();
  await page.getByRole('button', { name: '切换视角', exact: true }).click();
  await pauseClock(page);
  await resolveGain(page);
  await page.clock.runFor(450);
  await sampleMotionAt(page, 450);
  await expect(page.locator('[data-object-id="obj_target"] [data-effect-result-art]')).toHaveCount(
    1
  );
  const matrix = await badges(page).evaluate((node) => {
    const m = new DOMMatrix(getComputedStyle(node).transform);
    return { b: m.b, c: m.c };
  });
  expect(matrix).toEqual({ b: 0, c: 0 });
  await page.screenshot({ path: info.outputPath('sideways-opponent.png') });
  await page.clock.runFor(1300);
  await expect(badges(page)).toHaveCount(0);
});

test('reduced motion shows exact values briefly without sheen', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page, 'mixed');
  await pauseClock(page);
  await resolveGain(page);
  await expect(badges(page)).toHaveCount(1);
  await expect(badges(page).locator('img')).toHaveCount(2);
  await expect(art(page)).toHaveCount(0);
  await page.clock.runFor(100);
  await sampleMotionAt(page, 100);
  await page.screenshot({ path: info.outputPath('reduced.png') });
  await page.clock.runFor(250);
  await expect(badges(page)).toHaveCount(0);
});

test('activation keeps its 1s lift; payment produces no gain; resolved heart does', async ({
  page,
}, info) => {
  await prepare(page, 'self');
  await page.locator('[data-object-id="obj_source"]').first().click();
  const activate = page.getByRole('button', { name: /^起动/ }).last();
  await expect(activate).toBeVisible();
  await pauseClock(page);
  await activate.dispatchEvent('click');
  await page.clock.runFor(999);
  await expect(page.locator('[data-ability-activation-ink]')).toHaveCount(1);
  expect((await snapshot(page)).active).toBe(false);
  await expect(badges(page)).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(page.locator('[data-ability-activation-ink]')).toHaveCount(0);
  expect((await snapshot(page)).active).toBe(true);
  await expect(art(page)).toHaveCount(0);
  await resolveGain(page);
  await page.clock.runFor(450);
  await sampleMotionAt(page, 450);
  await expect(badges(page)).toHaveText('+1');
  await page.screenshot({ path: info.outputPath('after-activation.png') });
  await page.clock.runFor(1300);
  await expect(badges(page)).toHaveCount(0);
});

for (const action of ['重新准备', '切换视角', '撤销']) {
  test(`clears feedback on ${action} and does not replay stale events`, async ({ page }) => {
    await prepare(page, 'mixed');
    await pauseClock(page);
    await resolveGain(page);
    await expect(badges(page)).toHaveCount(1);
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(badges(page)).toHaveCount(0);
    await expect(art(page)).toHaveCount(0);
    await page.clock.runFor(1500);
    await expect(badges(page)).toHaveCount(0);
    if (action === '撤销') {
      await resolveGain(page);
      await expect(badges(page)).toHaveCount(1);
    }
  });
}

test('real-time mixed gain visibly plays and disappears without waiting for another command', async ({
  page,
}, info) => {
  await prepare(page, 'mixed');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(badges(page)).toHaveCount(1);
  await expect
    .poll(() => badges(page).evaluate((node) => Number(getComputedStyle(node).opacity)))
    .toBeGreaterThan(0.5);
  await page.screenshot({ path: info.outputPath('real-time-gain.png') });
  await expect(badges(page)).toHaveCount(0);
  await expect(art(page)).toHaveCount(0);
  expect((await snapshot(page)).active).toBe(false);
});
