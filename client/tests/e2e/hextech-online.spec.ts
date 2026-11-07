import { expect, test, type Page } from '@playwright/test';
import { prepareVisualPage } from '../visual/support/mockApp';
import { CardType } from '../../../src/shared/types/enums';
import { toTransport } from '../../../src/online/serde';
import type { OnlineRoomView } from '../../../src/online/release-types';
import type { DeckConfig } from '../../../src/application/game-service';

test.use({ serviceWorkers: 'block' });
test.setTimeout(90_000);

test('娱乐模式海克斯标签预选建房玩法并使用自选卡组', async ({ page }, info) => {
  await prepareVisualPage(page, 'light', true);
  const writes: unknown[] = [];
  await page.route('**/api/casual-tables/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/').at(-1);
    let data: unknown = null;
    if (path === 'me') data = { table: null, otherParticipation: null };
    if (path === 'rooms')
      data = {
        rooms: [],
        counts: { waiting: 0, preparing: 0, playing: 0 },
        nextCursor: null,
        snapshotAt: Date.now(),
        unavailableReason: null,
      };
    if (path === 'create') {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        status: 409,
        json: { data: null, error: { code: 'TEST_COMPLETE', message: '已验证创建参数' } },
      });
    }
    return route.fulfill({ json: { data, error: null } });
  });
  await page.goto('/?page=battle-lobby');
  await page.getByRole('radio', { name: '娱乐模式 PT 不限' }).check();
  await page.getByRole('button', { name: '海克斯', exact: true }).click();
  await expect(page.getByRole('heading', { name: '娱乐模式房间' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('hextech-lobby.png'), fullPage: true });
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('region', { name: '海克斯玩法' })).toBeVisible();
  await expect(dialog.getByText(/第 1／3／5 回合开始时/)).toBeVisible();
  const formats = dialog.getByRole('group', { name: '娱乐玩法' });
  await formats.getByRole('button', { name: '自由构筑', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '海克斯玩法' })).toHaveCount(0);
  await formats.getByRole('button', { name: '海克斯', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '海克斯玩法' })).toBeVisible();
  for (const button of await formats.getByRole('button').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: info.outputPath('hextech-create-dialog.png'), fullPage: true });
  await dialog.getByRole('button', { name: '创建海克斯房间', exact: true }).click();
  expect(writes).toEqual([
    expect.objectContaining({
      format: 'HEXTECH',
      ruleMode: 'UNLIMITED',
      deckId: expect.any(String),
    }),
  ]);
});

