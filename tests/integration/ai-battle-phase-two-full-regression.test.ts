import { describe, expect, it } from 'vitest';
import { AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX } from '../../src/server/ai-battle/phase-zero-baseline';
import { runAiPhaseTwoExplainablePlayout } from '../../src/server/ai-battle/phase-two-playout';
import { summarizeAiStrategyEvaluation } from '../../src/server/ai-battle/strategy-evaluation';
import {
  createAiBattlePhaseTwoPlayoutInput,
  persistAiBattlePhaseTwoRegressionArtifact,
} from '../helpers/ai-battle-phase-two';

const FULL_REGRESSION_ENABLED = process.env.AI_BATTLE_PHASE_TWO_FULL === '1';
const SEEDS_PER_MATCHUP = 8;

describe('AI battle Phase 2 dedicated multi-seed regression', () => {
  it.skipIf(!FULL_REGRESSION_ENABLED)(
    'completes eight matchup units across eight deterministic seeds with quality metrics',
    () => {
      const games = AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.flatMap((scenario) =>
        Array.from({ length: SEEDS_PER_MATCHUP }, (_, index) =>
          runAiPhaseTwoExplainablePlayout(
            createAiBattlePhaseTwoPlayoutInput(
              scenario,
              `regression:${scenario.scenarioId}:${String(index)}`
            )
          )
        )
      );
      const summary = summarizeAiStrategyEvaluation(games);
      persistAiBattlePhaseTwoRegressionArtifact({ games, summary });

      expect(
        games.filter((game) => !game.completed),
        JSON.stringify(games.filter((game) => !game.completed))
      ).toEqual([]);
      expect(summary.gameCount).toBe(64);
      expect(summary.completionRate).toBe(1);
      expect(summary.rejectedDecisionCount).toBe(0);
      expect(summary.quality.stageDevelopmentGames).toBe(64);
      expect(summary.quality.liveSetGames).toBe(64);
      expect(summary.quality.successLiveSelectionGames).toBe(64);
      expect(summary.quality.gamesWithAllStrategyTiers).toBe(64);
      expect(summary.historyContextCoverageRate).toBeGreaterThan(0.9);
      const persistedAuditPayload = JSON.stringify({ games, summary });
      expect(persistedAuditPayload).not.toContain('obj_');
      expect(persistedAuditPayload).not.toContain('matchId');
      expect(persistedAuditPayload).not.toContain('playerName');
      expect(persistedAuditPayload).not.toContain('authorityState');
      expect(persistedAuditPayload).not.toContain('chat');
    },
    600_000
  );
});
