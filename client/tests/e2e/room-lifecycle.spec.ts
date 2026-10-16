import { expect, test, type Page } from '@playwright/test';
import { prepareVisualPage } from '../visual/support/mockApp';
import type { DeckConfig } from '../../../src/application/game-service';
import type { OnlineRoomEndReason, OnlineRoomView } from '../../../src/online/release-types';
import { createHeartIcon, createHeartRequirement } from '../../../src/domain/entities/card';
import { markGameEnded } from '../../../src/domain/entities/game';
import { CardType, GameEndReason, HeartColor } from '../../../src/shared/types/enums';
import { toTransport } from '../../../src/online/serde';

test.use({ serviceWorkers: 'block' });
test.setTimeout(90_000);

type Mode = 'CASUAL' | 'RANKED' | 'THEME';
const target = {
  tableId: '11111111-1111-4111-8111-111111111111',
  roundId: '22222222-2222-4222-8222-222222222222',
  revision: 5,
};

// The existing shared desktop consumes real service projections. Only HTTP transport
// and persistence are replaced; no account writes or test-only product UI.
async function fixture(
  page: Page,
  mode: Mode,
  ended: boolean,
  reason = GameEndReason.VICTORY_CONDITION
) {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    JWT_SECRET: 'lifecycle-browser-fixture',
    JWT_REFRESH_SECRET: 'lifecycle-browser-refresh',
    MINIO_ENDPOINT: '127.0.0.1',
    MINIO_ACCESS_KEY: 'fixture',
    MINIO_SECRET_KEY: 'fixture',
    FRONTEND_URL: 'http://localhost:5173',
  });
  await prepareVisualPage(page, 'light', true);
  const { OnlineMatchService } = await import('../../../src/server/services/online-match-service');
  const matches = new OnlineMatchService({ recorder: null });
  const deck: DeckConfig = {
    mainDeck: [
      ...Array.from({ length: 48 }, (_, i) => ({
        cardCode: `ME-visual-${String(Math.floor(i / 4) + 1).padStart(3, '0')}`,
        name: '生命周期测试成员',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        cardCode: `LV-visual-${String(i + 1).padStart(3, '0')}`,
        name: '生命周期测试 LIVE',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      })),
    ],
    energyDeck: Array.from({ length: 12 }, () => ({
      cardCode: 'LL-E-001-SD',
      name: '能量',
      cardType: CardType.ENERGY as const,
    })),
  };
  const originKind = mode === 'RANKED' ? 'RANKED' : 'ONLINE_ROOM';
  const pointValidation = { pointTableVersion: 'lifecycle-fixture', pointTotal: 0, pointLimit: 9 };
  const match = await matches.createMatch({
    roomCode: 'LIFE12',
    originKind,
    first: { userId: 'visual-user', displayName: '视觉验收玩家', deck, pointValidation },
    second: { userId: 'opponent-user', displayName: '对手', deck, pointValidation },
  });
  if (ended) {
    match.session.restoreRuntimeState({
      authorityState: markGameEnded(
        match.session.state!,
        reason,
        reason === GameEndReason.DRAW ? null : match.participants.FIRST.playerId
      ),
      currentPublicSeq: match.session.getCurrentPublicEventSeq(),
    });
  }
  const state = {
    leaves: 0,
    failLeaves: 0,
    failSurrender: false,
    departed: false,
    opponentAbsent: false,
  };
  const room = (): OnlineRoomView => ({
    ...(mode === 'CASUAL' ? { casualTable: target } : {}),
    ...(mode === 'THEME' ? { themeTableVersionId: 'theme-fixture' } : {}),
    roomCode: 'LIFE12',
    originKind,
    battleTimeouts: { playerActionTimeoutSeconds: 180, reconnectGracePeriodSeconds: 60 },
    status: 'IN_GAME',
    ownerUserId: 'visual-user',
    currentUserId: 'visual-user',
    currentUserRole: 'HOST',
    currentUserPresence: 'ACTIVE',
    currentUserSeat: 'FIRST',
    members: [
      {
        userId: 'visual-user',
        displayName: '视觉验收玩家',
        role: 'HOST',
        presence: 'ACTIVE',
        lockedDeckId: 'visual-deck',
        lockedDeckName: '测试卡组',
        ready: true,
        startReady: true,
        seat: 'FIRST',
      },
      {
        userId: 'opponent-user',
        displayName: '对手',
        role: 'GUEST',
        presence: state.opponentAbsent ? 'LEFT' : 'ACTIVE',
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
  });
  const own = () => ({
    ...target,
    roomCode: 'LIFE12',
    discoverability: 'PUBLIC',
    note: '',
    state: 'BOUND',
    waitingSince: Date.now(),
    confirmationExpiresAt: null,
    ownDeck: { id: 'visual-deck', name: '测试卡组' },
    spectatorEnabled: false,
    members: [
      { userId: 'visual-user', displayName: '视觉验收玩家', confirmed: true },
      { userId: 'opponent-user', displayName: '对手', confirmed: true },
    ],
    roomGeneration: 'lifecycle-generation',
    failureReason: null,
    runtime: {
      status: matches.isMatchCompleted(match.matchId) ? 'ENDED' : 'PLAYING',
      matchId: match.matchId,
      startedAt: Date.now(),
      endedAt: ended ? Date.now() : null,
      departedUserIds: [],
      spectatorViews: [],
      rematch: null,
    },
    canRematch: matches.isMatchCompleted(match.matchId),
    canContinuePublic: false,
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('loveca.online.room', 'LIFE12');
    sessionStorage.setItem('loveca.online.briefingAcknowledged', 'true');
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const ok = (data: unknown) => route.fulfill({ json: { data: toTransport(data), error: null } });
    if (url.pathname === '/api/casual-tables/me') {
      return ok({
        table: mode === 'CASUAL' && !state.departed ? own() : null,
        otherParticipation:
          mode !== 'CASUAL' && !state.departed
            ? {
                kind: 'ONLINE_MATCH',
                destination: mode === 'RANKED' ? 'ranked' : 'theme-table',
                roomGeneration: 'lifecycle-generation',
                matchId: match.matchId,
              }
            : null,
      });
    }
    if (url.pathname === '/api/casual-tables/heartbeat') return ok({});
    if (url.pathname === '/api/online/rooms/LIFE12') return ok(room());
    if (url.pathname === `/api/online/matches/${match.matchId}/snapshot`)
      return ok(await matches.getMatchSnapshot(match.matchId, 'visual-user'));
    if (url.pathname === `/api/online/matches/${match.matchId}/command`) {
      if (state.failSurrender) return ok({ success: false, error: '认输暂未成功，请重试' });
      const command = route.request().postDataJSON().command;
      return ok(await matches.executeCommand(match.matchId, 'visual-user', command));
    }
    if (
      url.pathname === '/api/casual-tables/leave' ||
      url.pathname === '/api/online/rooms/LIFE12/leave'
    ) {
      state.leaves += 1;
      if (mode === 'CASUAL') expect(route.request().postDataJSON().target).toMatchObject(target);
      expect(matches.isMatchCompleted(match.matchId)).toBe(true);
      if (state.failLeaves > 0) {
        state.failLeaves -= 1;
        return route.fulfill({
          status: 503,
          json: { data: null, error: { code: 'LEAVE_RETRY', message: '暂时无法离房，请重试' } },
        });
      }
      state.departed = true;
      return ok({ room: null });
    }
    if (url.pathname.endsWith('/public-events'))
      return ok({ matchId: match.matchId, currentPublicSeq: 0, publicEvents: [] });
    if (url.pathname.endsWith('/chat/messages')) return ok({ entries: [], currentSeq: 0 });
    return route.fallback();
  });
  return { state, matches, match };
}

async function desktop(page: Page, ended = false) {
  await page.goto('/?page=battle-lobby');
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.setItem('loveca.online.room', 'LIFE12');
    window.dispatchEvent(new CustomEvent('loveca:casual-navigation', { detail: 'online-room' }));
  });
  const skip = page.getByRole('button', { name: '跳过提示', exact: true });
  if (ended) await expect(skip).toHaveCount(0);
  else {
    await expect(skip).toBeVisible();
    await skip.click();
  }
  await expect(page.getByTitle('打开房间操作')).toBeVisible();
}

