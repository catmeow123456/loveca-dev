/**
 * 卡组构筑验证器单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  validateDeck,
  isDeckValid,
  canAddCard,
  countCardCodes,
  MAIN_DECK_SIZE,
  ENERGY_DECK_SIZE,
  MAX_SAME_CODE_COUNT,
} from '../../src/domain/rules/deck-validator';
import { CardType } from '../../src/shared/types/enums';
import type { MemberCardData, LiveCardData, EnergyCardData } from '../../src/domain/entities/card';

// ============================================
// 辅助函数
// ============================================

function createMemberCard(code: string, name: string = '测试成员'): MemberCardData {
  return {
    cardType: CardType.MEMBER,
    cardCode: code,
    name,
    cost: 5,
    blade: 2,
    hearts: [],
  };
}

function createLiveCard(code: string, name: string = '测试Live'): LiveCardData {
  return {
    cardType: CardType.LIVE,
    cardCode: code,
    name,
    score: 3,
    requirements: { colorRequirements: new Map(), totalRequired: 3 },
  };
}

function createEnergyCard(code: string): EnergyCardData {
  return {
    cardType: CardType.ENERGY,
    cardCode: code,
    name: '能量卡',
  };
}

/**
 * 创建一个有效的主卡组（60张）
 * 使用 4 段格式的 card_code 以匹配 getBaseCardCode 的行为
 */
function createValidMainDeck(): (MemberCardData | LiveCardData)[] {
  const deck: (MemberCardData | LiveCardData)[] = [];

  // 48张成员卡（12种，每种4张）
  for (let i = 0; i < 12; i++) {
    const seq = String(i).padStart(3, '0');
    for (let j = 0; j < 4; j++) {
      const rarity = ['N', 'R', 'P', 'AR'][j];
      deck.push(createMemberCard(`PL!-sd1-${seq}-${rarity}`, `成员${i}号`));
    }
  }

  // 12张Live卡（3种，每种4张）
  for (let i = 0; i < 3; i++) {
    const seq = String(50 + i).padStart(3, '0');
    for (let j = 0; j < 4; j++) {
      const rarity = ['N', 'R', 'P', 'AR'][j];
      deck.push(createLiveCard(`PL!-sd1-${seq}-${rarity}`, `Live${i}号`));
    }
  }

  return deck;
}

/**
 * 创建一个有效的能量卡组（12张）
 */
function createValidEnergyDeck(): EnergyCardData[] {
  const deck: EnergyCardData[] = [];

  for (let i = 0; i < 12; i++) {
    deck.push(createEnergyCard(`LL-E-${String(i).padStart(3, '0')}-SD`));
  }

  return deck;
}

// ============================================
// 测试套件
// ============================================

