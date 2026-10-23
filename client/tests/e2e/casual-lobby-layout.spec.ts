import { expect, test, type Page } from '@playwright/test';
test.setTimeout(120_000);

import { prepareVisualPage, waitForVisualStability } from '../visual/support/mockApp';

async function expectLobbyActionsInViewport(page: Page) {
  await page.getByText('练习与调试', { exact: true }).click();
  for (const name of ['找对手', '对墙打', '双人调试']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.getByText('练习与调试', { exact: true }).click();
}

test('practice entries expand with the keyboard and open their own preparation', async ({
  page,
}) => {
  await prepareVisualPage(page, 'light', true);
  for (const name of ['对墙打', '双人调试']) {
    await page.goto('/?page=battle-lobby');
    const practice = page.getByText('练习与调试', { exact: true });
    await expect(page.getByRole('button', { name, exact: true })).toBeHidden();
    await practice.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name, exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: name === '对墙打' ? '选择己方卡组' : '选择 Player 1 的卡组',
        exact: true,
      })
    ).toBeVisible();
  }
});

test('lobby fits narrow and wide screens, both themes and enlarged text', async ({
  page,
}, testInfo) => {
  for (const theme of ['light', 'dark'] as const) {
    await prepareVisualPage(page, theme, true);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/?page=battle-lobby');
      await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '找对手', exact: true })).toBeEnabled();
      await waitForVisualStability(page);
      await expectLobbyActionsInViewport(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      const rect = await page.locator('.casual-lobby').boundingBox();
      expect(rect!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`lobby-${width}-${theme}.png`),
        fullPage: true,
      });
      await page.getByRole('button', { name: '创建房间', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: '创建房间' })).toBeVisible();
      await expect(dialog.getByRole('radio', { name: /公开找人/ })).toBeChecked();
      const dialogRect = await dialog.boundingBox();
      expect(dialogRect!.x).toBeGreaterThanOrEqual(0);
      expect(dialogRect!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(page.getByRole('button', { name: '创建房间', exact: true })).toBeFocused();
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto('/?page=battle-lobby');
    await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await expectLobbyActionsInViewport(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    await page.screenshot({
      path: testInfo.outputPath(`lobby-200-text-${theme}.png`),
      fullPage: true,
    });
  }
});

test('old discovery links lead to the lobby and the unified room list supports search', async ({
  page,
}) => {
  await prepareVisualPage(page, 'light', true);
  for (const path of ['/?page=public-table', '/?page=online-spectator', '/online/spectate']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '创建房间', exact: true })).toBeEnabled();
  }
  await expect(page.getByRole('tablist', { name: '浏览房间' })).toHaveCount(0);
  const search = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === '/api/casual-tables/rooms' &&
      new URL(request.url()).searchParams.get('search') === '视觉验收玩家'
  );
  await page.getByRole('textbox', { name: '搜索昵称或房间号' }).fill('视觉验收玩家');
  const request = await search;
  expect(new URL(request.url()).searchParams.has('filter')).toBe(false);
  expect(new URL(request.url()).searchParams.has('spectatable')).toBe(false);
  await expect(page.getByText('我的当前状态', { exact: true })).toHaveCount(0);
});

