import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckRecordLike } from '@game/domain/card-data/deck-record-utils';
import type { DeckPointTableRules } from '@game/domain/rules/deck-point-table';
import {
  createDeckRecordCardDataTypeResolver,
  normalizeDeckRecordPayload,
} from '@game/domain/card-data/deck-record-utils';
import { getCurrentDeckPointTableRules } from '@/store/deckPointTableStore';

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
  cardDataRegistry: ReadonlyMap<string, AnyCardData>,
  pointTable: DeckPointTableRules = getCurrentDeckPointTableRules()
): boolean {
  const result = normalizeDeckRecordPayload(
    deck,
    createDeckRecordCardDataTypeResolver(cardDataRegistry),
    pointTable
  );

  return result.sourceErrors.length === 0 && result.validation.valid;
}
