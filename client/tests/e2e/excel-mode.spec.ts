import { expect, test, type Page } from '@playwright/test';
import { DECK_RECORD, installVisualApiMocks } from '../visual/support/mockApp';

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
  await expect(page.getByRole('heading', { name: '选择己方卡组', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: /卡组/ })).toBeVisible();
  await page.getByRole('button', { name: '查看内容', exact: true }).click();
  await expect(page.getByText('视觉验收成员 001', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('excel-decks.png'), fullPage: true });
  expect(media).toEqual([]);
  expect(await page.evaluate(() => (window as any).excelAudioCalls)).toBe(0);
});

test('practice and debug enter deck selection directly and retain progress across presentation changes', async ({
  page,
}, info) => {
  await excel(page);
  await installVisualApiMocks(page, true);
  const media = observeMedia(page);
  await page.goto('/?page=battle-lobby');
  await page.getByRole('button', { name: '对墙打', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择己方卡组', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一步：确认对局' }).click();
  await expect(page.getByRole('region', { name: '对局确认' })).toContainText('在线记录');
  await expect(page.getByRole('button', { name: '开始对局', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await page.getByRole('button', { name: '取消准备', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '双人调试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 1 的卡组' })).toBeVisible();
  await page.getByRole('button', { name: '下一步：选择 P2 卡组' }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 2 的卡组' })).toBeVisible();
  const selectedDeck = await page.getByRole('row', { selected: true }).innerText();
  expect(media).toEqual([]);
  expect(await page.evaluate(() => (window as any).excelAudioCalls)).toBe(0);
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await expect(page.getByRole('heading', { name: '选择 Player 2 的卡组' })).toBeVisible();
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
  await expect(page.getByRole('row', { selected: true })).toHaveText(selectedDeck, {
    useInnerText: true,
  });
  await expect(page.getByRole('heading', { name: '选择 Player 2 的卡组' })).toBeVisible();
  await page.getByRole('button', { name: '下一步：确认对局' }).click();
  await expect(page.getByRole('region', { name: '对局确认' })).toContainText('本地模拟');
  await expect(page.getByRole('region', { name: '对局确认' })).toContainText('对方卡组');
  await expect(page.getByRole('button', { name: '开始对局', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('excel-debug-confirm.png'), fullPage: true });

  await page
    .getByRole('group', { name: '练习与调试模式' })
    .getByRole('button', { name: '对墙打', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '选择己方卡组', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回大厅', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
});

test('empty practice decks cannot advance and retain access to deck management', async ({
  page,
}, info) => {
  await excel(page);
  await installVisualApiMocks(page, true);
  await page.route('**/api/decks', (route) => route.fulfill({ json: { data: [], error: null } }));
  const media = observeMedia(page);
  await page.goto('/?page=battle-lobby');
  await page.getByRole('button', { name: '对墙打', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一步：确认对局' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '管理卡组', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '双人调试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择 Player 1 的卡组' })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步：选择 P2 卡组' })).toBeDisabled();
  await page.screenshot({
    path: info.outputPath('excel-empty-practice-decks.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '管理卡组', exact: true }).click();
  await expect(page.getByRole('heading', { name: '此页面使用普通界面' })).toBeVisible();
  expect(media).toEqual([]);
});

test('practice stays blocked while lobby participation restores and while queued', async ({
  page,
}) => {
  await excel(page);
  await installVisualApiMocks(page, true);
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route('**/api/casual-tables/me', async (route) => {
    await statusGate;
    await route.fulfill({
      json: {
        data: {
          table: null,
          otherParticipation: {
            kind: 'RANKED_QUEUE',
            destination: 'ranked',
            roomGeneration: null,
            matchId: null,
          },
        },
        error: null,
      },
    });
  });
  const media = observeMedia(page);
  await page.goto('/?page=battle-lobby');
  await expect(page.getByRole('button', { name: '对墙打', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '双人调试', exact: true })).toBeDisabled();
  releaseStatus();
  await expect(page.getByText('请先结束当前匹配或离开房间，再开始练习或调试。')).toBeVisible();
  await expect(page.getByRole('button', { name: '对墙打', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '双人调试', exact: true })).toBeDisabled();
  expect(media).toEqual([]);
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

test('cover worksheet edits local text, navigates, pastes and restores without game key events', async ({
  page,
  context,
}, info) => {
  await excel(page);
  await installVisualApiMocks(page, false);
  const media = observeMedia(page);
  await page.goto('/');
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(icon).toMatch(/^data:image\/svg\+xml,/);
  await expect(page).toHaveTitle('工作簿');
  await page.getByRole('button', { name: '遮挡工作区', exact: true }).click();
  const cover = page.getByRole('region', { name: '工作记录工作表' });
  const grid = cover.getByRole('grid', { name: '工作表1' });
  const current = cover.getByLabel('当前单元格');
  await expect(cover.getByRole('textbox', { name: '编辑 A1', exact: true })).toBeFocused();
  await page.evaluate(() => {
    (window as any).backgroundKeyEvents = 0;
    window.addEventListener('keydown', () => (window as any).backgroundKeyEvents++);
  });
  await page.keyboard.type('Plan');
  await page.keyboard.press('Enter');
  await expect(current).toHaveText('A2');
  await page.keyboard.insertText('资料整理');
  await page.keyboard.press('Tab');
  await expect(current).toHaveText('B2');
  const formula = cover.getByRole('textbox', { name: '单元格内容', exact: true });
  await formula.fill('本周完成');
  await page.keyboard.press('Enter');
  await expect(cover.getByRole('textbox', { name: '编辑 B2', exact: true })).toBeFocused();
  await grid.getByRole('gridcell', { name: 'A4', exact: true }).click();
  await cover.getByRole('textbox', { name: '编辑 A4', exact: true }).evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', '事项\t计划\n文档核对\t本周\n归档检查\t下周');
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  });
  await expect(grid.getByRole('gridcell', { name: 'B5', exact: true })).toHaveText('本周');
  await expect(grid.getByRole('gridcell', { name: 'A6', exact: true })).toHaveText('归档检查');
  await grid.getByRole('gridcell', { name: 'C2', exact: true }).click();
  await cover.getByRole('textbox', { name: '编辑 C2', exact: true }).fill('=SUM(A1:A2)');
  await page.keyboard.press('Enter');
  await expect(grid.getByRole('gridcell', { name: 'C2', exact: true })).toHaveText('=SUM(A1:A2)');
  await grid.getByRole('gridcell', { name: 'D2', exact: true }).click();
  await cover
    .getByRole('textbox', { name: '编辑 D2', exact: true })
    .fill('<img src=x onerror=alert(1)>');
  await cover.getByRole('textbox', { name: '编辑 D2', exact: true }).dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    bubbles: true,
  });
  await expect(current).toHaveText('D2');
  await page.keyboard.press('ArrowDown');
  await expect(current).toHaveText('D3');
  await page.keyboard.press('ArrowUp');
  await expect(current).toHaveText('D2');
  await expect(cover.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).backgroundKeyEvents)).toBe(0);
  await expect(page.locator('#app-surface')).toHaveAttribute('inert', '');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', icon!);
  await page.screenshot({ path: info.outputPath('editable-workbook-light.png'), fullPage: true });
  await page.keyboard.press('Control+Alt+x');
  await expect(cover).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', icon!);
  await page.getByRole('button', { name: '夜间模式', exact: true }).click();
  await page.keyboard.press('Control+Alt+x');
  await expect(cover.getByRole('textbox', { name: '编辑 A1', exact: true })).toHaveValue('Plan');
  await page.screenshot({ path: info.outputPath('editable-workbook-dark.png'), fullPage: true });
  await page.reload();
  await expect(cover.getByRole('textbox', { name: '编辑 A1', exact: true })).toHaveValue('Plan');
  await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('资料整理');
  await expect(grid.getByRole('gridcell', { name: 'B2', exact: true })).toHaveText('本周完成');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', icon!);
  const other = await context.newPage();
  await excel(other);
  await installVisualApiMocks(other, false);
  await other.goto('/');
  await other.keyboard.press('Control+Alt+x');
  await expect(other.getByRole('textbox', { name: '编辑 A1', exact: true })).toHaveValue('');
  await other.close();
  expect(media).toEqual([]);
  await cover.getByRole('button', { name: '返回工作区', exact: true }).click();
  await page.keyboard.press('Control+Alt+e');
  await expect(page).toHaveTitle('LOVECA');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/pwa/icon-192.png');
});

test('cover storage failure preserves edits until refresh and corrupt storage cannot break recovery', async ({
  page,
}) => {
  await excel(page);
  await installVisualApiMocks(page, false);
  await page.addInitScript(() => {
    sessionStorage.setItem('loveca.presentation.workbook', '{invalid');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'loveca.presentation.workbook')
        throw new DOMException('Blocked', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.keyboard.press('Control+Alt+x');
  await page.getByRole('textbox', { name: '编辑 A1', exact: true }).fill('临时记录');
  await expect(
    page.getByRole('region', { name: '工作记录工作表' }).locator('.worksheet-save-status')
  ).toContainText('刷新前请复制');
  await page.keyboard.press('Control+Alt+x');
  await page.keyboard.press('Control+Alt+x');
  await expect(page.getByRole('textbox', { name: '编辑 A1', exact: true })).toHaveValue('临时记录');
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  await expect(page.getByRole('button', { name: '遮挡工作区', exact: true })).toBeVisible();
});

test('workbook icon and title are present before React starts in Excel and covered modes', async ({
  page,
}) => {
  await page.route(/\/src\/main\.tsx(?:\?|$)/, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' })
  );
  await page.addInitScript(() => {
    const mode = new URL(location.href).searchParams.get('bootMode') ?? 'excel';
    localStorage.setItem('loveca.presentation.mode', mode);
    sessionStorage.setItem('loveca.presentation.covered', String(mode === 'normal'));
  });
  for (const mode of ['excel', 'normal']) {
    await page.goto(`/?bootMode=${mode}`);
    await expect(page).toHaveTitle('工作簿');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      'href',
      /^data:image\/svg\+xml,/
    );
    await expect(page.locator('#root')).toBeEmpty();
  }
});

test('new lobby shares deck and mode choices with Excel and keeps casual previews text only', async ({
  page,
}, info) => {
  await excel(page);
  await installVisualApiMocks(page, true);
  const second = { ...DECK_RECORD, id: 'second-deck', name: '第二副测试卡组' };
  await page.route('**/api/decks', (route) =>
    route.fulfill({ json: { data: [DECK_RECORD, second], error: null } })
  );
  const media = observeMedia(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const modes = page.getByRole('combobox', { name: '选择玩法', exact: true });
  await expect(modes).toHaveValue('casual');
  const rows = page.getByRole('table', { name: '卡组列表' }).getByRole('row');
  const secondRow = rows.filter({ hasText: second.name });
  await secondRow.getByRole('button', { name: '选择', exact: true }).click();
  await secondRow.getByRole('button', { name: '查看内容', exact: true }).click();
  await expect(page.getByRole('button', { name: '视觉验收成员 001', exact: true })).toBeVisible();
  await page.keyboard.press('Control+Alt+x');
  await expect(page.locator('#app-surface')).toHaveAttribute('inert', '');
  await page.keyboard.press('Control+Alt+x');
  await expect(secondRow).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '收起内容', exact: true }).click();
  await modes.selectOption('ranked');
  await expect(page.getByRole('button', { name: '前往赛季排位', exact: true })).toBeEnabled();
  await modes.selectOption('casual');
  await expect(secondRow).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: info.outputPath('excel-new-lobby.png'), fullPage: true });
  await page.getByRole('button', { name: '进入对战大厅', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('loveca.deckSelection.lastUsed.public-table'))
  ).toBe(second.id);
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.casual-selected-deck')).toContainText(second.name);
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: '更换', exact: true }).click();
  await dialog
    .getByRole('row')
    .filter({ hasText: DECK_RECORD.name })
    .getByRole('button', { name: '选择', exact: true })
    .click();
  await expect(dialog.locator('.casual-selected-deck')).toContainText(DECK_RECORD.name);
  await page.screenshot({ path: info.outputPath('excel-casual-deck.png'), fullPage: true });
  await page.keyboard.press('Control+Alt+x');
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Control+Alt+x');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(media).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).excelAudioCalls)).toBe(0);
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await modes.selectOption('ranked');
  await secondRow.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('button', { name: '前往赛季排位', exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem('loveca.deckSelection.lastUsed.ranked'))
  ).toBe(second.id);
  await expect(page.getByRole('heading', { name: '赛季排位', exact: true }).first()).toBeVisible();
});