test('activity codes keep read-only spectator entry and fence a replaced generation', async ({
  page,
}) => {
  await prepareVisualPage(page, 'light', true);
  await page.route('**/api/casual-tables/rooms/ACT123', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: { code: 'CASUAL_ROOM_NOT_FOUND', message: '房间不存在' },
      }),
    })
  );
  await page.route('**/api/online/rooms/ACT123/spectator-entry?activityOnly=true', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          roomCode: 'ACT123',
          roomGeneration: 'activity-generation',
          status: 'IN_GAME',
          matchId: 'activity-match',
          seats: [{ seat: 'FIRST', displayName: '活动玩家', enabled: true }],
        },
        error: null,
      }),
    })
  );
  await page.route('**/api/online/rooms/ACT123/spectator-entry/FIRST/link', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ roomGeneration: 'activity-generation' });
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: { code: 'ONLINE_ROOM_REPLACED', message: '本轮房间已经变化，请重新选择' },
      }),
    });
  });
  await page.goto('/?page=battle-lobby');
  await page.getByRole('button', { name: '输入房间号', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('房间号', { exact: true }).fill('ACT123');
  await dialog.getByRole('button', { name: '查找房间', exact: true }).click();
  await dialog.getByRole('button', { name: '观看 活动玩家 的视角', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('本轮房间已经变化，请重新选择');
});

test('missing activity recovery code cannot silently abandon authority and enter a local game', async ({
  page,
}) => {
  await prepareVisualPage(page, 'light', true);
  await page.route('**/api/casual-tables/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    })
  );
  await page.goto('/');
  await page
    .getByRole('region', { name: '当前房间', exact: true })
    .getByText('其他操作', { exact: true })
    .click();
  await expect(page.getByRole('button', { name: '另开本地对局', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '另开本地对局', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择己方卡组' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回房间', exact: true })).toBeVisible();
  await expect(page.getByText(/读取排位|读取赛季|未能恢复当前房间/).first()).toBeVisible();
});

test('opening can explicitly close its round from the lobby without an old-room leave command', async ({
  page,
}) => {
  await prepareVisualPage(page, 'light', true);
  const target = {
    tableId: '11111111-1111-4111-8111-111111111111',
    roundId: '22222222-2222-4222-8222-222222222222',
    revision: 3,
  };
  let left = false;
  await page.route('**/api/casual-tables/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          table: left
            ? null
            : {
                ...target,
                roomCode: 'OPEN12',
                ruleMode: 'NORMAL',
                discoverability: 'PUBLIC',
                note: '',
                state: 'BOUND',
                waitingSince: Date.now(),
                confirmationExpiresAt: null,
                ownDeck: { id: 'deck', name: '开局测试卡组', pointTotal: 0, pointLimit: 9 },
                spectatorEnabled: false,
                members: [{ userId: 'visual-user', displayName: '视觉验收玩家', confirmed: true }],
                roomGeneration: 'opening-generation',
                failureReason: null,
                runtime: {
                  status: 'OPENING',
                  matchId: null,
                  startedAt: Date.now(),
                  endedAt: null,
                  departedUserIds: [],
                  spectatorViews: [],
                  rematch: null,
                },
                canRematch: false,
                canContinuePublic: false,
              },
          otherParticipation: null,
        },
        error: null,
      }),
    })
  );
  await page.route('**/api/casual-tables/leave', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ target: expect.objectContaining(target) });
    left = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { table: null, otherParticipation: null }, error: null }),
    });
  });
  await page.goto('/?page=battle-lobby');
  await page.getByRole('button', { name: '离开房间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '退出本轮开局？' });
  await expect(dialog.getByText('退出将关闭本轮开局，双方席位都会释放。')).toBeVisible();
  await dialog.getByRole('button', { name: '确认退出', exact: true }).click();
  await expect(page.getByRole('button', { name: '找对手', exact: true })).toBeEnabled();
});

for (const kind of [
  'WAITING',
  'RESERVED',
  'BOOTSTRAPPING',
  'RANKED_QUEUE',
  'THEME_QUEUE',
] as const) {
  test(`abandoning a stale room cannot bypass fresh ${kind} participation`, async ({ page }) => {
    await prepareVisualPage(page, 'light', true);
    let changed = false;
    const initial = {
      table: null,
      otherParticipation: {
        kind: 'ONLINE_MATCH',
        destination: 'online-room',
        roomGeneration: 'old-room',
        matchId: 'old-match',
      },
    };
    const fresh = kind.endsWith('_QUEUE')
      ? {
          table: null,
          otherParticipation: {
            kind,
            destination: kind === 'RANKED_QUEUE' ? 'ranked' : 'theme-table',
            roomGeneration: null,
            matchId: null,
          },
        }
      : {
          table: {
            tableId: '11111111-1111-4111-8111-111111111111',
            roundId: '22222222-2222-4222-8222-222222222222',
            revision: 1,
            roomCode: 'WAIT12',
            ruleMode: 'NORMAL',
            discoverability: 'PUBLIC',
            note: '',
            state: kind,
            waitingSince: Date.now(),
            confirmationExpiresAt: null,
            ownDeck: null,
            spectatorEnabled: false,
            members: [],
            roomGeneration: null,
            failureReason: null,
            runtime: null,
            canRematch: false,
            canContinuePublic: false,
          },
          otherParticipation: null,
        };
    await page.route('**/api/casual-tables/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: changed ? fresh : initial, error: null }),
      })
    );
    await page.goto('/');
    const abandon = page.getByRole('button', { name: '另开本地对局', exact: true });
    await expect(abandon).toBeHidden();
    await page
      .getByRole('region', { name: '当前房间', exact: true })
      .getByText('其他操作', { exact: true })
      .click();
    await expect(abandon).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem('loveca.online.room', 'OLD123'));
    let staleWrites = 0;
    await page.route('**/api/online/rooms/OLD123/abandon-for-local-game', async (route) => {
      staleWrites += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { room: null }, error: null }),
      });
    });
    changed = true;
    await abandon.click();
    await expect(
      page.getByText(/未能恢复当前房间|读取排位|读取赛季|读取娱乐/).first()
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: '选择己方卡组', exact: true })).toHaveCount(0);
    expect(staleWrites).toBe(0);
  });
}
