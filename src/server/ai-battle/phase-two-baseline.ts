import {
  AI_DECISION_COMMAND_ADAPTER_VERSION,
  AI_DECISION_CONTRACT_SCHEMA_VERSION,
} from '../../application/ai-decisions/index.js';
import { AI_OBSERVATION_SCHEMA_VERSION } from './ai-observation.js';
import { AI_DECK_KNOWLEDGE_SCHEMA_VERSION } from './deck-knowledge.js';
import { AI_EXPLAINABLE_DECISION_POLICY_VERSION } from './explainable-decision-policy.js';
import { AI_PHASE_TWO_PLAYOUT_SCHEMA_VERSION } from './phase-two-playout.js';
import { AI_STRATEGY_CONTEXT_SCHEMA_VERSION } from './strategy-context.js';
import {
  AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
  AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
} from './strategy-decision-audit.js';
import { AI_STRATEGY_EVALUATION_SCHEMA_VERSION } from './strategy-evaluation.js';
import { AI_SELECTED_HISTORY_SCHEMA_VERSION } from './strategy-history.js';
import { AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION } from './strategic-objectives.js';
import {
  AI_COMPACT_RULES_VERSION,
  AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION,
  AI_MUSE_STARTER_PLAYBOOK_VERSION,
} from './strategy-knowledge.js';

export const AI_BATTLE_PHASE_TWO_BASELINE_VERSION = 'ai-battle.phase-two/v5' as const;
export const AI_BATTLE_PHASE_TWO_CERTIFICATION_STATUS = 'COMPLETE' as const;

export const AI_BATTLE_PHASE_TWO_COMPONENT_STATUS = {
  playerViewObservation: 'IMPLEMENTED',
  redactedDecisionSummary: 'IMPLEMENTED',
  compactRules: 'IMPLEMENTED',
  exactDeckKnowledge: 'IMPLEMENTED_COLLAPSED_COUNTS_WITHOUT_ORDER',
  fixedDeckPlaybooks: 'IMPLEMENTED',
  strategyContextEnvelope: 'IMPLEMENTED',
  strategicObjectives: 'IMPLEMENTED_SERVER_DERIVED_CROSS_WINDOW',
  deterministicStrategyRouter: 'IMPLEMENTED',
  heuristicPolicy: 'IMPLEMENTED',
  decisionAudit: 'PERSISTED_RESTRICTED_TEST_ARTIFACT',
  selectedHistory: 'IMPLEMENTED_BOUNDED_VISIBLE',
  strategyEvaluation: 'IMPLEMENTED',
  representativePlayout: 'EIGHT_BY_EIGHT_REGRESSION',
} as const;

export const AI_BATTLE_PHASE_TWO_COMPONENT_VERSIONS = {
  observation: AI_OBSERVATION_SCHEMA_VERSION,
  decisionContract: AI_DECISION_CONTRACT_SCHEMA_VERSION,
  commandAdapter: AI_DECISION_COMMAND_ADAPTER_VERSION,
  compactRules: AI_COMPACT_RULES_VERSION,
  deckKnowledge: AI_DECK_KNOWLEDGE_SCHEMA_VERSION,
  museStarterPlaybook: AI_MUSE_STARTER_PLAYBOOK_VERSION,
  greenHasunosoraB6Playbook: AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION,
  strategyContext: AI_STRATEGY_CONTEXT_SCHEMA_VERSION,
  strategicObjectives: AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION,
  selectedHistory: AI_SELECTED_HISTORY_SCHEMA_VERSION,
  explainablePolicy: AI_EXPLAINABLE_DECISION_POLICY_VERSION,
  strategyDecisionAudit: AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
  strategyDecisionRecord: AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
  strategyEvaluation: AI_STRATEGY_EVALUATION_SCHEMA_VERSION,
  phaseTwoPlayout: AI_PHASE_TWO_PLAYOUT_SCHEMA_VERSION,
} as const;

export const AI_BATTLE_PHASE_TWO_RUNTIME_BOUNDARY = {
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
} as const;

export const AI_BATTLE_PHASE_TWO_ACCEPTANCE = {
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
} as const;

