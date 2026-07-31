import {
  AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION,
  AI_MODEL_REQUEST_ENVELOPE_SCHEMA_VERSION,
  AI_MODEL_STRATEGY_CONTEXT_SCHEMA_VERSION,
  AI_MODEL_SYSTEM_PROMPT_VERSION,
} from './model-protocol.js';
import { AI_BATTLE_DEBUG_TRACE_SCHEMA_VERSION } from './debug-trace.js';
import { AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION } from './semantic-context.js';
import {
  AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
  AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
} from './strategy-decision-audit.js';
import { AI_SELECTED_HISTORY_SCHEMA_VERSION } from './strategy-history.js';
import { AI_SYSTEM_IDENTITY_SCHEMA_VERSION } from './system-participant.js';

export const AI_BATTLE_PHASE_FOUR_FIVE_BASELINE_VERSION = 'ai-battle.phase-four-five/v1' as const;
export const AI_BATTLE_PHASE_FOUR_FIVE_STATUS = 'IN_PROGRESS' as const;

export const AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_STATUS = {
  semanticCurrentState: 'IMPLEMENTED_FROM_REDACTED_OBSERVATION',
  semanticActionConsequences: 'IMPLEMENTED_FIRST_SLICE_MAIN_MEMBER_PLAY_AND_LIVE_SET',
  semanticFactReferences: 'IMPLEMENTED_EXISTENCE_AND_SELECTED_CHOICE_REQUIREMENTS',
  modelConclusionFields: 'IMPLEMENTED_TRADEOFF_AND_NEXT_PLAN_LOW_TRUST',
  selectedHistoryPurity: 'IMPLEMENTED_AUTHORITY_ACCEPTED_SELECTION_AND_VISIBLE_DELTA_ONLY',
  relayAbilityOwnershipRegression: 'IMPLEMENTED_FIXED_SEMANTIC_FIXTURE',
  administratorContextInspector: 'IMPLEMENTED_ADMIN_DEVELOPMENT_IN_MEMORY',
  broaderEffectSemanticRegressions: 'PENDING',
  realProviderSemanticEvaluation: 'PENDING',
  humanSampleReview: 'PENDING',
} as const;

export const AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_VERSIONS = {
  baseline: AI_BATTLE_PHASE_FOUR_FIVE_BASELINE_VERSION,
  requestEnvelope: AI_MODEL_REQUEST_ENVELOPE_SCHEMA_VERSION,
  modelStrategyContext: AI_MODEL_STRATEGY_CONTEXT_SCHEMA_VERSION,
  semanticDecisionContext: AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION,
  systemPrompt: AI_MODEL_SYSTEM_PROMPT_VERSION,
  decisionOutput: AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION,
  selectedHistory: AI_SELECTED_HISTORY_SCHEMA_VERSION,
  decisionAudit: AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
  decisionRecord: AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
  systemIdentity: AI_SYSTEM_IDENTITY_SCHEMA_VERSION,
  administratorContextInspector: AI_BATTLE_DEBUG_TRACE_SCHEMA_VERSION,
} as const;

export const AI_BATTLE_PHASE_FOUR_FIVE_RUNTIME_BOUNDARY = {
  authorityStateReadableBySemanticBuilder: false,
  semanticBuilderInputs: ['AI_OBSERVATION', 'SELECTED_HISTORY'],
  rawObservationSentToModel: false,
  rawSelectedHistorySentToModel: false,
  hiddenIdentitySentToModel: false,
  modelFreeTextStoredAsHistoryFact: false,
  factReferencesCheckedBeforeAuthoritySubmission: true,
  authoritySelectionValidationStillRequired: true,
  serverStrategyValueVetoImplemented: false,
  administratorContextInspectorDevelopmentOnly: true,
  administratorContextInspectorAdminOnly: true,
  administratorContextInspectorOwnedAiBattleOnly: true,
  administratorContextInspectorPersisted: false,
  rawInvalidProviderOutputRetainedForInspection: false,
} as const;

export const AI_BATTLE_PHASE_FOUR_FIVE_CURRENT_EVIDENCE = {
  semanticRegressionTest: 'tests/unit/ai-battle-phase-four-five-semantic-context.test.ts',
  modelProtocolTest: 'tests/unit/ai-battle-phase-four-model-protocol.test.ts',
  historyPurityTest: 'tests/unit/ai-battle-phase-two-strategy-history.test.ts',
  runtimeIntegrationTest: 'tests/integration/ai-battle-phase-four-model-runtime.test.ts',
} as const;

export const AI_BATTLE_PHASE_FOUR_FIVE_NEXT_SLICE = [
  '卡效来源、可选费用、目标选择与更多 LIVE 设置语义回归',
  '真实 provider 语义事实引用评测与真人抽样复盘',
] as const;
