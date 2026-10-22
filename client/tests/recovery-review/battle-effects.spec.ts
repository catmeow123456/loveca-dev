import { test, expect, type Page } from '@playwright/test';

// QA inventory: persisted desktop/mobile control; activation exactly once; recovery/public
// reveal; cheer real faces/counts; all numerical gains; entrance ACK; result continuation.
// With effects off, retain baseline moves/flips/tap feedback/public discard/LIVE results;
// verify hand-to-stage on desktop/mobile/opponent view and OS reduced-motion separately.
// Off/on during playback must release masks and never replay the interrupted event.
const cosmetics =
  '[data-ability-activation-ink], [data-effect-recovery-card], .cheer-motion-overlay, ' +
  '.card-entrance-presentation, [data-effect-feedback-badge], [data-effect-result-art]';
const snapshot = (page: Page) =>
  page.evaluate(async () => (await import('./battleEffectsProbe')).snapshot());
async function toggle(page: Page, enabled: boolean) {
  const control = page.getByRole('switch', { name: '对战特效', exact: true });
  if (!(await control.isVisible()))
    await page.getByRole('button', { name: '对战设置', exact: true }).click();
  await expect(control).toHaveAttribute('aria-checked', String(!enabled));
  await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(enabled));
  await page.keyboard.press('Escape');
}
async function offOnLoad(page: Page) {
  await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
}
async function watchCosmetics(page: Page) {
  await page.evaluate((selector) => {
    (window as any).unexpectedEffects = [];
    (window as any).baseMoves = [];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            const moves = [
              ...(node.matches('[data-battle-card-move]') ? [node] : []),
              ...node.querySelectorAll('[data-battle-card-move]'),
            ];
            (window as any).baseMoves.push(
              ...moves.map((move) => move.getAttribute('data-battle-card-move'))
            );
          }
          if (node instanceof Element && (node.matches(selector) || node.querySelector(selector)))
            (window as any).unexpectedEffects.push(node.outerHTML.slice(0, 160));
        }
    }).observe(document.body, { childList: true, subtree: true });
  }, cosmetics);
}
async function noCosmetics(page: Page) {
  await expect(page.locator(cosmetics)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).unexpectedEffects)).toEqual([]);
}
async function activate(page: Page) {
  await page.locator('[data-ability-activation-source="source"]').first().click();
  await page.getByRole('button', { name: /^起动/ }).last().click();
}
async function pause(page: Page) {
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

for (const mobile of [false, true]) {
  test(`persisted switch and immediate activation, ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }, info) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/activation.html');
    await toggle(page, false);
    await page.reload();
    if (!mobile) await page.getByRole('button', { name: '对战设置', exact: true }).click();
    await expect(page.getByRole('switch', { name: '对战特效' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    await page.screenshot({ path: info.outputPath('effects-off.png') });
    await page.keyboard.press('Escape');
    await watchCosmetics(page);
    const before = await snapshot(page);
    await activate(page);
    await expect.poll(async () => (await snapshot(page)).activations).toBe(before.activations + 1);
    await expect.poll(async () => !!(await snapshot(page)).view?.activeEffect).toBe(true);
    await noCosmetics(page);
    await page.getByRole('button', { name: '重新准备', exact: true }).click();
    await toggle(page, true);
    await activate(page);
    await expect(page.locator('[data-ability-activation-ink]')).toHaveCount(1);
  });
}

test('turning off a pending activation submits once and removes lift immediately', async ({
  page,
}) => {
  await page.goto('/activation.html');
  await pause(page);
  const before = await snapshot(page);
  await activate(page);
  await page.clock.runFor(250);
  await expect(page.locator('[data-ability-activation-ink]')).toHaveCount(1);
  await toggle(page, false);
  await expect.poll(async () => (await snapshot(page)).activations).toBe(before.activations + 1);
  await expect(
    page.locator('[data-ability-activation-ink], [data-ability-activation-floor]')
  ).toHaveCount(0);
  expect(
    await page
      .locator('[data-ability-activation-source="source"]')
      .first()
      .getAttribute('data-ability-activation')
  ).toBeNull();
  await toggle(page, true);
  await page.clock.runFor(1800);
  expect((await snapshot(page)).activations).toBe(before.activations + 1);
  await expect(page.locator('[data-ability-activation-ink]')).toHaveCount(0);
});

test('off preserves public discard and selection, then uses a basic recovery flight', async ({
  page,
}, info) => {
  await offOnLoad(page);
  await page.goto('/');
  await watchCosmetics(page);
  await pause(page);
  const step = () => page.getByRole('button', { name: '下一步', exact: true }).click();
  await step();
  await step();
  await page.clock.runFor(160);
  await expect(page.locator('[data-discard-presentation-object-id]').first()).toBeVisible();
  const publicBatch = await page
    .locator('[data-discard-presentation]')
    .getAttribute('data-discard-presentation');
  await page.screenshot({ path: info.outputPath('public-discard-still-visible.png') });
  await toggle(page, true);
  await expect(page.locator('[data-discard-presentation-object-id]').first()).toBeVisible();
  await expect(page.locator('[data-discard-presentation]')).toHaveAttribute(
    'data-discard-presentation',
    publicBatch!
  );
  await toggle(page, false);
  await page.clock.resume();
  await page
    .getByRole('button', { name: 'Dream with You 4分 Dream with You', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).baseMoves))
    .toContain('obj_recover-a');
  const hand = page.locator('[data-recovery-hand-card="obj_recover-a"] [data-object-id]');
  await expect(hand).toBeVisible();
  await expect(hand).toHaveCSS('visibility', 'visible');
  await expect.poll(async () => (await snapshot(page)).occlusions.length).toBe(0);
  await noCosmetics(page);
});

test('off during recovery releases the hand and on does not replay queued movement', async ({
  page,
}) => {
  await page.goto('/');
  const step = () => page.getByRole('button', { name: '下一步', exact: true }).click();
  await step();
  await step();
  await page
    .getByRole('button', { name: 'Dream with You 4分 Dream with You', exact: true })
    .click();
  await expect(page.locator('[data-effect-recovery-card]')).toHaveCount(1);
  await toggle(page, false);
  await expect(page.locator('[data-effect-recovery-card]')).toHaveCount(0);
  await expect(
    page.locator('[data-recovery-hand-card="obj_recover-a"] [data-object-id]')
  ).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).occlusions.length).toBe(0);
  await watchCosmetics(page);
  await toggle(page, true);
  await page.waitForTimeout(1800);
  await noCosmetics(page);
});

for (const initiallyOff of [true, false]) {
  test(`cheer ${initiallyOff ? 'off before' : 'off during'} preserves revealed cards, counts and success`, async ({
    page,
  }, info) => {
    if (initiallyOff) await offOnLoad(page);
    await page.goto('/cheer.html');
    await expect(page.getByRole('button', { name: '播放三张声援', exact: true })).toBeEnabled();
    if (initiallyOff) await watchCosmetics(page);
    await pause(page);
    await page.getByRole('button', { name: '播放三张声援', exact: true }).click();
    await page.clock.runFor(500);
    if (!initiallyOff) {
      await expect(page.locator('.cheer-motion-overlay')).toHaveCount(1);
      await toggle(page, false);
    }
    // Base reveal moves still finish, independently of the disabled heart choreography.
    await page.clock.runFor(600);
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
    await expect(page.locator('#judgment-panel [data-cheer-card-id]')).toHaveCount(3);
    await expect(page.locator('#judgment-panel [data-cheer-total]')).toContainText('总计 6');
    await expect(page.locator('[data-cheer-outcome]')).toContainText('判定成功');
    await expect(page.locator('#judgment-panel [style*="visibility: hidden"]')).toHaveCount(0);
    await expect.poll(async () => (await snapshot(page)).occlusions.length).toBe(0);
    await page.screenshot({ path: info.outputPath('judgment-remains.png') });
    if (initiallyOff) await noCosmetics(page);
    await watchCosmetics(page);
    await toggle(page, true);
    await page.clock.runFor(4000);
    await noCosmetics(page);
    if (!initiallyOff) {
      await page.getByRole('button', { name: '播放三张声援', exact: true }).click();
      await page.clock.runFor(500);
      await expect(page.locator('.cheer-motion-overlay')).toHaveCount(1);
    }
  });
}

for (const scenario of ['mixed', 'score', 'requirement']) {
  test(`off suppresses ${scenario} feedback but applies real gains`, async ({ page }) => {
    await offOnLoad(page);
    await page.goto('/feedback.html');
    await page.getByLabel('验收场景').selectOption(scenario);
    await watchCosmetics(page);
    const read = () => page.evaluate(async () => (await import('./feedbackProbe')).snapshot());
    await page.getByRole('button', { name: '演示一次', exact: true }).click();
    await expect.poll(async () => (await read()).events.length).toBeGreaterThan(0);
    const settled = await read();
    expect(
      settled.events.flatMap((event) => event.targets.flatMap((target) => target.changes)).length
    ).toBeGreaterThan(0);
    await noCosmetics(page);
    await toggle(page, true);
    await page.waitForTimeout(1800);
    await noCosmetics(page);
    expect((await read()).events).toEqual(settled.events);
  });
}

for (const special of [false, true]) {
  test(`off skips ${special ? 'return' : 'ordinary'} entrance and completes barrier`, async ({
    page,
  }) => {
    await offOnLoad(page);
    await page.goto('/landing.html');
    await watchCosmetics(page);
    await page
      .getByRole('button', { name: special ? '特殊登场（回流）' : '普通登场', exact: true })
      .click();
    await expect.poll(async () => (await snapshot(page)).view?.match.entrance).toBeFalsy();
    await expect(page.locator('[data-object-id="obj_mia"]').first()).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).occlusions.length).toBe(0);
    await noCosmetics(page);
  });
}

for (const scenario of ['desktop', 'mobile', 'opponent', 'reduced'] as const) {
  test(`effects off keeps the baseline stage-entry presentation: ${scenario}`, async ({
    page,
  }, info) => {
    await offOnLoad(page);
    if (scenario === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
    if (scenario === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/landing.html');
    await expect(page.getByRole('button', { name: '普通登场', exact: true })).toBeVisible();
    if (scenario === 'opponent') {
      await page.getByRole('button', { name: '切换视角', exact: true }).click();
      await expect(page.locator('[data-battle-ui-anchor="opponent-hand"] img')).toHaveAttribute(
        'alt',
        'Card Back'
      );
    }
    await watchCosmetics(page);
    await pause(page);
    await page.getByRole('button', { name: '普通登场', exact: true }).click();
    await page.clock.runFor(100);
    const flight = page.locator('[data-battle-card-move="obj_mia"]');
    const target = page.locator('[data-object-id="obj_mia"]').first();
    if (scenario === 'reduced' || scenario === 'opponent') {
      // The baseline does not infer a flight origin from anonymous opponent hand cards.
      await expect(flight).toHaveCount(0);
      await expect(target).toBeVisible();
    } else {
      await expect(flight).toHaveCount(1);
      await expect(target).toHaveCSS('visibility', 'hidden');
      await page.screenshot({ path: info.outputPath('basic-flight.png') });
    }
    await page.clock.runFor(600);
    await page.clock.resume();
    await expect(flight).toHaveCount(0);
    await expect(target).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).view?.match.entrance).toBeFalsy();
    await expect.poll(async () => (await snapshot(page)).occlusions.length).toBe(0);
    await noCosmetics(page);
    await page.screenshot({ path: info.outputPath('settled.png') });
  });
}

test('turning effects off does not cancel a basic slot swap; tap feedback also stays', async ({
  page,
}) => {
  await page.goto('/activation.html');
  await expect(page.locator('[data-ability-activation-source="source"]').first()).toBeVisible();
  await pause(page);
  const result = await page.evaluate(async () =>
    (await import('./activationProbe')).moveSourceToLeft()
  );
  expect(result.success).toBe(true);
  await page.clock.runFor(80);
  const flight = page.locator('[data-battle-card-move]');
  await expect(flight).toHaveCount(2);
  const objects = () =>
    flight.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-battle-card-move')).sort()
    );
  const objectIds = await objects();
  await toggle(page, false);
  expect(await objects()).toEqual(objectIds);
  await page.clock.runFor(650);
  await page.clock.resume();
  await expect(flight).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).occlusions.length).toBe(0);
  await page.evaluate(async () => (await import('./activationProbe')).tapSource('LEFT' as any));
  await expect(page.locator('[data-battle-state-feedback="ORIENTATION_CHANGE"]')).toHaveCount(1);
  await expect(page.locator('[data-battle-state-feedback]')).toHaveCount(0);
});

test('off retains the original LIVE result presentation and subsequent successful-LIVE choice', async ({
  page,
}) => {
  await offOnLoad(page);
  // The existing fixture runs the real controller; no account/server state is changed.
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('http://127.0.0.1:5173/tests/excel-review/index.html');
  await expect(page.getByTestId('excel-battle')).toBeVisible();
  await page.keyboard.press('Control+Alt+e');
  await page.evaluate(() => (window as any).excelReview.score());
  await expect(page.getByText('Live 分数最终确认', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认我的分数', exact: true }).click();
  await page.evaluate(() => (window as any).excelReview.store().setViewingPlayer('p2'));
  await page.getByRole('button', { name: '确认我的分数', exact: true }).click();
  await page.evaluate(() => (window as any).excelReview.store().setViewingPlayer('p1'));
  await expect(page.getByText('LIVE RESULT', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).excelReview.store().playerViewState.match.subPhase)
    )
    .toBe('RESULT_SETTLEMENT');
  await expect(page.getByText(/选择.*成功/).first()).toBeVisible();
});
