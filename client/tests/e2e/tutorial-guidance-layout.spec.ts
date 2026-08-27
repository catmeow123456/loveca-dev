import { expect, test, type Page, type TestInfo } from '@playwright/test';

interface RectMetrics {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

function overlapArea(left: RectMetrics, right: RectMetrics): number {
  return (
    Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) *
    Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
  );
}

async function readRect(page: Page, selector: string): Promise<RectMetrics> {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function expectTransferGuidanceClear(page: Page, viewportLabel: string) {
  const calloutSelector = '[data-tutorial-callout="true"]';
  const sourceSelector = '[data-tutorial-interaction-target="source"]';
  const destinationSelector = '[data-tutorial-interaction-target="destination"]';

  await expect(page.locator(calloutSelector)).toHaveAttribute(
    'data-tutorial-callout-mode',
    'COMPACT'
  );
  await expect(page.locator(calloutSelector)).toBeVisible();
  await expect(page.locator(sourceSelector)).toBeVisible();
  await expect(page.locator(destinationSelector)).toBeVisible();

  await expect
    .poll(
      async () => {
        const [callout, source, destination] = await Promise.all([
          readRect(page, calloutSelector),
          readRect(page, sourceSelector),
          readRect(page, destinationSelector),
        ]);
        return {
          sourceOverlap: overlapArea(callout, source),
          destinationOverlap: overlapArea(callout, destination),
        };
      },
      { message: `${viewportLabel}: transfer guidance did not settle without overlap` }
    )
    .toEqual({ sourceOverlap: 0, destinationOverlap: 0 });

  const [source, destination, viewport] = await Promise.all([
    readRect(page, sourceSelector),
    readRect(page, destinationSelector),
    page.evaluate(() => ({
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
    })),
  ]);

  for (const [label, rect] of [
    ['source', source],
    ['destination', destination],
  ] as const) {
    expect(rect.left, `${viewportLabel}: ${label} leaves viewport left`).toBeGreaterThanOrEqual(-1);
    expect(rect.top, `${viewportLabel}: ${label} leaves viewport top`).toBeGreaterThanOrEqual(-1);
    expect(rect.right, `${viewportLabel}: ${label} leaves viewport right`).toBeLessThanOrEqual(
      viewport.width + 1
    );
    expect(rect.bottom, `${viewportLabel}: ${label} leaves viewport bottom`).toBeLessThanOrEqual(
      viewport.height + 1
    );
  }
}

async function completeCurrentTransfer(page: Page) {
  const sourceObjectId = await page
    .locator('[data-tutorial-interaction-target="source"]')
    .getAttribute('data-tutorial-target-object-id');
  const destinationAnchor = await page
    .locator('[data-tutorial-interaction-target="destination"]')
    .getAttribute('data-tutorial-target-anchor');
  expect(sourceObjectId).toBeTruthy();
  expect(destinationAnchor).toBeTruthy();
  await page.locator(`[data-object-id="${sourceObjectId}"]`).click();
  await page.locator(`[data-battle-ui-anchor="${destinationAnchor}"]`).click();
}

test.describe('tutorial transfer guidance', () => {
  test('keeps source, destination, and compact callout mutually clear on narrow viewports', async ({
    page,
  }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '教程响应式矩阵只需执行一次');

    await page.goto('/tutorial');
    await page.getByRole('button', { name: /场攻估算与 LIVE 配置/ }).click();
    await expect(page.locator('[data-tutorial-step="count-final-stage-hearts"]')).toBeVisible();
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.locator('[data-tutorial-step="compare-final-live-options"]')).toBeVisible();
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.locator('[data-tutorial-step="set-final-live-one"]')).toBeVisible();

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 360, height: 640 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ]) {
      await page.setViewportSize(viewport);
      await expectTransferGuidanceClear(page, `${viewport.width}x${viewport.height}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await completeCurrentTransfer(page);
    await expect(page.locator('[data-tutorial-step="set-final-live-two"]')).toBeVisible();
    await expectTransferGuidanceClear(page, 'second transfer');

    const screenshotPath = testInfo.outputPath('tutorial-transfer-guidance-390x844.png');
    await page.screenshot({ path: screenshotPath, animations: 'disabled' });
    await testInfo.attach('tutorial-transfer-guidance-390x844', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test('does not spotlight the saved LIVE during the two-card discard choice', async ({
    page,
  }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '教程响应式检查只需执行一次');

    await page.goto('/tutorial');
    await page.getByRole('button', { name: /换手与触发能力/ }).click();
    for (const stepId of [
      'advanced-welcome',
      'read-relay-cost',
      'read-hearts-and-blade',
      'read-on-enter-effect',
    ]) {
      await expect(page.locator(`[data-tutorial-step="${stepId}"]`)).toBeVisible();
      await page.getByRole('button', { name: '下一步' }).click();
    }

    await expect(page.locator('[data-tutorial-step="relay-to-center"]')).toBeVisible();
    await completeCurrentTransfer(page);
    await expect(page.locator('[data-tutorial-step="effect-window"]')).toBeVisible();
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.locator('[data-tutorial-step="resolve-relay-discard"]')).toBeVisible();

    const spotlights = page.locator('[data-tutorial-spotlight-index]');
    await expect(spotlights).toHaveCount(2);
    await expect(spotlights.nth(0)).toHaveAttribute(
      'data-tutorial-target-anchor',
      'active-effect-selection'
    );
    await expect(spotlights.nth(1)).toHaveAttribute(
      'data-tutorial-target-anchor',
      'active-effect-confirm'
    );
    await expect(
      page.locator('[data-tutorial-target-object-id], [data-tutorial-elevated-hand-card]')
    ).toHaveCount(0);

    const screenshotPath = testInfo.outputPath('relay-discard-without-live-spotlight.png');
    await page.screenshot({ path: screenshotPath, animations: 'disabled' });
    await testInfo.attach('relay-discard-without-live-spotlight', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });
});
