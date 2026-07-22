import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { Buffer } from 'node:buffer';

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

async function fulfillApi(route: Route, data: unknown, status = 200, error: ApiError = null) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data, error }),
  });
}

async function installApiMocks(page: Page, authenticated: boolean) {
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

    if (url.pathname === '/api/cards/status-map') {
      await fulfillApi(
        route,
        Object.fromEntries(CARD_RECORDS.map((card) => [card.card_code, card.status]))
      );
      return;
    }

    if (url.pathname === '/api/cards/export') {
      await fulfillApi(route, []);
      return;
    }

    if (url.pathname === '/api/cards' && method === 'GET') {
      await fulfillApi(route, CARD_RECORDS);
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
          name: input.name ?? '新建卡牌',
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
      const card = CARD_RECORDS.find((record) => record.card_code === cardCode) ?? CARD_RECORDS[0];
      await fulfillApi(route, card);
      return;
    }

    if (url.pathname === '/api/decks' && method === 'GET') {
      await fulfillApi(route, [DECK_RECORD]);
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

type Scenario = {
  name: string;
  path: string;
  authenticated: boolean;
  ready: (page: Page) => Promise<void>;
  action?: (page: Page) => Promise<void>;
};

const scenarios: Scenario[] = [
  {
    name: 'auth-login',
    path: '/',
    authenticated: false,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: '进入 Loveca' })).toBeVisible();
    },
  },
  {
    name: 'home',
    path: '/',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'Loveca' })).toBeVisible();
    },
  },
  {
    name: 'game-setup',
    path: '/?page=game-setup',
    authenticated: true,
    ready: async (page) => {
      await expect(page.getByText('游戏准备')).toBeVisible();
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
      await expect(page.getByText(/共\s*1\s*个卡组/)).toHaveCount(0);

      if ((page.viewportSize()?.width ?? 0) < 768) {
        await expect(page.getByRole('button', { name: '创建卡组', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '导入', exact: true })).toBeVisible();

        const titleBox = await page
          .getByRole('heading', { name: 'E2E 移动验收卡组' })
          .boundingBox();
        const editBox = await page.getByRole('button', { name: '编辑', exact: true }).boundingBox();
        const moreBox = await page
          .getByRole('button', { name: /E2E 移动验收卡组的更多操作/ })
          .boundingBox();
        expect(titleBox).not.toBeNull();
        expect(editBox).not.toBeNull();
        expect(moreBox).not.toBeNull();
        expect(Math.abs((editBox?.y ?? 0) - (titleBox?.y ?? 0))).toBeLessThan(16);
        expect(Math.abs((editBox?.y ?? 0) - (moreBox?.y ?? 0))).toBeLessThan(2);
      }

      await page.getByRole('button', { name: /E2E 移动验收卡组的更多操作/ }).click();
      const menu = page.getByRole('menu', { name: /E2E 移动验收卡组的操作/ });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: '复制为新版本' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: '删除卡组' })).toBeVisible();
      await expectElementWithinVisualViewport(page, '[role="menu"]', 'deck actions menu');
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
      await expect(page.getByRole('button', { name: /查看卡组/ })).toBeVisible();
      await expectElementWithinVisualViewport(
        page,
        'button:has-text("查看卡组")',
        'deck editor view-deck button'
      );
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
    name: 'shared-deck',
    path: '/decks/share/e2e-share',
    authenticated: false,
    ready: async (page) => {
      await expect(page.getByText('卡组分享')).toBeVisible();
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
      await expectNoGlobalHorizontalOverflow(page, scenario.name);
      await attachScreenshot(page, testInfo, scenario.name);
    });
  }

  test('新建卡组默认包含 12 张能量卡', async ({ page }, testInfo) => {
    await installApiMocks(page, true);
    await page.goto('/?page=deck-manager');
    await expect(page.getByText('卡组管理')).toBeVisible();

    await page.getByRole('button', { name: /创建(?:新)?卡组/ }).click();
    await expect(page.getByPlaceholder('搜索卡牌名称或编号...')).toBeVisible();

    const viewDeckButton = page.getByRole('button', { name: /查看卡组/ });
    if (await viewDeckButton.isVisible()) await viewDeckButton.click();
    const tabletDeckToggle = page.getByRole('button', { name: '卡组' });
    if (await tabletDeckToggle.isVisible()) await tabletDeckToggle.click();

    await expect(page.getByText('12/12', { exact: true })).toBeVisible();
    await expectNoGlobalHorizontalOverflow(page, 'new deck with default energy');
    await attachScreenshot(page, testInfo, 'deck-manager-new-default-energy');
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
});
