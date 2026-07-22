import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENERGY_CARD_CODE,
  createDefaultEnergyDeck,
  createNewDeckConfig,
} from '../../src/domain/card-data/deck-defaults';

describe('deck defaults', () => {
  it('新卡组默认使用 12 张 LL-E-001-SD 能量卡', () => {
    const deck = createNewDeckConfig('测试卡组');

    expect(deck.energy_deck).toEqual([{ card_code: DEFAULT_ENERGY_CARD_CODE, count: 12 }]);
    expect(deck.main_deck).toEqual({ members: [], lives: [] });
  });

  it('每次创建都返回独立的能量卡数组', () => {
    const first = createDefaultEnergyDeck();
    const second = createDefaultEnergyDeck();

    first[0].count = 1;
    expect(second).toEqual([{ card_code: DEFAULT_ENERGY_CARD_CODE, count: 12 }]);
  });
});
