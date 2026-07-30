import {
  AI_DECISION_COMMAND_ADAPTER_VERSION,
  AI_DECISION_CONTRACT_SCHEMA_VERSION,
} from '../../application/ai-decisions/index.js';
import { AI_EXPLAINABLE_DECISION_POLICY_VERSION } from './explainable-decision-policy.js';
import {
  AI_BATTLE_PHASE_ZERO_BASELINE_VERSION,
  AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS,
  AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX,
} from './phase-zero-baseline.js';
import { AI_STRATEGY_CONTEXT_SCHEMA_VERSION } from './strategy-context.js';
import { AI_CONTROLLED_PREGAME_RESULT_SCHEMA_VERSION } from './system-pregame.js';
import {
  AI_PHASE_THREE_LIFECYCLE_POLICY_VERSION,
  AI_PHASE_THREE_PREGAME_POLICY_VERSION,
} from './system-participant.js';

export const AI_BATTLE_PHASE_THREE_BASELINE_VERSION = 'ai-battle.phase-three/v1' as const;
export const AI_BATTLE_PHASE_THREE_CERTIFICATION_STATUS = 'COMPLETE' as const;

export const AI_BATTLE_PHASE_THREE_COMPONENT_STATUS = {
  unloginableSystemIdentity: 'IMPLEMENTED_VERSIONED_BINDING',
  certifiedDeckBinding: 'IMPLEMENTED_CANONICAL_YAML_CONTENT_HASH',
  phaseZeroVersionBinding: 'IMPLEMENTED_IN_SYSTEM_IDENTITY',
  serverInternalCommandAuthority: 'IMPLEMENTED_NON_FORGEABLE',
  systemSchedulingScope: 'AI_BATTLE_BOUND_SYSTEM_ONLY',
  formalOnlineRuntime: 'IMPLEMENTED_SHARED_MATCH_SERVICE',
  phaseTwoStrategyRuntime: 'IMPLEMENTED_EXPLAINABLE_NO_LLM',
  strategyMatchRecord: 'IMPLEMENTED_ATOMIC_COMMAND_FRAME',
  controlledEntry: 'IMPLEMENTED_ADMIN_ONLY',
  controlledPregame: 'IMPLEMENTED_SHARED_RPS_RESOLVER',
  standaloneAiChatAuthorization: 'IMPLEMENTED_MATCH_PARTICIPANT',
  entryConcurrency: 'SERIALIZED_PER_HUMAN',
  standardPlayerSnapshot: 'IMPLEMENTED_SHARED_GAME_BOARD_INPUT',
  refreshPolicy: 'RESUME_SAME_MATCH',
  undoPolicy: 'DISABLED',
  freeModePolicy: 'DISABLED_RULES_ONLY',
  restartPolicy: 'SYSTEM_AUTO_ACCEPTS_NEW_MATCH',
  leavePolicy: 'HUMAN_SURRENDER_AND_REMOVE_RUNTIME',
  primaryStrategyLiveness: 'AUTHORITY_PROGRESS_WATCHDOG_ONLY',
  fallbackLiveness: 'CONSERVATIVE_LIMITS_ONLY_AFTER_DEGRADATION',
  abnormalTerminalPolicy: 'PRIMARY_MACHINE_FAILURE_OR_FALLBACK_LIVENESS',
  certifiedRuntimeVerification: 'EIGHT_MATCHUP_UNITS_NATURAL_TERMINAL_ZERO_REJECTIONS',
} as const;

