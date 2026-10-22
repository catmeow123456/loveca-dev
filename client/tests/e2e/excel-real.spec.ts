import { expect, test, type Page } from '@playwright/test';
import process from 'node:process';

test.skip(
  process.env.RUN_EXCEL_REAL !== '1',
  'Requires the existing local player test environment'
);
test.setTimeout(150_000);
const sessions = new Map<
  number,
  Awaited<ReturnType<ReturnType<Page['context']>['storageState']>>
>();
async function login(page: Page, index: number, excel: boolean) {
  if (excel)
    await page.addInitScript(() => localStorage.setItem('loveca.presentation.mode', 'excel'));
  const saved = sessions.get(index);
  if (saved) {
    await page.context().addCookies(saved.cookies);
    await page.addInitScript((origins) => {
      for (const origin of origins)
        if (origin.origin === location.origin)
          for (const item of origin.localStorage)
            if (!item.name.startsWith('loveca.presentation.'))
              localStorage.setItem(item.name, item.value);
    }, saved.origins);
  }
  await page.goto('/');
  if (saved) {
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: excel ? '登录账号' : '登录', exact: true }).click();
  await page.getByPlaceholder('输入你的用户名或邮箱').fill(`test_player_${index}`);
  await page.getByPlaceholder('输入你的密码').fill(`test_password_${index}`);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  sessions.set(index, await page.context().storageState());
}
function media(page: Page, watch: boolean) {
  const requests: string[] = [];
  if (watch)
    page.on('request', (r) => {
      if (['image', 'media'].includes(r.resourceType())) requests.push(r.url());
    });
  return requests;
}
async function surrender(page: Page) {
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === '/src/store/gameStore.ts')
      .at(-1);
    if (!url) throw new Error('Store resource not found');
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const state = useGameStore.getState();
    if (!state.playerViewState) throw new Error('Test imported a different store');
    const result = state.surrender();
    if (result.error) throw new Error(result.error);
  });
}
async function leaveFinishedRoom(page: Page) {
  await page.goto('/?page=battle-lobby');
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
  await expect(page.getByText('正在同步对战大厅')).toHaveCount(0);
  const leave = page.getByRole('button', { name: '离开房间', exact: true });
  if (await leave.isVisible()) {
    await leave.click();
    await page.getByRole('dialog').getByRole('button', { name: '确认退出', exact: true }).click();
    await expect(leave).toHaveCount(0);
  }
}
async function assertExcelLayout(page: Page) {
  if (!(await page.getByTestId('excel-battle').isVisible())) return;
  const height = page.viewportSize()!.height;
  for (const locator of [
    page.getByRole('table', { name: '对方场面' }),
    page.getByRole('table', { name: '我方场面' }),
    page.getByLabel('双方 LIVE 摘要'),
    page.locator('.excel-hand'),
    page.locator('.excel-sheets'),
  ]) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
  }
}
async function advanceAndRecover(starter: Page, other: Page, textPage: Page) {
  await expect(starter.getByRole('button', { name: 'Live Start!', exact: true })).toBeEnabled();
  const before = await starter.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => new URL(n).pathname === '/src/store/gameStore.ts')
      .at(-1)!;
    const { useGameStore } = await import(/* @vite-ignore */ url);
    const v = useGameStore.getState().playerViewState;
    const ownHand = v.table.zones[`${v.match.viewerSeat}_HAND`].objectIds;
    const members = ownHand.filter((id: string) => v.objects[id]?.frontInfo?.cardType === 'MEMBER');
    const quotes =
      v.permissions.availableCommands.find((hint: any) => hint.command === 'PLAY_MEMBER_TO_SLOT')
        ?.params?.memberPlayQuotes ?? [];
    return {
      turn: v.match.turnCount,
      active: v.match.activeSeat,
      seq: v.match.seq,
      quotedMembers: quotes.length,
      expectedQuotes: members.length * 3,
      ownQuotesOnly: quotes.every((quote: any) => ownHand.includes(quote.sourceObjectId)),
    };
  });
  expect(before.quotedMembers).toBe(before.expectedQuotes);
  expect(before.ownQuotesOnly).toBe(true);
  await starter.getByRole('button', { name: 'Live Start!', exact: true }).click();
  await expect
    .poll(() =>
      starter.evaluate(async () => {
        const url = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => new URL(n).pathname === '/src/store/gameStore.ts')
          .at(-1)!;
        const { useGameStore } = await import(/* @vite-ignore */ url);
        return useGameStore.getState().playerViewState.match.seq;
      })
    )
    .toBeGreaterThan(before.seq);
  await expect
    .poll(() =>
      other.evaluate(async () => {
        const url = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => new URL(n).pathname === '/src/store/gameStore.ts')
          .at(-1)!;
        const { useGameStore } = await import(/* @vite-ignore */ url);
        return useGameStore.getState().playerViewState.match.seq;
      })
    )
    .toBeGreaterThan(before.seq);
  await textPage.keyboard.press('Control+Alt+x');
  await textPage.reload();
  await expect(textPage.getByRole('region', { name: '工作记录工作表' })).toBeVisible();
  await expect(textPage.getByTestId('excel-battle')).toBeAttached();
  await textPage.context().setOffline(true);
  await textPage.waitForTimeout(1800);
  await textPage.context().setOffline(false);
  await textPage.keyboard.press('Control+Alt+x');
  const intro = textPage.getByRole('button', { name: '跳过提示', exact: true });
  if (await intro.isVisible()) await intro.click();
  await expect(textPage.getByTestId('excel-battle')).toBeVisible();
  await expect(textPage.getByTestId('excel-battle')).toContainText('已连接');
  await assertExcelLayout(starter);
  await assertExcelLayout(other);
}
async function briefing(page: Page) {
  await page.getByRole('button', { name: '跳过提示', exact: true }).click();
}

