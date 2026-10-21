import { expect, test, type Page, type Route } from '@playwright/test';
import type { MatchRecordDetailView } from '../../../src/online/replay-types';
import { installVisualApiMocks } from '../visual/support/mockApp';

const now = Date.parse('2026-07-31T12:00:00.000Z');
function record(id: string, opponent: string): MatchRecordDetailView {
  return {
    matchId: id,
    roomCode: id.toUpperCase(),
    matchMode: 'ONLINE',
    automationGameMode: 'DEBUG',
    originKind: 'RANKED',
    originLabel: '赛季排位',
    status: 'COMPLETED',
    completeness: 'METADATA_ONLY',
    startedAt: now - 60_000,
    endedAt: now,
    sealedAt: now,
    viewerSeat: 'FIRST',
    opponentSeat: 'SECOND',
    opponentUserId: `opponent-${id}`,
    opponentDisplayName: opponent,
    winnerSeat: 'FIRST',
    endReason: null,
    turnCount: 5,
    lastTimelineSeq: 0,
    lastCheckpointSeq: 0,
    replayCapabilities: [],
    replayLimitations: [],
    partialReasonSummary: null,
    participants: [
      {
        seat: 'FIRST',
        userId: 'visual-user',
        displayName: '视觉验收玩家',
        playerId: 'p1',
        participantKind: 'USER',
        ownerUserId: null,
      },
      {
        seat: 'SECOND',
        userId: `opponent-${id}`,
        displayName: opponent,
        playerId: 'p2',
        participantKind: 'USER',
        ownerUserId: null,
      },
    ],
    deckSnapshots: [],
  };
}
const own = record('own-recent', '本人上一场对手');
const globalRecords = Array.from({ length: 50 }, (_, index) =>
  record(`global-${index}`, `全站对手${index}`)
);
async function reply(route: Route, data: unknown) {
  await route.fulfill({ json: { data, error: null } });
}
async function setup(page: Page, role: 'user' | 'season_admin' | 'admin', missing = false) {
  await installVisualApiMocks(page, true);
  await page.route('**/api/auth/refresh', (route) =>
    reply(route, {
      accessToken: 'visual-token',
      user: { id: 'visual-user', email: 'visual@example.test', emailVerified: true },
      profile: {
        id: 'visual-profile',
        username: 'visual_player',
        display_name: '视觉验收玩家',
        avatar_url: null,
        role,
        deck_count: 1,
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
    })
  );
  await page.route('**/api/battle/match-records', (route) => reply(route, [own]));
  let releaseList = () => {};
  const listGate = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  await page.route('**/api/battle/admin/match-records', async (route) => {
    await listGate;
    await reply(route, globalRecords);
  });
  await page.route('**/api/admin/ranked/seasons', (route) => reply(route, []));
  await page.route('**/api/admin/theme-table/events', (route) => reply(route, []));
  const detailRequests: string[] = [];
  await page.route(/\/api\/battle\/(admin\/)?match-records\/[^/?]+(?:\?.*)?$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    detailRequests.push(id);
    if (missing && id === own.matchId)
      return route.fulfill({
        status: 404,
        json: { data: null, error: { code: 'MATCH_NOT_FOUND', message: '该历史对局无法读取' } },
      });
    await reply(
      route,
      id === own.matchId ? own : globalRecords.find((item) => item.matchId === id)
    );
  });
  return { releaseList, detailRequests };
}

test.use({ serviceWorkers: 'block' });
for (const role of ['user', 'season_admin', 'admin'] as const) {
  test(`${role} 从最近一场打开对应详情，慢列表与刷新不能替换指定对局`, async ({ page }) => {
    const { releaseList, detailRequests } = await setup(page, role);
    await page.goto('/');
    await page
      .getByRole('region', { name: '最近一场', exact: true })
      .getByRole('button', { name: /本人上一场对手/ })
      .click();
    const requested = page.getByRole('heading', {
      name: '视觉验收玩家 vs 本人上一场对手',
      exact: true,
    });
    await expect(requested).toBeVisible();
    releaseList();
    const refresh = page.getByRole('button', { name: '刷新历史对局', exact: true });
    await expect(refresh).toBeEnabled();
    await expect(requested).toBeVisible();
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await expect(requested).toBeVisible();
    expect(detailRequests).toEqual([own.matchId]);
    if (role !== 'user') {
      const listed = page.getByRole('button', { name: /视觉验收玩家 vs 全站对手0\s/ });
      await listed.click();
      await expect(requested).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: '视觉验收玩家 vs 全站对手0', exact: true })
      ).toBeVisible();
      await refresh.click();
      await expect(refresh).toBeEnabled();
      expect(detailRequests.at(-1)).toBe('global-0');
    }
  });
}

test('指定详情读取失败时显示错误，不改为全站其他记录', async ({ page }) => {
  const { releaseList, detailRequests } = await setup(page, 'season_admin', true);
  await page.goto('/');
  await page
    .getByRole('region', { name: '最近一场', exact: true })
    .getByRole('button', { name: /本人上一场对手/ })
    .click();
  releaseList();
  await expect(page.getByText('该历史对局无法读取', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新历史对局', exact: true })).toBeEnabled();
  expect(detailRequests).toEqual([own.matchId]);
  await expect(
    page.getByRole('heading', { name: '视觉验收玩家 vs 全站对手0', exact: true })
  ).toHaveCount(0);
});
