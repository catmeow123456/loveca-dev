import { expect, test } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';

const fixture = '/tests/recovery-review/rikoZeroCostFixture.ts';
test.use({ serviceWorkers: 'block' });

test('Riko can decline or pay zero from the board even without an eligible LIVE', async ({
  page,
}, info) => {
  const origin = new URL(info.project.use.baseURL as string).origin;
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  );
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
  await page.goto('/?page=game');
  await page.evaluate(async (path) => {
    const authPath = '/src/store/authStore.ts';
    const { useAuthStore } = await import(authPath);
    useAuthStore.getState().enterOfflineMode('梨子零张费用验收');
    (await import(path)).prepareRikoZeroCost();
  }, fixture);
  const outcome = () =>
    page.evaluate(async (path) => (await import(path)).rikoZeroCostOutcome(), fixture);
  const decline = page.getByRole('button', { name: '不发动', exact: true });
  const pay = page.getByRole('button', { name: '支付费用并发动', exact: true });
  await expect(decline).toBeEnabled();
  await expect(pay).toBeEnabled();
  await decline.click();
  await expect.poll(outcome).toEqual({ active: false, paid: [] });
  await page.evaluate(async (path) => (await import(path)).reopenRikoZeroCost(), fixture);
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect.poll(outcome).toEqual({ active: false, paid: [[]] });
});
