import { createHash } from 'node:crypto';
import type { DeckConfig } from '../../domain/card-data/deck-loader.js';
import {
  DECK_CONTENT_CANONICAL_SCHEMA_VERSION,
  serializeCanonicalDeckContent,
} from '../../domain/card-data/deck-canonical.js';

export const DECK_CONTENT_HASH_ALGORITHM = 'sha256' as const;

export interface DeckContentIdentity {
  readonly canonicalSchemaVersion: typeof DECK_CONTENT_CANONICAL_SCHEMA_VERSION;
  readonly hashAlgorithm: typeof DECK_CONTENT_HASH_ALGORITHM;
  readonly contentHash: `sha256:${string}`;
}

/**
 * AI 卡组准入、认证清单和测试夹具共用的唯一内容身份入口。
 */
export function createDeckContentIdentity(config: DeckConfig): DeckContentIdentity {
  const canonicalJson = serializeCanonicalDeckContent(config);
  const digest = createHash(DECK_CONTENT_HASH_ALGORITHM)
    .update(canonicalJson, 'utf8')
    .digest('hex');

  return {
    canonicalSchemaVersion: DECK_CONTENT_CANONICAL_SCHEMA_VERSION,
    hashAlgorithm: DECK_CONTENT_HASH_ALGORITHM,
    contentHash: `sha256:${digest}`,
  };
}
