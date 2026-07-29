import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX } from '../../src/server/ai-battle/phase-zero-baseline';
import {
  AI_BATTLE_PHASE_ONE_C_ACCEPTANCE,
  AI_BATTLE_PHASE_ONE_C_BASELINE_VERSION,
  AI_BATTLE_PHASE_ONE_C_CERTIFICATION_STATUS,
  AI_BATTLE_PHASE_ONE_C_COMPONENT_VERSIONS,
  AI_BATTLE_PHASE_ONE_C_FAILURE_REGRESSION_CORPUS,
  AI_BATTLE_PHASE_ONE_C_GATE_EVIDENCE,
  AI_BATTLE_PHASE_ONE_C_RUNTIME_BOUNDARY,
} from '../../src/server/ai-battle/phase-one-c-baseline';

describe('AI battle Phase 1C certified baseline', () => {
  it('freezes the reproducible random and bounded headless runtime boundary', () => {
    expect(AI_BATTLE_PHASE_ONE_C_BASELINE_VERSION).toBe('ai-battle.phase-one-c/v1');
    expect(AI_BATTLE_PHASE_ONE_C_CERTIFICATION_STATUS).toBe('COMPLETE');
    expect(AI_BATTLE_PHASE_ONE_C_COMPONENT_VERSIONS).toEqual({
      ruleRandomSource: 'loveca.rule-random-source/v1',
      ruleRandomFact: 'loveca.rule-random-fact/v1',
      randomLegalPolicy: 'ai-battle.random-legal-policy/v1',
      randomLegalDecisionFact: 'ai-battle.random-legal-decision-fact/v1',
      headlessPlayout: 'ai-battle.headless-playout/v1',
      headlessFailureArtifact: 'ai-battle.headless-failure-artifact/v1',
      certifiedWindowMatrix: 'ai-battle.phase-one-a-window-matrix/v2',
    });
    expect(AI_BATTLE_PHASE_ONE_C_RUNTIME_BOUNDARY).toEqual({
      productionRandomSource: 'SECURE',
      testRandomSource: 'SEEDED_OR_STRICT_REPLAY',
      policyInput: 'TYPED_DECISION_CONTRACT_ONLY',
      headlessAuthority: 'GAME_SESSION_COMMANDS_ONLY',
      llmDependency: false,
      productSystemSeatEnabled: false,
      aiSpecificRuleDsl: false,
    });
  });

  it('freezes the eight-by-thirty-two acceptance matrix and watchdog limits', () => {
    expect(AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX).toHaveLength(8);
    expect(AI_BATTLE_PHASE_ONE_C_ACCEPTANCE).toMatchObject({
      matchupUnitCount: 8,
      pullRequestSmokeSeedsPerMatchup: 1,
      expectedPullRequestSmokeGames: 8,
      seedsPerMatchup: 32,
      expectedMinimumGames: 256,
      maxTurnsPerGame: 80,
      maxDecisionsPerGame: 5_000,
      maxRepairRetriesPerWindow: 2,
      maxDecisionsWithoutAuthorityProgress: 128,
      maxWallClockMsPerGame: 30_000,
    });
  });

  it('keeps discovered failure seeds in the fixed smoke corpus', () => {
    const smokeSeeds = new Set(
      AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.map(({ scenarioId }) => `smoke:${scenarioId}`)
    );
    for (const regression of AI_BATTLE_PHASE_ONE_C_FAILURE_REGRESSION_CORPUS) {
      expect(smokeSeeds.has(regression.seed), regression.regressionId).toBe(true);
      expect(regression.seed).toBe(`smoke:${regression.scenarioId}`);
    }
  });

  it('keeps every completion claim attached to executable evidence', () => {
    for (const row of AI_BATTLE_PHASE_ONE_C_GATE_EVIDENCE) {
      expect(
        readFileSync(row.behaviorTest, 'utf8'),
        `${row.gate} evidence anchor is stale`
      ).toContain(row.evidenceAnchor);
    }
  });
});
