/**
 * use-deck-mutations.ts - 卡组增删操作与验证 Hook
 */

import { useMemo, useCallback } from 'react';
import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckConfig, CardEntry } from '@game/domain/card-data/deck-loader';
import { CardType } from '@game/shared/types/enums';
import { MAX_SAME_CODE_COUNT } from '../../../../src/domain/rules/deck-validator';
import { getBaseCardCode } from '@/lib/cardUtils';

export interface UseDeckMutationsReturn {
  addCard: (card: AnyCardData) => void;
  removeCard: (card: AnyCardData) => void;
  baseCodeCountInDeck: Record<string, number>;
  exactCodeCountInDeck: Record<string, number>;
  validation: { valid: boolean; errors: string[] };
}

/** 不可变地添加一张卡到列表 */
function addToList(list: CardEntry[], cardCode: string): CardEntry[] {
  const idx = list.findIndex(e => e.card_code === cardCode);
  if (idx !== -1) {
    return list.map((e, i) => i === idx ? { ...e, count: e.count + 1 } : e);
  }
  return [...list, { card_code: cardCode, count: 1 }];
}

/** 不可变地从列表移除一张卡 */
function removeFromList(list: CardEntry[], cardCode: string): CardEntry[] {
  const idx = list.findIndex(e => e.card_code === cardCode);
  if (idx === -1) return list;
  if (list[idx].count > 1) {
    return list.map((e, i) => i === idx ? { ...e, count: e.count - 1 } : e);
  }
  return list.filter((_, i) => i !== idx);
}

export function useDeckMutations(
  deck: DeckConfig,
  onDeckChange: (deck: DeckConfig) => void,
  onValidate?: (deck: DeckConfig) => { valid: boolean; errors: string[] },
): UseDeckMutationsReturn {

  const baseCodeCountInDeck = useMemo(() => {
    const counts: Record<string, number> = {};
    const allEntries = [
      ...deck.main_deck.members,
      ...deck.main_deck.lives,
      ...deck.energy_deck,
    ];
    for (const entry of allEntries) {
      const base = getBaseCardCode(entry.card_code);
      counts[base] = (counts[base] || 0) + entry.count;
    }
    return counts;
  }, [deck]);

  const validation = useMemo(() => {
    if (onValidate) {
      return onValidate(deck);
    }
    const errors: string[] = [];
    const memberCount = deck.main_deck.members.reduce((sum, e) => sum + e.count, 0);
    const liveCount = deck.main_deck.lives.reduce((sum, e) => sum + e.count, 0);
    const energyCount = deck.energy_deck.reduce((sum, e) => sum + e.count, 0);

    if (memberCount !== 48) errors.push(`成员卡必须为 48 张 (当前 ${memberCount})`);
    if (liveCount !== 12) errors.push(`Live 卡必须为 12 张 (当前 ${liveCount})`);
    if (energyCount !== 12) errors.push(`能量卡必须为 12 张 (当前 ${energyCount})`);

    return { valid: errors.length === 0, errors };
  }, [deck, onValidate]);

  const addCard = useCallback((card: AnyCardData) => {
    // 分区满量检查
    if (card.cardType === CardType.MEMBER) {
      const count = deck.main_deck.members.reduce((sum, e) => sum + e.count, 0);
      if (count >= 48) return;
    } else if (card.cardType === CardType.LIVE) {
      const count = deck.main_deck.lives.reduce((sum, e) => sum + e.count, 0);
      if (count >= 12) return;
    } else {
      const count = deck.energy_deck.reduce((sum, e) => sum + e.count, 0);
      if (count >= 12) return;
    }

    // 同基础编号限制
    if (card.cardType !== CardType.ENERGY) {
      const baseCode = getBaseCardCode(card.cardCode);
      const allMainEntries = [...deck.main_deck.members, ...deck.main_deck.lives];
      const baseTotal = allMainEntries
        .filter(e => getBaseCardCode(e.card_code) === baseCode)
        .reduce((sum, e) => sum + e.count, 0);
      if (baseTotal >= MAX_SAME_CODE_COUNT) return;
    }

    // 不可变更新
    if (card.cardType === CardType.MEMBER) {
      onDeckChange({
        ...deck,
        main_deck: {
          ...deck.main_deck,
          members: addToList(deck.main_deck.members, card.cardCode),
        },
      });
    } else if (card.cardType === CardType.LIVE) {
      onDeckChange({
        ...deck,
        main_deck: {
          ...deck.main_deck,
          lives: addToList(deck.main_deck.lives, card.cardCode),
        },
      });
    } else {
      onDeckChange({
        ...deck,
        energy_deck: addToList(deck.energy_deck, card.cardCode),
      });
    }
  }, [deck, onDeckChange]);

  const removeCard = useCallback((card: AnyCardData) => {
    if (card.cardType === CardType.MEMBER) {
      onDeckChange({
        ...deck,
        main_deck: {
          ...deck.main_deck,
          members: removeFromList(deck.main_deck.members, card.cardCode),
        },
      });
    } else if (card.cardType === CardType.LIVE) {
      onDeckChange({
        ...deck,
        main_deck: {
          ...deck.main_deck,
          lives: removeFromList(deck.main_deck.lives, card.cardCode),
        },
      });
    } else {
      onDeckChange({
        ...deck,
        energy_deck: removeFromList(deck.energy_deck, card.cardCode),
      });
    }
  }, [deck, onDeckChange]);

  const exactCodeCountInDeck = useMemo(() => {
    const counts: Record<string, number> = {};
    const allEntries = [
      ...deck.main_deck.members,
      ...deck.main_deck.lives,
      ...deck.energy_deck,
    ];
    for (const entry of allEntries) {
      counts[entry.card_code] = entry.count;
    }
    return counts;
  }, [deck]);

  return { addCard, removeCard, baseCodeCountInDeck, exactCodeCountInDeck, validation };
}
