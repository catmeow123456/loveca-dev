import { expect, test, type Page } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';

test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const fixturePath = '/tests/recovery-review/sunnyNameFixture.ts';
const choices = (page: Page) => page.getByRole('group', { name: '效果选项', exact: true });
const option = (page: Page, name: string) =>
  choices(page).getByRole('button', { name: new RegExp(`视为「${name}」`) });

async function openFixture(page: Page, equalResults = false) {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
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
  await page.evaluate(async () => {
    const path = '/src/store/authStore.ts';
    const { useAuthStore } = await import(path);
    useAuthStore.getState().enterOfflineMode('SUNNY姓名选择验收');
  });
  await seed(page, equalResults);
}

async function seed(page: Page, equalResults = false) {
  const result = await page.evaluate(
    async ({ path, equalResults }) => {
      const { prepareSunnyNameChoice } = await import(path);
      return prepareSunnyNameChoice(equalResults);
    },
    { path: fixturePath, equalResults }
  );
  expect(result).toMatchObject({ success: true });
}

async function outcome(page: Page) {
  return page.evaluate(async (path) => (await import(path)).sunnyNameOutcome(), fixturePath);
}

test('defaults to the larger BLADE bonus and confirms without an extra option click', async ({
  page,
}, info) => {
  await openFixture(page);
  await expect(option(page, '星空凛')).toContainText('获得1个');
  await expect(option(page, '小泉花阳')).toContainText('获得2个');
  await expect(option(page, '小泉花阳')).toHaveAttribute('aria-pressed', 'true');
  await expect(option(page, '星空凛')).toHaveAttribute('aria-pressed', 'false');
  expect((await outcome(page)).blade).toBe(7);
  await page.screenshot({ path: info.outputPath('sunny-default-maximum.png') });
  await page.getByRole('button', { name: '获得 ブレード', exact: true }).click();
  await expect
    .poll(() => outcome(page))
    .toMatchObject({ blade: 9, stepId: null, selectedName: '小泉花陽' });
});

test('permits a smaller bonus on mobile and resets the draft for a new effect', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);
  await option(page, '星空凛').click();
  await expect(option(page, '星空凛')).toHaveAttribute('aria-pressed', 'true');
  await expect(option(page, '小泉花阳')).toHaveAttribute('aria-pressed', 'false');
  expect((await outcome(page)).blade).toBe(7);
  await page.getByRole('button', { name: '获得 ブレード', exact: true }).click();
  await expect
    .poll(() => outcome(page))
    .toMatchObject({ blade: 8, stepId: null, selectedName: '星空凛' });
  await seed(page);
  await expect(option(page, '小泉花阳')).toHaveAttribute('aria-pressed', 'true');
});

test('resolves equal results directly without a name-choice window', async ({ page }) => {
  await openFixture(page, true);
  await expect.poll(() => outcome(page)).toMatchObject({ blade: 8, stepId: null });
  await expect(choices(page)).toHaveCount(0);
});
