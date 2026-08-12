import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckRecordLike } from '@game/domain/card-data/deck-record-utils';
import type { DeckPointTableRules } from '@game/domain/rules/deck-point-table';
import type { DeckConfig } from '@game/domain/card-data/deck-loader';
import { validateDeckConfig } from '@game/domain/rules/deck-construction';
import { CardType } from '@game/shared/types/enums';
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

export function isDeckConfigValidForCurrentCardPool(
  deck: DeckConfig,
  cardDataRegistry: ReadonlyMap<string, AnyCardData>,
  pointTable: DeckPointTableRules = getCurrentDeckPointTableRules()
): boolean {
  if (!validateDeckConfig(deck, pointTable).valid) return false;

  return (
    deck.main_deck.members.every(
      (entry) => cardDataRegistry.get(entry.card_code)?.cardType === CardType.MEMBER
    ) &&
    deck.main_deck.lives.every(
      (entry) => cardDataRegistry.get(entry.card_code)?.cardType === CardType.LIVE
    ) &&
    deck.energy_deck.every(
      (entry) => cardDataRegistry.get(entry.card_code)?.cardType === CardType.ENERGY
    )
  );
}