test('server solitaire: draft across renderer and cover, outcome, return', async ({
  page,
  baseURL,
}, info) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const assets = media(page, true);
  await login(page, 1, true);
  await page.getByRole('button', { name: '对墙打', exact: true }).click();
  await page.getByRole('button', { name: '下一步：确认对局', exact: true }).click();
  await page.getByRole('button', { name: '开始对局', exact: true }).click();
  await briefing(page);
  const board = page.getByTestId('excel-battle');
  await expect(board).toBeVisible();
  const choice = page.locator('.excel-mulligan input[type=checkbox]').first();
  await expect(choice).toHaveAccessibleName(/^换掉第 1 张手牌 /);
  await expect(page.locator('body')).not.toContainText(/#[a-f0-9-]{36}:/);
  expect(await page.locator('body').ariaSnapshot()).not.toMatch(/[a-f0-9-]{36}:FIRST:/);
  await choice.focus();
  await page.keyboard.press('Space');
  await expect(choice).toBeChecked();
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await expect(page.locator('[aria-pressed=true][data-battle-ui-object-id]')).toHaveCount(1);
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
  await expect(choice).toBeChecked();
  assets.splice(0);
  await page.keyboard.press('Control+Alt+x');
  await expect(page.getByRole('region', { name: '工作记录工作表' })).toBeVisible();
  await page.keyboard.press('Control+Alt+x');
  await expect(choice).toBeChecked();
  await page.getByRole('button', { name: '保留手牌', exact: true }).click();
  await expect(page.locator('.excel-mulligan')).toHaveCount(0);
  const hand = page.getByRole('table', { name: '我方手牌', exact: true });
  await expect(hand.getByRole('columnheader', { name: '费用 / 分数', exact: true })).toBeVisible();
  await expect(hand).not.toContainText(/#[a-f0-9-]{36}:/);
  await hand.locator('tbody tr').first().getByRole('button').first().click();
  await expect(page.getByRole('region', { name: '选中卡牌', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '卡牌详情', exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole('navigation', { name: '工作表', exact: true })
      .getByRole('button', { name: '对局', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: info.outputPath('excel-real-solitaire.png'), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: info.outputPath('excel-real-solitaire-1920.png'), fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  const rect = await page.locator('.excel-sheets').boundingBox();
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(769);
  await surrender(page);
  await expect(page.getByText('对局结束', { exact: true })).toBeVisible();
  await board.getByRole('button', { name: '返回', exact: true }).click();
  const finish = page.getByRole('button', { name: '退出并结束', exact: true });
  if (await finish.isVisible()) await finish.click();
  await expect(page.getByRole('heading', { name: '对局准备', exact: true })).toBeVisible();
  expect(assets).toEqual([]);
});

for (const [textFirst, textSecond, firstStarts] of [
  [true, true, true],
  [true, true, false],
  [true, false, true],
  [false, true, true],
] as const) {
  test(`casual ${textFirst ? 'Excel' : 'normal'}/${textSecond ? 'Excel' : 'normal'} starting=${firstStarts ? 1 : 2}`, async ({
    browser,
    baseURL,
  }, info) => {
    expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    const contexts = await Promise.all([
      browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } }),
      browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } }),
    ]);
    const [first, second] = await Promise.all(contexts.map((c) => c.newPage()));
    const assets = [media(first, textFirst), media(second, textSecond)],
      errors: string[] = [];
    for (const p of [first, second]) p.on('pageerror', (e) => errors.push(e.message));
    try {
      await login(first, 1, textFirst);
      await login(second, 2, textSecond);
      await leaveFinishedRoom(first);
      await leaveFinishedRoom(second);
      await first.getByRole('button', { name: '创建房间', exact: true }).click();
      await first
        .getByRole('dialog')
        .getByRole('button', { name: '创建房间', exact: true })
        .click();
      await expect(first.getByRole('heading', { name: '正在公开等人' })).toBeVisible();
      const code = (await first.locator('.casual-current-top .casual-code').innerText()).trim();
      await second.getByRole('button', { name: '输入房间号', exact: true }).click();
      await second.getByRole('dialog').getByLabel('房间号', { exact: true }).fill(code);
      await second
        .getByRole('dialog')
        .getByRole('button', { name: '查找房间', exact: true })
        .click();
      await second
        .getByRole('dialog')
        .getByRole('button', { name: '选择卡组并加入', exact: true })
        .click();
      await second
        .getByRole('dialog')
        .getByRole('button', { name: '加入房间', exact: true })
        .click();
      await first.getByRole('button', { name: '确认开局', exact: true }).click();
      await second.getByRole('button', { name: '确认开局', exact: true }).click();
      await first.getByRole('button', { name: '石头', exact: true }).click({ timeout: 30000 });
      await second.getByRole('button', { name: '剪刀', exact: true }).click();
      await first
        .getByRole('button', { name: firstStarts ? '我先手' : '我后手', exact: true })
        .click();
      await Promise.all([briefing(first), briefing(second)]);
      const starter = firstStarts ? first : second,
        follower = firstStarts ? second : first;
      await starter.getByRole('button', { name: '保留手牌', exact: true }).click();
      await follower.getByRole('button', { name: '保留手牌', exact: true }).click();
      await advanceAndRecover(starter, follower, textFirst ? first : second);
      await first.screenshot({ path: info.outputPath('first-battle.png'), fullPage: true });
      await second.screenshot({ path: info.outputPath('second-battle.png'), fullPage: true });
      await surrender(first);
      for (const p of [first, second])
        await p.getByRole('button', { name: '返回对战大厅，再战或选组', exact: true }).click();
      for (const p of [first, second])
        await expect(p.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
      expect(assets).toEqual([[], []]);
      expect(errors).toEqual([]);
      await first.screenshot({ path: info.outputPath('result-return.png'), fullPage: true });
      await leaveFinishedRoom(first);
      await leaveFinishedRoom(second);
    } finally {
      for (const [i, c] of contexts.entries()) sessions.set(i + 1, await c.storageState());
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
}

for (const [textFirst, textSecond, firstStarts] of [
  [true, true, true],
  [true, true, false],
  [true, false, true],
  [false, true, true],
] as const) {
  test(`ranked ${textFirst ? 'Excel' : 'normal'}/${textSecond ? 'Excel' : 'normal'} starting=${firstStarts ? 1 : 2}`, async ({
    browser,
    baseURL,
  }, info) => {
    expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    const contexts = await Promise.all([
      browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } }),
      browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } }),
    ]);
    const [first, second] = await Promise.all(contexts.map((c) => c.newPage()));
    const assets = [media(first, textFirst), media(second, textSecond)];
    try {
      await login(first, 1, textFirst);
      await login(second, 2, textSecond);
      for (const p of [first, second]) {
        await leaveFinishedRoom(p);
        await p.goto('/?page=ranked');
        await p.getByRole('button', { name: '开始排位', exact: true }).click();
      }
      await first.getByRole('button', { name: '确认开局', exact: true }).last().click();
      await second.getByRole('button', { name: '确认开局', exact: true }).last().click();
      await first.getByRole('button', { name: '石头', exact: true }).click({ timeout: 30000 });
      await second.getByRole('button', { name: '剪刀', exact: true }).click();
      await first
        .getByRole('button', { name: firstStarts ? '我先手' : '我后手', exact: true })
        .click();
      await Promise.all([briefing(first), briefing(second)]);
      await (firstStarts ? first : second)
        .getByRole('button', { name: '保留手牌', exact: true })
        .click();
      await (firstStarts ? second : first)
        .getByRole('button', { name: '保留手牌', exact: true })
        .click();
      const textPage = textFirst ? first : second;
      await advanceAndRecover(firstStarts ? first : second, firstStarts ? second : first, textPage);
      await textPage.keyboard.press('Control+Alt+x');
      await expect(textPage.getByRole('region', { name: '工作记录工作表' })).toBeVisible();
      await surrender(first);
      await textPage.keyboard.press('Control+Alt+x');
      await expect(textPage.getByText('对局结束', { exact: true })).toBeVisible();
      await first.screenshot({ path: info.outputPath('ranked-result-first.png'), fullPage: true });
      await second.screenshot({
        path: info.outputPath('ranked-result-second.png'),
        fullPage: true,
      });
      for (const p of [first, second]) {
        await p.getByRole('button', { name: '返回大厅', exact: true }).click();
        await expect(p.getByRole('button', { name: '开始排位', exact: true })).toBeVisible();
      }
      expect(assets).toEqual([[], []]);
    } finally {
      for (const [i, c] of contexts.entries()) sessions.set(i + 1, await c.storageState());
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
}