export const AI_BATTLE_PHASE_THREE_COMPONENT_VERSIONS = {
  identity: 'ai-battle.system-participant-identity/v1',
  phaseZeroBaseline: AI_BATTLE_PHASE_ZERO_BASELINE_VERSION,
  phaseZeroRulesEngine: AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS.rulesEngineVersion,
  phaseZeroAuthoritativeCardData:
    AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS.authoritativeCardDataVersion,
  decisionContract: AI_DECISION_CONTRACT_SCHEMA_VERSION,
  commandAdapter: AI_DECISION_COMMAND_ADAPTER_VERSION,
  entry: 'ai-battle.phase-three-entry/v1',
  pregamePolicy: AI_PHASE_THREE_PREGAME_POLICY_VERSION,
  controlledPregameResult: AI_CONTROLLED_PREGAME_RESULT_SCHEMA_VERSION,
  lifecyclePolicy: AI_PHASE_THREE_LIFECYCLE_POLICY_VERSION,
  strategyContext: AI_STRATEGY_CONTEXT_SCHEMA_VERSION,
  explainablePolicy: AI_EXPLAINABLE_DECISION_POLICY_VERSION,
  strategyDecisionRecord: 'ai-battle.strategy-decision-record/v2',
  databaseMigration: 'drizzle/0010_simple_the_leader.sql',
} as const;

export const AI_BATTLE_PHASE_THREE_RUNTIME_BOUNDARY = {
  productEntryPublic: false,
  controlledEntryAuthorization: 'AUTHENTICATED_ADMIN',
  systemLoginAllowed: false,
  systemCommandPublicRouteAllowed: false,
  matchMode: 'ONLINE',
  originKind: 'AI_BATTLE',
  manualOperationMode: 'RULES',
  sharedAuthorityRuntime: 'OnlineMatchService',
  sharedPlayerProjection: 'OnlineMatchSnapshot',
  sharedFrontendSurface: ['GameBoard', 'PlayerArea'],
  controlledPregame: 'SERVER_DETERMINISTIC_SHARED_RPS_RULE',
  transientOnlineRoomCreated: false,
  standaloneAiChatAuthorization: 'ONLINE_MATCH_PARTICIPANT',
  ordinaryOnlineChatStillRequiresRoomPresence: true,
  entrySerializationScope: 'HUMAN_USER_ID',
  llmDependency: false,
  chatIncludedInStrategyContext: false,
  strategyRecordVisibility: 'RESTRICTED_JSONB_NOT_IN_PLAYER_REPLAY_PROJECTION',
  machineSchedulingRequires: ['ONLINE', 'AI_BATTLE', 'CERTIFIED_SYSTEM_BINDING'],
  primaryStrategyConservativeLimitAccounting: false,
} as const;

export const AI_BATTLE_PHASE_THREE_ACCEPTANCE = {
  certifiedMatchupUnitCount: AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.length,
  formalRuntimeGamesPerUnit: 1,
  expectedFormalRuntimeGames: 8,
  focusedCommand:
    'pnpm exec vitest run tests/unit/ai-battle-system-pregame.test.ts tests/integration/ai-battle-phase-three-formal-runtime.test.ts',
  httpRouteCommand: 'pnpm exec vitest run tests/integration/online-route-error-handling.test.ts',
  databaseRecorderUnitCommand: 'pnpm exec vitest run tests/unit/match-recorder-service.test.ts',
  typecheckCommand: 'pnpm typecheck:all',
  certifiedDeckFixtureSource: 'VERSION_CONTROLLED_YAML_PLUS_CANONICAL_CONTENT_HASH',
  expectedConcurrentActiveMatchesPerHuman: 1,
  expectedAuthorityRejectionsForSelectedMachineCommands: 0,
  expectedAbnormalSystemTerminals: 0,
  expectedFallbackActivations: 0,
  expectedHiddenInformationLeaks: 0,
} as const;

