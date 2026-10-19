import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
const play = (page: Page) => page.getByRole('button', { name: '播放三张声援', exact: true });
const originalCards = (page: Page) => page.locator('#judgment-panel [data-cheer-card-id]');
async function prepare(page: Page) {
  await page.goto('/cheer.html');
  await expect(play(page)).toBeEnabled();
  await expect(page.locator('#judgment-panel')).toBeVisible();
  await page.waitForTimeout(300);
}
async function clock(page: Page) {
  const time = new Date(); // Keep authority deadlines monotonic when installing the fake clock.
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}
async function motionTime(page: Page, at: number) {
  // Advance requestAnimationFrame with React/Framer commits between frames.
  for (let i = 0; i < 180; i++) {
    const value = await page
      .locator('.cheer-motion-overlay')
      .getAttribute('data-cheer-motion-time');
    if (value !== null && Number(value) >= at) return;
    await page.clock.runFor(16);
  }
  throw new Error('Cheer presentation did not start after the panel settled');
}
async function final(page: Page) {
  await expect(originalCards(page)).toHaveCount(3);
  await expect(page.locator('#judgment-panel [data-cheer-total]')).toContainText('总计 6');
  await expect(
    page.locator('#judgment-panel [data-cheer-heart-color="GREEN"] [data-cheer-heart-count]')
  ).toHaveText('4');
  await expect(
    page.locator('#judgment-panel [data-cheer-heart-color="YELLOW"] [data-cheer-heart-count]')
  ).toHaveText('2');
  await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
  await expect(page.locator('#judgment-panel [style*="visibility: hidden"]')).toHaveCount(0);
  await expect(page.locator('[data-cheer-outcome]')).toContainText('判定成功');
}
for (const narrow of [false, true])
  test(`shared board choreography and settled counts ${narrow ? 'mobile' : 'desktop'}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page);
    await page.screenshot({ path: info.outputPath('before.png') });
    await clock(page);
    await play(page).click();
    await page.clock.runFor(400);
    await motionTime(page, 140);
    await expect(originalCards(page)).toHaveCount(3);
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(1);
    // Hearts are already in motion while the cards are still turning.
    await expect(page.locator('.cheer-motion-flip').first()).toBeVisible();
    expect(
      await page.locator('.cheer-motion-overlay canvas').evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas
          .getContext('2d')!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        return pixels.some((value, index) => index % 4 === 3 && value > 0);
      })
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('flip.png') });
    await motionTime(page, 280);
    await expect(
      page.locator('[data-cheer-motion-count="GREEN"] [data-cheer-heart-count]')
    ).toHaveText('2');
    await page.screenshot({ path: info.outputPath('hearts-in-flight.png') });
    await page.screenshot({
      path: info.outputPath('panel-in-flight.png'),
      clip: { x: 0, y: 110, width: narrow ? 390 : 420, height: narrow ? 580 : 580 },
    });
    const visiblePanel = await page.locator('#judgment-panel').boundingBox();
    expect(visiblePanel!.x).toBeGreaterThanOrEqual(0);
    expect(visiblePanel!.x + visiblePanel!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.clock.runFor(2000);
    await final(page);
    await page.screenshot({ path: info.outputPath('settled.png') });
    // Opponent hand remains a card back throughout the shared projected view.
    if (!narrow)
      await expect(page.locator('[data-battle-ui-anchor="opponent-hand"] img')).toHaveAttribute(
        'alt',
        'Card Back'
      );
    else
      await expect(
        page.getByRole('button', { name: 'P2 对方，手牌 1 张，切换至此视角' })
      ).toHaveCount(1);
    expect(errors).toEqual([]);
  });
test('reset during flight cancels old presentation and no late reveal occurs', async ({ page }) => {
  await prepare(page);
  await clock(page);
  await play(page).click();
  await page.clock.runFor(400);
  await motionTime(page, 200);
  await page.getByRole('button', { name: '重新准备', exact: true }).click();
  await page.clock.runFor(4000);
  await expect(originalCards(page)).toHaveCount(0);
  await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
  await expect(page.locator('[data-cheer-total]')).toContainText('总计 3');
  await play(page).click();
  await page.clock.runFor(3200);
  await final(page);
});
test('original comparison and reduced motion retain the same result', async ({ page }) => {
  await prepare(page);
  await page.getByLabel('展示方式').selectOption('original');
  await play(page).click();
  await expect(originalCards(page)).toHaveCount(3);
  await final(page);
  await page.getByLabel('展示方式').selectOption('preview');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await play(page).click();
  await expect(play(page)).toBeEnabled();
  await final(page);
});
test('half speed and resize restore real cards and counters', async ({ page }) => {
  await prepare(page);
  await page.getByLabel('播放速度').selectOption('0.5');
  await clock(page);
  await play(page).click();
  await page.clock.runFor(800);
  await expect(page.locator('.cheer-motion-overlay')).toHaveCount(1);
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.clock.runFor(100);
  await final(page);
});

test('closing the panel during flight releases the presentation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await clock(page);
  await play(page).click();
  await page.clock.runFor(400);
  await motionTime(page, 200);
  await page.getByRole('button', { name: '收起应援/判定区', exact: true }).click();
  await page.clock.runFor(500);
  await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
  await expect(play(page)).toBeEnabled();
});

// Exercise the ordinary App -> GameBoard, with no review context or play button.
// Only the initial local position is seeded; automatic and additional cheer use real commands.
for (const narrow of [false, true])
  test(`5173 normal battle automatic and additional cheer ${narrow ? 'mobile' : 'desktop'}`, async ({
    page,
  }, info) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:5173/?page=game');
    await page.evaluate(async () => {
      const fixturePath = '/tests/recovery-review/cheerFixture.ts';
      const authPath = '/src/store/authStore.ts';
      const { prepareCheer } = await import(fixturePath);
      const { useAuthStore } = await import(authPath);
      useAuthStore.getState().enterOfflineMode('声援本地验收');
      await new Promise((resolve) => setTimeout(resolve, 250));
      prepareCheer(true);
    });
    await expect(page.locator('[data-battle-ui-anchor="self-main-deck"]')).toBeVisible();
    await page.waitForTimeout(350);
    await clock(page);
    const result = await page.evaluate(async () => {
      const fixturePath = '/tests/recovery-review/cheerFixture.ts';
      const { cheerReviewStore: useGameStore } = await import(fixturePath);
      return useGameStore.getState().confirmSubPhase('PERFORMANCE_LIVE_START_EFFECTS');
    });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    await page.clock.runFor(16);
    await expect(originalCards(page)).toHaveCount(3);
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(1);
    await expect(page.locator('.cheer-motion-flip')).toHaveCount(3);
    // The final front faces and totals must be masked in the panel's very first frame.
    await expect(page.locator('#judgment-panel > .cheer-motion-overlay')).toHaveCount(1);
    for (const card of await originalCards(page).all())
      await expect(card).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#judgment-panel [data-cheer-total]')).toHaveCSS(
      'visibility',
      'hidden'
    );
    await expect(
      page.locator('[data-cheer-motion-count="GREEN"] [data-cheer-heart-count]')
    ).toHaveText('2');
    await motionTime(page, 150);
    const chipBounds = await page.locator('[data-cheer-motion-count="GREEN"]').boundingBox();
    expect(chipBounds!.x).toBeGreaterThanOrEqual(0);
    expect(chipBounds!.x + chipBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await motionTime(page, 280);
    await page.screenshot({ path: info.outputPath('normal-battle-flight.png') });
    await page.clock.runFor(1600);
    await final(page);
    await page.screenshot({ path: info.outputPath('normal-battle-settled.png') });
    await page.getByRole('button', { name: /翻开一张/ }).click();
    await page.clock.runFor(100);
    await expect(originalCards(page)).toHaveCount(4);
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(1);
    await expect(page.locator('.cheer-motion-flip')).toHaveCount(1);
    await expect(
      page.locator('[data-cheer-motion-count="GREEN"] [data-cheer-heart-count]')
    ).toHaveText('4');
    await page.clock.runFor(1700);
    await expect(page.locator('[data-cheer-total]')).toContainText('总计 7');
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
    await expect(page.locator('#judgment-panel [style*="visibility: hidden"]')).toHaveCount(0);
    // Move a revealed card back using the ordinary command, then reveal it again.
    const moved = await page.evaluate(async () => {
      const fixturePath = '/tests/recovery-review/cheerFixture.ts';
      const { cheerReviewStore: useGameStore } = await import(fixturePath);
      return useGameStore
        .getState()
        .moveResolutionCardToZone('remaining', 'MAIN_DECK', { position: 'TOP' });
    });
    expect(moved.success).toBe(true);
    await page.clock.runFor(300);
    await expect(originalCards(page)).toHaveCount(3);
    await page.getByRole('button', { name: /翻开一张/ }).click();
    await page.clock.runFor(120);
    await expect(page.locator('.cheer-motion-flip')).toHaveCount(1);
    await page.getByRole('button', { name: '查看后攻玩家 对方 的判定' }).click();
    await page.clock.runFor(50);
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: '查看先攻玩家 己方 的判定' }).click();
    await page.clock.runFor(1800);
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
    await expect(page.locator('[data-cheer-total]')).toContainText('总计 7');
    await expect(page.locator('#judgment-panel [style*="visibility: hidden"]')).toHaveCount(0);
  });

test('large cheer batch uses effective heart colors and finishes within the half-speed window', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(async () => {
    const fixturePath = '/cheerFixture.ts';
    const { prepareCheer } = await import(fixturePath);
    prepareCheer(false, 20, true);
  });
  await page.waitForTimeout(100);
  await clock(page);
  const outcomes = await page.evaluate(async (storePath) => {
    const { cheerReviewStore: useGameStore } = await import(storePath);
    return Array.from({ length: 20 }, () => useGameStore.getState().revealCheerCard().success);
  }, '/cheerFixture.ts');
  expect(outcomes.every(Boolean)).toBe(true);
  await page.clock.runFor(100);
  await expect(originalCards(page)).toHaveCount(20);
  await expect(page.locator('.cheer-motion-overlay')).toHaveCount(1);
  await expect(page.locator('.cheer-motion-flip')).toHaveCount(20);
  await expect(
    page.locator('[data-cheer-motion-count="BLUE"] [data-cheer-heart-count]')
  ).toHaveText('0');
  await motionTime(page, 600);
  const intermediate = Number(
    await page.locator('[data-cheer-motion-count="BLUE"] [data-cheer-heart-count]').textContent()
  );
  expect(intermediate).toBeGreaterThan(0);
  expect(intermediate).toBeLessThan(20);
  // Later cards are still turning while earlier hearts have already reached the count.
  expect(
    await originalCards(page).evaluateAll(
      (cards) => cards.filter((card) => getComputedStyle(card).visibility === 'hidden').length
    )
  ).toBeGreaterThan(0);
  await page.clock.runFor(1000);
  await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
  await expect(page.locator('[data-cheer-total]')).toContainText('总计 23');
  await expect(page.locator('[data-cheer-heart-color="BLUE"] [data-cheer-heart-count]')).toHaveText(
    '20'
  );
  await expect(page.locator('#judgment-panel [style*="visibility: hidden"]')).toHaveCount(0);
});

for (const narrow of [false, true])
  test(`5173 twenty-card automatic batch never shows final results before the reveal ${narrow ? 'mobile' : 'desktop'}`, async ({
    page,
  }, info) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:5173/?page=game');
    await page.evaluate(async () => {
      const fixturePath = '/tests/recovery-review/cheerFixture.ts';
      const authPath = '/src/store/authStore.ts';
      const { prepareCheer } = await import(fixturePath);
      const { useAuthStore } = await import(authPath);
      useAuthStore.getState().enterOfflineMode('声援本地验收');
      await new Promise((resolve) => setTimeout(resolve, 250));
      prepareCheer(true, 20, true);
    });
    await expect(page.locator('[data-battle-ui-anchor="self-main-deck"]')).toBeVisible();
    await page.waitForTimeout(300);
    await clock(page);
    const result = await page.evaluate(async () => {
      const fixturePath = '/tests/recovery-review/cheerFixture.ts';
      const { cheerReviewStore: useGameStore } = await import(fixturePath);
      return useGameStore.getState().confirmSubPhase('PERFORMANCE_LIVE_START_EFFECTS');
    });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    await page.clock.runFor(16);
    await expect(originalCards(page)).toHaveCount(20);
    // Before any display frame can reveal the final result, the full batch is held on backs.
    expect(
      await originalCards(page).evaluateAll((cards) =>
        cards.every((card) => getComputedStyle(card).visibility === 'hidden')
      )
    ).toBe(true);
    await expect(page.locator('[data-cheer-total]')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('[data-cheer-outcome]')).toHaveCSS('visibility', 'hidden');
    await expect(
      page.locator('[data-cheer-motion-count="BLUE"] [data-cheer-heart-count]')
    ).toHaveText('0');
    await motionTime(page, 0);
    await page.clock.runFor(400);
    const halfSpeedTime = Number(
      await page.locator('.cheer-motion-overlay').getAttribute('data-cheer-motion-time')
    );
    expect(halfSpeedTime).toBeGreaterThanOrEqual(190);
    expect(halfSpeedTime).toBeLessThanOrEqual(220);
    await page.screenshot({ path: info.outputPath('twenty-backs.png') });
    await motionTime(page, 150);
    await page.screenshot({ path: info.outputPath('twenty-flipping.png') });
    await motionTime(page, 600);
    const count = Number(
      await page.locator('[data-cheer-motion-count="BLUE"] [data-cheer-heart-count]').textContent()
    );
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
    await expect(page.locator('.cheer-motion-progress')).not.toHaveText('翻牌 20/20');
    const scroll = await page.locator('[data-cheer-strip]').evaluate((strip) => {
      const cards = strip.querySelectorAll('[data-cheer-card-id]');
      const motion = document.querySelector<HTMLElement>('.cheer-motion-overlay')!;
      const latest = Math.min(
        19,
        Math.floor((Number(motion.dataset.cheerMotionTime) - 100) / (560 / 19))
      );
      const card = cards[latest].getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      return {
        left: strip.scrollLeft,
        latest,
        visible: card.left >= bounds.left && card.right <= bounds.right,
      };
    });
    expect(scroll.left).toBeGreaterThan(500);
    expect(scroll.visible).toBe(true);
    await expect(page.locator('[data-cheer-live-success]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('twenty-counting.png') });
    await page.clock.runFor(1000);
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
    await expect(
      page.locator('[data-cheer-heart-color="BLUE"] [data-cheer-heart-count]')
    ).toHaveText('20');
    await expect(page.locator('[data-cheer-total]')).toContainText('总计 23');
    await expect(page.locator('#judgment-panel [style*="visibility: hidden"]')).toHaveCount(0);
    expect(
      await page.locator('[data-cheer-strip]').evaluate((strip) => {
        const last = strip
          .querySelector('[data-cheer-card-id="cheer-19"]')!
          .getBoundingClientRect();
        const bounds = strip.getBoundingClientRect();
        return last.left >= bounds.left && last.right <= bounds.right;
      })
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('twenty-settled.png') });
  });

for (const opponent of [false, true])
  test(`whole LIVE group celebrates at the displayed threshold ${opponent ? 'opponent mobile' : 'self desktop'}`, async ({
    page,
  }, info) => {
    if (opponent) await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page);
    await page.evaluate(
      async ({ storePath, opponent }) => {
        const fixturePath = '/cheerFixture.ts';
        const { prepareCheer } = await import(fixturePath);
        const { cheerReviewStore: useGameStore } = await import(storePath);
        prepareCheer(true, 20, false, 2);
        if (opponent) {
          useGameStore.setState({ viewingPlayerId: 'p2' });
          useGameStore.getState().syncState();
        }
      },
      {
        storePath: '/cheerFixture.ts',
        opponent,
      }
    );
    await page.waitForTimeout(350);
    await clock(page);
    const result = await page.evaluate(
      async ({ storePath, commandPath }) => {
        const { cheerReviewStore: useGameStore } = await import(storePath);
        const { createConfirmStepCommand } = await import(commandPath);
        const store = useGameStore.getState();
        const result = store.gameSession.executeCommand(
          createConfirmStepCommand('p1', 'PERFORMANCE_LIVE_START_EFFECTS')
        );
        store.syncState();
        return result;
      },
      {
        storePath: '/cheerFixture.ts',
        commandPath:
          '/@fs' + path.resolve(import.meta.dirname, '../../../src/application/game-commands.ts'),
      }
    );
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    await motionTime(page, 600);
    // One LIVE would already succeed, but the two-card group's merged requirement does not.
    await expect(page.locator('[data-cheer-live-success]')).toHaveCount(0);
    await motionTime(page, 760);
    const notice = page.locator('[data-cheer-live-success]');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('LIVE成功');
    expect(
      Number(
        await page
          .locator('[data-cheer-motion-count="GREEN"] [data-cheer-heart-count]')
          .textContent()
      )
    ).toBeGreaterThanOrEqual(8);
    expect(
      Number(
        await page
          .locator('[data-cheer-motion-count="GREEN"] [data-cheer-heart-count]')
          .textContent()
      )
    ).toBeLessThan(15);
    await page.screenshot({ path: info.outputPath('whole-live-success.png') });
    await page.clock.runFor(1300);
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
    await expect(page.locator('[data-cheer-outcome]')).toContainText('判定成功');
    // An additional card after success must not celebrate the same group a second time.
    if (!opponent) {
      await page.getByRole('button', { name: /翻开一张/ }).click();
      await motionTime(page, 450);
      await expect(page.locator('[data-cheer-live-success]')).toHaveCount(0);
      await page.clock.runFor(500);
      await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
    }
  });

test('manual strip interaction cancels following and leaves usable cards', async ({ page }) => {
  await prepare(page);
  await clock(page);
  await page.getByRole('button', { name: '播放二十张声援', exact: true }).click();
  await page.clock.runFor(400);
  await motionTime(page, 500);
  await page.locator('[data-cheer-strip]').dispatchEvent('wheel', { deltaX: -100 });
  await page.clock.runFor(100);
  await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
  await expect(page.locator('#judgment-panel [style*="visibility: hidden"]')).toHaveCount(0);
  await expect(page.locator('[data-cheer-total]')).toContainText('总计 23');
});

test('already-satisfied initial LIVE still announces once, while no LIVE never announces', async ({
  page,
}) => {
  await prepare(page);
  await clock(page);
  for (const liveCount of [1, 0]) {
    await page.evaluate(
      async ({ storePath, liveCount }) => {
        const fixturePath = '/cheerFixture.ts';
        const { prepareCheer } = await import(fixturePath);
        prepareCheer(false, 3, false, liveCount, true);
      },
      {
        storePath: '/cheerFixture.ts',
        liveCount,
      }
    );
    await page.clock.runFor(400);
    await page.evaluate(async (storePath) => {
      const { cheerReviewStore: useGameStore } = await import(storePath);
      for (let i = 0; i < 3; i++) useGameStore.getState().revealCheerCard();
    }, '/cheerFixture.ts');
    await motionTime(page, 200);
    await expect(page.locator('[data-cheer-live-success]')).toHaveCount(liveCount);
    await page.clock.runFor(1600);
    await expect(page.locator('.cheer-motion-overlay')).toHaveCount(0);
  }
});
