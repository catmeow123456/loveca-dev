import { expect, test, type Page } from '@playwright/test';
import { installVisualApiMocks, waitForVisualStability } from '../visual/support/mockApp';

const entries = (page: Page) => page.getByRole('region', { name: '常用入口', exact: true });
const editor = (page: Page) => page.getByRole('dialog', { name: '自定义常用入口', exact: true });
const shortcuts = (page: Page) => entries(page).locator('.lobby-shortcut strong');
const defaults = ['新手教程', '观战', '历史对局', '对墙打'];

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await installVisualApiMocks(page, true);
});

test('定制草稿显式保存，返回大厅和刷新后保留排序，恢复默认也需保存', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Loveca 大厅', exact: true })).toBeVisible();
  await expect(shortcuts(page)).toHaveText(defaults);
  const edit = entries(page).getByRole('button', { name: '自定义', exact: true });
  await edit.focus();
  await page.keyboard.press('Space');
  const dialog = editor(page);
  await expect(dialog).toBeVisible();
  const tutorial = dialog.getByRole('checkbox', { name: '新手教程', exact: true });
  await tutorial.focus();
  await page.keyboard.press('Space');
  await expect(tutorial).not.toBeChecked();
  await expect(tutorial).toBeFocused();
  await expect(shortcuts(page)).toHaveText(defaults);
  expect(await page.evaluate(() => localStorage.getItem('loveca.home.hiddenEntries'))).toBeNull();
  await dialog.getByRole('button', { name: '上移对墙打', exact: true }).click();
  await waitForVisualStability(page);
  await dialog.screenshot({ path: testInfo.outputPath('customizing.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const customized = ['观战', '对墙打', '历史对局'];
  await expect(shortcuts(page)).toHaveText(customized);
  await page.getByRole('button', { name: '进入对战大厅', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await expect(shortcuts(page)).toHaveText(customized);
  await page.reload();
  await expect(shortcuts(page)).toHaveText(customized);
  await edit.click();
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(tutorial).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '对墙打', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(shortcuts(page)).toHaveText(customized);
  await edit.click();
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await expect(shortcuts(page)).toHaveText(defaults);
});

test('关闭或取消定制不保存草稿，并把焦点还给自定义入口', async ({ page }) => {
  await page.goto('/');
  const edit = entries(page).getByRole('button', { name: '自定义', exact: true });
  for (const close of ['取消', '关闭弹层', 'Escape']) {
    await edit.click();
    await editor(page).getByRole('checkbox', { name: '新手教程', exact: true }).uncheck();
    if (close === 'Escape') await page.keyboard.press('Escape');
    else await editor(page).getByRole('button', { name: close, exact: true }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(edit).toBeFocused();
    await expect(shortcuts(page)).toHaveText(defaults);
    expect(await page.evaluate(() => localStorage.getItem('loveca.home.hiddenEntries'))).toBeNull();
  }
});

test('新增的调试和卡组入口可自定义显示，并进入对应流程', async ({ page }) => {
  await page.goto('/');
  await entries(page).getByRole('button', { name: '自定义', exact: true }).click();
  for (const title of ['双人调试', '卡组管理']) {
    await editor(page).getByRole('checkbox', { name: title, exact: true }).check();
  }
  await editor(page).getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await entries(page).getByRole('button', { name: '对墙打', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择己方卡组' })).toBeVisible();
  await page.getByRole('button', { name: '返回大厅', exact: true }).click();
  await entries(page).getByRole('button', { name: '双人调试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 1 的卡组' })).toBeVisible();
  await page.getByRole('button', { name: '返回大厅', exact: true }).click();
  await entries(page).getByRole('button', { name: '卡组管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '卡组管理', exact: true })).toBeVisible();
});

test('旧版入口偏好保留隐藏选择，新版默认入口和调试边界明确', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('loveca.home.hiddenEntries', JSON.stringify(['tutorial']));
  });
  await page.goto('/');
  await expect(entries(page).getByRole('button', { name: '新手教程', exact: true })).toHaveCount(0);
  await expect(entries(page).getByRole('button', { name: '对墙打', exact: true })).toBeVisible();
  await expect(entries(page).getByRole('button', { name: '双人调试', exact: true })).toHaveCount(0);
  await entries(page).getByRole('button', { name: '自定义', exact: true }).click();
  await expect(
    editor(page).getByRole('checkbox', { name: '新手教程', exact: true })
  ).not.toBeChecked();
  await expect(
    editor(page).getByRole('checkbox', { name: '双人调试', exact: true })
  ).not.toBeChecked();
});

test('全部隐藏仍能重新定制；深浅主题下窄屏和桌面无横向溢出', async ({ page }, testInfo) => {
  await page.goto('/');
  const panel = entries(page);
  const edit = panel.getByRole('button', { name: '自定义', exact: true });
  await edit.click();
  while (await editor(page).getByRole('checkbox', { checked: true }).count()) {
    await editor(page).getByRole('checkbox', { checked: true }).first().uncheck();
  }
  await editor(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(shortcuts(page)).toHaveCount(0);
  await expect(panel.getByText('按你的习惯添加入口。')).toBeVisible();
  await page.reload();
  await expect(shortcuts(page)).toHaveCount(0);
  await edit.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor(page).getByRole('button', { name: '恢复默认', exact: true }).click();
  await editor(page).getByRole('button', { name: '保存', exact: true }).click();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme
      );
      await waitForVisualStability(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await expect(shortcuts(page)).toHaveText(defaults);
      await page.screenshot({
        path: testInfo.outputPath(`home-${width}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});

test('定制不重复玩法入口，也不绕过平台显隐和卡组要求', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        data: {
          features: { battleEntries: { ranked: true, themeTable: false } },
          siteStatus: {
            lifecycle: 'NORMAL',
            generatedAt: '2026-07-31T12:00:00.000Z',
            maintenance: null,
            announcements: [],
          },
        },
        error: null,
      },
    })
  );
  await page.route('**/api/decks', (route) => route.fulfill({ json: { data: [], error: null } }));
  await page.goto('/');
  const modes = page.getByRole('region', { name: '选择玩法', exact: true });
  await expect(modes.getByRole('button', { name: /娱乐模式/ })).toHaveCount(0);
  await modes.getByRole('button', { name: /赛季排位/ }).click();
  await expect(page.getByRole('button', { name: '前往赛季排位', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '构筑卡组', exact: true })).toBeVisible();
  await entries(page).getByRole('button', { name: '自定义', exact: true }).click();
  for (const label of ['娱乐模式', '赛季排位', '对战大厅']) {
    await expect(editor(page).getByRole('checkbox', { name: label, exact: true })).toHaveCount(0);
  }
  await editor(page).getByRole('button', { name: '恢复默认', exact: true }).click();
  await editor(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '前往赛季排位', exact: true })).toBeDisabled();
});

test('损坏的偏好回退默认；存储失败仍应用当前选择并提示', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('loveca.home.hiddenEntries', '{broken');
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'loveca.home.hiddenEntries')
        throw new DOMException('Storage full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/');
  await expect(shortcuts(page)).toHaveText(defaults);
  await entries(page).getByRole('button', { name: '自定义', exact: true }).click();
  await editor(page).getByRole('checkbox', { name: '新手教程', exact: true }).uncheck();
  await editor(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(entries(page).getByRole('status')).toContainText('浏览器未能保存设置');
  await expect(entries(page).getByRole('button', { name: '新手教程', exact: true })).toHaveCount(0);
});
