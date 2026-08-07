import type { CardEntry, DeckConfig } from '../card-data/deck-loader.js';
import { getBaseCardCode } from '../../shared/utils/card-code.js';
import { MAX_SAME_CODE_COUNT } from './deck-validator.js';
import type { DeckPointTableRules } from './deck-point-table.js';

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

export function getCardPoint(cardCode: string, pointTable: DeckPointTableRules): number {
  return pointTable.entries[getBaseCardCode(cardCode)] ?? 0;
}

export function calculateDeckPointTotal(
  entries: readonly DeckCountEntryLike[],
  pointTable: DeckPointTableRules
): number {
  return entries.reduce(
    (sum, entry) => sum + getCardPoint(entry.card_code, pointTable) * entry.count,
    0
  );
}

export function calculateDeckConfigStats(
  deck: DeckConfig,
  pointTable: DeckPointTableRules
): DeckConfigStats {
  const memberCount = deck.main_deck.members.reduce((sum, entry) => sum + entry.count, 0);
  const liveCount = deck.main_deck.lives.reduce((sum, entry) => sum + entry.count, 0);
  const energyCount = deck.energy_deck.reduce((sum, entry) => sum + entry.count, 0);
  const pointTotal = calculateDeckPointTotal(
    [...deck.main_deck.members, ...deck.main_deck.lives, ...deck.energy_deck],
    pointTable
  );

  return {
    memberCount,
    liveCount,
    energyCount,
    pointTotal,
  };
}

export function validateDeckConfig(
  deck: DeckConfig,
  pointTable: DeckPointTableRules
): DeckConfigValidation {
  const stats = calculateDeckConfigStats(deck, pointTable);
  const errors: string[] = [];

  if (stats.memberCount !== 48) errors.push(`成员卡必须为 48 张 (当前 ${stats.memberCount})`);
  if (stats.liveCount !== 12) errors.push(`Live 卡必须为 12 张 (当前 ${stats.liveCount})`);
  if (stats.energyCount !== 12) errors.push(`能量卡必须为 12 张 (当前 ${stats.energyCount})`);
  if (stats.pointTotal > pointTable.pointLimit) {
    errors.push(`卡组点数必须不超过 ${pointTable.pointLimit}pt (当前 ${stats.pointTotal}pt)`);
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
