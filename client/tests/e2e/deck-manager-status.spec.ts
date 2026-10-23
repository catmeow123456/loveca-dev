import { expect, test, type Page } from '@playwright/test';
import { DECK_RECORD, prepareVisualPage } from '../visual/support/mockApp';

async function prepareDecks(page: Page, theme: 'light' | 'dark' = 'light') {
  await prepareVisualPage(page, theme, true);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/decks') && request.method() !== 'GET') {
      writes.push(request.method());
    }
  });
  await page.route('**/api/deck-point-tables/current', (route) =>
    route.fulfill({
      json: {
        data: {
          version: 'status-test',
          pointLimit: 9,
          effectiveFrom: '2026-01-01T00:00:00Z',
          entries: [{ baseCardCode: 'LV-visual-001', points: 3 }],
        },
        error: null,
      },
    })
  );
  await page.route('**/api/decks', (route) =>
    route.fulfill({
      json: {
        data: [
          { ...DECK_RECORD, name: '标准卡组', share_enabled: true, share_id: 'status-test' },
          {
            ...DECK_RECORD,
            id: 'entertainment',
            name: '娱乐卡组',
            main_deck: DECK_RECORD.main_deck
              .filter(
                (entry) =>
                  !['LV-visual-002', 'LV-visual-003', 'LV-visual-004'].includes(entry.card_code)
              )
              .map((entry) =>
                entry.card_code === 'LV-visual-001' ? { ...entry, count: 4 } : entry
              ),
          },
          {
            ...DECK_RECORD,
            id: 'incomplete',
            name: '未完成卡组',
            main_deck: DECK_RECORD.main_deck.slice(1),
          },
        ],
        error: null,
      },
    })
  );
  await page.goto('/?page=deck-manager');
  await expect(page.getByRole('heading', { name: '标准卡组', exact: true })).toBeVisible();
  await expect(page.getByText('12/9pt', { exact: true })).toBeVisible();
  return writes;
}

async function expectTooltipWithinViewport(page: Page) {
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  const box = await tooltip.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

for (const theme of ['light', 'dark'] as const) {
  test(`compact results retain mode details, construction reasons and sharing actions (${theme})`, async ({
    page,
  }) => {
    const writes = await prepareDecks(page, theme);
    await expect(page.getByText('标准', { exact: true })).toBeVisible();
    await expect(page.getByText('仅娱乐', { exact: true })).toBeVisible();
    await expect(page.getByText('待调整', { exact: true })).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.getByText('已分享', { exact: true })).toHaveCount(0);

    const standard = page.getByRole('button', { name: '标准卡组：标准，查看可用模式' });
    await standard.focus();
    await expect(page.getByRole('tooltip')).toHaveText('标准、娱乐均可用。');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(standard).toBeFocused();

    const entertainment = page.getByRole('button', { name: '娱乐卡组：仅娱乐，查看可用模式' });
    await entertainment.tap();
    await expect(page.getByRole('tooltip')).toHaveText(
      '当前 12 PT，标准上限 9 PT。可用于娱乐对战。'
    );
    await expectTooltipWithinViewport(page);
    await entertainment.tap();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await entertainment.tap();
    await page.getByRole('heading', { name: '卡组管理', exact: true }).click();
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    await page.getByRole('button', { name: '未完成卡组：待调整，查看构筑问题' }).click();
    await expect(page.getByRole('tooltip')).toContainText('成员卡必须为 48 张 (当前 44)');
    await expectTooltipWithinViewport(page);

    const shared = page.getByRole('button', { name: '标准卡组：已分享，管理分享' });
    await shared.tap();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: '复制分享链接', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '关闭分享', exact: true })).toBeVisible();
    await shared.tap();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await shared.tap();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}

test('hover explanation remains readable under the pointer and Escape dismisses it', async ({
  page,
}) => {
  await prepareDecks(page);
  await page.getByRole('button', { name: '娱乐卡组：仅娱乐，查看可用模式' }).hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
});
