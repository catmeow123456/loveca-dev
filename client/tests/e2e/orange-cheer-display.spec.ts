import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';

test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
test.setTimeout(60_000);

const fixturePath = '/tests/recovery-review/cheerFixture.ts';
const panel = (page: Page) => page.locator('#judgment-panel');
const orangeCount = (page: Page) =>
  panel(page).locator('[data-cheer-heart-color="ORANGE"] [data-cheer-heart-count]');

async function openIsolatedBattle(page: Page) {
  const base = new URL(test.info().project.use.baseURL as string);
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === base.origin ? route.fallback() : route.abort();
  });
  await installVisualApiMocks(page, false);
  await page.route('**/site-status.json*', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        availability: 'OPEN',
        generatedAt: new Date().toISOString(),
        maintenance: null,
      },
    })
  );
  // Neutral card faces make the real colored Heart assets unambiguous in evidence.
  await page.route(/\/images\/(?:thumb|medium|large)\/PL[^/]*\.webp(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" rx="14" fill="#d1d5db"/><path d="M35 55h230v300H35z" fill="#e5e7eb"/><text x="150" y="205" text-anchor="middle" font-size="24" fill="#374151">LOCAL FIXTURE</text></svg>',
    })
  );
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('loveca-theme', 'dark');
    const observed: string[] = [];
    Object.assign(window, { orangeCheerSpriteSources: observed });
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      image: CanvasImageSource,
      ...args: number[]
    ) {
      if (this.canvas.closest('.cheer-motion-overlay') && image instanceof HTMLImageElement)
        observed.push(image.currentSrc || image.src);
      return Reflect.apply(drawImage, this, [image, ...args]);
    };
  });
  await page.goto('/?page=game');
  await page.evaluate(async () => {
    const authPath = '/src/store/authStore.ts';
    const { useAuthStore } = await import(authPath);
    useAuthStore.getState().enterOfflineMode('橙色声援本地验收');
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

async function seed(page: Page, requirement: 'RAINBOW' | 'ORANGE', memberOrange = false) {
  await page.evaluate(
    async ({ fixturePath, requirement, memberOrange }) => {
      const { prepareCheer, cheerReviewStore } = await import(fixturePath);
      prepareCheer(true, 2);
      const store = cheerReviewStore.getState();
      const session = store.gameSession;
      const original = session.state;
      const registry = new Map(original.cardRegistry);
      const replace = (id: string, patch: Record<string, unknown>) => {
        const card = registry.get(id) as { data: Record<string, unknown> };
        registry.set(id, { ...card, data: { ...card.data, ...patch } });
      };
      replace('member-green', { hearts: memberOrange ? [{ color: 'ORANGE', count: 1 }] : [] });
      replace('member-yellow', { hearts: [] });
      replace('cheer-0', { bladeHearts: [{ effect: 'HEART', heartColor: 'ORANGE' }] });
      replace('cheer-1', { bladeHearts: [] });
      const required = requirement === 'RAINBOW' ? 2 : 1;
      replace('live-0', {
        requirements: {
          colorRequirements: new Map([[requirement, required]]),
          totalRequired: required,
        },
      });
      session.authorityState = {
        ...original,
        cardRegistry: registry,
        manualOperationMode: 'RULES',
        liveResolution: {
          ...original.liveResolution,
          liveModifiers: [
            ...original.liveResolution.liveModifiers,
            {
              kind: 'CHEER_CARD_BLADE_HEART_GRANT',
              playerId: 'p1',
              maxMemberCost: 4,
              heartColor: 'ORANGE',
              sourceCardId: 'local-snow-rule',
            },
          ],
        },
      };
      store.loadCardData([...registry.values()].map((card) => (card as { data: unknown }).data));
      store.syncState();
      const motionPath = '/src/components/game/cheerMotion.ts';
      const { warmCheerAssets } = await import(motionPath);
      await warmCheerAssets();
    },
    { fixturePath, requirement, memberOrange }
  );
  await expect(page.locator('[data-battle-ui-anchor="self-main-deck"]')).toBeVisible();
}

async function pauseClock(page: Page) {
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
}

async function reveal(page: Page) {
  const result = await page.evaluate(async (fixturePath) => {
    const { cheerReviewStore } = await import(fixturePath);
    return cheerReviewStore.getState().confirmSubPhase('PERFORMANCE_LIVE_START_EFFECTS');
  }, fixturePath);
  expect(result).toMatchObject({ success: true });
  await page.clock.runFor(16);
  await expect(panel(page).locator('[data-cheer-card-id]')).toHaveCount(2);
}

async function motionTime(page: Page, at: number) {
  for (let i = 0; i < 180; i++) {
    const value = await page
      .locator('.cheer-motion-overlay')
      .getAttribute('data-cheer-motion-time');
    if (value !== null && Number(value) >= at) return;
    await page.clock.runFor(16);
  }
  throw new Error(`Cheer motion did not reach ${at}ms`);
}

async function expectOrangeDisplay(page: Page, count: number) {
  await expect(orangeCount(page)).toHaveText(String(count));
  await expect(panel(page).locator('[data-cheer-heart-color="GRAY"]')).toHaveCount(0);
  const icons = panel(page).locator('[data-cheer-card-summary] img');
  await expect(icons).toHaveCount(2);
  for (const icon of await icons.all()) await expect(icon).toHaveAttribute('src', /heart_orange/);
  await expect(panel(page).locator('[data-cheer-total]')).toContainText(`总计 ${count}`);
}

async function authoritativeJudgment(page: Page, success: boolean, memberOrange = false) {
  const result = await page.evaluate(async (fixturePath) => {
    const { cheerReviewStore } = await import(fixturePath);
    const store = cheerReviewStore.getState();
    const command = store.confirmJudgment(new Map());
    return {
      command,
      result: store.gameSession.state.liveResolution.liveResults.get('live-0'),
      hearts: store.gameSession.state.liveResolution.playerLiveJudgmentHearts.get('p1'),
    };
  }, fixturePath);
  expect(result.command).toMatchObject({ success: true });
  expect(result.result).toBe(success);
  expect(result.hearts).toContainEqual({ color: 'GRAY', count: 2 });
  expect(result.hearts?.filter((heart: { color: string }) => heart.color === 'ORANGE')).toEqual(
    memberOrange ? [{ color: 'ORANGE', count: 1 }] : []
  );
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(name) });
}