// Real OnlineMatchService and shared OnlineRoomPage/GameBoard; only HTTP and persistence
// are isolated. No account decks, active local rooms or production APIs are changed.
test('双方真人桌面自动显示稀有度、独立重抽和确认，支持后攻先确认及重连', async ({
  page,
  browser,
}, info) => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    JWT_SECRET: 'hextech-fixture',
    JWT_REFRESH_SECRET: 'hextech-refresh',
    MINIO_ENDPOINT: '127.0.0.1',
    MINIO_ACCESS_KEY: 'fixture',
    MINIO_SECRET_KEY: 'fixture',
    FRONTEND_URL: 'http://localhost:5173',
  });
  const { OnlineMatchService } = await import('../../../src/server/services/online-match-service');
  const service = new OnlineMatchService({ recorder: null, randomInt: (max) => max - 1 });
  const deck: DeckConfig = {
    mainDeck: Array.from({ length: 60 }, () => ({
      cardCode: 'ME-visual-001',
      name: '测试成员',
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [],
    })),
    energyDeck: Array.from({ length: 12 }, () => ({
      cardCode: 'LL-E-001-SD',
      name: '能量',
      cardType: CardType.ENERGY,
    })),
  };
  const participant = (userId: string, displayName: string) => ({
    userId,
    displayName,
    deck,
    pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
  });
  const match = await service.createMatch({
    roomCode: 'HEX123',
    hextechRoundSelection: true,
    casualRuleMode: 'UNLIMITED',
    first: participant('first-user', '先攻玩家'),
    second: participant('second-user', '后攻玩家'),
  });
  const secondContext = await browser.newContext({
    baseURL: info.project.use.baseURL,
    viewport: page.viewportSize()!,
    serviceWorkers: 'block',
  });
  const second = await secondContext.newPage();
  const errors: string[] = [];
  for (const [index, client] of [page, second].entries()) {
    client.on('pageerror', (error) => errors.push(error.message));
    await prepareVisualPage(client, index === 0 ? 'light' : 'dark', true);
    await client.addInitScript(() => {
      sessionStorage.setItem('loveca.online.room', 'HEX123');
    });
    const seat = index === 0 ? 'FIRST' : 'SECOND';
    const userId = index === 0 ? 'first-user' : 'second-user';
    const room: OnlineRoomView = {
      casualTable: { format: 'HEXTECH', ruleMode: 'UNLIMITED', tableId: 'table', roundId: 'round' },
      roomCode: 'HEX123',
      originKind: 'ONLINE_ROOM',
      status: 'IN_GAME',
      battleTimeouts: { playerActionTimeoutSeconds: 180, reconnectGracePeriodSeconds: 60 },
      ownerUserId: 'first-user',
      currentUserId: userId,
      currentUserRole: index === 0 ? 'HOST' : 'GUEST',
      currentUserPresence: 'ACTIVE',
      currentUserSeat: seat,
      members: [
        {
          userId: 'first-user',
          displayName: '先攻玩家',
          role: 'HOST',
          presence: 'ACTIVE',
          lockedDeckId: null,
          lockedDeckName: null,
          ready: true,
          startReady: true,
          seat: 'FIRST',
        },
        {
          userId: 'second-user',
          displayName: '后攻玩家',
          role: 'GUEST',
          presence: 'ACTIVE',
          lockedDeckId: null,
          lockedDeckName: null,
          ready: true,
          startReady: true,
          seat: 'SECOND',
        },
      ],
      openingRps: null,
      openingArrivalExpiresAt: null,
      restartRequest: null,
      endInfo: null,
      matchId: match.matchId,
      spectatorRoomEntry: null,
      spectatorPresence: { total: 0, viewers: [] },
      updatedAt: Date.now(),
    };
    await client.route('**/api/auth/refresh', (route) =>
      route.fulfill({
        json: {
          data: {
            accessToken: 'test-token',
            user: { id: userId, email: `${userId}@example.test`, emailVerified: true },
            profile: {
              id: userId,
              username: userId,
              display_name: index === 0 ? '先攻玩家' : '后攻玩家',
              role: 'user',
              deck_count: 1,
            },
          },
          error: null,
        },
      })
    );
    await client.route('**/api/online/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const ok = (data: unknown) =>
        route.fulfill({ json: { data: toTransport(data), error: null } });
      if (path === '/api/online/rooms/HEX123') return ok(room);
      if (path.endsWith('/snapshot'))
        return ok(await service.getMatchSnapshot(match.matchId, userId));
      if (path.endsWith('/command'))
        return ok(
          await service.executeCommand(
            match.matchId,
            userId,
            route.request().postDataJSON().command
          )
        );
      if (path.endsWith('/public-events'))
        return ok({
          matchId: match.matchId,
          currentPublicSeq: match.session.getCurrentPublicEventSeq(),
          publicEvents: match.session.getPublicEventsSince(0),
        });
      if (path.endsWith('/chat/messages')) return ok({ entries: [], currentSeq: 0 });
      return route.fallback();
    });
    await enterRoom(client);
  }
  await page.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  await second.getByRole('button', { name: '保留全部手牌', exact: true }).click();
  const firstDialog = page.getByRole('dialog', { name: '海克斯选择 · T1' });
  const secondDialog = second.getByRole('dialog', { name: '海克斯选择 · T1' });
  await expect(firstDialog.getByRole('radio')).toHaveCount(3);
  await expect(secondDialog.getByRole('radio')).toHaveCount(3);
  for (const dialog of [firstDialog, secondDialog]) {
    await expect(
      dialog.getByText('系统随机：彩色海克斯 · 双方同时选择', { exact: true })
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: '随机决定稀有度', exact: true })).toHaveCount(
      0
    );
    await expect(dialog.getByRole('radio').first()).toBeEnabled();
  }
  const beforeOther = await secondDialog.getByRole('radiogroup').innerText();
  await firstDialog.getByRole('button', { name: /^重抽第 1 项/ }).click();
  await expect(firstDialog.getByRole('button', { name: /^重抽第 1 项/ })).toBeDisabled();
  expect(await secondDialog.getByRole('radiogroup').innerText()).toBe(beforeOther);
  for (const [client, name] of [
    [page, 'light'],
    [second, 'dark'],
  ] as const) {
    await client.screenshot({ path: info.outputPath(`hextech-selection-${name}.png`) });
    expect(
      await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
    ).toBe(true);
  }
  const expected = match.session.getPlayerViewState(match.participants.FIRST.playerId)!.match
    .hextech!.selection!.ownOffer!;
  await page.reload();
  await enterRoom(page);
  await expect(firstDialog.getByRole('button', { name: /^重抽第 1 项/ })).toBeDisabled();
  expect(
    match.session.getPlayerViewState(match.participants.FIRST.playerId)!.match.hextech!.selection!
      .ownOffer
  ).toEqual(expected);
  await secondDialog.getByRole('radio').nth(0).check();
  await secondDialog.getByRole('button', { name: '锁定选择' }).click();
  await expect(secondDialog.getByText('已锁定，等待对方选择', { exact: true })).toBeVisible();
  expect(match.session.state!.hextech!.owned).toHaveLength(0);
  await expect(firstDialog.getByText('后攻玩家 · 已锁定', { exact: true })).toBeVisible();
  await firstDialog.getByRole('radio').nth(1).check();
  await firstDialog.getByRole('button', { name: '锁定选择' }).click();
  await expect(firstDialog).toHaveCount(0);
  await expect(secondDialog).toHaveCount(0);
  expect(match.session.state!.hextech!.owned).toHaveLength(2);
  await page
    .locator('summary')
    .filter({ hasText: /^海克斯$/ })
    .click();
  await expect(page.getByLabel('已持有海克斯')).toContainText('小画家');
  expect(errors).toEqual([]);
  await secondContext.close();
});

async function enterRoom(page: Page) {
  await page.goto('/?page=battle-lobby');
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.setItem('loveca.online.room', 'HEX123');
    window.dispatchEvent(new CustomEvent('loveca:casual-navigation', { detail: 'online-room' }));
  });
  const skip = page.getByRole('button', { name: '跳过提示', exact: true });
  await skip
    .waitFor({ timeout: 5000 })
    .then(() => skip.click())
    .catch(() => undefined);
  await expect(page.getByTitle('打开房间操作')).toBeVisible();
}
