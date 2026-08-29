import { expect, test, type Page, type Route } from '@playwright/test';

const NOW = '2026-08-29T04:00:00.000Z';
const SEASON_ID = '77777777-7777-4777-8777-777777777701';
const SECOND_SEASON_ID = '77777777-7777-4777-8777-777777777711';
const RELEASE_ID = '77777777-7777-4777-8777-777777777702';
const ARCHETYPE_ID = '77777777-7777-4777-8777-777777777703';
const PLAYER_TOTAL = 125;
const RANKED_PLAYER_LOCATE_WINDOW_SIZE = 7;

const RATING_CONFIG = {
  algorithmVersion: 'GLICKO1_PER_MATCH_V4',
  ratingScale: 800,
  initialRating: 1500,
  initialRatingDeviation: 300,
  minimumRatingDeviation: 100,
  maximumRatingDeviation: 350,
  placementMatchCount: 5,
  softResetMode: 'RESET_TO_INITIAL',
  softResetCenter: 1500,
  softResetRetention: 0.5,
  softResetMinimumDeviation: 200,
  growthPool: {
    mode: 'POST_PLACEMENT_AVERAGE_CENTERED',
    enabled: true,
    centerRating: 1800,
    maximumTotalAdjustment: 16,
    transitionWidth: 250,
    positiveSplitMode: 'EQUAL',
    negativeWinnerShare: 0.75,
  },
};

const SEASON = {
  id: SEASON_ID,
  seasonKey: 'ranked-insights-ui-e2e',
  name: '排位洞察页面 E2E',
  announcement: '',
  lifecycle: 'ACTIVE',
  queueAdmission: 'PAUSED',
  platformTimeZone: 'Asia/Shanghai',
  openWindows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 0, endMinute: 1440 }],
  startsAt: '2026-08-01T00:00:00.000Z',
  scheduledEndsAt: '2026-09-01T00:00:00.000Z',
  finalizingDeadlineAt: '2026-09-03T00:00:00.000Z',
  closedAt: null,
  ratingAlgorithmVersion: RATING_CONFIG.algorithmVersion,
  ratingConfig: RATING_CONFIG,
  leaderboardMinimumMatchCount: 5,
  ledgerRevision: 1,
  withinOpenWindow: true,
  effectiveQueueOpen: false,
};

const SECOND_SEASON = {
  ...SEASON,
  id: SECOND_SEASON_ID,
  seasonKey: 'ranked-insights-ui-e2e-second',
  name: '排位洞察页面 E2E 第二赛季',
};

const PLAYERS = Array.from({ length: PLAYER_TOTAL }, (_, index) => {
  const ordinal = index + 1;
  const suffix = String(ordinal).padStart(3, '0');
  const leaderboardEligible = ordinal <= 120;
  const ratedMatchCount = leaderboardEligible ? 12 : 3;
  return {
    userId: `88888888-8888-4888-8${String(ordinal).padStart(3, '0')}-${String(ordinal).padStart(12, '0')}`,
    username: `insight_player_${suffix}`,
    displayName: `排位玩家 ${suffix}`,
    listPosition: ordinal,
    rating: 2201 - ordinal,
    ratingDeviation: 100 + (ordinal % 20),
    ratedMatchCount,
    wins: Math.floor(ratedMatchCount / 2),
    losses: ratedMatchCount - Math.floor(ratedMatchCount / 2),
    placementCompleted: leaderboardEligible,
    leaderboardEligible,
    status: leaderboardEligible ? 'RANKED' : 'PLACEMENT',
    rank: leaderboardEligible ? ordinal : null,
    deckClassification: {
      release: { id: RELEASE_ID, version: 3 },
      observedMatchCount: ratedMatchCount,
      classifiedMatchCount: ratedMatchCount,
      coverageStatus: 'COMPLETE',
      isTied: false,
      leaders: [{ archetypeId: ARCHETYPE_ID, name: '核心节奏', matchCount: ratedMatchCount }],
    },
  };
});

const SECOND_SEASON_PLAYERS = PLAYERS.slice(0, 2).map((player, index) => ({
  ...player,
  userId: `99999999-9999-4999-900${index}-${String(index + 1).padStart(12, '0')}`,
  username: `second_season_player_${index + 1}`,
  displayName: `第二赛季玩家 ${index + 1}`,
  rank: index + 1,
}));

interface MockState {
  readonly mismatchOnFirstAppend?: boolean;
  readonly includeSecondSeason?: boolean;
  readonly delayFirstSeasonPlayersMs?: number;
  mismatchSeen: boolean;
  readonly playerRequests: Array<{
    query: string;
    limit: number;
    offset: number;
    revision: number;
  }>;
  readonly playerSeasonRequests: string[];
}