export const AI_BATTLE_PHASE_THREE_GATE_EVIDENCE = [
  {
    gate: 'UNLOGINABLE_IDENTITY_AND_EXACT_DECK_BINDING',
    behaviorTest: 'tests/integration/ai-battle-phase-three-formal-runtime.test.ts',
    evidenceAnchor:
      "it('binds an unloginable identity, blocks forged SYSTEM commands, and records strategy atomically'",
  },
  {
    gate: 'PHASE_ZERO_CANONICAL_DECK_CONTENT_IDENTITY',
    behaviorTest: 'tests/unit/ai-battle-certified-deck-loader.test.ts',
    evidenceAnchor: "it('loads both version-controlled decks after canonical content verification'",
  },
  {
    gate: 'SYSTEM_SCHEDULING_REQUIRES_FORMAL_AI_BATTLE_BINDING',
    behaviorTest: 'tests/integration/ai-battle-phase-one-b-machine-scheduler.test.ts',
    evidenceAnchor: "it('rejects ONLINE SYSTEM seats outside a certified AI_BATTLE binding'",
  },
  {
    gate: 'PRIMARY_STRATEGY_EXCLUDED_FROM_FALLBACK_LIMITS',
    behaviorTest: 'tests/integration/ai-battle-phase-one-b-machine-scheduler.test.ts',
    evidenceAnchor:
      "it('does not apply conservative fallback bounds to the formal primary strategy'",
  },
  {
    gate: 'CONTROLLED_PREGAME_SHARED_RPS_AND_REQUESTED_SEAT',
    behaviorTest: 'tests/unit/ai-battle-system-pregame.test.ts',
    evidenceAnchor: "it('resolves both requested SYSTEM seats through the shared RPS rule'",
  },
  {
    gate: 'NON_FORGEABLE_INTERNAL_SYSTEM_AUTHORITY',
    behaviorTest: 'tests/integration/ai-battle-phase-three-formal-runtime.test.ts',
    evidenceAnchor:
      "it('binds an unloginable identity, blocks forged SYSTEM commands, and records strategy atomically'",
  },
  {
    gate: 'ATOMIC_STRATEGY_AND_COMMAND_RECORD_FRAME',
    behaviorTest: 'tests/integration/ai-battle-phase-three-formal-runtime.test.ts',
    evidenceAnchor:
      "it('binds an unloginable identity, blocks forged SYSTEM commands, and records strategy atomically'",
  },
  {
    gate: 'DATABASE_JSONB_SYSTEM_IDENTITY_AND_STRATEGY_RECORD',
    behaviorTest: 'tests/unit/match-recorder-service.test.ts',
    evidenceAnchor: "it('原子写入 SYSTEM 身份快照与受限 AI 策略记录 JSONB'",
  },
  {
    gate: 'STANDALONE_AI_MATCH_CHAT_AUTHORIZATION',
    behaviorTest: 'tests/integration/online-route-error-handling.test.ts',
    evidenceAnchor: "it('无真人房间的受控 AI 对局仍按 match participant 授权聊天读写'",
  },
  {
    gate: 'PER_HUMAN_ENTRY_SERIALIZATION',
    behaviorTest: 'tests/integration/ai-battle-phase-three-formal-runtime.test.ts',
    evidenceAnchor:
      "it('serializes concurrent create requests per human and leaves exactly one controlled match'",
  },
  {
    gate: 'REFRESH_UNDO_FREE_MODE_RESTART_AND_LEAVE_POLICY',
    behaviorTest: 'tests/integration/ai-battle-phase-three-formal-runtime.test.ts',
    evidenceAnchor:
      "it('resumes on refresh, rejects undo/free mode, auto-accepts restart, and treats leave as surrender'",
  },
  {
    gate: 'EIGHT_UNIT_FORMAL_ONLINE_RUNTIME_COMPLETION',
    behaviorTest: 'tests/integration/ai-battle-phase-three-formal-runtime.test.ts',
    evidenceAnchor:
      "it('completes all eight certified matchup/turn-order units through the real online runtime'",
  },
  {
    gate: 'ABNORMAL_SYSTEM_TERMINALS_AND_NOTICE_DISPLAY',
    behaviorTest: 'tests/integration/ai-battle-phase-one-b-machine-scheduler.test.ts',
    evidenceAnchor: "it('ends the match explicitly when a SYSTEM decision window is unsupported'",
  },
] as const;
