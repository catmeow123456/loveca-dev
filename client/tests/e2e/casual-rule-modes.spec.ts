import { expect, test, type Page, type Route } from '@playwright/test';
import { DECK_RECORD, prepareVisualPage, waitForVisualStability } from '../visual/support/mockApp';

const stamp = Date.parse('2026-07-31T12:00:00Z');
const pointCard = DECK_RECORD.main_deck.find((card) => card.card_type === 'LIVE')!.card_code;
const replacement = DECK_RECORD.main_deck.filter((card) => card.card_type === 'LIVE')[1].card_code;
const overDeck = { ...DECK_RECORD, id: 'over-deck', name: '超 PT 构筑' };
const normalDeck = {
  ...DECK_RECORD,
  id: 'normal-deck',
  name: '标准可用卡组',
  main_deck: DECK_RECORD.main_deck.map((card) =>
    card.card_code === pointCard ? { ...card, card_code: replacement } : card
  ),
};
const room = (ruleMode: 'NORMAL' | 'UNLIMITED') => ({
  ruleMode,
  tableId: ruleMode === 'NORMAL' ? 'normal-table' : 'unlimited-table',
  roundId: 'round',
  revision: 1,
  roomCode: ruleMode === 'NORMAL' ? 'NORMAL' : 'UNLMTD',
  note: '',
  status: 'WAITING',
  members: [{ userId: 'opponent', displayName: ruleMode === 'NORMAL' ? '标准房主' : '娱乐房主' }],
  since: stamp,
  canJoin: true,
  isMine: false,
  spectatorViews: [],
});
async function setup(page: Page, theme: 'light' | 'dark' = 'light') {
  await prepareVisualPage(page, theme, true);
  let own: unknown = null;
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fulfill = (route: Route, data: unknown) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, error: null }) });
  await page.route('**/api/deck-point-tables/current', (route) =>
    fulfill(route, {
      version: 'ui-test',
      displayName: '测试 PT',
      pointLimit: 9,
      effectiveFrom: '2026-01-01T00:00:00Z',
      platformTimeZone: 'Asia/Shanghai',
      entries: [{ baseCardCode: pointCard, points: 20 }],
    })
  );
  await page.route('**/api/decks', (route) =>
    fulfill(route, [
      normalDeck,
      overDeck,
      { ...overDeck, id: 'incomplete', name: '构筑未完成', energy_deck: [] },
    ])
  );
  await page.route('**/api/casual-tables/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/').at(-1)!;
    if (path === 'me') return fulfill(route, { table: own, otherParticipation: null });
    if (path === 'rooms') {
      const mode = url.searchParams.get('ruleMode') === 'UNLIMITED' ? 'UNLIMITED' : 'NORMAL';
      return fulfill(route, {
        rooms: [room(mode)],
        counts: { waiting: 1, preparing: 0, playing: 0 },
        nextCursor: null,
        snapshotAt: stamp,
        unavailableReason: null,
      });
    }
    if (path === 'UNLMTD') return fulfill(route, room('UNLIMITED'));
    if (path === 'NORMAL') return fulfill(route, room('NORMAL'));
    const body = route.request().postDataJSON();
    writes.push({ path, body });
    if (path === 'cancel') {
      own = null;
      return fulfill(route, { table: null, otherParticipation: null });
    }
    if (path === 'create' || path === 'join' || path === 'find') {
      const entry = path === 'join' ? body.entry : body;
      own = {
        ...room(entry.ruleMode),
        roomCode: body.roomCode || room(entry.ruleMode).roomCode,
        state: path === 'join' ? 'RESERVED' : 'WAITING',
        waitingSince: stamp,
        discoverability: body.discoverability ?? 'PUBLIC',
        confirmationExpiresAt: stamp + 60_000,
        ownDeck: {
          id: entry.deckId,
          name: entry.deckId === 'over-deck' ? overDeck.name : normalDeck.name,
          pointTotal: entry.deckId === 'over-deck' ? 20 : 0,
          pointLimit: 9,
        },
        spectatorEnabled: false,
        members: [{ userId: 'visual-user', displayName: '本人', confirmed: false }],
        roomGeneration: null,
        failureReason: null,
        runtime: null,
        canRematch: false,
        canContinuePublic: false,
      };
    }
    return fulfill(route, own);
  });
  return writes;
}

