import { expect, test, type Page } from '@playwright/test';
import { installVisualApiMocks } from '../visual/support/mockApp';

async function excel(page: Page) {
  await page.context().route('**/site-status.json*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        availability: 'OPEN',
        generatedAt: new Date().toISOString(),
        maintenance: null,
      }),
    })
  );
  await page.addInitScript(() => {
    if (!localStorage.getItem('loveca.presentation.mode'))
      localStorage.setItem('loveca.presentation.mode', 'excel');
    (window as any).excelAudioCalls = 0;
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        (window as any).excelAudioCalls++;
        return Reflect.construct(target, args);
      },
    });
  });
}
function observeMedia(page: Page) {
  const media: string[] = [];
  page.context().on('request', (request) => {
    if (
      ['image', 'media'].includes(request.resourceType()) ||
      // Vite ?import URLs return JavaScript URL exports, not image/audio bytes.
      (request.resourceType() !== 'script' &&
        /\.(png|jpe?g|webp|avif|gif|svg|mp3|ogg|wav)(\?|$)/i.test(request.url()))
    )
      media.push(request.url());
  });
  return media;
}

test('mode switches only by shortcut, persists, and never dismisses the cover', async ({
  page,
}, info) => {
  await excel(page);
  await installVisualApiMocks(page, false);
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /^(表格界面|普通界面|切换普通界面)$/ })
  ).toHaveCount(0);
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await expect(page.locator('.excel-toolbar, .presentation-switch')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await expect(page.getByRole('button', { name: '表格界面', exact: true })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('normal-without-mode-button.png'),
    fullPage: true,
  });
  await page.evaluate(() => {
    for (const flags of [{ repeat: true }, { isComposing: true }, { shiftKey: true }])
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          code: 'KeyE',
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          ...flags,
        })
      );
  });
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
  await page.getByRole('button', { name: '登录账号', exact: true }).click();
  await page.getByPlaceholder('输入你的用户名或邮箱').fill('输入不触发切换');
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await page.keyboard.press('Control+Alt+x');
  const cover = page.getByRole('region', { name: '工作记录工作表' });
  await expect(cover).toBeVisible();
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
  await expect(cover).toBeVisible();
  await expect(page.locator('#app-surface')).toHaveAttribute('inert', '');
  await page.keyboard.press('Control+Alt+x');
  await expect(cover).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
});

