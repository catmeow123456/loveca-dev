import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { Buffer } from 'node:buffer';
import type { RankedOverviewView } from '../../../src/online/ranked-types';

type ApiError = { code: string; message: string } | null;
type CardDbRecord = {
  id: string;
  card_code: string;
  card_type: 'MEMBER' | 'LIVE' | 'ENERGY';
  name_jp: string | null;
  name_cn: string | null;
  work_names: string[] | null;
  group_names: string[] | null;
  unit_name: string | null;
  unit_name_raw: string | null;
  cost: number | null;
  blade: number | null;
  hearts: Array<{ color: string; count: number }>;
  blade_hearts: Array<{ effect: string; heartColor?: string }> | null;
  score: number | null;
  requirements: Array<{ color: string; count: number }>;
  card_text_jp: string | null;
  card_text_cn: string | null;
  image_filename: string | null;
  image_source_uri: string | null;
  rare: string | null;
  product: string | null;
  product_code: string | null;
  source_external_id: string | null;
  source_flags: Record<string, unknown> | null;
  status: 'DRAFT' | 'PUBLISHED';
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

type DeckRecord = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  main_deck: Array<{ card_code: string; count: number; card_type: 'MEMBER' | 'LIVE' }>;
  energy_deck: Array<{ card_code: string; count: number }>;
  is_valid: boolean;
  validation_errors: string[];
  is_public: boolean;
  share_id: string | null;
  share_enabled: boolean;
  shared_at: string | null;
  forked_from_deck_id: string | null;
  forked_from_share_id: string | null;
  forked_at: string | null;
  created_at: string;
  updated_at: string;
};

const NOW = '2026-06-13T00:00:00.000Z';
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

function makeBaseCard(overrides: Partial<CardDbRecord>): CardDbRecord {
  return {
    id: overrides.card_code ?? 'card',
    card_code: overrides.card_code ?? 'CARD-001',
    card_type: overrides.card_type ?? 'MEMBER',
    name_jp: null,
    name_cn: overrides.name_cn ?? '测试卡牌',
    work_names: ['测试作品'],
    group_names: ['测试组合'],
    unit_name: null,
    unit_name_raw: null,
    cost: null,
    blade: null,
    hearts: [],
    blade_hearts: null,
    score: null,
    requirements: [],
    card_text_jp: null,
    card_text_cn: '用于移动端布局验收的测试卡牌。',
    image_filename: null,
    image_source_uri: null,
    rare: 'N',
    product: 'E2E',
    product_code: null,
    source_external_id: null,
    source_flags: null,
    status: 'PUBLISHED',
    created_at: NOW,
    updated_at: NOW,
    updated_by: null,
    ...overrides,
  };
}

function memberCard(index: number): CardDbRecord {
  const suffix = String(index).padStart(3, '0');
  return makeBaseCard({
    id: `member-${suffix}`,
    card_code: `ME-e2e-${suffix}`,
    card_type: 'MEMBER',
    name_cn: `移动验收成员 ${suffix}`,
    cost: index % 3,
    blade: 1,
    hearts: [{ color: 'PINK', count: 1 }],
  });
}

function liveCard(index: number): CardDbRecord {
  const suffix = String(index).padStart(3, '0');
  return makeBaseCard({
    id: `live-${suffix}`,
    card_code: `LV-e2e-${suffix}`,
    card_type: 'LIVE',
    name_cn: `移动验收 Live ${suffix}`,
    score: 1,
    requirements: [{ color: 'PINK', count: 1 }],
  });
}

const ENERGY_CARD = makeBaseCard({
  id: 'energy-001',
  card_code: 'LL-E-001-SD',
  card_type: 'ENERGY',
  name_cn: '移动验收能量',
});

const MEMBER_CARDS = Array.from({ length: 12 }, (_, index) => memberCard(index + 1));
const LIVE_CARDS = Array.from({ length: 12 }, (_, index) => liveCard(index + 1));
const CARD_RECORDS = [...MEMBER_CARDS, ...LIVE_CARDS, ENERGY_CARD];
const PRODUCT_FILTER_CARD_RECORDS = [
  ...CARD_RECORDS,
  ...Array.from({ length: 40 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return makeBaseCard({
      id: `product-filter-${number}`,
      card_code: `ME-product-filter-${number}`,
      card_type: 'MEMBER',
      name_cn: `商品筛选滚动验收 ${number}`,
      product: `滚动测试商品 ${number}`,
    });
  }),
];

const RANKED_SEASON = {
  id: 'e2e-ranked-season',
  seasonKey: 'e2e-ranked-season',
  name: 'E2E 排位赛季',
  announcement: '用于验证个人排名展示。',
  lifecycle: 'ACTIVE',
  platformTimeZone: 'Asia/Shanghai',
  startsAt: Date.parse('2026-08-01T00:00:00.000Z'),
  scheduledEndsAt: Date.parse('2026-09-01T00:00:00.000Z'),
  closedAt: null,
  ratingAlgorithmVersion: 'GLICKO1_PER_MATCH_V3',
  placementMatchCount: 3,
} as const;

const RANKED_QUEUE_IDLE = {
  state: 'IDLE',
  ticketId: null,
  joinedAt: null,
  deckName: null,
  reservationId: null,
  confirmationExpiresAt: null,
  confirmed: false,
  roomCode: null,
  roomGeneration: null,
  message: null,
} as const;

const RANKED_OVERVIEW_OUTSIDE_TOP_TEN: RankedOverviewView = {
  season: RANKED_SEASON,
  availability: {
    state: 'PAUSED',
    canJoin: false,
    message: '排位暂时关闭',
    nextOpensAt: null,
    currentWindowEndsAt: null,
  },
  player: {
    placement: false,
    placementCompleted: 3,
    placementRequired: 3,
    rating: 1528,
    ratingDeviation: 88,
    rank: 37,
    completedMatches: 12,
    wins: 7,
    losses: 5,
    winRate: 7 / 12,
  },
  queue: RANKED_QUEUE_IDLE,
  recentMatches: [],
  leaderboard: Array.from({ length: 10 }, (_, index) => ({
    rank: index + 1,
    userId: `ranked-leader-${index + 1}`,
    displayName: `排行榜玩家 ${index + 1}`,
    rating: 1700 - index * 10,
    ratingDeviation: 70,
    ratedMatchCount: 12,
  })),
};

const RANKED_OVERVIEW_INSIDE_TOP_TEN: RankedOverviewView = {
  ...RANKED_OVERVIEW_OUTSIDE_TOP_TEN,
  player: {
    ...RANKED_OVERVIEW_OUTSIDE_TOP_TEN.player!,
    rating: 1670,
    rank: 4,
  },
  leaderboard: RANKED_OVERVIEW_OUTSIDE_TOP_TEN.leaderboard.map((entry) =>
    entry.rank === 4
      ? { ...entry, userId: 'e2e-user', displayName: 'E2E Admin', rating: 1670 }
      : entry
  ),
};

const RANKED_OVERVIEW_IN_PLACEMENT: RankedOverviewView = {
  ...RANKED_OVERVIEW_OUTSIDE_TOP_TEN,
  player: {
    placement: true,
    placementCompleted: 2,
    placementRequired: 3,
    rating: 1508,
    ratingDeviation: 210,
    rank: null,
    completedMatches: 2,
    wins: 1,
    losses: 1,
    winRate: 0.5,
  },
};

