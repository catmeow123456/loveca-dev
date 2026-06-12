import { describe, expect, it } from 'vitest';
import type { AnyCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createDeckRecordCardDataTypeResolver,
  normalizeDeckRecordPayload,
} from '../../src/domain/card-data/deck-record-utils';
import { CardType, HeartColor } from '../../src/shared/types/enums';

function createMemberCard(cardCode: string): AnyCardData {
  return {
    cardType: CardType.MEMBER,
    cardCode,
    name: cardCode,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string): AnyCardData {
  return {
    cardType: CardType.LIVE,
    cardCode,
    name: cardCode,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergyCard(cardCode: string): AnyCardData {
  return {
    cardType: CardType.ENERGY,
    cardCode,
    name: cardCode,
  };
}

function createPublishedCards(): Map<string, AnyCardData> {
  const cards = new Map<string, AnyCardData>();
  for (let i = 0; i < 12; i += 1) {
    const code = `LL-bp1-${String(i).padStart(3, '0')}-N`;
    cards.set(code, createMemberCard(code));
  }
  for (let i = 0; i < 3; i += 1) {
    const code = `PL!-bp1-${String(i).padStart(3, '0')}-N`;
    cards.set(code, createLiveCard(code));
  }
  for (let i = 0; i < 3; i += 1) {
    const code = `LL-E-${String(i).padStart(3, '0')}-SD`;
    cards.set(code, createEnergyCard(code));
  }
  return cards;
}

describe('deck record utils', () => {
  it('补齐旧格式 main_deck 的 card_type 并重新计算合法性', () => {
    const cards = createPublishedCards();
    const result = normalizeDeckRecordPayload(
      {
        name: '旧格式卡组',
        main_deck: [
          ...Array.from({ length: 12 }, (_, index) => ({
            card_code: `LL-bp1-${String(index).padStart(3, '0')}-N`,
            count: 4,
          })),
          ...Array.from({ length: 3 }, (_, index) => ({
            card_code: `PL!-bp1-${String(index).padStart(3, '0')}-N`,
            count: 4,
          })),
        ],
        energy_deck: Array.from({ length: 3 }, (_, index) => ({
          card_code: `LL-E-${String(index).padStart(3, '0')}-SD`,
          count: 4,
        })),
      },
      createDeckRecordCardDataTypeResolver(cards)
    );

    expect(result.sourceErrors).toEqual([]);
    expect(result.validation.valid).toBe(true);
    expect(
      result.main_deck.every((entry) => entry.card_type === 'MEMBER' || entry.card_type === 'LIVE')
    ).toBe(true);
    expect(result.main_deck.filter((entry) => entry.card_type === 'MEMBER')).toHaveLength(12);
    expect(result.main_deck.filter((entry) => entry.card_type === 'LIVE')).toHaveLength(3);
  });

  it('拒绝未发布或不存在的卡牌引用', () => {
    const cards = createPublishedCards();
    const result = normalizeDeckRecordPayload(
      {
        name: '包含未知卡',
        main_deck: [{ card_code: 'LL-bp9-999-N', count: 1 }],
        energy_deck: [],
      },
      createDeckRecordCardDataTypeResolver(cards)
    );

    expect(result.sourceErrors).toContain('卡牌不存在或未发布: LL-bp9-999-N');
  });

  it('拒绝主卡组和能量卡组中的卡种错放', () => {
    const cards = createPublishedCards();
    const result = normalizeDeckRecordPayload(
      {
        name: '卡种错放',
        main_deck: [{ card_code: 'LL-E-000-SD', count: 1 }],
        energy_deck: [{ card_code: 'LL-bp1-000-N', count: 1 }],
      },
      createDeckRecordCardDataTypeResolver(cards)
    );

    expect(result.sourceErrors).toContain('主卡组不能包含能量卡: LL-E-000-SD');
    expect(result.sourceErrors).toContain('能量卡组只能包含能量卡: LL-bp1-000-N 是 MEMBER');
  });
});
