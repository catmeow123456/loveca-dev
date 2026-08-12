import type { AiObservation } from '../../../src/server/ai-battle/ai-observation';
import {
  AI_BATTLE_PHASE_ZERO_DECKS,
  type AiBattlePhaseZeroDeckKey,
} from '../../../src/server/ai-battle/phase-zero-baseline';
import type { AiStrategicObjectiveSet } from '../../../src/server/ai-battle/strategic-objectives';
import {
  buildAiStrategyContext,
  type AiStrategyContext,
} from '../../../src/server/ai-battle/strategy-context';
import type { AiSelectedHistoryItem } from '../../../src/server/ai-battle/strategy-history';
import { loadAiBattlePhaseZeroRuntimeDeck } from '../ai-battle-phase-zero-decks';

export function createAiStrategyContextFixture(input: {
  readonly observation: AiObservation;
  readonly deckKey?: AiBattlePhaseZeroDeckKey;
  readonly strategicObjectives?: AiStrategicObjectiveSet;
  readonly selectedHistory?: readonly AiSelectedHistoryItem[];
}): AiStrategyContext {
  const deckKey = input.deckKey ?? 'GREEN_HASUNOSORA_B6';
  return buildAiStrategyContext({
    observation: input.observation,
    deckKey,
    deckContentHash: AI_BATTLE_PHASE_ZERO_DECKS[deckKey].contentHash,
    deck: loadAiBattlePhaseZeroRuntimeDeck(deckKey),
    strategicObjectives: input.strategicObjectives,
    selectedHistory: input.selectedHistory,
  });
}
