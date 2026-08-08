import { createHash } from 'node:crypto';
import type { AnyCardData } from '../../domain/entities/card.js';
import { getPublishedCardRegistry } from '../services/card-registry-service.js';
import { REPLAY_RULES_VERSION } from '../services/replay-constants.js';
import { stableJsonStringify } from '../services/replay-payload-serialization.js';
import { assertValidRankedRatingConfig, type RankedRatingConfig } from './ranked-rating.js';

export const RANKED_CARD_CATALOG_VERSION = 'PUBLISHED_RUNTIME_CARD_CATALOG_V1';
export const RANKED_DECK_POLICY_VERSION = 'STANDARD_PUBLISHED_CARD_POOL_V1';

export interface RankedCardCatalogIdentity {
  readonly cardCatalogVersion: string;
  readonly cardCatalogHash: string;
  readonly publishedCardCount: number;
}

export interface RankedCompetitiveEnvironmentIdentity extends RankedCardCatalogIdentity {
  readonly competitiveEnvironmentId: string;
  readonly rulesVersion: string;
  readonly deckPolicyVersion: string;
  readonly ratingAlgorithmVersion: string;
}

export async function getCurrentRankedCardCatalogIdentity(
  forceRefresh = false
): Promise<RankedCardCatalogIdentity> {
  const registry = await getPublishedCardRegistry(forceRefresh);
  return buildRankedCardCatalogIdentity(registry.getAll());
}

export function buildRankedCardCatalogIdentity(
  cards: readonly AnyCardData[]
): RankedCardCatalogIdentity {
  const canonicalCards = cards
    .map(toRankedCardCatalogRecord)
    .sort((first, second) => compareText(first.cardCode, second.cardCode));
  return {
    cardCatalogVersion: RANKED_CARD_CATALOG_VERSION,
    cardCatalogHash: hashValue({
      schemaVersion: RANKED_CARD_CATALOG_VERSION,
      cards: canonicalCards,
    }),
    publishedCardCount: canonicalCards.length,
  };
}

export function buildRankedCompetitiveEnvironmentIdentity(
  cardCatalog: RankedCardCatalogIdentity,
  ratingConfig: RankedRatingConfig,
  options: {
    readonly rulesVersion?: string;
    readonly deckPolicyVersion?: string;
  } = {}
): RankedCompetitiveEnvironmentIdentity {
  assertValidRankedRatingConfig(ratingConfig);
  const rulesVersion = options.rulesVersion ?? REPLAY_RULES_VERSION;
  const deckPolicyVersion = options.deckPolicyVersion ?? RANKED_DECK_POLICY_VERSION;
  const competitiveEnvironmentId = hashValue({
    schemaVersion: 'RANKED_COMPETITIVE_ENVIRONMENT_V1',
    rulesVersion,
    cardCatalogVersion: cardCatalog.cardCatalogVersion,
    cardCatalogHash: cardCatalog.cardCatalogHash,
    deckPolicyVersion,
    ratingConfig,
  });

  return {
    ...cardCatalog,
    competitiveEnvironmentId,
    rulesVersion,
    deckPolicyVersion,
    ratingAlgorithmVersion: ratingConfig.algorithmVersion,
  };
}

function toRankedCardCatalogRecord(
  card: AnyCardData
): Record<string, unknown> & { readonly cardCode: string } {
  return {
    cardCode: card.cardCode,
    cardType: card.cardType,
    name: card.name,
    nameJp: card.nameJp ?? null,
    nameCn: card.nameCn ?? null,
    workNames: card.workNames ?? null,
    groupNames: card.groupNames ?? null,
    unitName: card.unitName ?? null,
    cardText: card.cardText ?? null,
    ...('cost' in card ? { cost: card.cost } : {}),
    ...('blade' in card ? { blade: card.blade } : {}),
    ...('hearts' in card ? { hearts: card.hearts } : {}),
    ...('bladeHearts' in card ? { bladeHearts: card.bladeHearts ?? null } : {}),
    ...('score' in card ? { score: card.score } : {}),
    ...('requirements' in card ? { requirements: card.requirements } : {}),
  };
}

function hashValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`;
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}
