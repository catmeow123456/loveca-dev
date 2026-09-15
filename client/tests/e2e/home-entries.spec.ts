import { expect, test } from '@playwright/test';
import { installVisualApiMocks, waitForVisualStability } from '../visual/support/mockApp';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await installVisualApiMocks(page, true);
});

test('定制入口即时保存，返回首页和刷新后保留，恢复默认可重新访问', async ({ page }, testInfo) => {
  await page.goto('/');
  const panel = page.getByRole('complementary', { name: '常用入口' });
  const edit = panel.getByRole('switch', { name: '自定义' });
  await expect(edit).not.toBeChecked();
  await expect(panel.getByRole('button', { name: /^新手教程/ })).toBeVisible();

  await edit.focus();
  await page.keyboard.press('Space');
  await expect(edit).toBeChecked();
  const tutorial = panel.getByRole('checkbox', { name: '显示新手教程' });
  await tutorial.focus();
  await page.keyboard.press('Space');
  await expect(tutorial).not.toBeChecked();
  await expect(tutorial).toBeFocused();
  await expect(panel.getByRole('checkbox')).toHaveCount(5);
  await expect(panel.getByRole('status')).toHaveText('已显示 4 / 5 项');

  await waitForVisualStability(page);
  await panel.screenshot({ path: testInfo.outputPath('customizing.png'), animations: 'disabled' });
  await edit.click();
  await expect(panel.getByRole('button', { name: /^新手教程/ })).toHaveCount(0);
  await panel.getByRole('button', { name: /^房间观战/ }).click();
  await expect(page.getByLabel('房间号')).toBeVisible();
  await page.goto('/');
  await expect(panel.getByRole('button', { name: /^新手教程/ })).toHaveCount(0);
  await page.reload();
  await expect(edit).not.toBeChecked();
  await expect(panel.getByRole('button', { name: /^新手教程/ })).toHaveCount(0);
  await edit.click();
  await expect(tutorial).not.toBeChecked();
  await panel.getByRole('button', { name: '恢复默认' }).click();
  await expect(tutorial).toBeChecked();
  await edit.click();
  await expect(panel.getByRole('button', { name: /^新手教程/ })).toBeVisible();
  await page.reload();
  await expect(panel.getByRole('button', { name: /^新手教程/ })).toBeVisible();
});

test('全部隐藏仍能重新定制；浅色和深色页面在窄屏与桌面没有横向溢出', async ({ page }, testInfo) => {
  await page.goto('/');
  const panel = page.getByRole('complementary', { name: '常用入口' });
  const edit = panel.getByRole('switch', { name: '自定义' });
  await edit.click();
  for (const checkbox of await panel.getByRole('checkbox').all()) {
    await checkbox.uncheck();
  }
  await edit.click();
  await expect(panel.getByText('已隐藏所有常用入口')).toBeVisible();
  await page.reload();
  await expect(panel.getByText('已隐藏所有常用入口')).toBeVisible();
  await edit.click();
  await panel.getByRole('button', { name: '恢复默认' }).click();
  await edit.click();

  const width =
    testInfo.project.name === 'tablet-1024x768' ? 1440 : testInfo.project.use.viewport!.width;
  await page.setViewportSize({ width, height: 900 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme
    );
    await waitForVisualStability(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await expect(panel.getByRole('button', { name: /^新手教程/ })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`home-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('定制不开放平台关闭的入口，也不绕过卡组要求', async ({ page }) => {
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
  const panel = page.getByRole('complementary', { name: '常用入口' });
  const ranked = panel.getByRole('button', { name: '赛季排位', exact: true });
  await expect(ranked).toBeDisabled();
  await expect(ranked.getByText('需要符合规则的卡组')).toBeVisible();
  await panel.getByRole('switch', { name: '自定义' }).click();
  await expect(panel.getByRole('checkbox', { name: '显示娱乐模式' })).toHaveCount(0);
  const rankedChoice = panel.getByRole('checkbox', { name: '显示赛季排位' });
  await rankedChoice.uncheck();
  await rankedChoice.check();
  await panel.getByRole('switch', { name: '自定义' }).click();
  await expect(ranked).toBeDisabled();
});

test('损坏的偏好回退默认；存储失败不阻止定制并给出提示', async ({ page }) => {
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
  const panel = page.getByRole('complementary', { name: '常用入口' });
  await expect(panel.getByRole('button', { name: /^新手教程/ })).toBeVisible();
  await panel.getByRole('switch', { name: '自定义' }).click();
  await panel.getByRole('checkbox', { name: '显示新手教程' }).uncheck();
  await expect(
    panel.getByText('浏览器未能保存设置，刷新后可能丢失。请允许本站存储后重试。')
  ).toBeVisible();
  await panel.getByRole('switch', { name: '自定义' }).click();
  await expect(panel.getByRole('button', { name: /^新手教程/ })).toHaveCount(0);
});