test('printed and Snow-granted orange stay orange in flight, per-card icons and totals while generic judgment uses gray', async ({
  page,
}, info) => {
  await openIsolatedBattle(page);
  await seed(page, 'RAINBOW');
  await page.waitForTimeout(350);
  await pauseClock(page);
  await reveal(page);
  await motionTime(page, 250);
  await expect(page.locator('.cheer-motion-overlay canvas')).toBeVisible();
  const sprites = await page.evaluate(
    () => (window as unknown as { orangeCheerSpriteSources: string[] }).orangeCheerSpriteSources
  );
  expect(sprites.length).toBeGreaterThan(0);
  expect(sprites.every((source) => source.includes('heart_orange'))).toBe(true);
  expect(
    await page.locator('.cheer-motion-overlay canvas').evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let orangePixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          pixels[index + 3] > 100 &&
          pixels[index] > 150 &&
          pixels[index + 1] > 50 &&
          pixels[index + 1] < pixels[index] * 0.9 &&
          pixels[index + 2] < 120
        )
          orangePixels++;
      }
      return orangePixels;
    })
  ).toBeGreaterThan(0);
  await screenshot(page, info, 'orange-flight.png');
  await motionTime(page, 510);
  await expect(page.locator('[data-cheer-live-success]')).toBeVisible();
  await page.clock.runFor(3000);
  await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
  await expectOrangeDisplay(page, 2);
  await expect(panel(page).locator('[data-cheer-outcome]')).toContainText('判定成功');
  await screenshot(page, info, 'orange-settled.png');
  await authoritativeJudgment(page, true);
});

test('orange cheer cannot fill a specified orange requirement or produce a false LIVE-success animation', async ({
  page,
}, info) => {
  await openIsolatedBattle(page);
  await seed(page, 'ORANGE');
  await page.waitForTimeout(350);
  await pauseClock(page);
  await reveal(page);
  await motionTime(page, 510);
  await expect(page.locator('[data-cheer-live-success]')).toHaveCount(0);
  await page.clock.runFor(3000);
  await expectOrangeDisplay(page, 2);
  await expect(panel(page).locator('[data-cheer-outcome]')).toContainText('判定失败');
  await screenshot(page, info, 'orange-specific-failed.png');
  await authoritativeJudgment(page, false);
});

test('reduced motion retains orange displays and separates ordinary member orange from cheer contributions', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openIsolatedBattle(page);
  await seed(page, 'ORANGE');
  await page.waitForTimeout(300);
  await pauseClock(page);
  await reveal(page);
  await page.clock.runFor(400);
  await expect(page.locator('[data-cheer-live-success]')).toHaveCount(0);
  await expectOrangeDisplay(page, 2);
  await expect(panel(page).locator('[data-cheer-outcome]')).toContainText('判定失败');
  await authoritativeJudgment(page, false);
  await seed(page, 'ORANGE', true);
  await page.clock.runFor(400);
  await reveal(page);
  await page.clock.runFor(3000);
  await expectOrangeDisplay(page, 3);
  await expect(panel(page).locator('[data-cheer-outcome]')).toContainText('判定成功');
  await screenshot(page, info, 'orange-reduced-member-success.png');
  await authoritativeJudgment(page, true, true);
});