export const AI_BATTLE_PHASE_TWO_GATE_EVIDENCE = [
  {
    gate: 'ALLOWLIST_PLAYER_VIEW_OBSERVATION',
    behaviorTest: 'tests/unit/ai-battle-phase-two-observation.test.ts',
    evidenceAnchor:
      "it('builds a representative allowlist snapshot without authority or hidden identifiers'",
  },
  {
    gate: 'BLIND_CANDIDATE_REDACTION',
    behaviorTest: 'tests/unit/ai-battle-phase-two-observation.test.ts',
    evidenceAnchor:
      "it('keeps blind active-effect candidates anonymous while retaining legal constraints'",
  },
  {
    gate: 'SEAT_REVISION_AND_RULES_MODE_BINDING',
    behaviorTest: 'tests/unit/ai-battle-phase-two-observation.test.ts',
    evidenceAnchor: "it('rejects seat, revision, and operation-mode mismatches at the boundary'",
  },
  {
    gate: 'OBSERVATION_TYPE_ISOLATION',
    behaviorTest: 'tests/unit/ai-battle-phase-two-baseline.test.ts',
    evidenceAnchor:
      "it('keeps the observation adapter isolated from authority and match runtime imports'",
  },
  {
    gate: 'CERTIFIED_COMPACT_RULES_AND_PLAYBOOKS',
    behaviorTest: 'tests/unit/ai-battle-phase-two-strategy-context.test.ts',
    evidenceAnchor:
      "it('binds both playbooks to certified content hashes and cards actually in each deck'",
  },
  {
    gate: 'MECHANICAL_AND_HEURISTIC_POLICY_ROUTING',
    behaviorTest: 'tests/unit/ai-battle-phase-two-explainable-policy.test.ts',
    evidenceAnchor:
      "it('keeps exact payments mechanical but routes multi-candidate mandatory selections to the model'",
  },
  {
    gate: 'REDACTED_STRATEGY_DECISION_AUDIT_FACT',
    behaviorTest: 'tests/unit/ai-battle-phase-two-strategy-audit.test.ts',
    evidenceAnchor:
      "it('records versions, redacted context hash, tier, reason, and structured selection'",
  },
  {
    gate: 'BOUNDED_SELECTED_VISIBLE_HISTORY',
    behaviorTest: 'tests/unit/ai-battle-phase-two-strategy-history.test.ts',
    evidenceAnchor: "it('records accepted strategic decisions without contract-local identifiers'",
  },
  {
    gate: 'PERSISTED_RESTRICTED_STRATEGY_AUDIT_ARTIFACT',
    behaviorTest: 'tests/unit/ai-battle-phase-two-artifact.test.ts',
    evidenceAnchor: "it('persists the versioned audit summary without product or user fields'",
  },
  {
    gate: 'HASHED_STRATEGY_EXECUTION_RECORD',
    behaviorTest: 'tests/unit/ai-battle-phase-two-strategy-audit.test.ts',
    evidenceAnchor: "it('persists a redacted execution record with hashed contract identity'",
  },
  {
    gate: 'STRATEGY_QUALITY_EVALUATION',
    behaviorTest: 'tests/unit/ai-battle-phase-two-strategy-evaluation.test.ts',
    evidenceAnchor: "it('aggregates completion, audit, history, and quality metrics'",
  },
  {
    gate: 'EIGHT_UNIT_EXPLAINABLE_PLAYOUT_SMOKE',
    behaviorTest: 'tests/integration/ai-battle-phase-two-explainable-playout.test.ts',
    evidenceAnchor: 'it(`finishes ${scenario.scenarioId} through redacted contexts`',
  },
  {
    gate: 'EIGHT_BY_EIGHT_EXPLAINABLE_PLAYOUT_REGRESSION',
    behaviorTest: 'tests/integration/ai-battle-phase-two-full-regression.test.ts',
    evidenceAnchor:
      "it.skipIf(!FULL_REGRESSION_ENABLED)(\n    'completes eight matchup units across eight deterministic seeds with quality metrics'",
  },
] as const;
