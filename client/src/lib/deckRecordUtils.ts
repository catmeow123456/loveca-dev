import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckRecordLike } from '@game/domain/card-data/deck-record-utils';
import {
  createDeckRecordCardDataTypeResolver,
  normalizeDeckRecordPayload,
} from '@game/domain/card-data/deck-record-utils';

export type {
  DeckRecordDeckPayload,
  DeckRecordEnergyEntry,
  DeckRecordLike,
  DeckRecordMainEntry,
  MainDeckEntryType,
  MainDeckEntryTypeResolver,
} from '@game/domain/card-data/deck-record-utils';

export {
  createDeckRecordCardDataTypeResolver,
  createDeckRecordCardTypeResolver,
  deckConfigToRecordPayload,
  deckRecordToConfig,
  getMainDeckEntryType,
  inferMainDeckEntryTypeByCode,
  normalizeDeckRecordPayload,
} from '@game/domain/card-data/deck-record-utils';

export function isDeckRecordValidForCurrentCardPool(
  deck: DeckRecordLike,
  cardDataRegistry: ReadonlyMap<string, AnyCardData>
): boolean {
  const result = normalizeDeckRecordPayload(
    deck,
    createDeckRecordCardDataTypeResolver(cardDataRegistry)
  );

  return result.sourceErrors.length === 0 && result.validation.valid;
}
