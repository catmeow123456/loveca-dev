import type { AiBattlePhaseZeroDeckKey } from './phase-zero-baseline.js';
import type { DeckConfig } from '../../application/game-service.js';
import type { AiObservation } from './ai-observation.js';
import { buildAiDeckKnowledge, type AiDeckKnowledge } from './deck-knowledge.js';
import {
  AI_COMPACT_RULES,
  getAiDeckPlaybook,
  type AiCompactRules,
  type AiDeckPlaybook,
} from './strategy-knowledge.js';
import {
  AI_SELECTED_HISTORY_SCHEMA_VERSION,
  type AiSelectedHistoryItem,
} from './strategy-history.js';

export const AI_STRATEGY_CONTEXT_SCHEMA_VERSION = 'ai-battle.strategy-context/v3' as const;

export interface AiStrategyContext {
  readonly schemaVersion: typeof AI_STRATEGY_CONTEXT_SCHEMA_VERSION;
  readonly knowledge: {
    readonly compactRules: AiCompactRules;
    readonly deckPlaybook: AiDeckPlaybook;
    readonly deck: AiDeckKnowledge;
  };
  readonly observation: AiObservation;
  readonly selectedHistory: readonly AiSelectedHistoryItem[];
}

export interface BuildAiStrategyContextInput {
  readonly observation: AiObservation;
  readonly deckKey: AiBattlePhaseZeroDeckKey;
  readonly deckContentHash: string;
  readonly deck: DeckConfig;
  readonly selectedHistory?: readonly AiSelectedHistoryItem[];
}

/**
 * Builds the Phase 2 strategy-only envelope.
 *
 * The caller must supply an already-redacted observation and the exact
 * certified deck content identity. Chat, display names, match runtime records,
 * private events, and authority state are not accepted inputs.
 */
export function buildAiStrategyContext(input: BuildAiStrategyContextInput): AiStrategyContext {
  const playbook = getAiDeckPlaybook(input.deckKey);
  if (playbook.certifiedContentHash !== input.deckContentHash) {
    throw new Error(
      `AI playbook content hash mismatch for ${input.deckKey}: expected ${playbook.certifiedContentHash}`
    );
  }
  const selectedHistory = input.selectedHistory ?? [];
  for (const item of selectedHistory) {
    if (item.schemaVersion !== AI_SELECTED_HISTORY_SCHEMA_VERSION) {
      throw new Error('AI selected history requires the current schema version');
    }
    if (item.authorityRevision > input.observation.authorityRevision) {
      throw new Error('AI selected history cannot contain a future authority revision');
    }
    const expectedSource =
      item.category === 'VISIBLE_STATE_CHANGE'
        ? 'VISIBLE_PROJECTION_DELTA'
        : 'AUTHORITY_ACCEPTED_SELECTION';
    if (item.source !== expectedSource) {
      throw new Error('AI selected history source does not match its factual category');
    }
  }

  return {
    schemaVersion: AI_STRATEGY_CONTEXT_SCHEMA_VERSION,
    knowledge: {
      compactRules: AI_COMPACT_RULES,
      deckPlaybook: playbook,
      deck: buildAiDeckKnowledge({
        deckKey: input.deckKey,
        contentHash: input.deckContentHash,
        deck: input.deck,
      }),
    },
    observation: input.observation,
    selectedHistory: selectedHistory.map((item) => ({
      ...item,
      cards: item.cards.map((card) => ({ ...card })),
    })),
  };
}
