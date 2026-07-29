import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiBattlePhaseZeroMatchupScenario } from '../../src/server/ai-battle/phase-zero-baseline';
import type { AiPhaseTwoPlayoutInput } from '../../src/server/ai-battle/phase-two-playout';
import type {
  AiStrategyEvaluationGame,
  AiStrategyEvaluationSummary,
} from '../../src/server/ai-battle/strategy-evaluation';
import { loadAiBattlePhaseZeroRuntimeDeck } from './ai-battle-phase-zero-decks';

export const AI_BATTLE_PHASE_TWO_REGRESSION_ARTIFACT_SCHEMA_VERSION =
  'ai-battle.phase-two-regression-artifact/v1' as const;

export function createAiBattlePhaseTwoPlayoutInput(
  scenario: AiBattlePhaseZeroMatchupScenario,
  seed: string
): AiPhaseTwoPlayoutInput {
  const firstDeckKey =
    scenario.aiTurnOrder === 'FIRST' ? scenario.aiDeckKey : scenario.playerDeckKey;
  const secondDeckKey =
    scenario.aiTurnOrder === 'SECOND' ? scenario.aiDeckKey : scenario.playerDeckKey;
  return {
    scenarioId: scenario.scenarioId,
    seed,
    firstPlayer: {
      playerId: 'phase-two-first',
      playerName: 'Phase 2 First',
      deckKey: firstDeckKey,
      deck: loadAiBattlePhaseZeroRuntimeDeck(firstDeckKey),
    },
    secondPlayer: {
      playerId: 'phase-two-second',
      playerName: 'Phase 2 Second',
      deckKey: secondDeckKey,
      deck: loadAiBattlePhaseZeroRuntimeDeck(secondDeckKey),
    },
  };
}

export function persistAiBattlePhaseTwoRegressionArtifact(input: {
  readonly games: readonly AiStrategyEvaluationGame[];
  readonly summary: AiStrategyEvaluationSummary;
}): void {
  const artifactDirectory = process.env.AI_BATTLE_PHASE_TWO_ARTIFACT_DIR;
  if (!artifactDirectory) return;
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(
    join(artifactDirectory, 'phase-two-strategy-evaluation.json'),
    `${JSON.stringify(
      {
        schemaVersion: AI_BATTLE_PHASE_TWO_REGRESSION_ARTIFACT_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        summary: input.summary,
        games: input.games,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}