test('new lobby preserves ordinary dialogs and selection when switching and covering', async ({
  page,
}, info) => {
  await installVisualApiMocks(page, true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Loveca 大厅', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更换卡组', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '更换卡组', exact: true });
  await expect(page.locator('#app-overlays').getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Control+Alt+x');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#app-overlays')).toHaveAttribute('inert', '');
  await page.keyboard.press('Control+Alt+x');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '更换卡组', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '查看构筑', exact: true }).click();
  await expect(page.getByRole('dialog').locator('img').first()).toBeVisible();
  await page.keyboard.press('Control+Alt+e');
  await expect(page.getByRole('combobox', { name: '选择玩法', exact: true })).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  await page.keyboard.press('Control+Alt+e');
  await expect(page.getByRole('dialog').locator('img').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('ordinary-new-lobby.png'), fullPage: true });
  await page.keyboard.press('Control+Alt+e');
  await page.getByRole('button', { name: '对墙打', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择己方卡组', exact: true })).toBeVisible();
});

test('new Excel lobby handles failed reads, no valid deck and stale selections', async ({
  page,
}) => {
  await excel(page);
  await installVisualApiMocks(page, true);
  let fail = true;
  let decks: (typeof DECK_RECORD)[] = [];
  await page.route('**/api/decks', (route) =>
    route.fulfill({
      status: fail ? 400 : 200,
      json: {
        data: fail ? null : decks,
        error: fail ? { code: 'UNAVAILABLE', message: '测试卡组暂不可用' } : null,
      },
    })
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        data: {
          features: { battleEntries: { ranked: false, themeTable: false } },
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
  await page.goto('/');
  const launch = page.getByRole('button', { name: '进入对战大厅', exact: true });
  await expect(page.getByRole('alert').filter({ hasText: '测试卡组暂不可用' })).toBeVisible();
  await expect(launch).toBeDisabled();
  await expect(
    page.getByRole('combobox', { name: '选择玩法', exact: true }).locator('option')
  ).toHaveText(['对战大厅']);
  fail = false;
  decks = [{ ...DECK_RECORD, main_deck: [], is_valid: false }];
  await page.getByRole('button', { name: '刷新卡组', exact: true }).click();
  await expect(page.getByText('需要一副符合规则的卡组', { exact: true })).toBeVisible();
  await expect(launch).toBeDisabled();
  const second = { ...DECK_RECORD, id: 'second-deck', name: '第二副测试卡组' };
  decks = [DECK_RECORD, second];
  await page.getByRole('button', { name: '刷新卡组', exact: true }).click();
  const rows = page.getByRole('table', { name: '卡组列表' }).getByRole('row');
  await rows
    .filter({ hasText: second.name })
    .getByRole('button', { name: '选择', exact: true })
    .click();
  decks = [DECK_RECORD];
  await page.getByRole('button', { name: '刷新卡组', exact: true }).click();
  await expect(rows.filter({ hasText: second.name })).toHaveCount(0);
  await expect(rows.filter({ hasText: DECK_RECORD.name })).toHaveAttribute('aria-selected', 'true');
  await expect(launch).toBeEnabled();
});

test('new Excel lobby retains room recovery guard before local play', async ({ page }) => {
  await excel(page);
  await installVisualApiMocks(page, true);
  await page.route('**/api/casual-tables/me', (route) =>
    route.fulfill({
      json: {
        data: {
          table: null,
          otherParticipation: {
            kind: 'ONLINE_MATCH',
            destination: 'ranked',
            roomGeneration: 'ranked-generation',
            matchId: 'ranked-match',
          },
        },
        error: null,
      },
    })
  );
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/(casual-tables|online)\//.test(request.url()))
      writes.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '对墙打', exact: true })).toBeDisabled();
  const room = page.getByRole('region', { name: '当前房间', exact: true });
  await room.getByText('其他操作', { exact: true }).click();
  await room.getByRole('button', { name: '另开本地对局', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: /读取排位|读取赛季|未能恢复当前房间/ })
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: '选择玩法', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  await room.getByRole('button', { name: '返回房间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
});
