import type { CardEntry, DeckConfig } from '../card-data/deck-loader';
import { getBaseCardCode } from '../../shared/utils/card-code';
import { MAX_SAME_CODE_COUNT } from './deck-validator';

export const DECK_POINT_LIMIT = 9;

const CARD_POINT_MAP: Record<string, number> = {
  'PL!N-bp1-003': 4,
  'PL!N-bp1-012': 3,
  'LL-bp2-001': 3,
  'PL!N-bp1-002': 2,
  'PL!N-sd1-008': 2,
  'PL!HS-bp2-014': 2,
  'PL!SP-bp1-005': 1,
  'PL!N-bp1-029': 1,
  'PL!SP-sd1-020': 1,
  'PL!SP-pb1-014': 1,
  'PL!SP-bp2-024': 1,
};

export interface DeckConfigStats {
  memberCount: number;
  liveCount: number;
  energyCount: number;
  pointTotal: number;
}

export interface DeckConfigValidation {
  valid: boolean;
  errors: string[];
  stats: DeckConfigStats;
}

export interface DeckCountEntryLike {
  card_code: string;
  count: number;
}

export function getCardPoint(cardCode: string): number {
  return CARD_POINT_MAP[getBaseCardCode(cardCode)] ?? 0;
}

export function calculateDeckPointTotal(entries: readonly DeckCountEntryLike[]): number {
  return entries.reduce((sum, entry) => sum + getCardPoint(entry.card_code) * entry.count, 0);
}

export function calculateDeckConfigStats(deck: DeckConfig): DeckConfigStats {
  const memberCount = deck.main_deck.members.reduce((sum, entry) => sum + entry.count, 0);
  const liveCount = deck.main_deck.lives.reduce((sum, entry) => sum + entry.count, 0);
  const energyCount = deck.energy_deck.reduce((sum, entry) => sum + entry.count, 0);
  const pointTotal = calculateDeckPointTotal([
    ...deck.main_deck.members,
    ...deck.main_deck.lives,
    ...deck.energy_deck,
  ]);

  return {
    memberCount,
    liveCount,
    energyCount,
    pointTotal,
  };
}

export function validateDeckConfig(deck: DeckConfig): DeckConfigValidation {
  const stats = calculateDeckConfigStats(deck);
  const errors: string[] = [];

  if (stats.memberCount !== 48) errors.push(`成员卡必须为 48 张 (当前 ${stats.memberCount})`);
  if (stats.liveCount !== 12) errors.push(`Live 卡必须为 12 张 (当前 ${stats.liveCount})`);
  if (stats.energyCount !== 12) errors.push(`能量卡必须为 12 张 (当前 ${stats.energyCount})`);
  if (stats.pointTotal > DECK_POINT_LIMIT) {
    errors.push(`卡组点数必须不超过 ${DECK_POINT_LIMIT}pt (当前 ${stats.pointTotal}pt)`);
  }

  const baseCodeCounts = new Map<string, number>();
  const allMainDeckEntries: CardEntry[] = [...deck.main_deck.members, ...deck.main_deck.lives];
  for (const entry of allMainDeckEntries) {
    const baseCode = getBaseCardCode(entry.card_code);
    baseCodeCounts.set(baseCode, (baseCodeCounts.get(baseCode) ?? 0) + entry.count);
  }

  for (const [baseCode, count] of baseCodeCounts.entries()) {
    if (count > MAX_SAME_CODE_COUNT) {
      errors.push(`基础编号 ${baseCode} 超过 ${MAX_SAME_CODE_COUNT} 张限制 (当前 ${count})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    stats,
  };
}
