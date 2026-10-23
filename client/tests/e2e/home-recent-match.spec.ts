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
  await page.route(/\/api\/battle\/match-records(?:\?.*)?$/, (route) => reply(route, [own]));
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
      if (page.viewportSize()!.width < 1024) {
        await page.getByRole('button', { name: '返回对局列表', exact: true }).click();
      }
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

test('个人历史分页、列表刷新失败与详情重试各自保留上下文', async ({ page }) => {
  await setup(page, 'user');
  const items = Array.from({ length: 65 }, (_, index) =>
    record(`page-${index}`, `分页对手 ${index}`)
  );
  const offsets: number[] = [];
  let failList = false;
  let failDetail = true;
  await page.route(/\/api\/battle\/match-records(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (!query.has('limit')) return reply(route, [own]);
    if (failList)
      return route.fulfill({
        status: 503,
        json: { data: null, error: { code: 'UNAVAILABLE', message: '暂时无法刷新列表' } },
      });
    const offset = Number(query.get('offset'));
    offsets.push(offset);
    await reply(route, items.slice(offset, offset + Number(query.get('limit'))));
  });
  await page.route(/\/api\/battle\/match-records\/page-\d+$/, async (route) => {
    if (failDetail)
      return route.fulfill({
        status: 503,
        json: { data: null, error: { code: 'UNAVAILABLE', message: '暂时无法读取这场对局' } },
      });
    await reply(
      route,
      items.find((item) => route.request().url().endsWith(item.matchId))
    );
  });
  await page.goto('/');
  await page
    .getByRole('region', { name: '最近一场', exact: true })
    .getByRole('button', { name: /本人上一场对手/ })
    .click();
  const list = page.getByRole('region', { name: '对局列表', exact: true });
  const detail = page.getByRole('region', { name: '对局详情', exact: true });
  const narrow = page.viewportSize()!.width < 1024;
  if (narrow) {
    await expect(list).toBeHidden();
    await page.getByRole('button', { name: '返回对局列表' }).click();
  }
  await expect(list.getByRole('button', { name: /对战 分页对手 29\s/ })).toBeVisible();
  await list.getByRole('button', { name: '加载更多对局' }).click();
  await expect(list.getByRole('button', { name: /对战 分页对手 59\s/ })).toBeVisible();
  await list.getByRole('button', { name: '加载更多对局' }).click();
  await expect(list.getByRole('button', { name: /对战 分页对手 64\s/ })).toBeVisible();
  await expect(list.getByRole('button', { name: '加载更多对局' })).toHaveCount(0);
  expect(offsets).toEqual([0, 30, 60]);
  const chosen = list.getByRole('button', { name: /对战 分页对手 29\s/ });
  await chosen.scrollIntoViewIfNeeded();
  const listScroll = await list.evaluate((element) => element.closest('.app-shell')!.scrollTop);
  await chosen.click();
  await expect(detail.getByRole('alert')).toContainText('暂时无法读取这场对局');
  if (narrow) await expect(list).toBeHidden();
  failDetail = false;
  await detail.getByRole('alert').getByRole('button', { name: '重试' }).click();
  await expect(
    detail.getByRole('heading', { name: '视觉验收玩家 vs 分页对手 29', exact: true })
  ).toBeVisible();
  if (narrow) {
    await page.getByRole('button', { name: '返回对局列表' }).click();
    await expect(chosen).toBeFocused();
    await expect
      .poll(() => list.evaluate((element) => element.closest('.app-shell')!.scrollTop))
      .toBeGreaterThan(listScroll - 5);
  }
  failList = true;
  await page.getByRole('button', { name: '刷新历史对局', exact: true }).click();
  await expect(list.getByRole('alert')).toContainText('暂时无法刷新列表');
  await expect(chosen).toHaveAttribute('aria-current', 'true');
  await expect(list.getByText('暂无历史对局', { exact: true })).toHaveCount(0);
  failList = false;
  await list.getByRole('alert').getByRole('button', { name: '重试' }).click();
  await expect(list.getByRole('alert')).toHaveCount(0);
  await expect(chosen).toHaveAttribute('aria-current', 'true');
});

test('历史筛选按需展开，查询和服务失败重试保留条件', async ({ page }) => {
  await setup(page, 'season_admin');
  let failList = true;
  const queries: URLSearchParams[] = [];
  await page.route(/\/api\/battle\/admin\/match-records(?:\?.*)?$/, async (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    if (failList)
      return route.fulfill({
        status: 503,
        json: { data: null, error: { code: 'UNAVAILABLE', message: '对战服务暂不可用' } },
      });
    await reply(route, globalRecords);
  });
  await page.goto('/?page=match-records');
  const list = page.getByRole('region', { name: '对局列表', exact: true });
  const filters = page.getByRole('form', { name: '对局筛选', exact: true });
  const toggle = filters.getByRole('button', { name: '筛选对局', exact: true });
  await expect(list.getByRole('alert')).toContainText('对战服务暂不可用');
  await expect(list.getByText('0 条', { exact: true })).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(filters.getByLabel('玩家 A', { exact: true })).toBeHidden();
  await toggle.click();
  await filters.getByLabel('搜索参与者或对局', { exact: true }).fill('ROOM');
  await filters.getByLabel('玩家 A', { exact: true }).fill('Alpha');
  await filters.getByLabel('玩家 B', { exact: true }).fill('Beta');
  await filters.getByLabel('开始', { exact: true }).fill('2026-10-20');
  await filters.getByLabel('结束', { exact: true }).fill('2026-10-23');
  await toggle.click();
  await toggle.click();
  await expect(filters.getByLabel('玩家 A', { exact: true })).toHaveValue('Alpha');
  await filters.getByRole('button', { name: '查询', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await expect.poll(() => queries.at(-1)?.get('playerBQuery')).toBe('Beta');
  expect(Object.fromEntries(queries.at(-1)!)).toMatchObject({
    userQuery: 'ROOM',
    playerAQuery: 'Alpha',
    playerBQuery: 'Beta',
  });
  await expect(filters.getByRole('status')).toHaveText('5 项生效');
  failList = false;
  await list.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
  await expect(list.getByRole('alert')).toHaveCount(0);
  expect(queries.at(-1)?.get('playerAQuery')).toBe('Alpha');
  await filters.getByRole('button', { name: '清空', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.toString()).toBe('');
  await expect(filters.getByRole('button', { name: '清空', exact: true })).toBeDisabled();
});
