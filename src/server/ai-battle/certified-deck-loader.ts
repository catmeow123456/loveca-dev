import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as yaml from 'yaml';
import type { DeckConfig as RuntimeDeckConfig } from '../../application/game-service.js';
import { DeckConfigSchema, DeckLoader } from '../../domain/card-data/deck-loader.js';
import type { CardDataRegistry } from '../../domain/card-data/loader.js';
import { createDeckContentIdentity } from '../services/deck-content-hash.js';
import { getPublishedCardRegistry } from '../services/card-registry-service.js';
import {
  AI_BATTLE_PHASE_ZERO_BASELINE_VERSION,
  AI_BATTLE_PHASE_ZERO_DECKS,
  type AiBattlePhaseZeroDeckKey,
} from './phase-zero-baseline.js';

export interface LoadedCertifiedAiDeck {
  readonly deckKey: AiBattlePhaseZeroDeckKey;
  readonly contentHash: string;
  readonly phaseZeroBaselineVersion: typeof AI_BATTLE_PHASE_ZERO_BASELINE_VERSION;
  readonly runtimeDeck: RuntimeDeckConfig;
}

const cachedDecks = new Map<AiBattlePhaseZeroDeckKey, Promise<LoadedCertifiedAiDeck>>();

/**
 * Loads a Phase 0 certified deck from the version-controlled source and
 * rejects any content drift before resolving card data from the published
 * authority registry.
 */
export function loadCertifiedAiDeck(
  deckKey: AiBattlePhaseZeroDeckKey
): Promise<LoadedCertifiedAiDeck> {
  const cached = cachedDecks.get(deckKey);
  if (cached) return cached;
  const pending = loadCertifiedAiDeckUncached(deckKey).catch((error) => {
    cachedDecks.delete(deckKey);
    throw error;
  });
  cachedDecks.set(deckKey, pending);
  return pending;
}

async function loadCertifiedAiDeckUncached(
  deckKey: AiBattlePhaseZeroDeckKey
): Promise<LoadedCertifiedAiDeck> {
  return loadCertifiedAiDeckFromRegistry(deckKey, await getPublishedCardRegistry());
}

export async function loadCertifiedAiDeckFromRegistry(
  deckKey: AiBattlePhaseZeroDeckKey,
  registry: CardDataRegistry
): Promise<LoadedCertifiedAiDeck> {
  const certification = AI_BATTLE_PHASE_ZERO_DECKS[deckKey];
  const raw = await readFile(resolve(certification.sourceAssetPath), 'utf8');
  const canonicalConfig = DeckConfigSchema.parse(yaml.parse(raw));
  const identity = createDeckContentIdentity(canonicalConfig);
  if (
    identity.canonicalSchemaVersion !== certification.canonicalSchemaVersion ||
    identity.contentHash !== certification.contentHash
  ) {
    throw new Error(
      `Certified AI deck content drifted for ${deckKey}: expected ${certification.contentHash}, received ${identity.contentHash}`
    );
  }

  const loaded = new DeckLoader(registry).loadFromConfig(canonicalConfig);
  if (!loaded.success || !loaded.deck) {
    throw new Error(`Failed to load certified AI deck ${deckKey}: ${loaded.errors.join('; ')}`);
  }
  const runtimeDeck = {
    mainDeck: loaded.deck.mainDeck,
    energyDeck: loaded.deck.energyDeck,
  };
  return {
    deckKey,
    contentHash: certification.contentHash,
    phaseZeroBaselineVersion: AI_BATTLE_PHASE_ZERO_BASELINE_VERSION,
    runtimeDeck,
  };
}
