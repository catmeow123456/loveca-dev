import { describe, expect, it } from 'vitest';
import {
  AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS,
  AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX,
} from '../../src/server/ai-battle/phase-zero-baseline';
import { runAiPhaseTwoExplainablePlayout } from '../../src/server/ai-battle/phase-two-playout';
import { summarizeAiStrategyEvaluation } from '../../src/server/ai-battle/strategy-evaluation';
import { createAiBattlePhaseTwoPlayoutInput } from '../helpers/ai-battle-phase-two';

describe('AI battle Phase 2 explainable policy playout smoke', () => {
  const games = AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.map((scenario) =>
    runAiPhaseTwoExplainablePlayout(
      createAiBattlePhaseTwoPlayoutInput(scenario, `smoke:${scenario.scenarioId}`)
    )
  );

  for (const scenario of AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX) {
    it(`finishes ${scenario.scenarioId} through redacted contexts`, () => {
      const game = games.find((candidate) => candidate.scenarioId === scenario.scenarioId)!;
      expect(game.completed, game.failureReason).toBe(true);
      expect(game.endReason).not.toBeNull();
      expect(game.decisionCount).toBeGreaterThan(0);
      expect(game.historyContextDecisionCount).toBeGreaterThan(0);
      expect(game.turnCount).toBeLessThanOrEqual(
        AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.maxTurnsPerGame
      );
      expect(game.decisionCount).toBeLessThan(
        AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.maxDecisionsPerGame
      );
      expect(new Set(game.records.map((record) => record.decisionAudit.tier))).toEqual(
        new Set(['RULE_FORCED', 'DETERMINISTIC', 'HEURISTIC'])
      );
      expect(game.records.every((record) => record.execution.status === 'ACCEPTED')).toBe(true);
      expect(
        game.records.every((record) =>
          /^sha256:[a-f0-9]{64}$/.test(record.contractIdentity.decisionIdSha256)
        )
      ).toBe(true);
    }, 30_000);
  }

  it('meets the frozen smoke-level strategy quality floor', () => {
    const summary = summarizeAiStrategyEvaluation(games);
    expect(summary).toMatchObject({
      gameCount: 8,
      completedGameCount: 8,
      completionRate: 1,
      failedGameCount: 0,
      rejectedDecisionCount: 0,
      quality: {
        stageDevelopmentGames: 8,
        liveSetGames: 8,
        successLiveSelectionGames: 8,
        gamesWithAllStrategyTiers: 8,
      },
    });
    expect(summary.historyContextCoverageRate).toBeGreaterThan(0.9);
  });
});
