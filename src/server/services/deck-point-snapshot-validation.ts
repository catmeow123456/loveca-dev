import type { DeckConfig as RuntimeDeckConfig } from '../../application/game-service.js';
import type {
  DeckPointTableRules,
  DeckPointValidationFacts,
} from '../../domain/rules/deck-point-table.js';
import { getCardPoint } from '../../domain/rules/deck-construction.js';

export interface RuntimeDeckPointRevalidation {
  readonly valid: boolean;
  readonly changed: boolean;
  readonly facts: DeckPointValidationFacts;
}

/**
 * Revalidate an immutable runtime-deck snapshot against the authoritative
 * current PT table. Structural/card-pool validation already happened when the
 * snapshot was locked; this boundary specifically prevents a table rollover
 * from starting a new match with stale PT facts.
 */
export function revalidateRuntimeDeckPointSnapshot(
  deck: RuntimeDeckConfig,
  previous: DeckPointValidationFacts,
  current: DeckPointTableRules
): RuntimeDeckPointRevalidation {
  const pointTotal = [...deck.mainDeck, ...deck.energyDeck].reduce(
    (sum, card) => sum + getCardPoint(card.cardCode, current),
    0
  );
  const facts: DeckPointValidationFacts = {
    pointTableVersion: current.version,
    pointTotal,
    pointLimit: current.pointLimit,
  };
  return {
    valid: pointTotal <= current.pointLimit,
    changed:
      previous.pointTableVersion !== facts.pointTableVersion ||
      previous.pointTotal !== facts.pointTotal ||
      previous.pointLimit !== facts.pointLimit,
    facts,
  };
}
