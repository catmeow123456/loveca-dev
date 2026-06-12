import type { CardDataRegistry } from '../../domain/card-data/loader.js';
import type {
  DeckRecordLike,
  DeckRecordNormalizationResult,
} from '../../domain/card-data/deck-record-utils.js';
import { normalizeDeckRecordPayload } from '../../domain/card-data/deck-record-utils.js';
import { getPublishedCardRegistry } from './card-registry-service.js';

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
}

export async function prepareDeckPayloadForStorage(
  deck: DeckRecordLike
): Promise<PreparedDeckStoragePayload> {
  const registry = await getPublishedCardRegistry();
  const result = normalizeDeckRecordPayload(
    deck,
    (cardCode) => registry.getByCode(cardCode)?.cardType
  );

  if (result.sourceErrors.length > 0) {
    throw new DeckPayloadValidationError(result.sourceErrors);
  }

  return {
    ...result,
    registry,
  };
}
