import type { Page, Route } from '@playwright/test';

const NOW = '2026-07-31T12:00:00.000Z';

type VisualCard = {
  id: string;
  card_code: string;
  card_type: 'MEMBER' | 'LIVE' | 'ENERGY';
  name_jp: string | null;
  name_cn: string;
  work_names: string[];
  group_names: string[];
  unit_name: string | null;
  unit_name_raw: string | null;
  cost: number | null;
  blade: number | null;
  hearts: Array<{ color: string; count: number }>;
  blade_hearts: null;
  score: number | null;
  requirements: Array<{ color: string; count: number }>;
  card_text_jp: string | null;
  card_text_cn: string;
  image_filename: null;
  image_source_uri: null;
  rare: string;
  product: string;
  product_code: null;
  source_external_id: null;
  source_flags: null;
  status: 'PUBLISHED';
  created_at: string;
  updated_at: string;
  updated_by: null;
};

function makeCard(
  cardCode: string,
  cardType: VisualCard['card_type'],
  name: string,
  index: number
): VisualCard {
  return {
    id: cardCode,
    card_code: cardCode,
    card_type: cardType,
    name_jp: null,
    name_cn: name,
    work_names: ['视觉回归作品'],
    group_names: ['视觉回归组合'],
    unit_name: null,
    unit_name_raw: null,
    cost: cardType === 'MEMBER' ? index % 3 : null,
    blade: cardType === 'MEMBER' ? 1 : null,
    hearts: cardType === 'MEMBER' ? [{ color: 'PINK', count: 1 }] : [],
    blade_hearts: null,
    score: cardType === 'LIVE' ? 1 : null,
    requirements: cardType === 'LIVE' ? [{ color: 'PINK', count: 1 }] : [],
    card_text_jp: null,
    card_text_cn: '用于固定视口视觉回归的本地测试卡牌。',
    image_filename: null,
    image_source_uri: null,
    rare: 'N',
    product: 'VISUAL',
    product_code: null,
    source_external_id: null,
    source_flags: null,
    status: 'PUBLISHED',
    created_at: NOW,
    updated_at: NOW,
    updated_by: null,
  };
}

const MEMBER_CARDS = Array.from({ length: 12 }, (_, index) => {
  const suffix = String(index + 1).padStart(3, '0');
  return makeCard(`ME-visual-${suffix}`, 'MEMBER', `视觉验收成员 ${suffix}`, index + 1);
});
const LIVE_CARDS = Array.from({ length: 12 }, (_, index) => {
  const suffix = String(index + 1).padStart(3, '0');
  return makeCard(`LV-visual-${suffix}`, 'LIVE', `视觉验收 LIVE ${suffix}`, index + 1);
});
const ENERGY_CARD = makeCard('LL-E-001-SD', 'ENERGY', '视觉验收能量', 1);
const CARD_RECORDS = [...MEMBER_CARDS, ...LIVE_CARDS, ENERGY_CARD];

const DECK_RECORD = {
  id: 'visual-deck',
  user_id: 'visual-user',
  name: '视觉回归标准卡组',
  description: '用于全站固定视口验收。',
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
  share_id: null,
  share_enabled: false,
  shared_at: null,
  forked_from_deck_id: null,
  forked_from_share_id: null,
  forked_at: null,
  created_at: NOW,
  updated_at: NOW,
};

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({
      data,
      error: status >= 400 ? { code: 'UNAUTHORIZED', message: '未登录或登录已过期' } : null,
    }),
  });
}

export async function installVisualApiMocks(page: Page, authenticated: boolean) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/api/config') {
      await fulfill(route, {
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
          announcements: [],
        },
      });
      return;
    }

    if (url.pathname === '/api/auth/refresh') {
      if (!authenticated) {
        await fulfill(route, null, 401);
        return;
      }
      await fulfill(route, {
        accessToken: 'visual-token',
        user: {
          id: 'visual-user',
          email: 'visual@example.test',
          emailVerified: true,
        },
        profile: {
          id: 'visual-profile',
          username: 'visual_player',
          display_name: '视觉验收玩家',
          avatar_url: null,
          role: 'player',
          deck_count: 1,
          created_at: NOW,
          updated_at: NOW,
        },
      });
      return;
    }

    if (url.pathname === '/api/cards/status-map') {
      await fulfill(
        route,
        Object.fromEntries(CARD_RECORDS.map((card) => [card.card_code, card.status]))
      );
      return;
    }

    if (url.pathname === '/api/cards' && request.method() === 'GET') {
      await fulfill(route, CARD_RECORDS);
      return;
    }

    if (url.pathname === '/api/decks' && request.method() === 'GET') {
      await fulfill(route, [DECK_RECORD]);
      return;
    }

    if (url.pathname === `/api/decks/${DECK_RECORD.id}` && request.method() === 'GET') {
      await fulfill(route, DECK_RECORD);
      return;
    }

    await fulfill(route, null);
  });
}

export async function prepareVisualPage(
  page: Page,
  theme: 'light' | 'dark',
  authenticated: boolean
) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((selectedTheme) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('loveca-theme', selectedTheme);
  }, theme);
  await installVisualApiMocks(page, authenticated);
}

export async function waitForVisualStability(page: Page) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    const visibleImages = Array.from(document.images).filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.bottom >= 0 && rect.top <= window.innerHeight;
    });
    await Promise.all(
      visibleImages.map(async (image) => {
        if (!image.complete) {
          await new Promise<void>((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          });
        }
        await image.decode?.().catch(() => undefined);
      })
    );
  });
}
