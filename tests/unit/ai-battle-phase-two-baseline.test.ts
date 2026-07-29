import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AI_BATTLE_PHASE_TWO_ACCEPTANCE,
  AI_BATTLE_PHASE_TWO_BASELINE_VERSION,
  AI_BATTLE_PHASE_TWO_CERTIFICATION_STATUS,
  AI_BATTLE_PHASE_TWO_COMPONENT_STATUS,
  AI_BATTLE_PHASE_TWO_COMPONENT_VERSIONS,
  AI_BATTLE_PHASE_TWO_GATE_EVIDENCE,
  AI_BATTLE_PHASE_TWO_RUNTIME_BOUNDARY,
} from '../../src/server/ai-battle/phase-two-baseline';

describe('AI battle Phase 2 completed baseline', () => {
  it('freezes the completed strategy context, audit, history, and evaluation slices', () => {
    expect(AI_BATTLE_PHASE_TWO_BASELINE_VERSION).toBe('ai-battle.phase-two/v2');
    expect(AI_BATTLE_PHASE_TWO_CERTIFICATION_STATUS).toBe('COMPLETE');
    expect(AI_BATTLE_PHASE_TWO_COMPONENT_STATUS).toEqual({
      playerViewObservation: 'IMPLEMENTED',
      redactedDecisionSummary: 'IMPLEMENTED',
      compactRules: 'IMPLEMENTED',
      fixedDeckPlaybooks: 'IMPLEMENTED',
      strategyContextEnvelope: 'IMPLEMENTED',
      deterministicStrategyRouter: 'IMPLEMENTED',
      heuristicPolicy: 'IMPLEMENTED',
      decisionAudit: 'PERSISTED_RESTRICTED_TEST_ARTIFACT',
      selectedHistory: 'IMPLEMENTED_BOUNDED_VISIBLE',
      strategyEvaluation: 'IMPLEMENTED',
      representativePlayout: 'EIGHT_BY_EIGHT_REGRESSION',
    });
    expect(AI_BATTLE_PHASE_TWO_COMPONENT_VERSIONS).toEqual({
      observation: 'ai-battle.observation/v1',
      decisionContract: 'ai-battle.decision-contract/v1',
      commandAdapter: 'ai-battle.decision-command-adapter/v1',
      compactRules: 'ai-battle.compact-rules/v1',
      museStarterPlaybook: 'ai-battle.playbook.muse-starter/v1',
      greenHasunosoraB6Playbook: 'ai-battle.playbook.green-hasunosora-b6/v1',
      strategyContext: 'ai-battle.strategy-context/v1',
      selectedHistory: 'ai-battle.selected-history/v2',
      explainablePolicy: 'ai-battle.explainable-policy/v1',
      strategyDecisionAudit: 'ai-battle.strategy-decision-audit/v2',
      strategyDecisionRecord: 'ai-battle.strategy-decision-record/v2',
      strategyEvaluation: 'ai-battle.strategy-evaluation/v1',
      phaseTwoPlayout: 'ai-battle.phase-two-playout/v1',
    });
  });

  it('freezes the no-authority/no-chat/no-LLM runtime boundary', () => {
    expect(AI_BATTLE_PHASE_TWO_RUNTIME_BOUNDARY).toEqual({
      observationInputs: ['PLAYER_VIEW_STATE', 'TYPED_DECISION_CONTRACT'],
      authorityStateReadableByObservation: false,
      matchRuntimeReadableByObservation: false,
      chatIncluded: false,
      playerControlledTextIncluded: false,
      authorityObjectIdsIncluded: false,
      hiddenCardIdentityIncluded: false,
      llmDependency: false,
      productSystemSeatEnabled: false,
      strategyInput: 'STRATEGY_CONTEXT_ONLY',
      decisionAuditPersistence: 'RESTRICTED_TEST_ARTIFACT',
      productMatchRecordIntegration: false,
    });
  });

  it('freezes the eight-by-eight regression, persistence, and quality floor', () => {
    expect(AI_BATTLE_PHASE_TWO_ACCEPTANCE).toEqual({
      matchupUnitCount: 8,
      smokeSeedsPerMatchup: 1,
      regressionSeedsPerMatchup: 8,
      regressionGameCount: 64,
      smokeCommand:
        'pnpm exec vitest run tests/integration/ai-battle-phase-two-explainable-playout.test.ts',
      regressionCommand: 'pnpm test:ai-battle:phase-two',
      dedicatedRegressionImplemented: true,
      decisionAuditPersistenceImplemented: true,
      qualityThresholds: {
        completionRate: 1,
        rejectedDecisionCount: 0,
        historyContextCoverageRateGreaterThan: 0.9,
        stageDevelopmentGameRate: 1,
        liveSetGameRate: 1,
        successLiveSelectionGameRate: 1,
        allStrategyTiersGameRate: 1,
      },
    });
  });

  it('keeps the observation adapter isolated from authority and match runtime imports', () => {
    const source = readFileSync('src/server/ai-battle/ai-observation.ts', 'utf8');
    expect(source).not.toContain("from '../../domain/");
    expect(source).not.toContain("from '../services/");
    expect(source).not.toContain('projectPlayerViewState');
  });

  it('keeps executable evidence anchors for every implemented slice', () => {
    for (const row of AI_BATTLE_PHASE_TWO_GATE_EVIDENCE) {
      expect(
        readFileSync(row.behaviorTest, 'utf8'),
        `${row.gate} evidence anchor is stale`
      ).toContain(row.evidenceAnchor);
    }
  });
});
