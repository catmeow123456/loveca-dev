import { expect, test, type Page } from '@playwright/test';
import type { prepareRemoteFeedback, readRemoteFeedback } from './remoteFeedbackFixture';

const fixtureUrl = '/tests/recovery-review/remoteFeedbackFixture.ts';
const badges = (page: Page) => page.locator('[data-effect-feedback-badge]');
const art = (page: Page) => page.locator('[data-effect-result-art]');
const snapshot = (page: Page): Promise<ReturnType<typeof readRemoteFeedback>> =>
  page.evaluate(async (path) => (await import(path)).readRemoteFeedback(), fixtureUrl);
const invoke = (page: Page, name: string) =>
  page.evaluate(async ({ path, name }) => (await import(path))[name](), { path: fixtureUrl, name });

async function prepare(page: Page, input: Parameters<typeof prepareRemoteFeedback>[0]) {
  // Exercise the ordinary App, shared board and remote store ingestion. Only the transport
  // is replaced: no account, API, database or AI model is used by these isolated tests.
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config')
      return route.fulfill({
        json: {
          data: {
            siteStatus: {
              lifecycle: 'NORMAL',
              generatedAt: '2026-01-01T00:00:00Z',
              maintenance: null,
              announcements: [],
            },
          },
        },
      });
    if (path === '/api/cards') return route.fulfill({ json: { data: [] } });
    return route.abort();
  });
  await page.route('**/site-status.json*', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        availability: 'OPEN',
        generatedAt: '2026-01-01T00:00:00Z',
        maintenance: null,
      },
    })
  );
  // Reuse the review server's existing local card-art cache, including synthetic energy backs.
  await page.route(/\/images\/(?:medium|thumb|large|static)\//, async (route) => {
    const url = new URL(
      new URL(route.request().url()).pathname,
      process.env.FEEDBACK_REVIEW_URL ?? 'http://127.0.0.1:5186'
    ).href;
    await route.fulfill({ response: await route.fetch({ url }) });
  });
  await page.route('**/src/lib/remoteMatchClient.ts*', (route) => {
    const reads = [
      'fetchRemoteSnapshot',
      'fetchRemoteSnapshotSyncResult',
      'fetchRemotePublicEvents',
    ];
    const writes = [
      'executeRemoteCommand',
      'advanceRemotePhase',
      'undoRemoteMatch',
      'createRemoteUndoRequest',
      'acceptRemoteUndoRequest',
      'rejectRemoteUndoRequest',
      'changeRemoteManualOperationMode',
      'respondRemoteManualOperationModeRequest',
    ];
    return route.fulfill({
      contentType: 'application/javascript',
      body: [
        ...reads.map(
          (name) =>
            `export const ${name} = (...args) => import('${fixtureUrl}').then(m => m.transport.${name}(...args));`
        ),
        ...writes.map(
          (name) =>
            `export const ${name} = () => { throw new Error('Unexpected UI command: ${name}'); };`
        ),
      ].join('\n'),
    });
  });
  await page.goto(process.env.FEEDBACK_APP_URL ?? 'http://127.0.0.1:5173/?page=game');
  await page.evaluate(
    async ({ path, input }) => (await import(path)).prepareRemoteFeedback(input),
    { path: fixtureUrl, input }
  );
  if (input.seat === 'SECOND' && page.viewportSize()!.width < 768) {
    await page.getByRole('button', { name: '隐藏', exact: true }).click();
    await page.getByRole('button', { name: /查看对手战场/ }).click();
  }
  await expect(page.locator('[data-object-id="obj_source"]').first()).toBeVisible();
  await page.waitForFunction(() =>
    [...document.images]
      .filter((img) => img.getBoundingClientRect().width > 0)
      .every((img) => img.complete && img.naturalWidth > 0)
  );
  // Let the App's real entrance finish before freezing lifecycle time.
  await page.waitForTimeout(450);
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
  await expect(badges(page)).toHaveCount(0);
}

async function resolveGain(page: Page) {
  for (let i = 0; i < 10; i++) {
    const state = await snapshot(page);
    if (state.authorityEvents.length) return state;
    if (state.deadline) {
      const remaining = await page.evaluate(
        (deadline) => Math.max(0, deadline - Date.now()),
        state.deadline
      );
      await page.clock.runFor(remaining + 20);
    }
    await invoke(page, 'stepRemoteFeedback');
    await page.clock.runFor(16);
  }
  throw new Error('Real commands did not produce numerical feedback');
}

