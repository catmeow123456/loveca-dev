import type { DeckRecord } from '@/lib/apiClient';
import type { AnyCardData } from '@game/domain/entities/card';
import type { CardEntry, DeckConfig } from '@game/domain/card-data/deck-loader';
import { CardType } from '@game/shared/types/enums';

export type MainDeckEntryType = 'MEMBER' | 'LIVE';

type DeckRecordMainEntry = DeckRecord['main_deck'][number];
type DeckRecordEnergyEntry = DeckRecord['energy_deck'][number];

export type DeckRecordLike = {
  name: string;
  description?: string | null;
  main_deck?: readonly DeckRecordMainEntry[] | null;
  energy_deck?: readonly DeckRecordEnergyEntry[] | null;
};

export type MainDeckEntryTypeResolver = (cardCode: string) => MainDeckEntryType | undefined;

interface DeckRecordConversionOptions {
  resolveCardType?: MainDeckEntryTypeResolver;
}

export interface DeckRecordDeckPayload {
  main_deck: Array<CardEntry & { card_type: MainDeckEntryType }>;
  energy_deck: CardEntry[];
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

  return options.resolveCardType?.(entry.card_code) ?? inferMainDeckEntryTypeByCode(entry.card_code);
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