function createMockState(
  input: {
    mismatchOnFirstAppend?: boolean;
    includeSecondSeason?: boolean;
    delayFirstSeasonPlayersMs?: number;
  } = {}
): MockState {
  return {
    mismatchOnFirstAppend: input.mismatchOnFirstAppend,
    includeSecondSeason: input.includeSecondSeason,
    delayFirstSeasonPlayersMs: input.delayFirstSeasonPlayersMs,
    mismatchSeen: false,
    playerRequests: [],
    playerSeasonRequests: [],
  };
}

async function fulfillApi(route: Route, data: unknown, total?: number): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data, ...(total === undefined ? {} : { total }), error: null }),
  });
}

async function installRankedInsightsMocks(page: Page, state: MockState): Promise<void> {
  await page.route('**/site-status.json*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        availability: 'OPEN',
        generatedAt: NOW,
        maintenance: null,
      }),
    });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/api/config') {
      await fulfillApi(route, {
        features: {
          email: { enabled: false, verificationRequired: false, passwordResetEnabled: false },
          battleEntries: { ranked: true, themeTable: true },
          battleTimeouts: { playerActionTimeoutSeconds: 180, reconnectGracePeriodSeconds: 60 },
        },
        siteStatus: {
          lifecycle: 'NORMAL',
          generatedAt: NOW,
          maintenance: null,
          announcements: [],
        },
        matchEmotes: null,
      });
      return;
    }

    if (url.pathname === '/api/auth/refresh') {
      await fulfillApi(route, {
        accessToken: 'ranked-insights-e2e-token',
        user: { id: 'ranked-insights-e2e-user', email: 'ranked-insights@example.test' },
        profile: {
          id: 'ranked-insights-e2e-user',
          username: 'ranked_insights_admin',
          display_name: '排位洞察管理员',
          avatar_url: null,
          role: 'admin',
          deck_count: 0,
          created_at: NOW,
          updated_at: NOW,
        },
      });
      return;
    }

    if (url.pathname === '/api/admin/ranked/environment') {
      await fulfillApi(route, {
        persistentSeasonReady: true,
        algorithms: [
          {
            algorithmVersion: RATING_CONFIG.algorithmVersion,
            status: 'FORMAL',
            config: RATING_CONFIG,
          },
        ],
      });
      return;
    }

    if (url.pathname === '/api/admin/ranked/seasons') {
      const seasons = state.includeSecondSeason ? [SEASON, SECOND_SEASON] : [SEASON];
      await fulfillApi(route, seasons, seasons.length);
      return;
    }

    if (url.pathname === '/api/admin/ranked/matches') {
      await fulfillApi(route, [], 0);
      return;
    }

    if (url.pathname === '/api/admin/ranked/overview') {
      const requestedSeasonId = url.searchParams.get('seasonId') ?? SEASON_ID;
      await fulfillApi(route, {
        seasonId: requestedSeasonId,
        generatedAt: NOW,
        health: {
          waitingTickets: 0,
          activeReservations: 0,
          runningMatches: 0,
          pendingMatches: 0,
          oldestPendingEndedAt: null,
        },
        statistics: {
          totalParticipants: PLAYER_TOTAL,
          placementCompletedPlayers: 120,
          leaderboardPlayers: 120,
          totalSettledMatches: 750,
          matchesToday: 12,
          matchesLast7Days: 90,
          activePlayersLast7Days: 80,
          averageMatchesPerPlayer: 12,
          leaderboardCutoffRating: 2081,
        },
        matchCountDistribution: [],
        ratingDistribution: [],
      });
      return;
    }

    if (url.pathname === '/api/admin/ranked/deck-statistics') {
      const requestedSeasonId = url.searchParams.get('seasonId') ?? SEASON_ID;
      await fulfillApi(route, {
        seasonId: requestedSeasonId,
        generatedAt: NOW,
        available: true,
        release: { id: RELEASE_ID, version: 3, publishedAt: Date.parse(NOW) },
        sample: {
          settledMatchCount: 750,
          observedMatchCount: 740,
          analyzedMatchCount: 730,
          deckObservationCount: 1480,
          assignedDeckObservationCount: 1460,
          recognizedDeckObservationCount: 1440,
          invalidDeckObservationCount: 10,
          excludedDeckObservationCount: 10,
          observationCoverageRate: 740 / 750,
          classificationCoverageRate: 1460 / 1480,
        },
        categories: [
          ['核心节奏', '基础组', 'core-tempo', '#8b5cf6'],
          ['攻击连携', '基础组', 'attack-chain', '#ef4444'],
          ['稳健控制', '基础组', 'steady-control', '#3b82f6'],
          ['高风险组合', '进阶组', 'high-risk-combo', '#f59e0b'],
          ['特殊测试构筑', '实验组', 'special-lab', '#10b981'],
        ].map(([name, groupName, categoryKey, color], index) => ({
          archetypeId:
            index === 0 ? ARCHETYPE_ID : `77777777-7777-4777-8777-77777777770${index + 3}`,
          categoryKey,
          name,
          groupName,
          color,
          sortOrder: index + 1,
          classificationStatus: 'CLASSIFIED',
          appearanceCount: 800 - index * 100,
          winnerCount: 440 - index * 50,
          lossCount: 360 - index * 50,
          playerCount: 90 - index * 10,
          winRate: (440 - index * 50) / (800 - index * 100),
          players:
            index === 0
              ? [
                  {
                    userId: PLAYERS[0]!.userId,
                    username: PLAYERS[0]!.username,
                    displayName: '分类明细玩家',
                    appearanceCount: 12,
                    winnerCount: 7,
                    lossCount: 5,
                    winRate: 7 / 12,
                  },
                ]
              : [],
        })),
      });
      return;
    }

    if (url.pathname === '/api/admin/ranked/players') {
      const requestedSeasonId = url.searchParams.get('seasonId') ?? SEASON_ID;
      const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase();
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      state.playerSeasonRequests.push(requestedSeasonId);
      if (requestedSeasonId === SEASON_ID && state.delayFirstSeasonPlayersMs) {
        await new Promise((resolve) => setTimeout(resolve, state.delayFirstSeasonPlayersMs));
      }
      if (state.mismatchOnFirstAppend && offset > 0 && !state.mismatchSeen) {
        state.mismatchSeen = true;
      }
      const revision = state.mismatchSeen ? 2 : 1;
      state.playerRequests.push({ query, limit, offset, revision });
      const baseSeasonPlayers =
        requestedSeasonId === SECOND_SEASON_ID ? SECOND_SEASON_PLAYERS : PLAYERS;
      const seasonPlayers =
        revision === 2
          ? baseSeasonPlayers.map((player, index) => ({
              ...player,
              username: `snapshot2_player_${String(index + 1).padStart(3, '0')}`,
              displayName: `快照 2 玩家 ${String(index + 1).padStart(3, '0')}`,
            }))
          : baseSeasonPlayers;
      const filtered = query
        ? seasonPlayers.filter((player) =>
            [player.userId, player.username, player.displayName].some((value) =>
              value.toLocaleLowerCase().includes(query)
            )
          )
        : seasonPlayers;
      await fulfillApi(route, {
        seasonId: requestedSeasonId,
        generatedAt: NOW,
        ledgerRevision: revision,
        placementRequired: 5,
        leaderboardMinimumMatchCount: 5,
        classificationRelease: { id: RELEASE_ID, version: 3 },
        query,
        limit,
        offset,
        total: filtered.length,
        players: filtered.slice(offset, offset + limit),
      });
      return;
    }

    if (url.pathname === '/api/decks' || url.pathname === '/api/player-badges/me') {
      await fulfillApi(route, []);
      return;
    }

    await fulfillApi(route, null);
  });
}

