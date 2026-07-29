import type { DeckConfig } from './deck-loader.js';
import { normalizeCardCode } from '../../shared/utils/card-code.js';

export const DECK_CONTENT_CANONICAL_SCHEMA_VERSION = 'loveca.deck-content/v1' as const;

export interface CanonicalDeckEntry {
  readonly cardCode: string;
  readonly count: number;
}

export interface CanonicalDeckContent {
  readonly schemaVersion: typeof DECK_CONTENT_CANONICAL_SCHEMA_VERSION;
  readonly mainDeck: {
    readonly members: readonly CanonicalDeckEntry[];
    readonly lives: readonly CanonicalDeckEntry[];
  };
  readonly energyDeck: readonly CanonicalDeckEntry[];
}

/**
 * 将已通过 DeckConfigSchema 校验的配置转换为稳定的内容身份。
 *
 * 玩家名称和描述不属于内容；各分区内的重复条目按标准化后的精确印刷编号
 * 合并并排序。成员、LIVE 与能量分区始终分别参与身份计算。
 */
export function canonicalizeDeckContent(config: DeckConfig): CanonicalDeckContent {
  return {
    schemaVersion: DECK_CONTENT_CANONICAL_SCHEMA_VERSION,
    mainDeck: {
      members: canonicalizeEntries(config.main_deck.members),
      lives: canonicalizeEntries(config.main_deck.lives),
    },
    energyDeck: canonicalizeEntries(config.energy_deck),
  };
}

export function serializeCanonicalDeckContent(config: DeckConfig): string {
  return JSON.stringify(canonicalizeDeckContent(config));
}

function canonicalizeEntries(
  entries: readonly {
    readonly card_code: string;
    readonly count: number;
  }[]
): readonly CanonicalDeckEntry[] {
  const countsByCardCode = new Map<string, number>();

  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.count) || entry.count <= 0) {
      throw new TypeError(`卡组数量必须是正安全整数: ${entry.card_code}`);
    }

    const cardCode = normalizeCardCode(entry.card_code);
    if (cardCode.length === 0 || cardCode.trim() !== cardCode) {
      throw new TypeError(`卡牌编号不能为空或包含首尾空白: "${entry.card_code}"`);
    }

    countsByCardCode.set(cardCode, (countsByCardCode.get(cardCode) ?? 0) + entry.count);
  }

  return [...countsByCardCode.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([cardCode, count]) => ({ cardCode, count }));
}
