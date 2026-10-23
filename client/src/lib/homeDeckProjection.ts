import type { CasualRuleMode } from '@game/online/casual-table-types';
import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckPointTableRules } from '@game/domain/rules/deck-point-table';
import type { DeckRecord } from '@/lib/apiClient';
import { buildDeckDisplayItems, type DeckDisplayItem } from '@/lib/deckDisplay';
import type { LocalDeck } from '@/lib/localDeckStorage';
import {
  createDeckRecordCardTypeResolver,
  isDeckConfigValidForCurrentCardPool,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';

export interface HomeDeckProjection {
  readonly deckItems: DeckDisplayItem[];
  readonly validCloudDecks: DeckRecord[];
  readonly validDeckItems: DeckDisplayItem[];
}

export function buildHomeDeckProjection({
  cloudDecks,
  localDecks = [],
  cardDataRegistry,
  pointTable,
  ruleMode = 'NORMAL',
}: {
  readonly cloudDecks: readonly DeckRecord[];
  readonly localDecks?: readonly LocalDeck[];
  readonly cardDataRegistry: ReadonlyMap<string, AnyCardData>;
  readonly ruleMode?: CasualRuleMode;
  readonly pointTable: DeckPointTableRules;
}): HomeDeckProjection {
  const resolveDeckRecordCardType = createDeckRecordCardTypeResolver(cardDataRegistry);
  const validCloudDecks = cloudDecks.filter((deck) =>
    isDeckRecordValidForCurrentCardPool(deck, cardDataRegistry, pointTable, ruleMode)
  );
  const validCloudDeckIds = new Set(validCloudDecks.map((deck) => deck.id));
  const deckItems = buildDeckDisplayItems({
    cloudDecks: [...cloudDecks],
    localDecks: [...localDecks],
    resolveDeckRecordCardType,
    pointTable,
    ruleMode,
    validateLocalDeck: (deck) =>
      isDeckConfigValidForCurrentCardPool(deck, cardDataRegistry, pointTable, ruleMode),
  });

  return {
    deckItems,
    validCloudDecks,
    validDeckItems: deckItems.filter((deck) =>
      deck.isCloud ? validCloudDeckIds.has(deck.id) : deck.isValid
    ),
  };
}