async function openRankedInsights(page: Page, state: MockState): Promise<void> {
  await installRankedInsightsMocks(page, state);
  await page.goto('/?page=ranked-admin');
  await expect(page.getByRole('heading', { name: '赛季排位管理' })).toBeVisible();
  await expect(page.getByRole('table', { name: '卡组分类统计' })).toBeVisible();
  await expect(page.getByRole('table', { name: '全部参赛玩家' })).toHaveCount(0);
}

async function expectNoGlobalHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(Math.max(metrics.rootScrollWidth, metrics.bodyScrollWidth)).toBeLessThanOrEqual(
    metrics.rootClientWidth + 1
  );
}

async function scrollProductPageToBottom(page: Page): Promise<void> {
  await page.locator('.product-frame-content').evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight });
  });
}

test.describe('排位管理员洞察页面', () => {
  test('卡组分类默认只显示前三类，可搜索、展开全部和展开玩家明细', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '完整交互仅在桌面代表视口执行');
    const state = createMockState();
    await openRankedInsights(page, state);
    expect(state.playerRequests).toEqual([]);

    const categoryTable = page.getByRole('table', { name: '卡组分类统计' });
    await expect(categoryTable.getByRole('row')).toHaveCount(4);
    for (const heading of ['使用场数', '玩家数', '胜利', '失败', '胜率', '最常使用者']) {
      await expect(categoryTable.getByRole('columnheader', { name: heading })).toHaveCSS(
        'text-align',
        'center'
      );
    }
    for (const cell of await categoryTable.locator('tbody > tr').first().locator('td').all()) {
      if ((await cell.evaluate((element) => element.cellIndex)) > 0) {
        await expect(cell).toHaveCSS('text-align', 'center');
      }
    }
    await expect(categoryTable.getByRole('columnheader', { name: '最常使用者' })).toBeVisible();
    await expect(categoryTable.getByText('分类明细玩家', { exact: true })).toBeVisible();
    await expect(categoryTable.getByText('@insight_player_001 · 12 场')).toBeVisible();
    await expect(categoryTable.getByText('高风险组合', { exact: true })).toHaveCount(0);

    const categoryInput = page.getByLabel('搜索卡组分类');
    const expandCategories = page.getByRole('button', { name: '展开全部 5 类' });
    const [inputBox, buttonBox] = await Promise.all([
      categoryInput.boundingBox(),
      expandCategories.boundingBox(),
    ]);
    expect(inputBox?.height).toBe(buttonBox?.height);

    await categoryInput.fill('实验组');
    await expect(categoryTable.getByRole('row')).toHaveCount(2);
    await expect(categoryTable.getByText('特殊测试构筑', { exact: true })).toBeVisible();

    await categoryInput.fill('');
    await expandCategories.click();
    await expect(categoryTable.getByRole('row')).toHaveCount(6);

    await page.getByRole('button', { name: /核心节奏/u }).click();
    const categoryPlayers = page.getByRole('table', { name: '核心节奏玩家明细' });
    await expect(categoryPlayers).toBeVisible();
    for (const heading of ['使用场数', '胜利', '失败', '胜率']) {
      await expect(categoryPlayers.getByRole('columnheader', { name: heading })).toHaveCSS(
        'text-align',
        'center'
      );
    }
    for (const cell of await categoryPlayers.locator('tbody > tr').first().locator('td').all()) {
      if ((await cell.evaluate((element) => element.cellIndex)) > 0) {
        await expect(cell).toHaveCSS('text-align', 'center');
      }
    }
    await expect(categoryPlayers.getByText('分类明细玩家', { exact: true })).toBeVisible();
  });

  test('玩家列表默认收起，定位后以目标为第四行并可向前后继续加载', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '玩家定位仅在桌面代表视口执行');
    const state = createMockState();
    await openRankedInsights(page, state);

    expect(state.playerRequests).toEqual([]);
    await page.getByLabel('定位排位玩家').fill('@insight_player_097');
    await page.getByRole('button', { name: '定位', exact: true }).click();

    const playerTable = page.getByRole('table', { name: '全部参赛玩家' });
    await expect(playerTable.getByRole('row')).toHaveCount(RANKED_PLAYER_LOCATE_WINDOW_SIZE + 1);
    await expect(playerTable.getByText('排名与玩家榜一致', { exact: true })).toHaveCount(0);
    for (const heading of ['状态', '评分', 'RD', '场数', '胜利', '失败', '最常用卡组']) {
      await expect(playerTable.getByRole('columnheader', { name: heading })).toHaveCSS(
        'text-align',
        'center'
      );
    }
    for (const cell of await playerTable.locator('tbody > tr').first().locator('td').all()) {
      if ((await cell.evaluate((element) => element.cellIndex)) >= 2) {
        await expect(cell).toHaveCSS('text-align', 'center');
      }
    }
    await expect(playerTable.locator('tbody tr').nth(3)).toContainText('@insight_player_097');
    await expect(playerTable.getByText('@insight_player_097', { exact: true })).toBeVisible();
    await expect(playerTable.locator('tr[aria-current="true"]')).toHaveCount(1);
    expect(state.playerRequests.slice(0, 2)).toEqual([
      { query: 'insight_player_097', limit: 10, offset: 0, revision: 1 },
      { query: '', limit: 7, offset: 93, revision: 1 },
    ]);

    await page.getByRole('button', { name: '加载更高名次玩家' }).click();
    await expect(playerTable.getByRole('row')).toHaveCount(58);
    expect(state.playerRequests.at(-1)).toEqual({
      query: '',
      limit: 50,
      offset: 43,
      revision: 1,
    });

    await page.getByRole('button', { name: '加载更低名次玩家' }).click();
    await expect(playerTable.getByRole('row')).toHaveCount(83);
    expect(state.playerRequests.at(-1)).toEqual({
      query: '',
      limit: 50,
      offset: 100,
      revision: 1,
    });

    await page.getByRole('button', { name: '清空', exact: true }).click();
    await expect(playerTable.getByRole('row')).toHaveCount(51);
    await expect(page.getByLabel('定位排位玩家')).toHaveValue('');
  });

  test('多个搜索结果先选择候选玩家再定位', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '候选选择仅在桌面代表视口执行');
    const state = createMockState();
    await openRankedInsights(page, state);

    await page.getByLabel('定位排位玩家').fill('insight_player_09');
    await page.getByRole('button', { name: '定位', exact: true }).click();
    const candidates = page.getByLabel('玩家定位候选');
    await expect(candidates.getByRole('button')).toHaveCount(10);
    await expect(page.getByRole('table', { name: '全部参赛玩家' })).toHaveCount(0);

    await candidates.getByRole('button', { name: '定位 @insight_player_097' }).click();
    const playerTable = page.getByRole('table', { name: '全部参赛玩家' });
    await expect(playerTable.locator('tbody tr').nth(3)).toContainText('@insight_player_097');
  });

  test('追加页快照变化时丢弃旧分页并重新读取首屏', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '快照竞态仅在桌面代表视口执行');
    const state = createMockState({ mismatchOnFirstAppend: true });
    await openRankedInsights(page, state);

    await page.getByRole('button', { name: '展开玩家列表' }).click();
    const playerTable = page.getByRole('table', { name: '全部参赛玩家' });
    await expect(playerTable.getByRole('row')).toHaveCount(51);
    await page.getByRole('button', { name: '加载更低名次玩家' }).click();

    await expect
      .poll(() => state.playerRequests.slice(0, 3))
      .toEqual([
        { query: '', limit: 50, offset: 0, revision: 1 },
        { query: '', limit: 50, offset: 50, revision: 2 },
        { query: '', limit: 50, offset: 0, revision: 2 },
      ]);
    await expect(page.getByText('流水修订 2', { exact: true })).toBeVisible();
    await expect(playerTable.getByRole('row')).toHaveCount(51);
    await expect(playerTable.getByText('@snapshot2_player_001', { exact: true })).toBeVisible();
    await expect(playerTable.getByText('@insight_player_001', { exact: true })).toHaveCount(0);
  });

  test('切换赛季时清空旧页并忽略迟到的旧赛季响应', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '赛季竞态仅在桌面代表视口执行');
    const state = createMockState({
      includeSecondSeason: true,
      delayFirstSeasonPlayersMs: 500,
    });
    await installRankedInsightsMocks(page, state);
    await page.goto('/?page=ranked-admin');
    await expect(page.getByRole('heading', { name: '赛季排位管理' })).toBeVisible();
    await page.getByRole('button', { name: '展开玩家列表' }).click();
    await expect.poll(() => state.playerSeasonRequests).toContain(SEASON_ID);

    await page.getByRole('button', { name: '概览赛季' }).click();
    await page.getByRole('option', { name: SECOND_SEASON.name }).click();

    await expect(page.getByRole('table', { name: '全部参赛玩家' })).toHaveCount(0);
    await page.getByRole('button', { name: '展开玩家列表' }).click();
    const playerTable = page.getByRole('table', { name: '全部参赛玩家' });
    await expect(playerTable.getByText('@second_season_player_1', { exact: true })).toBeVisible();
    await expect(playerTable.getByRole('row')).toHaveCount(SECOND_SEASON_PLAYERS.length + 1);
    await page.waitForTimeout(600);
    await expect(playerTable.getByText('@insight_player_001', { exact: true })).toHaveCount(0);
    expect(state.playerSeasonRequests).toContain(SECOND_SEASON_ID);
  });

  test('手机端宽表只在表内横向滚动且分类明细可展开', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '移动布局使用最窄代表视口');
    const state = createMockState();
    await openRankedInsights(page, state);

    await expectNoGlobalHorizontalOverflow(page);
    const categoryButton = page.getByRole('button', { name: /核心节奏/u });
    await categoryButton.scrollIntoViewIfNeeded();
    await categoryButton.click();
    await expect(page.getByRole('table', { name: '核心节奏玩家明细' })).toBeVisible();
    await expectNoGlobalHorizontalOverflow(page);

    await page.getByRole('button', { name: '展开玩家列表' }).click();
    await expect(page.getByRole('table', { name: '全部参赛玩家' })).toBeVisible();
    await scrollProductPageToBottom(page);
    await expect
      .poll(() => page.locator('.product-frame-content').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expectNoGlobalHorizontalOverflow(page);
  });
});
