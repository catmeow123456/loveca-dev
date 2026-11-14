import { expect, test } from '@playwright/test';
import { prepareVisualPage } from '../visual/support/mockApp';
import type { CasualFormat, CasualRoomSummary } from '../../../src/online/casual-table-types';

test.use({ serviceWorkers: 'block' });

test('娱乐房间统一展示，玩法标签只置顶强调，加入其他类型使用目标规则', async ({ page }, info) => {
  const theme = info.project.name.startsWith('mobile') ? 'light' : 'dark';
  await prepareVisualPage(page, theme, true);
  const room = (format: CasualFormat, name: string, roomCode: string): CasualRoomSummary => ({
    tableId: `table-${roomCode}`,
    roundId: `round-${roomCode}`,
    revision: 1,
    format,
    ruleMode: 'UNLIMITED',
    roomCode,
    note: '',
    status: 'WAITING',
    members: [{ userId: `user-${roomCode}`, displayName: name }],
    since: Date.now(),
    canJoin: true,
    isMine: false,
    spectatorViews: [],
  });
  const rooms = [
    room('CONSTRUCTED', '自由构筑房主', 'FREE123'),
    room('SEALED_BP7', '开盒房主', 'BOX123'),
    room('HEXTECH', '海克斯房主', 'HEX123'),
  ];
  const queries: URLSearchParams[] = [];
  const joins: unknown[] = [];
  let includeHextech = true;
  await page.route('**/api/casual-tables/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/').at(-1);
    if (path === 'me')
      return route.fulfill({
        json: { data: { table: null, otherParticipation: null }, error: null },
      });
    if (path === 'rooms') {
      queries.push(url.searchParams);
      const preferred = url.searchParams.get('preferredFormat');
      const visible =
        url.searchParams.get('ruleMode') === 'UNLIMITED'
          ? rooms.filter((row) => includeHextech || row.format !== 'HEXTECH')
          : [];
      visible.sort((a, b) => Number(b.format === preferred) - Number(a.format === preferred));
      return route.fulfill({
        json: {
          data: {
            rooms: visible,
            counts: { waiting: visible.length, preparing: 0, playing: 0 },
            nextCursor: null,
            snapshotAt: Date.now(),
            unavailableReason: null,
          },
          error: null,
        },
      });
    }
    if (path === 'join') {
      joins.push(route.request().postDataJSON());
      return route.fulfill({
        status: 409,
        json: { data: null, error: { code: 'TEST_COMPLETE', message: '已验证加入参数' } },
      });
    }
    return route.fallback();
  });
  await page.goto('/?page=battle-lobby');
  await page.getByRole('radio', { name: '娱乐模式 PT 不限' }).check();
  const tags = page.getByRole('tablist', { name: '娱乐玩法' });
  const list = page.getByRole('list', { name: '公开房间列表' });
  const rows = list.getByRole('listitem');
  expect((await tags.boundingBox())!.height).toBeLessThanOrEqual(56);
  await expect(tags.getByRole('tab', { name: '全部', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('自由构筑房主');
  await expect(page.getByText('3 间等人 · 0 间准备 · 0 间对战中', { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath(`entertainment-all-${theme}.png`),
    fullPage: true,
  });
  for (const [name, owner] of [
    ['海克斯', '海克斯房主'],
    ['开盒战', '开盒房主'],
    ['自由构筑', '自由构筑房主'],
  ] as const) {
    const tag = tags.getByRole('tab', { name, exact: true });
    await tag.click();
    await expect(rows.first()).toContainText(owner);
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveClass(/casual-row--preferred/);
    await expect(list.locator('.casual-row--preferred')).toHaveCount(1);
    await expect(tag).toBeFocused();
    for (const original of rooms)
      await expect(list.getByText(original.members[0].displayName, { exact: true })).toBeVisible();
  }
  await tags.getByRole('tab', { name: '海克斯', exact: true }).click();
  await expect(rows.first()).toContainText('海克斯房主');
  await page.getByRole('button', { name: '刷新房间', exact: true }).click();
  await expect(rows.first()).toContainText('海克斯房主');
  await expect(rows).toHaveCount(3);
  await page.screenshot({
    path: info.outputPath(`entertainment-hextech-first-${theme}.png`),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true
  );
  await list.getByRole('button', { name: '加入 开盒房主 的房间', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('region', { name: '开盒战玩法' })).toBeVisible();
  await expect(dialog.getByRole('region', { name: '海克斯玩法' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('已验证加入参数');
  expect(joins).toEqual([
    expect.objectContaining({
      target: expect.objectContaining({ tableId: 'table-BOX123' }),
      entry: expect.objectContaining({ format: 'SEALED_BP7', ruleMode: 'UNLIMITED' }),
    }),
  ]);
  expect((joins[0] as { entry: object }).entry).not.toHaveProperty('deckId');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  includeHextech = false;
  await page.getByRole('button', { name: '刷新房间', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('开盒房主', { exact: true })).toBeVisible();
  await expect(list.locator('.casual-row--preferred')).toHaveCount(0);
  await tags.getByRole('tab', { name: '全部', exact: true }).click();
  await expect(rows.first()).toContainText('自由构筑房主');
  await expect(rows).toHaveCount(2);
  expect(queries.every((query) => !query.has('format'))).toBe(true);
  expect(queries.some((query) => query.get('preferredFormat') === 'HEXTECH')).toBe(true);
});
