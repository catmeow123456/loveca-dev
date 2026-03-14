/**
 * 测试用卡组数据
 * 包含预定义的有效卡组配置，用于 E2E 测试
 */

/**
 * 卡组条目类型
 */
export interface DeckEntry {
  card_code: string;
  count: number;
  card_type?: 'MEMBER' | 'LIVE';
}

/**
 * 测试卡组配置
 */
export interface TestDeckConfig {
  name: string;
  description?: string;
  is_valid: boolean;
  main_deck: DeckEntry[];
  energy_deck: DeckEntry[];
}

/**
 * 测试卡组 1 - 标准配置
 * 48 张成员卡 + 12 张 Live 卡 + 12 张能量卡
 *
 * 注意：实际使用时需要替换为项目中真实存在的卡牌编号
 * 这里使用占位符格式，测试运行前需要从 cards_data.json 获取真实编号
 */
export const TEST_DECK_ALPHA: TestDeckConfig = {
  name: 'Test Deck Alpha',
  description: 'E2E 测试用标准卡组',
  is_valid: true,
  main_deck: [
    // 成员卡 (48 张) - 12种 x 4张
    { card_code: 'LL01-001', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-002', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-003', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-004', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-005', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-006', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-007', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-008', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-009', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-010', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-011', count: 4, card_type: 'MEMBER' },
    { card_code: 'LL01-012', count: 4, card_type: 'MEMBER' },
    // Live 卡 (12 张) - 3种 x 4张
    { card_code: 'PL01-001', count: 4, card_type: 'LIVE' },
    { card_code: 'PL01-002', count: 4, card_type: 'LIVE' },
    { card_code: 'PL01-003', count: 4, card_type: 'LIVE' },
  ],
  energy_deck: [
    // 能量卡 (12 张) - 3种 x 4张
    { card_code: 'EG-RED', count: 4 },
    { card_code: 'EG-BLUE', count: 4 },
    { card_code: 'EG-GREEN', count: 4 },
  ],
};

/**
 * 测试卡组 2 - 用于对手
 */
export const TEST_DECK_BETA: TestDeckConfig = {
  ...TEST_DECK_ALPHA,
  name: 'Test Deck Beta',
  description: 'E2E 测试用对手卡组',
};

/**
 * 获取卡组的总卡牌数
 */
export function getDeckTotalCount(deck: TestDeckConfig): {
  mainDeck: number;
  energyDeck: number;
  total: number;
} {
  const mainDeck = deck.main_deck.reduce((sum, entry) => sum + entry.count, 0);
  const energyDeck = deck.energy_deck.reduce((sum, entry) => sum + entry.count, 0);
  return {
    mainDeck,
    energyDeck,
    total: mainDeck + energyDeck,
  };
}

/**
 * 验证卡组是否符合规则
 * - 主卡组: 60 张 (48 成员 + 12 Live)
 * - 能量卡组: 12 张
 */
export function validateDeckConfig(deck: TestDeckConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const counts = getDeckTotalCount(deck);

  // 检查主卡组
  if (counts.mainDeck !== 60) {
    errors.push(`主卡组应为 60 张，实际 ${counts.mainDeck} 张`);
  }

  // 检查能量卡组
  if (counts.energyDeck !== 12) {
    errors.push(`能量卡组应为 12 张，实际 ${counts.energyDeck} 张`);
  }

  // 检查成员卡和 Live 卡数量
  const memberCount = deck.main_deck
    .filter((e) => e.card_type === 'MEMBER')
    .reduce((sum, e) => sum + e.count, 0);

  const liveCount = deck.main_deck
    .filter((e) => e.card_type === 'LIVE')
    .reduce((sum, e) => sum + e.count, 0);

  if (memberCount !== 48) {
    errors.push(`成员卡应为 48 张，实际 ${memberCount} 张`);
  }

  if (liveCount !== 12) {
    errors.push(`Live 卡应为 12 张，实际 ${liveCount} 张`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