for (const theme of ['light', 'dark'] as const) {
  test(`switches lists and available decks, creates an entertainment room, then explicitly cancels before switching (${theme})`, async ({
    page,
  }, testInfo) => {
    const writes = await setup(page, theme);
    await page.goto('/?page=battle-lobby');
    await expect(page.getByText('标准房主', { exact: true })).toBeVisible();
    await expect(page.getByText('娱乐房主', { exact: true })).toHaveCount(0);
    await page.getByRole('radio', { name: '娱乐模式 PT 不限' }).check();
    await expect(page.getByText('娱乐房主', { exact: true })).toBeVisible();
    await expect(page.getByText('标准房主', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '更换', exact: true }).click();
    await dialog.getByRole('button', { name: '超 PT 构筑', exact: true }).click();
    await expect(dialog.getByText('20 PT · 无上限', { exact: true })).toBeVisible();
    await expect(dialog.getByText('构筑未完成', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: '创建娱乐房间', exact: true }).click();
    await expect(page.getByRole('status', { name: '正在公开等人' })).toBeVisible();
    expect(writes.find((write) => write.path === 'create')?.body).toMatchObject({
      ruleMode: 'UNLIMITED',
      deckId: 'over-deck',
      roomCode: '',
    });
    await expect(
      page
        .getByRole('region', { name: '我的房间', exact: true })
        .getByText('娱乐模式 · PT 不限', { exact: true })
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: '标准模式', exact: true })).toHaveCount(0);
    await expect(page.getByText('练习与调试', { exact: true })).toHaveCount(0);
    await waitForVisualStability(page);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await expect(
        page.getByRole('button', { name: '加入 娱乐房主 的房间', exact: true })
      ).toBeInViewport({ ratio: 1 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`entertainment-room-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: '切换模式…', exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '取消等待并切换', exact: true })
    ).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '继续等待', exact: true }).click();
    await expect(page.getByRole('button', { name: '切换模式…', exact: true })).toBeFocused();
    expect(writes.filter((write) => write.path === 'cancel')).toHaveLength(0);
    await expect(page.getByRole('status', { name: '正在公开等人' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '娱乐模式房间' })).toBeVisible();
    await page.getByRole('button', { name: '切换模式…', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '取消等待并切换', exact: true })
      .click();
    await expect(page.getByRole('radio', { name: '标准模式', exact: true })).toBeChecked();
    expect(writes.filter((write) => write.path === 'find')).toHaveLength(0);
  });
}

test('room deck picker preserves settings, supports search and restores keyboard focus', async ({
  page,
}, testInfo) => {
  const writes = await setup(page);
  const additionalDecks = Array.from({ length: 6 }, (_, index) => ({
    ...normalDeck,
    id: `practice-${index}`,
    name: `练习卡组 ${index + 1} · 用于区分同名前缀的完整卡组名称`,
  }));
  await page.route('**/api/decks', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          normalDeck,
          ...additionalDecks,
          overDeck,
          { ...normalDeck, id: 'incomplete', name: '构筑未完成', energy_deck: [] },
        ],
        error: null,
      }),
    })
  );
  await page.goto('/?page=battle-lobby');
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '创建房间', exact: true });
  await dialog.getByLabel('房间号（可选）', { exact: true }).fill('FRIENDS');
  await dialog.getByLabel('备注（可选）').fill('练习用房间');
  await dialog.getByRole('radio', { name: '凭链接加入', exact: true }).check();
  await dialog.getByLabel('开放我的观战视角').check();
  await dialog.getByRole('button', { name: '更换', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '选择本局卡组', exact: true });
  await expect(dialog.getByRole('button', { name: normalDeck.name, exact: true })).toBeFocused();
  const thumbnail = dialog.locator('[data-deck-choice] img').first();
  await expect(thumbnail).toHaveCSS('width', '40px');
  await dialog.getByRole('searchbox', { name: '搜索卡组', exact: true }).fill('练习卡组 6');
  await expect(dialog.locator('[data-deck-choice]')).toHaveCount(1);
  await dialog.getByRole('searchbox').press('Enter');
  await expect(dialog).toBeVisible();
  expect(writes).toHaveLength(0);
  await dialog.getByRole('button', { name: '返回房间设置', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '创建房间', exact: true });
  await expect(dialog.getByRole('button', { name: '更换', exact: true })).toBeFocused();
  await expect(dialog.getByText(normalDeck.name, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '更换', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '选择本局卡组', exact: true });
  await dialog.getByRole('searchbox').fill('练习卡组 6');
  const chosen = dialog.getByRole('button', { name: additionalDecks[5].name, exact: true });
  await chosen.focus();
  await chosen.press('Enter');
  dialog = page.getByRole('dialog', { name: '创建房间', exact: true });
  await expect(dialog.getByRole('button', { name: '更换', exact: true })).toBeFocused();
  await expect(dialog.getByText(additionalDecks[5].name, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('房间号（可选）', { exact: true })).toHaveValue('FRIENDS');
  await expect(dialog.getByLabel('备注（可选）')).toHaveValue('练习用房间');
  await expect(dialog.getByRole('radio', { name: '凭链接加入', exact: true })).toBeChecked();
  await expect(dialog.getByLabel('开放我的观战视角')).toBeChecked();
  await dialog.getByRole('button', { name: '更换', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '选择本局卡组', exact: true });
  await expect(
    dialog.getByRole('button', { name: additionalDecks[5].name, exact: true })
  ).toBeFocused();
  await dialog.getByText('不可用卡组（2）', { exact: true }).click();
  await expect(dialog.getByText('能量卡必须为 12 张 (当前 0)', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('卡组点数必须不超过 9pt (当前 20pt)', { exact: true })
  ).toBeVisible();
  await waitForVisualStability(page);
  await page.screenshot({ path: testInfo.outputPath('room-deck-picker.png'), fullPage: true });
  await dialog.getByRole('button', { name: '关闭弹层', exact: true }).click();
  await page.getByRole('button', { name: '找对手', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '找对手', exact: true });
  await dialog.getByRole('button', { name: '更换', exact: true }).click();
  const gridThumbnail = dialog.locator('[data-deck-choice] img').first();
  const gridThumbnailBounds = await gridThumbnail.boundingBox();
  expect(gridThumbnailBounds!.width).toBeGreaterThan(20);
  expect(gridThumbnailBounds!.height).toBeGreaterThan(20);
  expect(writes).toHaveLength(0);
});

test('custom room codes validate before submitting, preserve the form on conflict and can be corrected', async ({
  page,
}, testInfo) => {
  const writes = await setup(page);
  const attempts: Array<Record<string, unknown>> = [];
  await page.route('**/api/casual-tables/create', async (route) => {
    attempts.push(route.request().postDataJSON());
    if (attempts.length > 1) return route.fallback();
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: {
          code: 'CASUAL_ROOM_CODE_TAKEN',
          message: '这个房间号已被占用，请换一个或留空自动生成',
        },
      }),
    });
  });
  await page.goto('/?page=battle-lobby');
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const code = dialog.getByRole('textbox', { name: '房间号（可选）', exact: true });
  await code.fill('bad!');
  await dialog.getByRole('button', { name: '创建标准房间', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('4–12 位字母或数字');
  expect(attempts).toHaveLength(0);
  expect(writes).toHaveLength(0);
  await code.fill('friends42');
  await dialog.getByRole('radio', { name: /凭链接加入/ }).check();
  await dialog.getByLabel('备注（可选）').fill('周末练习');
  await dialog.getByRole('button', { name: '创建标准房间', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('这个房间号已被占用');
  await expect(dialog.getByRole('alert')).toBeInViewport({ ratio: 1 });
  await expect(code).toHaveValue('friends42');
  await expect(dialog.getByRole('radio', { name: /凭链接加入/ })).toBeChecked();
  await expect(dialog.getByLabel('备注（可选）')).toHaveValue('周末练习');
  await waitForVisualStability(page);
  await page.screenshot({ path: testInfo.outputPath('custom-code-conflict.png'), fullPage: true });
  await code.fill('friends43');
  await dialog.getByRole('button', { name: '创建标准房间', exact: true }).click();
  await expect(page.getByRole('status', { name: '凭链接等人' })).toBeVisible();
  await expect(page.getByRole('region', { name: '我的房间', exact: true })).toContainText(
    'FRIENDS43'
  );
  expect(attempts[1]).toMatchObject({
    ruleMode: 'NORMAL',
    roomCode: 'FRIENDS43',
    discoverability: 'UNLISTED',
    note: '周末练习',
  });
  expect(attempts[0].requestId).toBe(attempts[1].requestId);
});

test('code joining accepts target entertainment rules in the same dialog; cancelling preserves normal preference', async ({
  page,
}, testInfo) => {
  const writes = await setup(page);
  await page.goto('/?page=battle-lobby');
  const lookup = async () => {
    await page.getByRole('button', { name: '输入房间号', exact: true }).click();
    await page.getByRole('dialog').getByLabel('房间号', { exact: true }).fill('UNLMTD');
    await page.getByRole('dialog').getByRole('button', { name: '查找房间', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '选择卡组并加入', exact: true })
      .click();
  };
  await lookup();
  await expect(
    page.getByRole('dialog').getByText('双方均可使用超 PT 卡组，其余构筑规则照常。')
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('radio', { name: '标准模式', exact: true })).toBeChecked();
  expect(writes).toHaveLength(0);
  await lookup();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '按娱乐模式加入', exact: true })
    .click();
  expect(writes.find((write) => write.path === 'join')?.body).toMatchObject({
    entry: { ruleMode: 'UNLIMITED' },
  });
  await expect(page.getByRole('button', { name: '确认开局', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '标准模式', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '切换模式…', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '我的房间', exact: true })).toContainText(
    '娱乐模式 · PT 不限'
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await waitForVisualStability(page);
    await page.screenshot({ path: testInfo.outputPath(`preparing-${width}.png`), fullPage: true });
  }
});

test('discards a late normal-list response after switching, and keeps the entertainment layout within narrow screens', async ({
  page,
}, testInfo) => {
  await setup(page, 'dark');
  await page.goto('/?page=battle-lobby');
  await expect(page.getByText('标准房主', { exact: true })).toBeVisible();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/casual-tables/rooms?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('ruleMode') !== 'NORMAL')
      return route.fallback();
    started();
    await delayed;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          rooms: [room('NORMAL')],
          counts: { waiting: 1, preparing: 0, playing: 0 },
          nextCursor: null,
          snapshotAt: stamp,
          unavailableReason: null,
        },
        error: null,
      }),
    });
  });
  await page.getByRole('button', { name: '刷新房间', exact: true }).click();
  await pending;
  await page.getByRole('radio', { name: '娱乐模式 PT 不限' }).check();
  await expect(page.getByText('娱乐房主', { exact: true })).toBeVisible();
  release();
  await expect(page.getByText('标准房主', { exact: true })).toHaveCount(0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await waitForVisualStability(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    await page.screenshot({
      path: testInfo.outputPath(`entertainment-${width}-dark.png`),
      fullPage: true,
    });
  }
});

test('continues the home rule and chosen deck into the lobby without offering over-PT decks as ordinary choices', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/?page=home');
  await page.getByRole('radio', { name: '娱乐模式 PT 不限' }).check();
  await page.getByRole('button', { name: /更换卡组/, exact: false }).click();
  await page.getByRole('dialog').getByRole('button', { name: '超 PT 构筑', exact: true }).click();
  await page.getByRole('button', { name: '进入对战大厅', exact: false }).click();
  await expect(page.getByRole('radio', { name: '娱乐模式 PT 不限' })).toBeChecked();
  await page.getByRole('button', { name: '找对手', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('超 PT 构筑', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('radio', { name: '标准模式', exact: true }).check();
  await page.getByRole('button', { name: '找对手', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '更换', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '超 PT 构筑', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('dialog').getByRole('region', { name: '娱乐模式可用卡组' })
  ).toBeVisible();
});

test('does not display zero PT when the online point table cannot be read', async ({ page }) => {
  await setup(page);
  await page.route('**/api/deck-point-tables/current', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: { code: 'UNAVAILABLE', message: 'PT 表暂不可用' },
      }),
    })
  );
  await page.goto('/?page=battle-lobby');
  await page.getByRole('radio', { name: '娱乐模式 PT 不限' }).check();
  await page.getByRole('button', { name: '找对手', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('PT 暂无法读取', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('0 PT · 无上限', { exact: true })).toHaveCount(0);
});

test('a player with only an over-PT construction can enter the normal lobby to browse', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/decks', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [overDeck], error: null }),
    })
  );
  await page.goto('/?page=home');
  await expect(page.getByRole('radio', { name: '标准模式', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '进入对战大厅', exact: false })).toBeEnabled();
  await page.getByRole('button', { name: '进入对战大厅', exact: false }).click();
  await expect(page.getByText('标准房主', { exact: true })).toBeVisible();
});

test('joining an ordinary code from entertainment offers only ordinary-legal decks', async ({
  page,
}) => {
  const writes = await setup(page);
  await page.goto('/?page=battle-lobby');
  await page.getByRole('radio', { name: '娱乐模式 PT 不限' }).check();
  await page.getByRole('button', { name: '输入房间号', exact: true }).click();
  await page.getByRole('dialog').getByLabel('房间号', { exact: true }).fill('NORMAL');
  await page.getByRole('dialog').getByRole('button', { name: '查找房间', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '选择卡组并加入', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByText('标准可用卡组', { exact: true })).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '按标准模式加入', exact: true })
    .click();
  expect(writes.find((write) => write.path === 'join')?.body).toMatchObject({
    entry: { ruleMode: 'NORMAL', deckId: 'normal-deck' },
  });
});

test('rule selection remains usable when the browser cannot save preferences', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('loveca.casualRuleMode:'))
        throw new DOMException('Storage blocked', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/?page=battle-lobby');
  await page.getByRole('radio', { name: '娱乐模式 PT 不限' }).check();
  await expect(page.getByText('娱乐房主', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '标准模式', exact: true }).check();
  await expect(page.getByText('标准房主', { exact: true })).toBeVisible();
});
