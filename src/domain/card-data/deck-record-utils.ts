import type { AnyCardData } from '../entities/card.js';
import type { CardEntry, DeckConfig } from './deck-loader.js';
import { validateDeckConfig, type DeckConfigValidation } from '../rules/deck-construction.js';
import { CardType } from '../../shared/types/enums.js';

export type MainDeckEntryType = 'MEMBER' | 'LIVE';

export interface DeckRecordMainEntry {
  readonly card_code: string;
  readonly count: number;
  readonly card_type?: MainDeckEntryType;
}

export interface DeckRecordEnergyEntry {
  readonly card_code: string;
  readonly count: number;
}

export type DeckRecordLike = {
  readonly name: string;
  readonly description?: string | null;
  readonly main_deck?: readonly DeckRecordMainEntry[] | null;
  readonly energy_deck?: readonly DeckRecordEnergyEntry[] | null;
};

export type MainDeckEntryTypeResolver = (cardCode: string) => MainDeckEntryType | undefined;
export type CardDataTypeResolver = (cardCode: string) => CardType | undefined;

interface DeckRecordConversionOptions {
  readonly resolveCardType?: MainDeckEntryTypeResolver;
}

export interface DeckRecordDeckPayload {
  readonly main_deck: Array<CardEntry & { card_type: MainDeckEntryType }>;
  readonly energy_deck: CardEntry[];
}

export interface DeckRecordNormalizationResult extends DeckRecordDeckPayload {
  readonly config: DeckConfig;
  readonly validation: DeckConfigValidation;
  readonly sourceErrors: string[];
}

function toCardEntry(entry: { card_code: string; count: number }): CardEntry {
  return {
    card_code: entry.card_code,
    count: entry.count,
  };
}

export function createDeckRecordCardTypeResolver(
  cardDataRegistry: ReadonlyMap<string, AnyCardData>
): MainDeckEntryTypeResolver {
  return (cardCode) => {
    const cardData = cardDataRegistry.get(cardCode);
    if (cardData?.cardType === CardType.MEMBER) return 'MEMBER';
    if (cardData?.cardType === CardType.LIVE) return 'LIVE';
    return undefined;
  };
}

export function createDeckRecordCardDataTypeResolver(
  cardDataRegistry: ReadonlyMap<string, AnyCardData>
): CardDataTypeResolver {
  return (cardCode) => cardDataRegistry.get(cardCode)?.cardType;
}

export function inferMainDeckEntryTypeByCode(cardCode: string): MainDeckEntryType {
  return cardCode.startsWith('PL') ? 'LIVE' : 'MEMBER';
}

export function getMainDeckEntryType(
  entry: DeckRecordMainEntry,
  options: DeckRecordConversionOptions = {}
): MainDeckEntryType {
  if (entry.card_type === 'MEMBER' || entry.card_type === 'LIVE') {
    return entry.card_type;
  }

  return (
    options.resolveCardType?.(entry.card_code) ?? inferMainDeckEntryTypeByCode(entry.card_code)
  );
}

export function deckRecordToConfig(
  deck: DeckRecordLike,
  options: DeckRecordConversionOptions = {}
): DeckConfig {
  const members: CardEntry[] = [];
  const lives: CardEntry[] = [];

  for (const entry of deck.main_deck ?? []) {
    const target = getMainDeckEntryType(entry, options) === 'LIVE' ? lives : members;
    target.push(toCardEntry(entry));
  }

  return {
    player_name: deck.name,
    description: deck.description || '',
    main_deck: { members, lives },
    energy_deck: (deck.energy_deck ?? []).map(toCardEntry),
  };
}

export function deckConfigToRecordPayload(deck: DeckConfig): DeckRecordDeckPayload {
  return {
    main_deck: [
      ...deck.main_deck.members.map((entry) => ({
        ...toCardEntry(entry),
        card_type: 'MEMBER' as const,
      })),
      ...deck.main_deck.lives.map((entry) => ({
        ...toCardEntry(entry),
        card_type: 'LIVE' as const,
      })),
    ],
    energy_deck: deck.energy_deck.map(toCardEntry),
  };
}

export function normalizeDeckRecordPayload(
  deck: DeckRecordLike,
  resolveCardDataType: CardDataTypeResolver
): DeckRecordNormalizationResult {
  const sourceErrors: string[] = [];
  const members: CardEntry[] = [];
  const lives: CardEntry[] = [];
  const normalizedMainDeck: Array<CardEntry & { card_type: MainDeckEntryType }> = [];
  const normalizedEnergyDeck: CardEntry[] = [];

  for (const entry of deck.main_deck ?? []) {
    const cardType = resolveCardDataType(entry.card_code);
    if (!cardType) {
      sourceErrors.push(`卡牌不存在或未发布: ${entry.card_code}`);
      continue;
    }

    if (cardType === CardType.ENERGY) {
      sourceErrors.push(`主卡组不能包含能量卡: ${entry.card_code}`);
      continue;
    }

    const mainDeckType: MainDeckEntryType = cardType === CardType.MEMBER ? 'MEMBER' : 'LIVE';
    if (entry.card_type && entry.card_type !== mainDeckType) {
      sourceErrors.push(
        `卡牌类型标记不匹配: ${entry.card_code} 标记为 ${entry.card_type}，实际为 ${mainDeckType}`
      );
      continue;
    }

    const normalizedEntry = { ...toCardEntry(entry), card_type: mainDeckType };
    normalizedMainDeck.push(normalizedEntry);
    if (mainDeckType === 'MEMBER') {
      members.push(toCardEntry(entry));
    } else {
      lives.push(toCardEntry(entry));
    }
  }

  for (const entry of deck.energy_deck ?? []) {
    const cardType = resolveCardDataType(entry.card_code);
    if (!cardType) {
      sourceErrors.push(`卡牌不存在或未发布: ${entry.card_code}`);
      continue;
    }

    if (cardType !== CardType.ENERGY) {
      sourceErrors.push(`能量卡组只能包含能量卡: ${entry.card_code} 是 ${cardType}`);
      continue;
    }

    normalizedEnergyDeck.push(toCardEntry(entry));
  }

  const config: DeckConfig = {
    player_name: deck.name,
    description: deck.description || '',
    main_deck: { members, lives },
    energy_deck: normalizedEnergyDeck,
  };

  return {
    main_deck: normalizedMainDeck,
    energy_deck: normalizedEnergyDeck,
    config,
    validation: validateDeckConfig(config),
    sourceErrors,
  };
}
