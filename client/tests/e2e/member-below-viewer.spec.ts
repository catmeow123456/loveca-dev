import { expect, test } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';

const fixture = '/tests/recovery-review/memberBelowFixture.ts';
test.use({ serviceWorkers: 'block' });

test('member stack inspection is read-only, closable and follows the current stack', async ({
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
    useAuthStore.getState().enterOfflineMode('下方卡牌查看验收');
    (await import(path)).prepareMemberBelow();
  }, fixture);
  const before = await page.evaluate(
    async (path) => (await import(path)).memberBelowOutcome(),
    fixture
  );
  const button = page.getByRole('button', { name: /查看.*下方的2张卡牌/ });
  await button.click();
  const dialog = page.getByRole('dialog', { name: '下方卡牌', exact: true });
  const cards = dialog.locator('[data-battle-ui-object-id]');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('4 中须霞');
  await expect(cards.nth(1)).toContainText('2 AOKUHARUKA');
  const close = dialog.getByRole('button', { name: '关闭下方卡牌' });
  await expect(close).toBeFocused();
  await expect
    .poll(() =>
      dialog
        .locator('img')
        .evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0)
        )
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('member-below.png'), animations: 'disabled' });
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(
    await page.evaluate(async (path) => (await import(path)).memberBelowOutcome(), fixture)
  ).toEqual(before);
  await button.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Opponent's public stack is inspectable; their hidden hand is never listed.
  const mobile = (page.viewportSize()?.width ?? 1024) < 768;
  if (mobile) await page.getByRole('button', { name: '切换至 对方 视角', exact: true }).click();
  await page.getByRole('button', { name: /查看.*下方的1张卡牌/ }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute('data-battle-ui-object-id', 'opponent-below');
  await close.click();
  if (mobile) await page.getByRole('button', { name: '切换至 己方 视角', exact: true }).click();
  await button.click();
  await page.evaluate(async (path) => (await import(path)).clearMemberBelow(), fixture);
  await expect(dialog).toHaveCount(0);
  await expect(button).toHaveCount(0);
  // Larger stacks remain scrollable on narrow screens; a new match closes the old view.
  await page.evaluate(async (path) => (await import(path)).prepareMemberBelow(12), fixture);
  await page.getByRole('button', { name: /查看.*下方的12张卡牌/ }).click();
  await expect(cards).toHaveCount(12);
  await expect(close).toBeInViewport();
  await cards.last().scrollIntoViewIfNeeded();
  await expect(close).toBeInViewport();
  await page.evaluate(async (path) => (await import(path)).prepareMemberBelow(), fixture);
  await expect(dialog).toHaveCount(0);
});
