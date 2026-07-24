import type { DeckConfig } from '@game/domain/card-data/deck-loader';
import { calculateDeckConfigStats, validateDeckConfig } from '@game/domain/rules/deck-construction';
import type { DeckRecord } from '@/lib/apiClient';
import { deckRecordToConfig, type MainDeckEntryTypeResolver } from '@/lib/deckRecordUtils';

export interface LocalDeck {
  id: string;
  name: string;
  description?: string;
  config: DeckConfig;
  isValid: boolean;
  updatedAt: Date;
}

export interface DeckDisplayItem {
  id: string;
  name: string;
  description?: string;
  isValid: boolean;
  isCloud: boolean;
  updatedAt: Date;
  memberCount: number;
  liveCount: number;
  energyCount: number;
  pointTotal: number;
  previewCardCodes: string[];
  cloudDeck?: DeckRecord;
  localDeck?: LocalDeck;
}

export function buildDeckDisplayItems({
  cloudDecks = [],
  localDecks = [],
  resolveDeckRecordCardType,
}: {
  cloudDecks?: DeckRecord[];
  localDecks?: LocalDeck[];
  resolveDeckRecordCardType?: MainDeckEntryTypeResolver;
}): DeckDisplayItem[] {
  const items: DeckDisplayItem[] = [];

  for (const deck of cloudDecks) {
    const deckConfig = deckRecordToConfig(deck, { resolveCardType: resolveDeckRecordCardType });
    const stats = calculateDeckConfigStats(deckConfig);

    items.push({
      id: deck.id,
      name: deck.name,
      description: deck.description || undefined,
      isValid: validateDeckConfig(deckConfig).valid,
      isCloud: true,
      updatedAt: new Date(deck.updated_at),
      memberCount: stats.memberCount,
      liveCount: stats.liveCount,
      energyCount: stats.energyCount,
      pointTotal: stats.pointTotal,
      previewCardCodes: collectPreviewCardCodes(deckConfig),
      cloudDeck: deck,
    });
  }

  for (const deck of localDecks) {
    const stats = calculateDeckConfigStats(deck.config);

    items.push({
      id: deck.id,
      name: deck.name,
      description: deck.description,
      isValid: deck.isValid,
      isCloud: false,
      updatedAt: deck.updatedAt,
      memberCount: stats.memberCount,
      liveCount: stats.liveCount,
      energyCount: stats.energyCount,
      pointTotal: stats.pointTotal,
      previewCardCodes: collectPreviewCardCodes(deck.config),
      localDeck: deck,
    });
  }

  return items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

function collectPreviewCardCodes(deck: DeckConfig): string[] {
  return Array.from(new Set(deck.main_deck.members.map((entry) => entry.card_code))).slice(0, 3);
}
