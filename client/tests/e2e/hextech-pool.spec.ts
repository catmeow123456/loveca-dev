import { expect, test, type Locator, type Page } from '@playwright/test';
import { HEXTECH_DEFINITIONS } from '../../../src/domain/hextech/catalog';
import { prepareVisualPage } from '../visual/support/mockApp';

test.use({ serviceWorkers: 'block' });

async function exercisePool(page: Page, reader: Locator) {
  const items = reader.getByRole('article');
  const tabs = reader.getByRole('tablist', { name: '海克斯稀有度' });
  await expect(items).toHaveCount(HEXTECH_DEFINITIONS.length);
  await expect(reader.getByRole('searchbox')).toHaveCount(0);
  await tabs.getByRole('tab', { name: '金色', exact: true }).click();
  await expect(items).toHaveCount(7);
  await expect(reader.locator('.hextech-pool-count')).toHaveText('7/24');
  await tabs.getByRole('tab', { name: '金色', exact: true }).press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: '彩色', exact: true })).toBeFocused();
  await expect(items).toHaveCount(8);
  await expect(items.filter({ hasText: '灵活单推' })).toContainText('虹ヶ咲：棒+4');
  await tabs.getByRole('tab', { name: '全部', exact: true }).click();
  await reader.getByRole('button', { name: '搜索海克斯', exact: true }).click();
  const search = reader.getByRole('searchbox', { name: '搜索海克斯名称或效果' });
  await expect(search).toBeFocused();
  await search.fill('抽牌');
  await expect(items).toHaveCount(5);
  await search.press('Escape');
  await expect(reader.getByRole('searchbox')).toHaveCount(0);
  await expect(items).toHaveCount(24);
  await reader.getByRole('button', { name: '搜索海克斯', exact: true }).click();
  await search.fill('彼方');
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('好好睡好好睡');
  await search.fill('找不到的能力');
  await expect(reader.getByRole('heading', { name: '没有找到匹配的海克斯' })).toBeVisible();
  await reader.getByRole('button', { name: '查看全部海克斯', exact: true }).click();
  await expect(items).toHaveCount(24);
  await reader.getByRole('button', { name: '收起海克斯搜索', exact: true }).click();
  expect(await reader.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test('海克斯池公开直达，不依赖登录和卡牌接口，完整筛选与搜索可用', async ({ page }, info) => {
  const errors: string[] = [];
  const cardRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/cards/')) cardRequests.push(request.url());
  });
  await prepareVisualPage(page, info.project.name.startsWith('mobile') ? 'light' : 'dark', false);
  await page.goto('/?page=hextech-pool');
  const reader = page.getByRole('main');
  await expect(reader.getByRole('heading', { name: '海克斯池', exact: true })).toBeVisible();
  await exercisePool(page, reader);
  await reader.getByRole('tab', { name: '金色', exact: true }).click();
  await page.screenshot({ path: info.outputPath('hextech-pool-public.png') });
  expect(cardRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('娱乐大厅复用玩法Tabs，查询海克斯池后保留房间筛选和搜索', async ({ page }, info) => {
  await prepareVisualPage(page, info.project.name.startsWith('mobile') ? 'light' : 'dark', true);
  await page.goto('/?page=battle-lobby');
  await page.getByRole('radio', { name: '娱乐模式 PT 不限' }).check();
  const formats = page.getByRole('tablist', { name: '娱乐玩法', exact: true });
  await formats.getByRole('tab', { name: '海克斯', exact: true }).click();
  await expect(formats.getByRole('tab', { name: '海克斯', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.getByRole('textbox', { name: '搜索昵称或房间号' }).fill('保留查询');
  const entry = page.getByRole('link', { name: /海克斯池/ });
  await expect(entry).toHaveAttribute('href', '/?page=hextech-pool');
  await entry.click();
  const dialog = page.getByRole('dialog', { name: '海克斯池', exact: true });
  await exercisePool(page, dialog);
  await dialog.getByRole('tab', { name: '金色', exact: true }).click();
  const headerHeight = await dialog.evaluate(
    (el) =>
      el.querySelector('.hextech-pool-results')!.getBoundingClientRect().top -
      el.getBoundingClientRect().top
  );
  expect(headerHeight).toBeLessThan(info.project.name.startsWith('mobile') ? 120 : 85);
  await page.screenshot({ path: info.outputPath('hextech-pool-dialog.png') });
  await dialog.getByRole('button', { name: '关闭海克斯池', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await expect(formats.getByRole('tab', { name: '海克斯', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('textbox', { name: '搜索昵称或房间号' })).toHaveValue('保留查询');
  await page.screenshot({ path: info.outputPath('hextech-pool-lobby.png'), fullPage: true });
});