test('first frame, authentication, cover keyboard and refresh', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await excel(page);
  await installVisualApiMocks(page, false);
  const media = observeMedia(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '离线体验', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('工作簿');
  await page.getByRole('button', { name: '登录账号', exact: true }).click();
  await page.getByPlaceholder('输入你的用户名或邮箱').fill('输入法测试');
  await page.keyboard.press('Control+Alt+x');
  await expect(page.getByRole('region', { name: '工作记录工作表' })).toBeVisible();
  await expect(page.locator('#app-surface')).toHaveAttribute('inert', '');
  await expect(page.getByPlaceholder('输入你的用户名或邮箱')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('region', { name: '工作记录工作表' })).toBeVisible();
  await page.getByRole('button', { name: '返回工作区' }).click();
  await expect(page.getByRole('region', { name: '工作记录工作表' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('excel-entry.png'), fullPage: true });
  expect(media).toEqual([]);
  expect(await page.evaluate(() => (window as any).excelAudioCalls)).toBe(0);
  expect(errors).toEqual([]);
});

test('deck selection shows full text without card art', async ({ page }, info) => {
  await excel(page);
  await installVisualApiMocks(page, true);
  const media = observeMedia(page);
  await page.goto('/?page=game-setup');
  await page.getByRole('button', { name: '下一步：选择己方卡组' }).click();
  await expect(page.getByRole('table', { name: /卡组/ })).toBeVisible();
  await page.getByRole('button', { name: '查看内容', exact: true }).click();
  await expect(page.getByText('视觉验收成员 001', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('excel-decks.png'), fullPage: true });
  expect(media).toEqual([]);
  expect(await page.evaluate(() => (window as any).excelAudioCalls)).toBe(0);
});

test('unsupported pages stay textual, shortcut configuration ignores IME and repeat events', async ({
  page,
  context,
}, info) => {
  await excel(page);
  await installVisualApiMocks(page, true);
  const media = observeMedia(page);
  await page.goto('/?page=deck-manager');
  await expect(page.getByRole('heading', { name: '此页面使用普通界面' })).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  const configure = page.getByRole('button', { name: '遮挡快捷键', exact: true });
  const recorder = page.getByRole('group', { name: '录制遮挡快捷键' });
  const cover = page.getByRole('region', { name: '工作记录工作表' });
  await configure.click();
  await expect(recorder).toBeFocused();
  await page.keyboard.press('Control+Alt+e');
  await expect(recorder.getByRole('status')).toContainText('已用于切换');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
  await page.keyboard.press('y');
  await expect(recorder.getByRole('status')).toContainText('修饰键');
  await page.evaluate(() => {
    for (const flags of [{ isComposing: true }, { repeat: true }])
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          code: 'KeyY',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          ...flags,
        })
      );
  });
  await expect(recorder).toBeVisible();
  await expect(configure).toHaveAttribute('title', /Ctrl\+Alt\+X/);
  await page.screenshot({ path: info.outputPath('shortcut-recorder.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(recorder).toHaveCount(0);
  await expect(configure).toBeFocused();
  await configure.click();
  await page.keyboard.press('Tab');
  await expect(recorder.getByRole('button', { name: '取消' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(recorder).toHaveCount(0);
  // Re-recording the current shortcut must save it without activating the cover.
  await configure.click();
  await page.keyboard.press('Control+Alt+x');
  await expect(recorder).toHaveCount(0);
  await expect(cover).toHaveCount(0);
  await configure.click();
  await page.keyboard.press('Control+Shift+y');
  await expect(recorder).toHaveCount(0);
  await expect(configure).toHaveAttribute('title', /Ctrl\+Shift\+Y/);
  await page.keyboard.press('Control+Alt+x');
  await expect(cover).toHaveCount(0);
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyY',
        ctrlKey: true,
        shiftKey: true,
        isComposing: true,
        bubbles: true,
      })
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyY',
        ctrlKey: true,
        shiftKey: true,
        repeat: true,
        bubbles: true,
      })
    );
  });
  await expect(page.getByRole('region', { name: '工作记录工作表' })).toHaveCount(0);
  const other = await context.newPage();
  await installVisualApiMocks(other, false);
  await other.goto('/');
  await page.keyboard.press('Control+Shift+y');
  await expect(page.getByRole('region', { name: '工作记录工作表' })).toBeVisible();
  await expect(other.getByRole('region', { name: '工作记录工作表' })).toHaveCount(0);
  await expect(page.locator('body')).not.toMatchAriaSnapshot(`- heading "此页面使用普通界面"`);
  await page.reload();
  await expect(page.getByRole('region', { name: '工作记录工作表' })).toBeVisible();
  await page.keyboard.press('Control+Shift+y');
  await expect(page.getByRole('heading', { name: '此页面使用普通界面' })).toBeVisible();
  expect(media).toEqual([]);
  await other.close();
});

test('service failure and covered reload remain neutral and silent', async ({ page }) => {
  await excel(page);
  await installVisualApiMocks(page, false);
  await page.route('**/api/config', (route) => route.abort('connectionrefused'));
  const media = observeMedia(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '连接暂不可用', exact: true })).toBeVisible();
  await page.keyboard.press('Control+Alt+x');
  await page.reload();
  await expect(page.getByRole('region', { name: '工作记录工作表' })).toBeVisible();
  await expect(page.locator('#app-surface')).toHaveAttribute('inert', '');
  await expect(page).toHaveTitle('工作簿');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  expect(media).toEqual([]);
  expect(await page.evaluate(() => (window as any).excelAudioCalls)).toBe(0);
});
