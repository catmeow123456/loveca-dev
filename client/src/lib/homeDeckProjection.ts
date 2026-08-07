import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckPointTableRules } from '@game/domain/rules/deck-point-table';
import type { DeckRecord } from '@/lib/apiClient';
import { buildDeckDisplayItems, type DeckDisplayItem } from '@/lib/deckDisplay';
import {
  createDeckRecordCardTypeResolver,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';

export interface HomeDeckProjection {
  readonly deckItems: DeckDisplayItem[];
  readonly validCloudDecks: DeckRecord[];
  readonly validDeckItems: DeckDisplayItem[];
}

export function buildHomeDeckProjection({
  cloudDecks,
  cardDataRegistry,
  pointTable,
}: {
  readonly cloudDecks: readonly DeckRecord[];
  readonly cardDataRegistry: ReadonlyMap<string, AnyCardData>;
  readonly pointTable: DeckPointTableRules;
}): HomeDeckProjection {
  const resolveDeckRecordCardType = createDeckRecordCardTypeResolver(cardDataRegistry);
  const validCloudDecks = cloudDecks.filter((deck) =>
    isDeckRecordValidForCurrentCardPool(deck, cardDataRegistry, pointTable)
  );

  return {
    deckItems: buildDeckDisplayItems({
      cloudDecks: [...cloudDecks],
      resolveDeckRecordCardType,
      pointTable,
    }),
    validCloudDecks,
    validDeckItems: buildDeckDisplayItems({
      cloudDecks: validCloudDecks,
      resolveDeckRecordCardType,
      pointTable,
    }),
  };
}
