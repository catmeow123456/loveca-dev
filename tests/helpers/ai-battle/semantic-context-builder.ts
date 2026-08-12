import type { AiObservation } from '../../../src/server/ai-battle/ai-observation';
import {
  buildAiSemanticDecisionContext,
  type AiSemanticDecisionContext,
} from '../../../src/server/ai-battle/semantic-context';
import type { AiStrategicObjectiveSet } from '../../../src/server/ai-battle/strategic-objectives';
import type { AiSelectedHistoryItem } from '../../../src/server/ai-battle/strategy-history';

export function createAiSemanticDecisionContextFixture(input: {
  readonly observation: AiObservation;
  readonly strategicObjectives?: AiStrategicObjectiveSet;
  readonly selectedHistory?: readonly AiSelectedHistoryItem[];
}): AiSemanticDecisionContext {
  return buildAiSemanticDecisionContext({
    observation: input.observation,
    strategicObjectives: input.strategicObjectives,
    selectedHistory: input.selectedHistory ?? [],
  });
}