const DECK_RECORD: DeckRecord = {
  id: 'e2e-deck',
  user_id: 'e2e-user',
  name: 'E2E 移动验收卡组',
  description: '用于移动端布局验收的完整构筑。',
  main_deck: [
    ...MEMBER_CARDS.map((card) => ({
      card_code: card.card_code,
      count: 4,
      card_type: 'MEMBER' as const,
    })),
    ...LIVE_CARDS.map((card) => ({
      card_code: card.card_code,
      count: 1,
      card_type: 'LIVE' as const,
    })),
  ],
  energy_deck: [{ card_code: ENERGY_CARD.card_code, count: 12 }],
  is_valid: true,
  validation_errors: [],
  validated_point_table_version: '2026-04-03',
  point_total: 0,
  point_limit: 9,
  is_public: false,
  share_id: 'e2e-share',
  share_enabled: true,
  shared_at: NOW,
  forked_from_deck_id: null,
  forked_from_share_id: null,
  forked_at: null,
  created_at: NOW,
  updated_at: NOW,
};

const DECK_POINT_TABLES = [
  {
    id: 'point-table-active',
    version: '2026-04-03',
    displayName: '2026年4月PT限制表',
    lifecycle: 'ACTIVE',
    pointLimit: 9,
    effectiveFrom: '2026-04-02T16:00:00.000Z',
    publishedAt: '2026-04-01T00:00:00.000Z',
    retirementReason: null,
    platformTimeZone: 'Asia/Shanghai',
    entries: [
      {
        baseCardCode: 'PL!N-bp1-003',
        points: 4,
        cardNameJp: '桜坂しずく',
        cardType: 'MEMBER',
        cost: 10,
      },
    ],
    revision: 1,
    createdBy: 'e2e-profile',
    updatedBy: 'e2e-profile',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'point-table-scheduled',
    version: '2026-08-08',
    displayName: '2026年8月PT限制表',
    lifecycle: 'SCHEDULED',
    pointLimit: 9,
    effectiveFrom: '2026-08-07T16:00:00.000Z',
    publishedAt: NOW,
    retirementReason: null,
    platformTimeZone: 'Asia/Shanghai',
    entries: [
      {
        baseCardCode: 'PL!N-pb1-011',
        points: 2,
        cardNameCn: '米娅·泰勒',
        cardType: 'MEMBER',
        cost: 15,
      },
    ],
    revision: 2,
    createdBy: 'e2e-profile',
    updatedBy: 'e2e-profile',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'point-table-cancelled',
    version: 'cancelled-preview',
    displayName: '已取消的PT排期',
    lifecycle: 'RETIRED',
    pointLimit: 9,
    effectiveFrom: '2026-08-14T16:00:00.000Z',
    publishedAt: NOW,
    retirementReason: 'SCHEDULE_CANCELLED',
    platformTimeZone: 'Asia/Shanghai',
    entries: [],
    revision: 3,
    createdBy: 'e2e-profile',
    updatedBy: 'e2e-profile',
    createdAt: NOW,
    updatedAt: NOW,
  },
] as const;

async function fulfillApi(route: Route, data: unknown, status = 200, error: ApiError = null) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data, error }),
  });
}

