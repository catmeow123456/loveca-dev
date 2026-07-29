import { describe, expect, it } from 'vitest';
import { AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX } from '../../src/server/ai-battle/phase-zero-baseline';
import { runHeadlessPlayout } from '../../src/server/ai-battle/headless-playout';
import {
  createAiBattlePhaseOneCPlayoutInput,
  persistHeadlessFailureArtifact,
  summarizeHeadlessFailure,
} from '../helpers/ai-battle-phase-one-c';

const FULL_REGRESSION_SEED_COUNT = 32;
const cases = AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.flatMap((scenario) =>
  Array.from({ length: FULL_REGRESSION_SEED_COUNT }, (_, seedIndex) => ({
    scenario,
    seedIndex,
  }))
);

describe.skipIf(process.env.AI_BATTLE_PHASE_ONE_C_FULL !== '1')(
  'AI battle Phase 1C dedicated 256-game regression',
  () => {
    it.each(cases)(
      'completes $scenario.scenarioId with deterministic seed $seedIndex',
      ({ scenario, seedIndex }) => {
        const result = runHeadlessPlayout(
          createAiBattlePhaseOneCPlayoutInput(
            scenario,
            `full:${scenario.scenarioId}:${String(seedIndex)}`
          )
        );

        if (!result.ok) {
          persistHeadlessFailureArtifact(
            result,
            `${scenario.scenarioId}-seed-${String(seedIndex)}`
          );
        }
        expect(result.ok, result.ok ? undefined : summarizeHeadlessFailure(result)).toBe(true);
      },
      35_000
    );
  }
);
