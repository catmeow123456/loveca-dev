/**
 * 测试数据 Mock
 * 提供 mock 卡组数据和 API 拦截
 */

import { Page } from '@playwright/test';

/**
 * Mock 卡组数据 - 符合 DeckRecord 格式
 */
export const MOCK_DECK_1 = {
  id: 'test-deck-1',
  user_id: 'test-user',
  name: '测试卡组 Alpha',
  description: 'E2E 测试专用卡组',
  is_valid: true,
  main_deck: generateMainDeck(),
  energy_deck: generateEnergyDeck(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const MOCK_DECK_2 = {
  ...MOCK_DECK_1,
  id: 'test-deck-2',
  name: '测试卡组 Beta',
  description: 'E2E 测试对手卡组',
};

/**
 * 生成主卡组（48 成员 + 12 Live = 60 张）
 * 返回数组格式，符合 DeckRecord.main_deck 的要求
 * 使用真实的卡牌代码
 */
function generateMainDeck(): Array<{ card_code: string; count: number; card_type: 'MEMBER' | 'LIVE' }> {
  const deck: Array<{ card_code: string; count: number; card_type: 'MEMBER' | 'LIVE' }> = [];

  // 真实的成员卡代码 - 12 种 x 4 张 = 48 张
  const memberCodes = [
    'LL-bp1-001-R+', 'LL-bp2-001-R+', 'LL-bp3-001-R+', 'LL-bp4-001-R+',
    'PL!-PR-001-PR', 'PL!-PR-002-PR', 'PL!-PR-003-PR', 'PL!-PR-004-PR',
    'PL!-PR-005-PR', 'PL!-PR-006-PR', 'PL!-PR-007-PR', 'PL!-PR-008-PR',
  ];
  for (const code of memberCodes) {
    deck.push({ card_code: code, count: 4, card_type: 'MEMBER' });
  }

  // 真实的 Live 卡代码 - 3 种 x 4 张 = 12 张
  const liveCodes = ['PL!-bp3-019-L', 'PL!-bp3-020-L', 'PL!-bp3-021-L'];
  for (const code of liveCodes) {
    deck.push({ card_code: code, count: 4, card_type: 'LIVE' });
  }

  return deck;
}

/**
 * 生成能量卡组（12 张）
 * 使用真实的能量卡代码
 */
function generateEnergyDeck(): Array<{ card_code: string; count: number }> {
  // 真实的能量卡代码 - 3 种 x 4 张 = 12 张
  return [
    { card_code: 'LL-E-001-SD', count: 4 },
    { card_code: 'LL-E-003-SD', count: 4 },
    { card_code: 'LL-E-004-SD', count: 4 },
  ];
}

/**
 * 在页面加载后注入测试卡组到 store
 * 通过 window.__DECK_STORE__ 访问 Zustand store
 */
export async function injectTestDecksToStore(page: Page): Promise<boolean> {
  return await page.evaluate(
    ([deck1, deck2]) => {
      const store = (window as any).__DECK_STORE__;
      if (store && typeof store.setState === 'function') {
        store.setState({
          cloudDecks: [deck1, deck2],
          isLoadingCloud: false,
          cloudError: null,
        });
        return true;
      }
      return false;
    },
    [MOCK_DECK_1, MOCK_DECK_2]
  );
}

/**
 * 等待卡组数据加载完成
 */
export async function waitForDecksLoaded(page: Page): Promise<boolean> {
  try {
    // 等待卡组列表出现
    await page.locator('.grid.gap-3 button').first().waitFor({
      state: 'visible',
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}
