import { test, expect, type Page } from '@playwright/test';

const residue = (page: Page) =>
  page.locator(
    '[data-card-surface-lighting], .card-landing-neighbor-shadow, [data-landing-ground-light]'
  );
async function prepare(page: Page) {
  await page.goto('/landing.html');
  await expect(page.getByRole('button', { name: '普通登场', exact: true })).toBeVisible();
  await page.waitForFunction(() =>
    [...document.images]
      .filter((i) => i.getBoundingClientRect().width > 0)
      .every((i) => i.complete && i.naturalWidth > 0)
  );
}
async function start(page: Page, special = false) {
  await page
    .getByRole('button', { name: special ? '特殊登场（回流）' : '普通登场', exact: true })
    .click();
  await expect(page.locator('.card-entrance-presentation')).toHaveAttribute(
    'data-phase',
    'playing'
  );
}
async function settled(page: Page) {
  await expect(page.locator('.card-entrance-presentation')).toHaveCount(0);
  await expect(residue(page)).toHaveCount(0);
  await expect(page.locator('[data-object-id="obj_mia"]').first()).toBeVisible();
  expect(
    await page.locator('[data-card-surface]').evaluateAll((nodes) =>
      nodes.every((n) => {
        const style = getComputedStyle(n);
        return style.visibility === 'visible' && !style.transform.includes('matrix3d');
      })
    )
  ).toBe(true);
}

for (const narrow of [false, true]) {
  test(`real landing on ${narrow ? 'mobile' : 'desktop'} has texture, correct masking and clean end`, async ({
    page,
  }, info) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await prepare(page);
    const handBefore = await page.locator('.battle-hand-zone').first().boundingBox();
    await page.screenshot({ path: info.outputPath('before.png') });
    await start(page);
    await expect(page.locator('.card-landing-card [data-card-surface-lighting]')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('flight.png') });
    const light = page.locator('[data-landing-ground-light]');
    await page.waitForFunction(() => !!document.querySelector('[data-landing-ground-light]'));
    await page.waitForTimeout(65);
    const sample = await light.evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      const rect = canvas.getBoundingClientRect();
      const target = document
        .querySelector<HTMLElement>('[data-object-id="obj_mia"]')!
        .getBoundingClientRect();
      const x = Math.floor(
        ((target.left + target.width / 2 - rect.left) * canvas.width) / rect.width
      );
      const y = Math.floor(
        ((target.top + target.height / 2 - rect.top) * canvas.height) / rect.height
      );
      return {
        litPixels: pixels.data.filter((v, i) => i % 4 === 3 && v > 0).length,
        cardCenterAlpha: pixels.data[(y * canvas.width + x) * 4 + 3],
        surfaces: document.querySelectorAll('[data-card-surface-lighting]').length,
      };
    });
    expect(sample.litPixels).toBeGreaterThan(100);
    expect(sample.cardCenterAlpha).toBe(0);
    expect(sample.surfaces).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath('impact.png') });
    await settled(page);
    if (handBefore) {
      const handAfter = (await page.locator('.battle-hand-zone').first().boundingBox())!;
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(handAfter[key] - handBefore[key])).toBeLessThan(1);
    }
    await page.screenshot({ path: info.outputPath('settled.png') });
    expect(errors).toEqual([]);
  });
}

test('opposite public seat and existing waiting-room return still reach the new landing', async ({
  page,
}, info) => {
  await prepare(page);
  await page.getByRole('button', { name: '切换视角', exact: true }).click();
  await start(page, true);
  await expect(page.locator('.waiting-return-entrance')).toHaveCount(1);
  await page.waitForFunction(
    () => !!document.querySelector('[data-landing-ground-light]'),
    undefined,
    { timeout: 10000 }
  );
  await page.screenshot({ path: info.outputPath('opponent-impact.png') });
  await settled(page);
});

test('skip during impact clears lights, neighbor poses and shadows', async ({ page }) => {
  await prepare(page);
  await start(page);
  await page.waitForFunction(() => !!document.querySelector('[data-landing-ground-light]'));
  await page.getByRole('button', { name: '跳过演出', exact: true }).click();
  await settled(page);
});

test('unavailable optional textures preserve landing and completion', async ({ page }, info) => {
  await page.route('**/impact-textures/*.png', (route) => route.abort());
  await prepare(page);
  await start(page);
  await page.waitForFunction(() => !!document.querySelector('[data-landing-ground-light]'));
  await page.screenshot({ path: info.outputPath('fallback-ring.png') });
  await settled(page);
});

test('reduced motion never creates flight, impact or neighbor lighting', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await page.evaluate(() => {
    document.documentElement.dataset.sawLanding = 'false';
    new MutationObserver(() => {
      if (document.querySelector('.card-landing, [data-card-surface-lighting]'))
        document.documentElement.dataset.sawLanding = 'true';
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('button', { name: '普通登场', exact: true }).click();
  await expect(page.locator('.review-bar [role=status]')).toContainText('已执行');
  await expect(page.locator('[data-object-id="obj_mia"]').first()).toBeVisible();
  await expect(page.locator('.card-entrance-presentation')).toHaveCount(0);
  await expect(residue(page)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-saw-landing', 'false');
});
