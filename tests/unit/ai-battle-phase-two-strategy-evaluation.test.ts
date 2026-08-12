import { describe, expect, it } from 'vitest';
import {
  AI_DECISION_COMMAND_ADAPTER_VERSION,
  AI_DECISION_CONTRACT_SCHEMA_VERSION,
} from '../../src/application/ai-decisions';
import type { AiStrategyEvaluationGame } from '../../src/server/ai-battle/strategy-evaluation';
import {
  AI_STRATEGY_EVALUATION_SCHEMA_VERSION,
  summarizeAiStrategyEvaluation,
} from '../../src/server/ai-battle/strategy-evaluation';

function game(
  completed: boolean,
  reasons: readonly {
    readonly reasonCode: string;
    readonly tier: 'RULE_FORCED' | 'DETERMINISTIC' | 'HEURISTIC';
  }[]
): AiStrategyEvaluationGame {
  return {
    scenarioId: completed ? 'completed' : 'failed',
    seed: 'seed',
    completed,
    endReason: completed ? ('SUCCESS_LIVE' as never) : null,
    winnerSeat: completed ? 'FIRST' : null,
    winnerDeckKey: completed ? 'MUSE_STARTER' : null,
    turnCount: completed ? 7 : 2,
    decisionCount: reasons.length,
    historyContextDecisionCount: Math.max(0, reasons.length - 1),
    records: reasons.map((reason, index) => ({
      schemaVersion: 'ai-battle.strategy-decision-record/v4',
      decisionAudit: {
        schemaVersion: 'ai-battle.strategy-decision-audit/v3',
        contextSchemaVersion: 'ai-battle.strategy-context/v4',
        observationSchemaVersion: 'ai-battle.observation/v3',
        decisionContractVersion: AI_DECISION_CONTRACT_SCHEMA_VERSION,
        commandAdapterVersion: AI_DECISION_COMMAND_ADAPTER_VERSION,
        contextSha256: `sha256:${'0'.repeat(64)}`,
        authorityRevision: index,
        seat: 'FIRST',
        decisionKind: 'MAIN_PHASE',
        compactRulesVersion: 'ai-battle.compact-rules/v4',
        playbookVersion: 'ai-battle.playbook.muse-starter/v2',
        policyVersion: 'ai-battle.explainable-policy/v1',
        tier: reason.tier,
        reasonCode: reason.reasonCode,
        summary: 'summary',
        factRefs: [],
        tradeoff: null,
        nextPlan: null,
        consideredIds: [],
        selection: { kind: 'CONFIRM_PHASE' },
      },
      modelInvocation: null,
      contractIdentity: {
        decisionIdSha256: `sha256:${'1'.repeat(64)}`,
        windowSignatureSha256: `sha256:${'2'.repeat(64)}`,
      },
      execution: {
        status: completed ? 'ACCEPTED' : 'REJECTED',
        commandType: 'TEST',
        authorityRevisionAfter: index + 1,
        errorCode: completed ? null : 'TEST_FAILURE',
      },
      ruleRandomFactRefs: [],
    })),
  };
}

describe('AI battle Phase 2 strategy evaluation summary', () => {
  it('aggregates completion, audit, history, and quality metrics', () => {
    const summary = summarizeAiStrategyEvaluation([
      game(true, [
        { reasonCode: 'PLAY_HIGHEST_RANKED_MEMBER', tier: 'HEURISTIC' },
        { reasonCode: 'SET_HIGHEST_RANKED_LIVE', tier: 'DETERMINISTIC' },
        { reasonCode: 'SELECT_HIGHEST_SCORE_SUCCESS_LIVE', tier: 'RULE_FORCED' },
      ]),
      game(false, [{ reasonCode: 'CONFIRM_PHASE_PROGRESS', tier: 'RULE_FORCED' }]),
    ]);

    expect(summary).toMatchObject({
      schemaVersion: AI_STRATEGY_EVALUATION_SCHEMA_VERSION,
      gameCount: 2,
      completedGameCount: 1,
      completionRate: 0.5,
      failedGameCount: 1,
      totalDecisionCount: 4,
      acceptedDecisionCount: 3,
      rejectedDecisionCount: 1,
      historyContextDecisionCount: 2,
      historyContextCoverageRate: 0.5,
      tierCounts: { RULE_FORCED: 2, DETERMINISTIC: 1, HEURISTIC: 1 },
      quality: {
        stageDevelopmentGames: 1,
        liveSetGames: 1,
        successLiveSelectionGames: 1,
        gamesWithAllStrategyTiers: 1,
        averageTurns: 4.5,
        averageDecisions: 2,
        maxTurns: 7,
        maxDecisions: 3,
        winsByDeck: { MUSE_STARTER: 1, GREEN_HASUNOSORA_B6: 0 },
      },
    });
  });
});