describe('卡组构筑验证器', () => {
  describe('validateDeck - 有效卡组', () => {
    it('应该验证通过一个合法的卡组', () => {
      const mainDeck = createValidMainDeck();
      const energyDeck = createValidEnergyDeck();

      const result = validateDeck(mainDeck, energyDeck);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.stats.mainDeckSize).toBe(MAIN_DECK_SIZE);
      expect(result.stats.energyDeckSize).toBe(ENERGY_DECK_SIZE);
    });
  });

  describe('validateDeck - 主卡组数量验证', () => {
    it('应该拒绝少于60张的主卡组', () => {
      const mainDeck = createValidMainDeck().slice(0, 50);
      const energyDeck = createValidEnergyDeck();

      const result = validateDeck(mainDeck, energyDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MAIN_DECK_SIZE_INVALID')).toBe(true);
    });

    it('应该拒绝多于60张的主卡组', () => {
      const mainDeck = [...createValidMainDeck(), createMemberCard('PL!-sd1-100-N')];
      const energyDeck = createValidEnergyDeck();

      const result = validateDeck(mainDeck, energyDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MAIN_DECK_SIZE_INVALID')).toBe(true);
    });
  });

  describe('validateDeck - 能量卡组数量验证', () => {
    it('应该拒绝少于12张的能量卡组', () => {
      const mainDeck = createValidMainDeck();
      const energyDeck = createValidEnergyDeck().slice(0, 10);

      const result = validateDeck(mainDeck, energyDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'ENERGY_DECK_SIZE_INVALID')).toBe(true);
    });

    it('应该拒绝多于12张的能量卡组', () => {
      const mainDeck = createValidMainDeck();
      const energyDeck = [...createValidEnergyDeck(), createEnergyCard('LL-E-099-SD')];

      const result = validateDeck(mainDeck, energyDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'ENERGY_DECK_SIZE_INVALID')).toBe(true);
    });
  });

  describe('validateDeck - 同编号数量限制', () => {
    it('应该拒绝同编号超过4张的成员卡牌', () => {
      // 创建一个有5张同编号卡的主卡组
      const mainDeck: (MemberCardData | LiveCardData)[] = [];

      // 5张同编号的成员卡（同基础编号 PL!-sd1-099）
      for (let i = 0; i < 5; i++) {
        mainDeck.push(createMemberCard(`PL!-sd1-099-${['N', 'R', 'P', 'AR', 'L'][i]}`));
      }

      // 填充到60张（55种不同基础编号）
      for (let i = 0; i < 55; i++) {
        const seq = String(i).padStart(3, '0');
        mainDeck.push(createMemberCard(`PL!N-bp1-${seq}-N`));
      }

      const energyDeck = createValidEnergyDeck();

      const result = validateDeck(mainDeck, energyDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MAIN_DECK_TOO_MANY_SAME_CODE')).toBe(true);
      expect(result.errors.some((e) => e.code === 'MEMBER_CARDS_NUMBER_INVALID')).toBe(true);
    });

    it('应该拒绝同编号超过4张的 Live 卡牌', () => {
      // 创建一个有12张同编号卡的主卡组
      const mainDeck: (MemberCardData | LiveCardData)[] = [];

      // 48张不同成员卡
      for (let i = 0; i < 48; i++) {
        const seq = String(i).padStart(3, '0');
        mainDeck.push(createMemberCard(`PL!N-bp1-${seq}-N`));
      }

      // 12张同编号 Live 卡（同基础编号 PL!-sd1-050）
      for (let i = 0; i < 12; i++) {
        mainDeck.push(createLiveCard(`PL!-sd1-050-N`));
      }

      const energyDeck = createValidEnergyDeck();

      const result = validateDeck(mainDeck, energyDeck);
      console.log(result);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MAIN_DECK_TOO_MANY_SAME_CODE')).toBe(true);
    });

    it('应该允许同编号正好4张的成员卡牌', () => {
      const mainDeck = createValidMainDeck(); // 这个已经有每种4张
      const energyDeck = createValidEnergyDeck();

      const result = validateDeck(mainDeck, energyDeck);

      expect(result.valid).toBe(true);
    });
  });

  describe('validateDeck - 卡牌类型验证', () => {
    it('应该拒绝主卡组中的能量卡', () => {
      const mainDeck = createValidMainDeck();
      // 替换一张成员卡为能量卡
      mainDeck[0] = createEnergyCard('LL-E-099-SD') as unknown as MemberCardData;

      const energyDeck = createValidEnergyDeck();

      const result = validateDeck(mainDeck, energyDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MAIN_DECK_HAS_ENERGY')).toBe(true);
    });

    it('应该拒绝能量卡组中的非能量卡', () => {
      const mainDeck = createValidMainDeck();
      const energyDeck = createValidEnergyDeck();
      // 替换一张能量卡为成员卡
      energyDeck[0] = createMemberCard('PL!-sd1-099-N') as unknown as EnergyCardData;

      const result = validateDeck(mainDeck, energyDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'ENERGY_DECK_HAS_NON_ENERGY')).toBe(true);
    });
  });

  describe('validateDeck - 警告检测', () => {
    it('应该对没有Live卡的卡组发出警告', () => {
      // 创建一个全是成员卡的主卡组
      const mainDeck: MemberCardData[] = [];
      for (let i = 0; i < 60; i++) {
        const base = i % 15;
        const seq = String(base).padStart(3, '0');
        mainDeck.push(createMemberCard(`PL!-sd1-${seq}-N`));
      }

      const energyDeck = createValidEnergyDeck();

      const result = validateDeck(mainDeck, energyDeck);

      // 警告不影响验证结果
      expect(result.warnings.some((w) => w.code === 'NO_LIVE_CARDS')).toBe(true);
    });
  });

  describe('isDeckValid', () => {
    it('应该返回 true 对于有效卡组', () => {
      const mainDeck = createValidMainDeck();
      const energyDeck = createValidEnergyDeck();

      expect(isDeckValid(mainDeck, energyDeck)).toBe(true);
    });

    it('应该返回 false 对于无效卡组', () => {
      const mainDeck = createValidMainDeck().slice(0, 50);
      const energyDeck = createValidEnergyDeck();

      expect(isDeckValid(mainDeck, energyDeck)).toBe(false);
    });
  });

  describe('canAddCard', () => {
    it('应该允许添加成员卡到主卡组', () => {
      const deck = createValidMainDeck().slice(0, 50);
      const card = createMemberCard('PL!-sd1-100-N');

      const result = canAddCard(deck, card, 'main');

      expect(result.canAdd).toBe(true);
    });

    it('应该拒绝添加能量卡到主卡组', () => {
      const deck = createValidMainDeck().slice(0, 50);
      const card = createEnergyCard('LL-E-099-SD');

      const result = canAddCard(deck, card, 'main');

      expect(result.canAdd).toBe(false);
      expect(result.reason).toContain('能量卡');
    });

    it('应该拒绝添加非能量卡到能量卡组', () => {
      const deck = createValidEnergyDeck().slice(0, 10);
      const card = createMemberCard('PL!-sd1-100-N');

      const result = canAddCard(deck, card, 'energy');

      expect(result.canAdd).toBe(false);
    });

    it('应该拒绝超过同编号上限的卡牌', () => {
      // 已有4张同编号卡
      const deck = [
        createMemberCard('PL!-sd1-099-N'),
        createMemberCard('PL!-sd1-099-R'),
        createMemberCard('PL!-sd1-099-P'),
        createMemberCard('PL!-sd1-099-AR'),
      ];

      const card = createMemberCard('PL!-sd1-099-L');

      const result = canAddCard(deck, card, 'main');

      expect(result.canAdd).toBe(false);
      expect(result.reason).toContain('上限');
    });

    it('应该拒绝卡组已满时添加', () => {
      const deck = createValidMainDeck(); // 已有60张
      const card = createMemberCard('PL!-sd1-100-N');

      const result = canAddCard(deck, card, 'main');

      expect(result.canAdd).toBe(false);
      expect(result.reason).toContain('已满');
    });
  });

  describe('countCardCodes', () => {
    it('应该按基础编号正确统计数量（不同稀有度视为同一张卡）', () => {
      const cards = [
        createMemberCard('LL-bp1-001-N'),
        createMemberCard('LL-bp1-001-R'),
        createMemberCard('LL-bp1-002-N'),
        createMemberCard('LL-bp1-001-SEC'),
      ];

      const counts = countCardCodes(cards);

      // LL-bp1-001-N, LL-bp1-001-R, LL-bp1-001-SEC 基础编号均为 LL-bp1-001
      expect(counts.get('LL-bp1-001')).toBe(3);
      expect(counts.get('LL-bp1-002')).toBe(1);
    });
  });
});