for (const reason of [GameEndReason.VICTORY_CONDITION, GameEndReason.DRAW]) {
  test(`casual ${reason}: return to lobby, reopen results, confirm leave`, async ({
    page,
  }, testInfo) => {
    const { state } = await fixture(page, 'CASUAL', true, reason);
    state.opponentAbsent = true;
    await desktop(page, true);
    await expect(page.getByText('等待对方返回。', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(reason === GameEndReason.DRAW ? '本局以平局结束。' : '你已达成胜利条件。')
    ).toBeVisible();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`casual-result-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: '返回对战大厅，再战或选组', exact: true }).click();
    await expect(page.getByRole('heading', { name: '本局已结束', exact: true })).toBeVisible();
    expect(state.leaves).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('casual-post-match.png'), fullPage: true });
    await page.getByRole('button', { name: '查看本局结果', exact: true }).click();
    await expect(page.getByRole('button', { name: '离开房间', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '离开房间', exact: true }).click();
    expect(state.leaves).toBe(0);
    await page.getByRole('dialog').getByRole('button', { name: '离开房间', exact: true }).click();
    await expect(page.getByRole('button', { name: '找对手', exact: true })).toBeEnabled();
    expect(state.departed).toBe(true);
    expect(state.leaves).toBe(1);
  });
}

for (const mode of ['RANKED', 'THEME'] as const) {
  for (const viaMenu of [false, true]) {
    test(`${mode} completed: ${viaMenu ? 'room menu' : 'result panel'} releases before returning to its mode`, async ({
      page,
    }) => {
      const { state } = await fixture(page, mode, true);
      await desktop(page, true);
      if (viaMenu) {
        await page.getByTitle('打开房间操作').click();
        await page
          .getByRole('region', { name: '房间操作', exact: true })
          .getByRole('button', { name: '返回大厅', exact: true })
          .click();
      } else {
        await page
          .getByRole('button', {
            name: mode === 'THEME' ? '返回娱乐模式' : '返回大厅',
            exact: true,
          })
          .click();
      }
      await expect.poll(() => state.departed).toBe(true);
      expect(state.leaves).toBe(1);
      if (mode === 'RANKED') await expect(page).toHaveURL(/page=ranked/);
      else await expect(page.getByRole('heading', { name: '娱乐模式', exact: true })).toBeVisible();
      expect(await page.evaluate(() => sessionStorage.getItem('loveca.online.room'))).toBeNull();
    });
  }
}

test('ranked temporary return confirms its deadline and retains participation', async ({
  page,
}, testInfo) => {
  const { state } = await fixture(page, 'RANKED', false);
  await desktop(page);
  await page.getByTitle('打开房间操作').click();
  await expect(page.getByRole('region', { name: '房间操作', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('room-menu-in-mulligan.png'), fullPage: true });
  await page.getByRole('button', { name: '返回大厅', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '返回大厅？' });
  await expect(dialog.getByText(/超时未返回将判负/)).toBeVisible();
  await dialog.getByRole('button', { name: '返回大厅', exact: true }).click();
  await expect(page).toHaveURL(/page=ranked/);
  expect(state.leaves).toBe(0);
  expect(state.departed).toBe(false);
});

test('surrender failure retains the game; a failed departure retains the completed result for retry', async ({
  page,
}, testInfo) => {
  const { state, matches, match } = await fixture(page, 'CASUAL', false);
  state.failSurrender = true;
  await desktop(page);
  await page.getByTitle('打开房间操作').click();
  await page.getByRole('button', { name: '认输并退出房间', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '认输并退出房间', exact: true })
    .click();
  await expect(page.getByText('认输暂未成功，请重试', { exact: false }).first()).toBeVisible();
  expect(state.leaves).toBe(0);
  expect(matches.isMatchCompleted(match.matchId)).toBe(false);
  state.failSurrender = false;
  state.failLeaves = 1;
  await page.getByRole('button', { name: '认输并退出房间', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '认输并退出房间', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '你已认输', exact: true })).toBeVisible();
  await expect.poll(() => state.leaves).toBe(1);
  expect(state.departed).toBe(false);
  await expect(page.getByText('暂时无法离房，请重试', { exact: true })).toBeVisible();
  await page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/online/rooms/LIFE12'
  );
  await expect(page.getByText('暂时无法离房，请重试', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('leave-failed-completed.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '离开房间', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '离开房间', exact: true }).click();
  await expect.poll(() => state.departed).toBe(true);
  await expect(page.getByRole('heading', { name: '对战大厅', exact: true })).toBeVisible();
});

test('failed surrender must not turn a later normal victory into automatic departure', async ({
  page,
}) => {
  const { state, match } = await fixture(page, 'CASUAL', false);
  state.failSurrender = true;
  await desktop(page);
  await page.getByTitle('打开房间操作').click();
  await page.getByRole('button', { name: '认输并退出房间', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '认输并退出房间', exact: true })
    .click();
  await expect(page.getByText('认输暂未成功，请重试', { exact: false }).first()).toBeVisible();
  match.session.restoreRuntimeState({
    authorityState: markGameEnded(
      match.session.state!,
      GameEndReason.VICTORY_CONDITION,
      match.participants.FIRST.playerId
    ),
    currentPublicSeq: match.session.getCurrentPublicEventSeq(),
  });
  match.remoteRevision += 1;
  await expect(page.getByRole('heading', { name: '本局获胜', exact: true })).toBeVisible();
  // A successful read after terminal projection gives the departure effect time to run.
  await page.waitForTimeout(500);
  expect(state.leaves).toBe(0);
  expect(state.departed).toBe(false);
});

for (const reason of [
  'OPENING_TIMEOUT',
  'DECK_POINT_TABLE_CHANGED',
] as const satisfies readonly OnlineRoomEndReason[]) {
  test(`opening failure ${reason} explains the actual reason in the lobby`, async ({ page }) => {
    await prepareVisualPage(page, 'light', true);
    await page.route('**/api/casual-tables/me', (route) =>
      route.fulfill({
        json: {
          data: {
            table: null,
            otherParticipation: null,
            notice: { tableId: target.tableId, roomCode: 'LIFE12', reason },
          },
          error: null,
        },
      })
    );
    await page.goto('/?page=battle-lobby');
    await expect(
      page.getByText(
        reason === 'OPENING_TIMEOUT'
          ? '未在开局期限内完成猜拳和先后手选择，本轮已关闭。'
          : '开局前卡组已不符合当前 PT 限制，本轮已关闭，请重新选组。',
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '找对手', exact: true })).toBeEnabled();
  });
}