async function installApiMocks(
  page: Page,
  authenticated: boolean,
  cardRecords: CardDbRecord[] = CARD_RECORDS,
  rankedOverview?: RankedOverviewView
) {
  await page.route('**/images/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TRANSPARENT_PNG,
    });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/api/config') {
      await fulfillApi(route, {
        features: {
          email: {
            enabled: false,
            verificationRequired: false,
            passwordResetEnabled: false,
          },
        },
        siteStatus: {
          lifecycle: 'NORMAL',
          generatedAt: NOW,
          maintenance: null,
          announcements: [
            {
              id: 'e2e-announcement',
              type: 'UPDATE',
              title: '移动端公告验收',
              summary: '公开首页与登录后页面应使用同一个公告中心。',
              detail: '用于验证公告入口、抽屉和已读状态。',
              publishedAt: NOW,
              startsAt: null,
              endsAt: null,
              priority: 10,
              impactScopes: [],
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === '/api/auth/refresh') {
      if (!authenticated) {
        await fulfillApi(route, null, 401, { code: 'UNAUTHORIZED', message: '未登录或登录已过期' });
        return;
      }

      await fulfillApi(route, {
        accessToken: 'e2e-token',
        user: { id: 'e2e-user', email: 'e2e@example.test', emailVerified: true },
        profile: {
          id: 'e2e-profile',
          username: 'e2e_admin',
          display_name: 'E2E Admin',
          avatar_url: null,
          role: 'admin',
          deck_count: 1,
          created_at: NOW,
          updated_at: NOW,
        },
      });
      return;
    }

    if (url.pathname === '/api/auth/login' && method === 'POST') {
      await fulfillApi(route, {
        accessToken: 'e2e-login-token',
        user: { id: 'e2e-user', email: 'e2e@example.test', emailVerified: true },
        profile: {
          id: 'e2e-profile',
          username: 'e2e_admin',
          display_name: 'E2E Admin',
          avatar_url: null,
          role: 'admin',
          deck_count: 1,
          created_at: NOW,
          updated_at: NOW,
        },
      });
      return;
    }

    if (url.pathname === '/api/ranked/overview' && method === 'GET' && rankedOverview) {
      await fulfillApi(route, rankedOverview);
      return;
    }

    if (url.pathname === '/api/ranked/seasons' && method === 'GET' && rankedOverview?.season) {
      await fulfillApi(route, [rankedOverview.season]);
      return;
    }

    if (url.pathname === '/api/ranked/environment' && method === 'GET' && rankedOverview?.season) {
      await fulfillApi(route, {
        seasonId: rankedOverview.season.id,
        sample: {
          settledMatchCount: 0,
          analyzedMatchCount: 0,
          deckObservationCount: 0,
          playerCount: 0,
          coverageRate: 0,
        },
        cardUsage: [],
      });
      return;
    }

    if (url.pathname === '/api/cards/admin' && method === 'GET') {
      const query = (url.searchParams.get('query') ?? '').trim().toLocaleLowerCase();
      const cardType = url.searchParams.get('cardType');
      const status = url.searchParams.get('status');
      const pageNumber = Math.max(1, Number(url.searchParams.get('page') ?? 1));
      const pageSize = Math.max(1, Number(url.searchParams.get('pageSize') ?? 28));
      const filtered = cardRecords.filter((card) => {
        if (cardType && card.card_type !== cardType) return false;
        if (status && card.status !== status) return false;
        if (!query) return true;
        return [card.card_code, card.name_jp, card.name_cn].some((value) =>
          value?.toLocaleLowerCase().includes(query)
        );
      });
      const offset = (pageNumber - 1) * pageSize;
      await fulfillApi(route, {
        items: filtered.slice(offset, offset + pageSize).map((card) => ({
          cardCode: card.card_code,
          cardType: card.card_type,
          nameJp: card.name_jp,
          nameCn: card.name_cn,
          imageFilename: card.image_filename,
          rare: card.rare,
          status: card.status,
          updatedAt: card.updated_at,
        })),
        page: pageNumber,
        pageSize,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / pageSize),
      });
      return;
    }

    if (url.pathname === '/api/cards/admin/status' && method === 'PUT') {
      await fulfillApi(route, { updated: cardRecords.length });
      return;
    }

    if (url.pathname === '/api/cards/status-map') {
      await fulfillApi(
        route,
        Object.fromEntries(cardRecords.map((card) => [card.card_code, card.status]))
      );
      return;
    }

    if (url.pathname === '/api/admin/deck-point-tables' && method === 'GET') {
      await fulfillApi(route, DECK_POINT_TABLES);
      return;
    }

    if (url.pathname === '/api/admin/deck-point-tables' && method === 'POST') {
      const input = request.postDataJSON() as {
        version: string;
        displayName: string;
        pointLimit: number;
        entries: Array<{ baseCardCode: string; points: number }>;
      };
      await fulfillApi(route, {
        id: 'point-table-new-draft',
        ...input,
        lifecycle: 'DRAFT',
        effectiveFrom: null,
        publishedAt: null,
        retirementReason: null,
        platformTimeZone: 'Asia/Shanghai',
        revision: 1,
        createdBy: 'e2e-profile',
        updatedBy: 'e2e-profile',
        createdAt: NOW,
        updatedAt: NOW,
      });
      return;
    }

    const deckPointTableMatch = url.pathname.match(/^\/api\/admin\/deck-point-tables\/([^/]+)$/);
    if (deckPointTableMatch && method === 'PUT') {
      const source = DECK_POINT_TABLES.find((table) => table.id === deckPointTableMatch[1]);
      const input = request.postDataJSON() as {
        version: string;
        displayName: string;
        pointLimit: number;
        effectiveDateTime?: string;
        entries: Array<{ baseCardCode: string; points: number }>;
      };
      await fulfillApi(route, {
        ...source,
        ...input,
        effectiveFrom: input.effectiveDateTime
          ? new Date(`${input.effectiveDateTime}+08:00`).toISOString()
          : source?.effectiveFrom,
        revision: (source?.revision ?? 0) + 1,
        updatedAt: NOW,
      });
      return;
    }

    if (deckPointTableMatch && method === 'DELETE') {
      await fulfillApi(route, { id: deckPointTableMatch[1], deleted: true });
      return;
    }

    const pointTableActionMatch = url.pathname.match(
      /^\/api\/admin\/deck-point-tables\/([^/]+)\/(publish|discard|cancel-schedule)$/
    );
    if (pointTableActionMatch && method === 'POST') {
      const source = DECK_POINT_TABLES.find((table) => table.id === pointTableActionMatch[1]);
      await fulfillApi(route, source);
      return;
    }

    if (url.pathname === '/api/cards/export') {
      await fulfillApi(route, []);
      return;
    }

    if (url.pathname === '/api/cards' && method === 'GET') {
      await fulfillApi(route, cardRecords);
      return;
    }

    if (url.pathname === '/api/cards' && method === 'POST') {
      const input = request.postDataJSON() as Partial<CardDbRecord>;
      await fulfillApi(
        route,
        makeBaseCard({
          id: input.card_code ?? 'created-card',
          card_code: input.card_code ?? 'CREATED-001',
          card_type: input.card_type ?? 'MEMBER',
          name_cn: input.name_cn ?? '新建卡牌',
        })
      );
      return;
    }

    if (/^\/api\/cards\/[^/]+\/(publish|unpublish)$/.test(url.pathname)) {
      await fulfillApi(route, null);
      return;
    }

    if (/^\/api\/cards\/[^/]+$/.test(url.pathname)) {
      const cardCode = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
      const card = cardRecords.find((record) => record.card_code === cardCode) ?? cardRecords[0];
      await fulfillApi(route, card);
      return;
    }

    if (url.pathname === '/api/decks' && method === 'GET') {
      await fulfillApi(route, [DECK_RECORD]);
      return;
    }

    if (url.pathname === '/api/player-badges/me' && method === 'GET') {
      await fulfillApi(route, [
        {
          key: 'ranked-first-season-qualified',
          name: '首届排位·定级纪念',
          description: '完成 Loveca 首届赛季排位定级，感谢你见证排位启程。',
          imagePath: '/badges/first-ranked-season.png',
          awardedAt: Date.parse('2026-08-03T12:00:00.000Z'),
          sourceSeason: {
            id: 'ranked-season-one',
            seasonKey: 'ranked-season-one',
            name: '第一赛季',
          },
        },
      ]);
      return;
    }

    if (url.pathname === '/api/decks' && method === 'POST') {
      await fulfillApi(route, DECK_RECORD);
      return;
    }

    if (url.pathname === '/api/decks/scrape-decklog' && method === 'POST') {
      await fulfillApi(route, {
        cards: [
          { card_code: MEMBER_CARDS[0].card_code, count: 4, raw_code: 'ME-e2e-001' },
          { card_code: LIVE_CARDS[0].card_code, count: 1, raw_code: 'LV-e2e-001' },
          { card_code: ENERGY_CARD.card_code, count: 12, raw_code: 'LL-E-001-SD' },
        ],
        deckName: 'DeckLog E2E 卡组',
        source: 'jp',
      });
      return;
    }

    if (url.pathname === '/api/decks/share/e2e-share') {
      await fulfillApi(route, {
        ...DECK_RECORD,
        author_display_name: 'E2E Admin',
        author_username: 'e2e_admin',
      });
      return;
    }

    if (url.pathname === '/api/decks/share/e2e-share/fork') {
      await fulfillApi(route, { ...DECK_RECORD, id: 'forked-e2e-deck' });
      return;
    }

    if (url.pathname === '/api/decks/e2e-deck/copy' && method === 'POST') {
      await fulfillApi(route, {
        ...DECK_RECORD,
        id: 'copied-e2e-deck',
        name: 'E2E 移动验收卡组 v2',
        is_public: false,
        share_id: null,
        share_enabled: false,
        shared_at: null,
        forked_from_deck_id: DECK_RECORD.id,
        forked_at: NOW,
      });
      return;
    }

    if (/^\/api\/decks\/[^/]+$/.test(url.pathname)) {
      await fulfillApi(route, DECK_RECORD);
      return;
    }

    await fulfillApi(route, null);
  });
}

async function waitForStableApp(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
  await page.waitForTimeout(650);
}

async function openDecklogDialog(page: Page) {
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByRole('button', { name: '导入', exact: true }).click();
    const importSheet = page.getByRole('dialog', { name: '导入卡组' });
    await expect(importSheet).toBeVisible();
    await importSheet.getByRole('button', { name: /从 DeckLog 导入/ }).click();
  } else {
    await page.getByRole('button', { name: /从 DeckLog 导入/ }).click();
  }

  return page.getByRole('dialog', { name: '从 DeckLog 导入' });
}

async function expectNoGlobalHorizontalOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return {
      innerWidth: window.innerWidth,
      documentClientWidth: documentElement.clientWidth,
      documentScrollWidth: documentElement.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
    };
  });

  const allowed = metrics.documentClientWidth + 1;
  const actual = Math.max(metrics.documentScrollWidth, metrics.bodyScrollWidth);
  expect(
    actual,
    `${label} has global horizontal overflow: ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(allowed);
}

async function expectElementWithinVisualViewport(page: Page, selector: string, label: string) {
  const metrics = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;

    return {
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
      viewport: {
        left: viewportLeft,
        top: viewportTop,
        right: viewportLeft + viewportWidth,
        bottom: viewportTop + viewportHeight,
      },
    };
  });

  expect(
    metrics.rect.left,
    `${label} left edge is outside visual viewport: ${JSON.stringify(metrics)}`
  ).toBeGreaterThanOrEqual(metrics.viewport.left - 1);
  expect(
    metrics.rect.top,
    `${label} top edge is outside visual viewport: ${JSON.stringify(metrics)}`
  ).toBeGreaterThanOrEqual(metrics.viewport.top - 1);
  expect(
    metrics.rect.right,
    `${label} right edge is outside visual viewport: ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(metrics.viewport.right + 1);
  expect(
    metrics.rect.bottom,
    `${label} bottom edge is outside visual viewport: ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(metrics.viewport.bottom + 1);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
}

async function expectUnifiedHeaderGeometry(page: Page) {
  const productHeader = page.locator('.product-header-inner').first();
  if (await productHeader.isVisible()) {
    const geometry = await productHeader.evaluate((element) => {
      const headerRect = element.getBoundingClientRect();
      const brandMark = element.querySelector<HTMLElement>('.product-brand-mark');
      return {
        height: headerRect.height,
        brandWidth: brandMark?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(geometry.height).toBeGreaterThanOrEqual(63);
    expect(geometry.height).toBeLessThanOrEqual(65);
    expect(geometry.brandWidth).toBe(32);
  }

  const pageHeader = page.locator('.page-header-inner').first();
  if (await pageHeader.isVisible()) {
    const height = await pageHeader.evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(75);
  }
}

type Scenario = {
  name: string;
  path: string;
  authenticated: boolean;
  ready: (page: Page) => Promise<void>;
  action?: (page: Page) => Promise<void>;
};

const scenarios: Scenario[] = [
  {
    name: 'public-home',
    path: '/',
    authenticated: false,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'Loveca 在线对战' })).toBeVisible();
    },
  },
  {
    name: 'auth-login',
    path: '/login',
    authenticated: false,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: '进入 Loveca' })).toBeVisible();
    },
  },
  {
    name: 'auth-register',
    path: '/register',
    authenticated: false,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();
    },
  },
  {
    name: 'spectator-lobby',
    path: '/online/spectate',
    authenticated: false,
    ready: async (page) => {
      await expect(page.getByLabel('房间号')).toBeVisible();
    },
  },
  {
    name: 'home',
    path: '/',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByRole('button', { name: '前往大厅' })).toBeVisible();
    },
  },
  {
    name: 'game-setup',
    path: '/?page=game-setup',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('对局准备')).toBeVisible();
    },
  },
  {
    name: 'deck-manager',
    path: '/?page=deck-manager',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('卡组管理')).toBeVisible();
    },
    action: async (page) => {
      const deckSearch = page.getByLabel('搜索卡组');
      await deckSearch.fill('不存在的卡组');
      await expect(page.getByRole('heading', { name: 'E2E 移动验收卡组' })).toHaveCount(0);
      await page.getByRole('button', { name: '清除搜索' }).click();
      await expect(page.getByRole('heading', { name: 'E2E 移动验收卡组' })).toBeVisible();

      await expect(page.getByText(/共\s*1\s*个卡组/)).toHaveCount(0);

      if ((page.viewportSize()?.width ?? 0) < 768) {
        await expect(page.getByRole('button', { name: '创建卡组', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '导入', exact: true })).toBeVisible();

        const deckCard = page
          .getByRole('heading', { name: 'E2E 移动验收卡组' })
          .locator('xpath=ancestor::div[contains(@class, "product-list-row")][1]');
        const alignment = await deckCard.evaluate((card) => {
          const heading = card.querySelector('h3');
          const buttons = Array.from(card.querySelectorAll('button'));
          const editButton = buttons.find((button) => button.textContent?.trim() === '编辑');
          const moreButton = buttons.find((button) =>
            button.getAttribute('aria-label')?.includes('E2E 移动验收卡组的更多操作')
          );

          if (!heading || !editButton || !moreButton) {
            return null;
          }

          return {
            titleY: heading.getBoundingClientRect().y,
            editY: editButton.getBoundingClientRect().y,
            moreY: moreButton.getBoundingClientRect().y,
          };
        });
        expect(alignment).not.toBeNull();
        expect(Math.abs((alignment?.editY ?? 0) - (alignment?.titleY ?? 0))).toBeLessThan(16);
        expect(Math.abs((alignment?.editY ?? 0) - (alignment?.moreY ?? 0))).toBeLessThan(2);
      }

      await page.getByRole('button', { name: /E2E 移动验收卡组的更多操作/ }).click();
      const menu = page.getByRole('menu', { name: /E2E 移动验收卡组的操作/ });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: '复制为新版本' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: '删除卡组' })).toBeVisible();
      await expectElementWithinVisualViewport(page, '[role="menu"]', 'deck actions menu');
      const menuReceivesPointerAtItsLowerEdge = await menu.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const probe = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 2);
        return probe === element || element.contains(probe);
      });
      expect(menuReceivesPointerAtItsLowerEdge).toBe(true);
    },
  },
  {
    name: 'decklog-dialog',
    path: '/?page=deck-manager',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('卡组管理')).toBeVisible();
    },
    action: async (page) => {
      const dialog = await openDecklogDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: /读取并导入/ })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: /日本版/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      await dialog
        .getByLabel('卡组链接或编号')
        .fill('https://decklog-en.bushiroad.com/ja/view/60G2Q');
      await expect(dialog.getByRole('button', { name: /国际版/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(
        dialog.getByText('decklog-en.bushiroad.com', { exact: true }).last()
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: /读取并导入/ })).toBeEnabled();
      await expectElementWithinVisualViewport(
        page,
        '[aria-labelledby="decklog-dialog-title"]',
        'DeckLog import dialog'
      );
    },
  },
  {
    name: 'deck-editor',
    path: '/?page=deck-manager&openDeckId=e2e-deck',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByPlaceholder('搜索卡牌名称或编号...')).toBeVisible();
    },
    action: async (page) => {
      const viewportWidth = page.viewportSize()?.width ?? 0;
      if (viewportWidth < 768) {
        await expect(page.getByRole('button', { name: /查看卡组/ })).toBeVisible();
        await expectElementWithinVisualViewport(
          page,
          'button:has-text("查看卡组")',
          'deck editor view-deck button'
        );
      } else if (viewportWidth < 960) {
        await expect(
          page.getByRole('main').getByRole('button', { name: /^(展开|收起)卡组面板$/ })
        ).toBeVisible();
        await expectElementWithinVisualViewport(
          page,
          'main button[aria-label$="卡组面板"]',
          'deck editor tablet sidebar toggle'
        );
      } else {
        await expect(page.locator('.workspace-sidebar')).toBeVisible();
        await expectElementWithinVisualViewport(
          page,
          '.workspace-sidebar',
          'deck editor desktop sidebar'
        );
      }
    },
  },
  {
    name: 'card-admin',
    path: '/?page=card-admin',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('卡牌数据管理')).toBeVisible();
    },
  },
  {
    name: 'card-admin-filters',
    path: '/?page=card-admin',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('卡牌数据管理')).toBeVisible();
    },
    action: async (page) => {
      const filterButton = page.getByRole('button', { name: /筛选/ }).first();
      if (await filterButton.isVisible()) {
        await filterButton.click();
        await expect(page.getByText('筛选与批量操作')).toBeVisible();
      }
    },
  },
  {
    name: 'card-admin-editor',
    path: '/?page=card-admin',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('卡牌数据管理')).toBeVisible();
    },
    action: async (page) => {
      await page.getByRole('button', { name: /新建卡牌/ }).click();
      await expect(page.getByText('创建新卡牌')).toBeVisible();
    },
  },
  {
    name: 'online-room',
    path: '/?page=online-room',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('正式联机', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'online-debug',
    path: '/?page=online-debug',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('联机调试', { exact: true }).first()).toBeVisible();
    },
  },
  {
    name: 'public-table',
    path: '/?page=public-table',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('公共牌桌', { exact: true }).first()).toBeVisible();
    },
  },
  {
    name: 'ranked',
    path: '/?page=ranked',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('赛季排位', { exact: true }).first()).toBeVisible();
    },
  },
  {
    name: 'authenticated-spectator-lobby',
    path: '/?page=online-spectator',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByLabel('房间号')).toBeVisible();
    },
  },
  {
    name: 'match-records',
    path: '/?page=match-records',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('历史对局', { exact: true }).first()).toBeVisible();
    },
  },
  {
    name: 'account',
    path: '/?page=account',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('个人中心', { exact: true }).first()).toBeVisible();
    },
    action: async (page) => {
      const profileLink = page.getByRole('link', { name: '个人资料', exact: true });
      const securityLink = page.getByRole('link', { name: '账号与安全', exact: true });
      await expect(profileLink).toHaveAttribute('aria-current', 'page');
      await expect(page.getByLabel('显示名称')).toBeVisible();

      await securityLink.click();
      await expect(securityLink).toHaveAttribute('aria-current', 'page');
      await expect(page).toHaveURL(/(?:\?|&)section=security(?:&|$)/);
      await expect(page.getByRole('heading', { name: '修改密码', exact: true })).toBeVisible();
      await expect(page.getByLabel('显示名称')).toHaveCount(0);

      await page.goBack();
      await expect(profileLink).toHaveAttribute('aria-current', 'page');
      await expect(page.getByLabel('显示名称')).toBeVisible();
    },
  },
  {
    name: 'online-admin',
    path: '/?page=online-admin',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('联机房间监控', { exact: true }).first()).toBeVisible();
    },
  },
  {
    name: 'announcement-admin',
    path: '/?page=announcement-admin',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('平台配置', { exact: true }).first()).toBeVisible();
    },
  },
  {
    name: 'ranked-admin',
    path: '/?page=ranked-admin',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('赛季排位管理', { exact: true }).first()).toBeVisible();
    },
  },
  {
    name: 'deck-point-admin',
    path: '/?page=deck-point-admin',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('卡组规则管理', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('2026年4月PT限制表', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('历史原因：已取消排期', { exact: true })).toBeVisible();
    },
    action: async (page) => {
      await page.getByRole('button', { name: /2026年8月PT限制表/ }).click();
      const effectiveInput = page.locator('input[type="datetime-local"]').first();
      await expect(effectiveInput).toHaveAttribute('step', '1');
      await expect(effectiveInput).toHaveAttribute('value', '2026-08-08T00:00:00');
      await page.getByLabel('显示名称').fill('2026年8月PT限制表·秒级');
      const updateRequest = page.waitForRequest(
        (request) =>
          request.method() === 'PUT' &&
          request.url().endsWith('/api/admin/deck-point-tables/point-table-scheduled')
      );
      await page.getByRole('button', { name: '保存修改' }).click();
      expect((await updateRequest).postDataJSON()).toMatchObject({
        displayName: '2026年8月PT限制表·秒级',
        effectiveDateTime: '2026-08-08T00:00:00',
        expectedRevision: 2,
      });
    },
  },
  {
    name: 'shared-deck',
    path: '/decks/share/e2e-share',
    authenticated: false,
    ready: async (page) => {
      await expect(page.getByText('共享卡组')).toBeVisible();
      await expect(page.getByText('E2E 移动验收卡组')).toBeVisible();
    },
  },
];

test.describe('mobile layout baseline', () => {
  for (const scenario of scenarios) {
    test(`${scenario.name} has no global horizontal overflow`, async ({ page }, testInfo) => {
      await installApiMocks(page, scenario.authenticated);
      await page.goto(scenario.path);
      await scenario.ready(page);
      await scenario.action?.(page);
      await waitForStableApp(page);
      await expectUnifiedHeaderGeometry(page);
      await expectNoGlobalHorizontalOverflow(page, scenario.name);
      await attachScreenshot(page, testInfo, scenario.name);
    });
  }

  test('卡牌管理直接启动只请求分页摘要，编辑保存不重载列表', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '请求链路回归只需执行一次');

    const cardRequests: Array<{ method: string; path: string; search: string }> = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/cards')) {
        cardRequests.push({ method: request.method(), path: url.pathname, search: url.search });
      }
    });

    await installApiMocks(page, true);
    await page.goto('/?page=card-admin');

    const firstCardButton = page.getByRole('button', { name: /^编辑 移动验收成员/ }).first();
    await expect(firstCardButton).toBeVisible();
    expect(
      cardRequests.filter((request) => request.method === 'GET' && request.path === '/api/cards')
    ).toHaveLength(0);
    expect(
      cardRequests.filter(
        (request) => request.method === 'GET' && request.path === '/api/cards/admin'
      )
    ).toHaveLength(1);
    expect(cardRequests.find((request) => request.path === '/api/cards/admin')?.search).toContain(
      'pageSize=28'
    );

    const memberFilterRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === 'GET' &&
        url.pathname === '/api/cards/admin' &&
        url.searchParams.get('cardType') === 'MEMBER'
      );
    });
    await page.getByRole('button', { name: '成员卡', exact: true }).click();
    await memberFilterRequest;

    await firstCardButton.click();
    const editor = page.getByRole('dialog');
    await expect(editor.getByText(/^编辑卡牌:/)).toBeVisible();
    expect(
      cardRequests.filter(
        (request) =>
          request.method === 'GET' &&
          request.path !== '/api/cards/admin' &&
          /^\/api\/cards\/[^/]+$/.test(request.path)
      )
    ).toHaveLength(1);

    await editor
      .locator('label', { hasText: '中文卡名' })
      .locator('..')
      .getByRole('textbox')
      .fill('编辑后的移动验收成员');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(
      cardRequests.filter(
        (request) => request.method === 'GET' && request.path === '/api/cards/admin'
      )
    ).toHaveLength(2);
  });

  test('桌面短视口中的收录商品筛选可以独立滚动', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '桌面短视口回归只需执行一次');

    await page.setViewportSize({ width: 1280, height: 560 });
    await installApiMocks(page, true, PRODUCT_FILTER_CARD_RECORDS);
    await page.goto('/?page=deck-manager&openDeckId=e2e-deck');
    await expect(page.getByPlaceholder('搜索卡牌名称或编号...')).toBeVisible();

    await page.getByRole('button', { name: '收录商品', exact: true }).click();
    const productFilterRegion = page.getByRole('region', { name: '筛选收录商品' });
    await expect(productFilterRegion).toBeVisible();

    const scrollState = await productFilterRegion.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: window.getComputedStyle(element).overflowY,
    }));
    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
    expect(scrollState.overflowY).toBe('auto');

    await productFilterRegion.hover();
    await page.mouse.wheel(0, 1000);
    await expect
      .poll(() => productFilterRegion.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    const lastProduct = productFilterRegion.getByRole('button', {
      name: '滚动测试商品 40',
      exact: true,
    });
    await lastProduct.scrollIntoViewIfNeeded();
    await expect(lastProduct).toBeVisible();
    await lastProduct.click();
    await expect(lastProduct).toHaveAttribute('aria-pressed', 'true');
  });

  test('排行榜前十外显示当前玩家的精确名次', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '排位名次回归只需执行一次');

    await installApiMocks(page, true, CARD_RECORDS, RANKED_OVERVIEW_OUTSIDE_TOP_TEN);
    await page.goto('/?page=ranked');

    await expect(page.getByText('第 37 名 · 赛季积分', { exact: true })).toBeVisible();
    const leaderboard = page
      .getByRole('heading', { name: '排行榜', exact: true })
      .locator('xpath=ancestor::section[1]');
    await expect(leaderboard.getByText('我的排名', { exact: true })).toBeVisible();
    await expect(leaderboard.getByText('37', { exact: true })).toBeVisible();
    await expect(leaderboard.getByText('1528', { exact: true })).toBeVisible();
    await expect(leaderboard.getByText('排行榜玩家 10', { exact: true })).toBeVisible();
  });

  test('排行榜前十内直接标记当前玩家', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '排位名次回归只需执行一次');

    await installApiMocks(page, true, CARD_RECORDS, RANKED_OVERVIEW_INSIDE_TOP_TEN);
    await page.goto('/?page=ranked');

    await expect(page.getByText('第 4 名 · 赛季积分', { exact: true })).toBeVisible();
    const leaderboard = page
      .getByRole('heading', { name: '排行榜', exact: true })
      .locator('xpath=ancestor::section[1]');
    await expect(leaderboard.getByText('E2E Admin（我）', { exact: true })).toBeVisible();
    await expect(leaderboard.getByText('我的排名', { exact: true })).toHaveCount(0);
  });

  test('未达到参榜门槛时继续显示定级进度', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '排位名次回归只需执行一次');

    await installApiMocks(page, true, CARD_RECORDS, RANKED_OVERVIEW_IN_PLACEMENT);
    await page.goto('/?page=ranked');

    await expect(page.getByText('2 / 3 场 · 满 3 场进入排行榜', { exact: true })).toBeVisible();
    await expect(page.getByText('我的排名', { exact: true })).toHaveCount(0);
  });

  test('公开首页保留卡组与对局入口的后续意图', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '入口意图回归只需执行一次');

    await installApiMocks(page, false);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Loveca 在线对战' })).toBeVisible();

    await page.getByRole('button', { name: '管理卡组', exact: true }).click();
    await expect(
      page.getByText('登录管理云端卡组，或进入离线模式把卡组保存在当前浏览器。')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '进入离线模式' })).toBeEnabled();
    await page.getByPlaceholder('输入你的用户名或邮箱').fill('e2e_admin');
    await page.getByPlaceholder('输入你的密码').fill('test_password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByText('卡组管理', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '返回' }).click();
    await page.getByRole('button', { name: '打开导航菜单' }).click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('button', { name: '开始对战', exact: true }).click();
    await expect(page.getByText('登录后继续选择对战方式和本次使用的卡组。')).toBeVisible();

    await page.getByRole('button', { name: '进入离线模式' }).click();
    await expect(page.getByText('选择对战方式', { exact: true })).toBeVisible();
  });

  test('离线访客可从示例创建并持久化本地卡组', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '离线卡组回归只需执行一次');

    await page.addInitScript(() => window.localStorage.removeItem('loveca.local-decks.v1'));
    await installApiMocks(page, false);
    await page.goto('/');
    await page.getByRole('button', { name: '管理卡组', exact: true }).click();
    await page.getByRole('button', { name: '进入离线模式' }).click();

    await expect(page.getByText('本地卡组', { exact: true })).toBeVisible();
    await expect(page.getByText('示例卡组', { exact: true })).toBeVisible();
    await expect(page.getByText('Liella! 加分星', { exact: true })).toBeVisible();
    await expect(page.getByText('Liella! 可香三神', { exact: true })).toBeVisible();
    await expect(page.getByText("μ's DGG混合", { exact: true })).toBeVisible();
    await expect(page.getByText('五费黛雅 Love U', { exact: true })).toBeVisible();

    await page.getByRole('button').filter({ hasText: 'Liella! 加分星' }).first().click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Liella! 加分星', exact: true })).toBeVisible();

    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('loveca.local-decks.v1') ?? 'null')
    );
    expect(stored).toMatchObject({
      version: 1,
      decks: [{ name: 'Liella! 加分星', config: { player_name: 'Liella! 加分星' } }],
    });
  });

  test('公开首页与登录后页面共用公告中心行为', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '公告行为回归只需执行一次');

    await installApiMocks(page, false);
    await page.goto('/');
    await page.getByRole('button', { name: /公告，1 条内容/ }).click();
    const publicAnnouncementDialog = page.getByRole('dialog', { name: '公告' });
    await expect(publicAnnouncementDialog).toBeVisible();
    await expect(
      publicAnnouncementDialog.getByText('移动端公告验收', { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: '关闭公告' }).click();

    await installApiMocks(page, true);
    await page.reload();
    await expect(page.getByRole('button', { name: '前往大厅' })).toBeVisible();
    await page.getByRole('button', { name: /公告，1 条内容/ }).click();
    const authenticatedAnnouncementDialog = page.getByRole('dialog', { name: '公告' });
    await expect(authenticatedAnnouncementDialog).toBeVisible();
    await expect(
      authenticatedAnnouncementDialog.getByText('移动端公告验收', { exact: true })
    ).toBeVisible();
  });

  test('桌面端顶栏提供退出登录', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '桌面顶栏回归只需执行一次');

    await installApiMocks(page, false);
    await page.goto('/');

    await page.locator('.public-home__login-button').click();
    await page.getByPlaceholder('输入你的用户名或邮箱').fill('e2e_admin');
    await page.getByPlaceholder('输入你的密码').fill('test_password');
    await page.getByRole('button', { name: '登录', exact: true }).click();

    const signOutButton = page.getByRole('button', { name: '退出登录', exact: true });
    await expect(signOutButton).toBeVisible();
    await signOutButton.click();
    await expect(page.getByRole('heading', { name: 'Loveca 在线对战' })).toBeVisible();
  });

  test('登录后开始对战包含赛季排位入口', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '入口回归只需执行一次');

    await installApiMocks(page, true);
    await page.goto('/?page=game-setup');
    await expect(page.getByText('选择对战方式', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /赛季排位/ }).click();
    await page.getByRole('button', { name: '进入赛季排位' }).click();
    await expect(page.getByText('赛季排位', { exact: true }).first()).toBeVisible();
  });

  test('手机端对墙打确认页的开始与返回操作互不遮挡', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '短视口回归只需执行一次');

    await page.setViewportSize({ width: 390, height: 667 });
    await installApiMocks(page, true);
    await page.goto('/?page=game-setup');
    await expect(page.getByText('选择对战方式', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '下一步：选择己方卡组' }).click();
    await expect(page.getByRole('button', { name: 'E2E 移动验收卡组' })).toBeVisible();
    await page.getByRole('button', { name: '下一步：确认对局' }).click();
    await waitForStableApp(page);

    const previousButton = page.getByRole('button', { name: '上一步' });
    const startButton = page.getByRole('button', { name: '开始对局' });
    await expect(previousButton).toBeVisible();
    await expect(startButton).toBeVisible();
    await expect(page.getByText('在线记录：本局会保存到历史并可复盘')).toBeVisible();
    await expectElementWithinVisualViewport(page, 'button:has-text("上一步")', '对墙打上一步');
    await expectElementWithinVisualViewport(page, 'button:has-text("开始对局")', '对墙打开始对局');

    const actionGeometry = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
      const previous = buttons.find((button) => button.textContent?.trim() === '上一步');
      const start = buttons.find((button) => button.textContent?.trim() === '开始对局');
      if (!previous || !start) return null;

      const previousRect = previous.getBoundingClientRect();
      const startRect = start.getBoundingClientRect();
      const receivesPointerAtCenter = (button: HTMLButtonElement, rect: DOMRect) => {
        const target = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return target === button || button.contains(target);
      };

      return {
        overlaps: !(
          previousRect.right <= startRect.left ||
          startRect.right <= previousRect.left ||
          previousRect.bottom <= startRect.top ||
          startRect.bottom <= previousRect.top
        ),
        previousReceivesPointer: receivesPointerAtCenter(previous, previousRect),
        startReceivesPointer: receivesPointerAtCenter(start, startRect),
      };
    });

    expect(actionGeometry).toEqual({
      overlaps: false,
      previousReceivesPointer: true,
      startReceivesPointer: true,
    });
    await startButton.click({ trial: true });
    await attachScreenshot(page, testInfo, 'game-setup-solitaire-mobile-confirm');

    await previousButton.click();
    await expect(page.getByText('选择己方卡组', { exact: true })).toBeVisible();
  });

  test('浅色主题的主行动区使用主题语义背景', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '主题回归只需执行一次');

    await page.addInitScript(() => window.localStorage.setItem('loveca-theme', 'light'));
    await installApiMocks(page, true);
    await page.goto('/');
    await expect(page.getByRole('button', { name: '前往大厅' })).toBeVisible();

    const actionBar = page.locator('.lobby-action-bar');
    const lightBackground = await actionBar.evaluate(
      (element) => window.getComputedStyle(element).backgroundColor
    );
    expect(lightBackground).not.toBe('rgb(53, 25, 47)');

    await page.getByRole('button', { name: '切换到深色主题' }).click();
    const darkBackground = await actionBar.evaluate(
      (element) => window.getComputedStyle(element).backgroundColor
    );
    expect(darkBackground).not.toBe(lightBackground);
  });

  test('房间观战入口保持短文案并跟随主题', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '主题回归只需执行一次');

    await page.addInitScript(() => window.localStorage.setItem('loveca-theme', 'light'));
    await installApiMocks(page, true);
    await page.goto('/?page=online-spectator');
    await expect(page.getByRole('heading', { name: '房间观战', exact: true })).toHaveCount(1);
    await expect(page.getByText('输入房间号', { exact: true })).toBeVisible();
    await expect(page.getByText('选择先攻或后攻玩家的视角')).toHaveCount(0);

    const desk = page.locator('.spectator-lobby-desk');
    const lightBackground = await desk.evaluate(
      (element) => window.getComputedStyle(element).backgroundColor
    );
    expect(lightBackground).not.toBe('rgb(53, 25, 47)');

    await page.getByRole('button', { name: '切换到深色主题' }).click();
    const darkBackground = await desk.evaluate(
      (element) => window.getComputedStyle(element).backgroundColor
    );
    expect(darkBackground).not.toBe(lightBackground);
  });

  test('新建卡组默认包含 12 张能量卡', async ({ page }, testInfo) => {
    await installApiMocks(page, true);
    await page.goto('/?page=deck-manager');
    await expect(page.getByText('卡组管理')).toBeVisible();

    await page.getByRole('button', { name: /创建(?:新)?卡组/ }).click();
    await expect(page.getByPlaceholder('搜索卡牌名称或编号...')).toBeVisible();

    const viewDeckButton = page.getByRole('button', { name: /查看卡组/ });
    if (await viewDeckButton.isVisible()) await viewDeckButton.click();
    const tabletDeckToggle = page
      .getByRole('main')
      .getByRole('button', { name: '卡组', exact: true });
    if (await tabletDeckToggle.isVisible()) await tabletDeckToggle.click();

    await expect(page.getByText('12/12', { exact: true })).toBeVisible();
    await expectNoGlobalHorizontalOverflow(page, 'new deck with default energy');
    await attachScreenshot(page, testInfo, 'deck-manager-new-default-energy');
  });

  test('手机端查看卡组抽屉顶部完整可见', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '短视口回归只需执行一次');

    await page.setViewportSize({ width: 390, height: 667 });
    await installApiMocks(page, true);
    await page.goto('/?page=deck-manager&openDeckId=e2e-deck');
    await expect(page.getByPlaceholder('搜索卡牌名称或编号...')).toBeVisible();

    await page.getByRole('button', { name: /查看卡组/ }).click();
    const deckDrawer = page.getByRole('dialog', { name: '当前卡组' });
    await expect(deckDrawer).toBeVisible();
    await waitForStableApp(page);
    await expectElementWithinVisualViewport(
      page,
      '[aria-labelledby="mobile-deck-drawer-title"]',
      'mobile deck drawer'
    );

    const topEdgeReceivesPointer = await deckDrawer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const probe = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 4);
      return probe === element || element.contains(probe);
    });
    expect(topEdgeReceivesPointer).toBe(true);

    await attachScreenshot(page, testInfo, 'deck-editor-mobile-drawer');
    await deckDrawer.getByRole('button', { name: '关闭卡组面板' }).click();
    await expect(page.getByRole('button', { name: /查看卡组/ })).toBeVisible();
  });

  test('手机端卡牌详情顶部与关闭按钮完整可见', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '短视口回归只需执行一次');

    await page.setViewportSize({ width: 390, height: 667 });
    await installApiMocks(page, true);
    await page.goto('/?page=deck-manager&openDeckId=e2e-deck');
    await expect(page.getByPlaceholder('搜索卡牌名称或编号...')).toBeVisible();

    await page
      .getByAltText('移动验收成员 001')
      .first()
      .locator('xpath=ancestor::div[contains(@class, "group-hover/card")][1]')
      .click({ position: { x: 16, y: 16 } });
    const cardDetailDrawer = page.getByRole('dialog', { name: '卡牌详情' });
    await expect(cardDetailDrawer).toBeVisible();
    await waitForStableApp(page);
    await expectElementWithinVisualViewport(
      page,
      '[aria-labelledby="card-detail-drawer-title"]',
      'mobile card detail drawer'
    );

    const closeButton = cardDetailDrawer.getByRole('button', { name: '关闭卡牌详情' });
    await expect(closeButton).toBeVisible();
    await expectElementWithinVisualViewport(
      page,
      'button[aria-label="关闭卡牌详情"]',
      'mobile card detail close button'
    );

    await attachScreenshot(page, testInfo, 'deck-editor-mobile-card-detail');
    await closeButton.click();
    await expect(cardDetailDrawer).toHaveCount(0);
  });

  test('桌面缩放等效短视口中联机猜拳操作保持可达', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '桌面短视口回归只需执行一次');

    await page.setViewportSize({ width: 1280, height: 560 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.sessionStorage.setItem('loveca.online.room', 'ZOOM');
    });
    await installApiMocks(page, true);

    let selectedGesture: 'ROCK' | 'PAPER' | 'SCISSORS' | null = null;
    let openingRevealed = false;
    const openingRoom = () => ({
      roomCode: 'ZOOM',
      originKind: 'ONLINE_ROOM',
      status: 'OPENING',
      ownerUserId: 'e2e-user',
      currentUserId: 'e2e-user',
      currentUserRole: 'HOST',
      currentUserPresence: 'ACTIVE',
      currentUserSeat: 'FIRST',
      members: [
        {
          userId: 'e2e-user',
          displayName: 'E2E Admin',
          role: 'HOST',
          presence: 'ACTIVE',
          lockedDeckId: 'e2e-deck',
          lockedDeckName: 'E2E 移动验收卡组',
          ready: true,
          startReady: true,
          seat: 'FIRST',
        },
        {
          userId: 'opponent-user',
          displayName: '测试对手',
          role: 'GUEST',
          presence: 'ACTIVE',
          lockedDeckId: 'opponent-deck',
          lockedDeckName: '测试对手卡组',
          ready: true,
          startReady: true,
          seat: 'SECOND',
        },
      ],
      openingRps: {
        round: 1,
        choices: [
          { userId: 'e2e-user', selected: selectedGesture !== null, gesture: selectedGesture },
          {
            userId: 'opponent-user',
            selected: openingRevealed,
            gesture: openingRevealed ? 'SCISSORS' : null,
          },
        ],
        revealed: openingRevealed,
        winnerUserId: openingRevealed ? 'e2e-user' : null,
        chooserUserId: openingRevealed ? 'e2e-user' : null,
        revealedAt: openingRevealed ? Date.now() : null,
      },
      openingArrivalExpiresAt: null,
      restartRequest: null,
      endInfo: null,
      matchId: null,
      spectatorRoomEntry: null,
      spectatorPresence: { total: 0, viewers: [] },
      updatedAt: Date.now(),
    });

    await page.route('**/api/online/rooms/ZOOM**', async (route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.url().endsWith('/opening-rps')) {
        selectedGesture = (request.postDataJSON() as { gesture: typeof selectedGesture }).gesture;
      }
      await fulfillApi(route, openingRoom());
    });

    await page.goto('/?page=online-room');
    await expect(page.getByRole('heading', { name: '开局猜拳' })).toBeVisible();
    await waitForStableApp(page);

    const expectGesturesWithinViewport = async (label: string) => {
      for (const gesture of ['石头', '剪刀', '布']) {
        await expectElementWithinVisualViewport(
          page,
          `button[aria-label="${gesture}"]`,
          `${label} opening RPS ${gesture} button`
        );
      }
    };
    const openingSectionOrder = () =>
      page.evaluate(() => {
        const controls = document.querySelector('.online-opening-stage-controls');
        const players = document.querySelector('.online-opening-stage-player-grid');
        return {
          controlsTop: controls?.getBoundingClientRect().top ?? 0,
          playersTop: players?.getBoundingClientRect().top ?? 0,
        };
      });

    await expectGesturesWithinViewport('150% zoom equivalent');
    const shortDesktopOrder = await openingSectionOrder();
    expect(shortDesktopOrder.controlsTop).toBeLessThan(shortDesktopOrder.playersTop);
    await attachScreenshot(page, testInfo, 'online-opening-short-desktop');

    await page.setViewportSize({ width: 1600, height: 900 });
    await waitForStableApp(page);
    await expectGesturesWithinViewport('wide desktop');
    const wideDesktopOrder = await openingSectionOrder();
    expect(wideDesktopOrder.playersTop).toBeLessThan(wideDesktopOrder.controlsTop);

    await page.setViewportSize({ width: 800, height: 450 });
    await waitForStableApp(page);
    await expectGesturesWithinViewport('200% zoom equivalent');
    const highlyZoomedOrder = await openingSectionOrder();
    expect(highlyZoomedOrder.controlsTop).toBeLessThan(highlyZoomedOrder.playersTop);

    await page.getByRole('button', { name: '石头' }).click();
    await expect(page.getByRole('button', { name: '石头' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    openingRevealed = true;
    await page.reload();
    await expect(page.getByRole('button', { name: '我先手' })).toBeVisible();
    await waitForStableApp(page);
    await expectElementWithinVisualViewport(
      page,
      'button:has-text("我先手")',
      'highly zoomed opening first-player button'
    );
    await expectElementWithinVisualViewport(
      page,
      'button:has-text("我后手")',
      'highly zoomed opening second-player button'
    );

    const turnOrderRequest = page.waitForRequest(
      (request) => request.url().endsWith('/opening-turn-order') && request.method() === 'POST'
    );
    await page.getByRole('button', { name: '我先手' }).click();
    expect((await turnOrderRequest).postDataJSON()).toEqual({ choice: 'SELF_FIRST' });
  });

  test('复制为新版本后直接打开独立副本编辑器', async ({ page }) => {
    await installApiMocks(page, true);
    await page.goto('/?page=deck-manager');
    await expect(page.getByText('卡组管理')).toBeVisible();

    await page.getByRole('button', { name: /E2E 移动验收卡组的更多操作/ }).click();
    await page.getByRole('menuitem', { name: '复制为新版本' }).click();

    await expect(page.getByPlaceholder('卡组名称')).toHaveValue('E2E 移动验收卡组 v2');
    await expect(page.getByPlaceholder('搜索卡牌名称或编号...')).toBeVisible();
  });

  test('手机端导入操作单可进入 DeckLog 导入并支持取消', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 768, '仅验证手机端导入操作单');

    await installApiMocks(page, true);
    await page.goto('/?page=deck-manager');
    await expect(page.getByText('卡组管理')).toBeVisible();

    await page.getByRole('button', { name: '导入', exact: true }).click();
    const importSheet = page.getByRole('dialog', { name: '导入卡组' });
    await expect(importSheet).toBeVisible();
    await expectElementWithinVisualViewport(
      page,
      '[aria-labelledby="deck-import-sheet-title"]',
      'deck import sheet'
    );

    await importSheet.getByRole('button', { name: /从 DeckLog 导入/ }).click();
    await expect(page.getByRole('heading', { name: '从 DeckLog 导入' })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('heading', { name: '从 DeckLog 导入' })).toHaveCount(0);
  });

  test('DeckLog 读取成功后进入卡组编辑器', async ({ page }) => {
    await installApiMocks(page, true);
    await page.goto('/?page=deck-manager');
    await expect(page.getByText('卡组管理')).toBeVisible();

    const dialog = await openDecklogDialog(page);
    await dialog.getByLabel('卡组链接或编号').fill('2D6XL');
    await dialog.getByRole('button', { name: '读取并导入' }).click();

    await expect(page.getByPlaceholder('卡组名称')).toHaveValue('DeckLog E2E 卡组');
    await expect(page.getByPlaceholder('搜索卡牌名称或编号...')).toBeVisible();
  });

  test('响应式布局切换后不会恢复旧的卡组抽屉状态', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '状态重置回归只需执行一次');

    await installApiMocks(page, true);
    await page.goto('/?page=deck-manager&openDeckId=e2e-deck');
    await expect(page.getByPlaceholder('搜索卡牌名称或编号...')).toBeVisible();

    const viewDeckButton = page.getByRole('button', { name: /查看卡组/ });
    await viewDeckButton.click();
    await expect(viewDeckButton).toHaveCount(0);

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator('.workspace-sidebar')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: /查看卡组/ })).toBeVisible();
  });

  test('观战入口忽略输入变更前返回的旧查询', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '竞态回归只需在一个浏览器尺寸执行');

    await installApiMocks(page, false);

    let notifyRequestStarted: () => void = () => undefined;
    const requestStarted = new Promise<void>((resolve) => {
      notifyRequestStarted = resolve;
    });
    let releaseResponse: () => void = () => undefined;
    const responseReleased = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    await page.route('**/api/online/rooms/AAAA/spectator-entry', async (route) => {
      notifyRequestStarted();
      await responseReleased;
      await fulfillApi(route, {
        roomCode: 'AAAA',
        status: 'IN_GAME',
        matchId: 'match-stale',
        seats: [{ seat: 'FIRST', displayName: '旧房间玩家', enabled: true }],
      });
    });

    await page.goto('/online/spectate');
    const roomCodeInput = page.getByLabel('房间号');
    await roomCodeInput.fill('AAAA');
    await page.getByRole('button', { name: '查找' }).click();
    await requestStarted;

    await roomCodeInput.fill('BBBB');
    releaseResponse();

    await expect(roomCodeInput).toHaveValue('BBBB');
    await expect(page.getByText(/房间 AAAA/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查找' })).toBeEnabled();
  });

  test('系统减少动态效果时全局动画与过渡会被压缩', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390x844', '媒体偏好回归只需执行一次');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installApiMocks(page, true);
    await page.goto('/');
    await expect(page.getByRole('button', { name: '前往大厅' })).toBeVisible();

    const motionState = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'animate-spin transition-all';
      document.body.append(probe);
      const styles = window.getComputedStyle(probe);
      const result = {
        mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        animationDurationSeconds: Number.parseFloat(styles.animationDuration),
        transitionDurationSeconds: Number.parseFloat(styles.transitionDuration),
      };
      probe.remove();
      return result;
    });

    expect(motionState.mediaMatches).toBe(true);
    expect(motionState.animationDurationSeconds).toBeLessThanOrEqual(0.001);
    expect(motionState.transitionDurationSeconds).toBeLessThanOrEqual(0.001);
  });
});
