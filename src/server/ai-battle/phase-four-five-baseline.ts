import {
  AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION,
  AI_MODEL_REQUEST_ENVELOPE_SCHEMA_VERSION,
  AI_MODEL_STRATEGY_CONTEXT_SCHEMA_VERSION,
  AI_MODEL_SYSTEM_PROMPT_VERSION,
} from './model-protocol.js';
import { AI_BATTLE_PROTOCOL_MANIFEST_REVISION } from '../../shared/ai-battle-protocol-versions.js';
import { AI_BATTLE_DEBUG_TRACE_SCHEMA_VERSION } from './debug-trace.js';
import { AI_OBSERVATION_SCHEMA_VERSION } from './ai-observation.js';
import { AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION } from './semantic-context.js';
import {
  AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
  AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
} from './strategy-decision-audit.js';
import { AI_SELECTED_HISTORY_SCHEMA_VERSION } from './strategy-history.js';
import { AI_STRATEGY_CONTEXT_SCHEMA_VERSION } from './strategy-context.js';
import { AI_SYSTEM_IDENTITY_SCHEMA_VERSION } from './system-participant.js';
import { AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION } from './strategic-objectives.js';

export const AI_BATTLE_PHASE_FOUR_FIVE_BASELINE_VERSION = 'ai-battle.phase-four-five/v5' as const;
export const AI_BATTLE_PHASE_FOUR_FIVE_STATUS = 'IN_PROGRESS' as const;

export const AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_STATUS = {
  semanticCurrentState: 'IMPLEMENTED_FROM_REDACTED_OBSERVATION',
  completeDeckKnowledgeInSystemPrompt:
    'IMPLEMENTED_EXACT_COUNT_CARD_CODE_NAME_TEXT_COST_BLADE_HEART_AND_LIVE_REQUIREMENTS',
  modelStrategyDirectives: 'REMOVED_FROM_MODEL_PROMPT_RULES_AND_DECK_FACTS_ONLY',
  optionalTacticalChoices: 'IMPLEMENTED_MODEL_DECIDES_CONSERVATIVE_WITNESS_ONLY_FOR_FALLBACK',
  semanticActionConsequences:
    'IMPLEMENTED_MEMBER_PLAY_ACTIVATED_SELF_SACRIFICE_LIVE_SET_EFFECT_SOURCE_OPTIONAL_COST_VISIBLE_TARGET_FORMATION_GROUP_AND_LIVE_SETTLEMENT',
  plainLanguageStrategyKnowledge:
    'REPLACED_BY_FACT_DRIVEN_CHINESE_RULES_DECK_STATE_CHOICES_AND_CONSEQUENCES',
  semanticFactReferences: 'IMPLEMENTED_SERVER_DERIVED_FROM_ACCEPTED_SELECTION',
  semanticConclusionConsistency: 'PENDING_BEYOND_SERVER_DERIVED_FACT_COVERAGE',
  modelConclusionFields: 'IMPLEMENTED_OPTIONAL_NON_BLOCKING_TRADEOFF_AND_NEXT_PLAN',
  crossWindowStrategicObjectives:
    'IMPLEMENTED_SERVER_DERIVED_VISIBLE_STATE_ONLY_MODEL_FREE_TEXT_EXCLUDED',
  selectedHistoryPurity: 'IMPLEMENTED_AUTHORITY_ACCEPTED_SELECTION_AND_VISIBLE_DELTA_ONLY',
  relayAbilityOwnershipRegression: 'IMPLEMENTED_FIXED_SEMANTIC_FIXTURE',
  administratorContextInspector: 'IMPLEMENTED_ADMIN_DEVELOPMENT_IN_MEMORY',
  broaderEffectSemanticRegressions:
    'IMPLEMENTED_SOURCE_COST_TARGET_HISTORY_FORMATION_GROUP_LIVE_SETTLEMENT_AND_STAGE_RESOURCE_SLICES',
  centralizedProtocolVersionManifest:
    'IMPLEMENTED_SHARED_SINGLE_SOURCE_WITH_COMPATIBILITY_AND_LITERAL_GOVERNANCE',
  realProviderSemanticEvaluation: 'PENDING',
  humanSampleReview: 'PENDING',
} as const;

export const AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_VERSIONS = {
  baseline: AI_BATTLE_PHASE_FOUR_FIVE_BASELINE_VERSION,
  protocolManifestRevision: AI_BATTLE_PROTOCOL_MANIFEST_REVISION,
  observation: AI_OBSERVATION_SCHEMA_VERSION,
  strategyContext: AI_STRATEGY_CONTEXT_SCHEMA_VERSION,
  strategicObjectives: AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION,
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
  semanticBuilderInputs: ['AI_OBSERVATION', 'STRATEGIC_OBJECTIVES', 'SELECTED_HISTORY'],
  rawObservationSentToModel: false,
  rawSelectedHistorySentToModel: false,
  hiddenIdentitySentToModel: false,
  shuffledDeckOrderSentToModel: false,
  exactDeckCompositionSentAsSystemKnowledge: true,
  modelFreeTextStoredAsHistoryFact: false,
  modelFreeTextStoredAsStrategicObjective: false,
  factReferencesGeneratedByServerFromSelection: true,
  authoritySelectionValidationStillRequired: true,
  serverStrategyValueVetoImplemented: false,
  administratorContextInspectorDevelopmentOnly: true,
  administratorContextInspectorAdminOnly: true,
  administratorContextInspectorOwnedAiBattleOnly: true,
  administratorContextInspectorPersisted: false,
  rawInvalidProviderOutputRetainedForInspection: false,
} as const;

export const AI_BATTLE_PHASE_FOUR_FIVE_CURRENT_EVIDENCE = {
  protocolVersionGovernanceTest: 'tests/unit/ai-battle-protocol-versions.test.ts',
  observationBoundaryTest: 'tests/unit/ai-battle-phase-two-observation.test.ts',
  semanticRegressionTest: 'tests/unit/ai-battle-phase-four-five-semantic-context.test.ts',
  modelProtocolTest: 'tests/unit/ai-battle-phase-four-model-protocol.test.ts',
  historyPurityTest: 'tests/unit/ai-battle-phase-two-strategy-history.test.ts',
  runtimeIntegrationTest: 'tests/integration/ai-battle-phase-four-model-runtime.test.ts',
} as const;

export const AI_BATTLE_PHASE_FOUR_FIVE_NEXT_SLICE = [
  '建立分层 builder、通用 fake model 与少量真实出站契约测试',
  '扩展服务端从合法 selection 派生的能力归属、站位与资源后果事实审计覆盖',
  '真实 provider v6 语义选择评测与真人抽样复盘',
] as const;
