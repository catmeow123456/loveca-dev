import type { CardDataRegistry } from '../../domain/card-data/loader.js';
import type {
  DeckRecordLike,
  DeckRecordNormalizationResult,
} from '../../domain/card-data/deck-record-utils.js';
import { normalizeDeckRecordPayload } from '../../domain/card-data/deck-record-utils.js';
import { getPublishedCardRegistry } from './card-registry-service.js';
import { deckPointTableService } from './deck-point-table-service.js';
import type { DeckPointTableRules } from '../../domain/rules/deck-point-table.js';

export class DeckPayloadValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join('; '));
    this.name = 'DeckPayloadValidationError';
    this.errors = errors;
  }
}

export interface PreparedDeckStoragePayload extends DeckRecordNormalizationResult {
  readonly registry: CardDataRegistry;
  readonly pointTable: DeckPointTableRules;
}

export interface DeckValidationContext {
  readonly registry: CardDataRegistry;
  readonly pointTable: DeckPointTableRules;
}

export async function getCurrentDeckValidationContext(): Promise<DeckValidationContext> {
  const [registry, pointTable] = await Promise.all([
    getPublishedCardRegistry(),
    deckPointTableService.getCurrentRules(),
  ]);
  return { registry, pointTable };
}

export function prepareDeckPayloadWithContext(
  deck: DeckRecordLike,
  context: DeckValidationContext
): PreparedDeckStoragePayload {
  const result = normalizeDeckRecordPayload(
    deck,
    (cardCode) => context.registry.getByCode(cardCode)?.cardType,
    context.pointTable
  );
  if (result.sourceErrors.length > 0) {
    throw new DeckPayloadValidationError(result.sourceErrors);
  }
  return { ...result, ...context };
}

export async function prepareDeckPayloadForStorage(
  deck: DeckRecordLike
): Promise<PreparedDeckStoragePayload> {
  return prepareDeckPayloadWithContext(deck, await getCurrentDeckValidationContext());
}