async function sampleAt(page: Page, time: number) {
  await page.clock.runFor(time);
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

for (const source of ['ONLINE', 'SOLITAIRE', 'AI_DEBUG'] as const) {
  test(`${source}: battle effects switch preserves remote gains without replay`, async ({
    page,
  }) => {
    const initiallyOff = source !== 'SOLITAIRE';
    if (initiallyOff)
      await page.addInitScript(() => localStorage.setItem('loveca-card-entrance-enabled', 'false'));
    if (source === 'AI_DEBUG') await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page, { source, scenario: 'mixed' });
    const notice = page.getByRole('button', { name: '关闭玩前须知', exact: true });
    if (await notice.isVisible()) {
      await notice.click();
      await page.clock.runFor(250);
    }
    const state = await resolveGain(page);
    const control = page.getByRole('switch', { name: '对战特效', exact: true });
    if (!(await control.isVisible()))
      await page.getByRole('button', { name: '对战设置', exact: true }).click();
    if (!initiallyOff) {
      await expect(badges(page)).toHaveCount(1);
      await control.click();
    }
    await expect(control).toHaveAttribute('aria-checked', 'false');
    await expect(badges(page)).toHaveCount(0);
    await expect(art(page)).toHaveCount(0);
    expect(
      state.authorityEvents.flatMap((event) =>
        event.targets.flatMap((target) => target.changes.map((change) => change.kind))
      )
    ).toEqual(expect.arrayContaining(['HEART', 'BLADE']));
    await control.click();
    await invoke(page, 'pollLogAgain');
    await page.clock.runFor(1800);
    await expect(badges(page)).toHaveCount(0);
    await expect(art(page)).toHaveCount(0);
    expect((await snapshot(page)).events).toEqual(state.authorityEvents);
  });
}

for (const source of ['ONLINE', 'SOLITAIRE', 'AI_DEBUG'] as const) {
  for (const scenario of ['heart', 'multi', 'score', 'requirement'] as const) {
    test(`${source} ${scenario}: public clock drives ordinary App feedback`, async ({
      page,
    }, info) => {
      if (source === 'AI_DEBUG') await page.setViewportSize({ width: 390, height: 844 });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await prepare(page, { source, scenario });
      await page.screenshot({ path: info.outputPath('before.png') });
      const state = await resolveGain(page);
      expect(state.source).toBe(source);
      expect(state.authorityEvents[0].seq).toBeGreaterThan(state.revision);
      const count = scenario === 'multi' ? 3 : 1;
      await expect(badges(page)).toHaveCount(count);
      await expect(art(page)).toHaveCount(count);
      if (scenario === 'heart') await expect(badges(page)).toHaveText('+2');
      if (scenario === 'multi') await expect(badges(page)).toHaveText(['+1', '+1', '+1']);
      if (scenario === 'score') {
        await expect(badges(page).locator('.card-effect-keyword-token-score')).toBeVisible();
        await expect(badges(page).locator('b')).toHaveText('+1');
      }
      if (scenario === 'requirement') await expect(badges(page)).toHaveText('需求−2');
      expect((await snapshot(page)).eventRequests).toEqual([source]);
      await sampleAt(page, 400);
      for (const badge of await badges(page).all()) {
        const box = (await badge.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        expect(box.y).toBeGreaterThanOrEqual(0);
      }
      await page.screenshot({ path: info.outputPath('feedback.png') });
      await page.clock.runFor(1300);
      await expect(badges(page)).toHaveCount(0);
      await expect(art(page)).toHaveCount(0);
      await invoke(page, 'pollLogAgain');
      await page.clock.runFor(32);
      await expect(badges(page)).toHaveCount(0);
      expect((await snapshot(page)).events).toEqual(state.authorityEvents);
      await page.screenshot({ path: info.outputPath('settled.png') });
      expect(errors).toEqual([]);
    });
  }
}

test('late log with a higher remote revision plays once; reconnect history stays silent', async ({
  page,
}) => {
  await prepare(page, { source: 'SOLITAIRE', scenario: 'score', revision: 200 });
  await page.evaluate(async (path) => (await import(path)).setHoldLogs(true), fixtureUrl);
  const state = await resolveGain(page);
  expect(state.revision).toBeGreaterThan(state.publicSeq);
  expect(state.events).toHaveLength(0);
  await expect(badges(page)).toHaveCount(0);
  await invoke(page, 'releaseLogs');
  await page.clock.runFor(32);
  await expect(badges(page)).toHaveCount(1);
  await page.clock.runFor(1300);
  await expect(badges(page)).toHaveCount(0);
  await page.evaluate(async (path) => (await import(path)).setHoldLogs(true), fixtureUrl);
  await invoke(page, 'reconnect');
  await page.clock.runFor(32);
  await expect(badges(page)).toHaveCount(0);
  await invoke(page, 'releaseLogs');
  await page.clock.runFor(1500);
  await expect(badges(page)).toHaveCount(0);
  expect((await snapshot(page)).events).toEqual(state.authorityEvents);
});

test('opponent mobile sees mixed gains; reduced motion clears without sheen', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page, { source: 'ONLINE', scenario: 'mixed', seat: 'SECOND' });
  await resolveGain(page);
  await expect(badges(page)).toHaveCount(1);
  await expect(badges(page).locator('img')).toHaveCount(2);
  await expect(art(page)).toHaveCount(0);
  await sampleAt(page, 100);
  await page.screenshot({ path: info.outputPath('opponent-reduced.png') });
  await page.clock.runFor(300);
  await expect(badges(page)).toHaveCount(0);
});
