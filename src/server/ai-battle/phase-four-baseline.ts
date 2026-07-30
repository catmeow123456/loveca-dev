import {
  AI_MODEL_INVOCATION_POLICY_VERSION,
  AI_MODEL_DECISION_POLICY_VERSION,
} from './model-governance.js';
import { AI_MODEL_ID, AI_MODEL_PROVIDER_PROFILE_VERSION } from './model-provider.js';
import {
  AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION,
  AI_MODEL_REQUEST_ENVELOPE_SCHEMA_VERSION,
  AI_MODEL_SYSTEM_PROMPT_VERSION,
} from './model-protocol.js';
import { AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION } from './strategy-decision-audit.js';
import { AI_SYSTEM_IDENTITY_SCHEMA_VERSION } from './system-participant.js';

export const AI_BATTLE_PHASE_FOUR_BASELINE_VERSION = 'ai-battle.phase-four/v1' as const;
export const AI_BATTLE_PHASE_FOUR_STATUS = 'COMPLETE' as const;

export const AI_BATTLE_PHASE_FOUR_COMPONENT_STATUS = {
  providerNeutralRequestEnvelope: 'IMPLEMENTED_VERSIONED_ALLOWLIST_CONTEXT_ONLY',
  strictStructuredOutput: 'IMPLEMENTED_JSON_SCHEMA_NO_UNKNOWN_FIELDS',
  authoritySelectionValidation: 'IMPLEMENTED_REUSES_TYPED_CONTRACT_VALIDATOR',
  promptInjectionBoundary: 'IMPLEMENTED_CONTEXT_DATA_ONLY_AND_FORBIDDEN_KEYS',
  repairEnvelope: 'IMPLEMENTED_ONE_BOUNDED_MACHINE_CODE_ONLY',
  requestHash: 'IMPLEMENTED_CANONICAL_SHA256',
  serverModelProvider: 'IMPLEMENTED_FIXED_ALIBABA_DASHSCOPE_PROFILE',
  asyncDecisionLifecycle: 'IMPLEMENTED_PROVIDER_WAIT_OUTSIDE_MATCH_LOCK_WITH_REVALIDATION',
  timeoutRetryCancellation: 'IMPLEMENTED_12S_TWO_ATTEMPTS_AND_MATCH_CANCELLATION',
  invocationAudit: 'IMPLEMENTED_SANITIZED_ATOMIC_DECISION_FACTS',
  budgetAndRateLimits: 'IMPLEMENTED_CONCURRENCY_RATE_REQUEST_TOKEN_AND_COST_LIMITS',
  fallbackSwitchNotice: 'IMPLEMENTED_ONE_NOTICE_AND_WHOLE_MATCH_CONSERVATIVE_SWITCH',
  promptModelVersionMatchBinding: 'IMPLEMENTED_SYSTEM_IDENTITY_V2',
  playerControlledEntry: 'IMPLEMENTED_AUTHENTICATED_FIXED_DECK_ENTRY',
  endToEndModelPlayout: 'IMPLEMENTED_FULL_RUNTIME_PLAYOUT_FIXED_REAL_SCENARIOS_AND_BROWSER_HANDOFF',
} as const;

export const AI_BATTLE_PHASE_FOUR_COMPONENT_VERSIONS = {
  baseline: AI_BATTLE_PHASE_FOUR_BASELINE_VERSION,
  requestEnvelope: AI_MODEL_REQUEST_ENVELOPE_SCHEMA_VERSION,
  systemPrompt: AI_MODEL_SYSTEM_PROMPT_VERSION,
  decisionOutput: AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION,
  providerProfile: AI_MODEL_PROVIDER_PROFILE_VERSION,
  model: AI_MODEL_ID,
  invocationPolicy: AI_MODEL_INVOCATION_POLICY_VERSION,
  decisionPolicy: AI_MODEL_DECISION_POLICY_VERSION,
  strategyDecisionRecord: AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
  systemIdentity: AI_SYSTEM_IDENTITY_SCHEMA_VERSION,
  publicEntry: 'ai-battle.phase-four-entry/v1',
} as const;

export const AI_BATTLE_PHASE_FOUR_RUNTIME_BOUNDARY = {
  modelCallsEnabledWhenServerConfigured: true,
  modelCredentialRequiredForNewPublicMatches: true,
  providerCredentialsStoredInRepository: false,
  modelCanReadAuthorityState: false,
  modelInputSource: 'PHASE_TWO_STRATEGY_CONTEXT_ONLY',
  modelCanReturnCommands: false,
  modelSelectionRequiresAuthorityContractValidation: true,
  rawInvalidOutputReflectedIntoRepairPrompt: false,
  providerErrorReflectedIntoRepairPrompt: false,
  maximumProtocolAttempts: 2,
  providerWaitHoldsMatchCriticalSection: false,
  mechanicalDecisionLayersRemainActive: true,
  confirmedModelFailureSwitchesWholeMatchToConservativePolicy: true,
  productEntryAuthenticatedPublic: true,
  publicTableAiReplacementEnabled: false,
} as const;

export const AI_BATTLE_PHASE_FOUR_CURRENT_EVIDENCE = {
  protocolTest: 'tests/unit/ai-battle-phase-four-model-protocol.test.ts',
  providerGovernanceTest: 'tests/unit/ai-battle-phase-four-model-runtime.test.ts',
  runtimeIntegrationTest: 'tests/integration/ai-battle-phase-four-model-runtime.test.ts',
  realProviderEvaluationTest: 'tests/integration/ai-battle-phase-four-real-model.test.ts',
  routeTest: 'tests/integration/online-route-error-handling.test.ts',
  browserArtifact: 'output/playwright/phase4-ai-battle-shared-board.png',
  typecheckCommand: 'pnpm typecheck:all',
  expectedHiddenAuthorityIdentifiers: 0,
  expectedUnknownOutputFieldsAccepted: 0,
  expectedRawRepairReflections: 0,
  expectedAuthorityCommandRejections: 0,
  fixedRealProviderScenarios: 4,
} as const;

export const AI_BATTLE_PHASE_FOUR_NEXT_SLICE = [] as const;
