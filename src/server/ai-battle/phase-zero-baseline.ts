import type { DeckContentIdentity } from '../services/deck-content-hash.js';

export const AI_BATTLE_PHASE_ZERO_BASELINE_VERSION = 'ai-battle.phase-zero/v1' as const;
export const AI_BATTLE_PHASE_ZERO_CERTIFICATION_STATUS = 'COMPLETE' as const;

export const AI_BATTLE_PHASE_ZERO_CERTIFICATION_SOURCES = {
  authoritativeCardData: 'llocg_db/json/cards.json',
  cardEffectLedger: 'docs/card-effect-reuse-audit/existing_module_map.md',
  abilityEvidence: 'src/server/ai-battle/phase-zero-ability-evidence.ts',
  cardEffectRegistrationTest: 'tests/unit/ai-battle-phase-zero-card-effect-registration.test.ts',
  rulesMatrixTest: 'tests/integration/ai-battle-phase-zero-rules-baseline.test.ts',
} as const;

export const AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS = {
  rulesEngineVersion: '3.9.6',
  authoritativeCardDataVersion:
    'sha256:4b7f3abc93ec10ba86a2bf0090c9b3475a0846b52075728d545f55a168ef353d',
  matchupMatrixVersion: 'ai-battle.phase-zero-matchups/v1',
  validationConfigVersion: 'ai-battle.phase-zero-validation/v1',
  abilityEvidenceVersion: 'ai-battle.phase-zero-ability-evidence/v1',
  decisionContractVersion: 'NOT_IMPLEMENTED_PHASE_ZERO',
} as const;

export const AI_BATTLE_SYSTEM_PARTICIPANT = {
  participantKey: 'loveca-ai-standard-v1',
  participantKind: 'SYSTEM',
  loginAllowed: false,
} as const;

export const AI_BATTLE_PHASE_ZERO_DECKS = {
  MUSE_STARTER: {
    deckKey: 'MUSE_STARTER',
    sourceAssetPath: 'assets/decks/缪预组.yaml',
    canonicalSchemaVersion: 'loveca.deck-content/v1',
    hashAlgorithm: 'sha256',
    contentHash: 'sha256:e81261ca02cfff6a7b8b010c3c0738d2127cbd6d782ed91568ac825d883d4095',
  },
  GREEN_HASUNOSORA_B6: {
    deckKey: 'GREEN_HASUNOSORA_B6',
    sourceAssetPath: 'assets/decks/绿莲-6弹ver.yaml',
    canonicalSchemaVersion: 'loveca.deck-content/v1',
    hashAlgorithm: 'sha256',
    contentHash: 'sha256:6faaac83a8205280eb1066d44f524da9838e5fcb3023f431d629e4979895f118',
  },
} as const satisfies Record<
  string,
  DeckContentIdentity & {
    readonly deckKey: string;
    readonly sourceAssetPath: string;
  }
>;

export type AiBattlePhaseZeroDeckKey = keyof typeof AI_BATTLE_PHASE_ZERO_DECKS;

export const AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX = [
  matchup('muse-vs-muse-ai-first', 'MUSE_STARTER', 'MUSE_STARTER', 'FIRST'),
  matchup('muse-vs-muse-ai-second', 'MUSE_STARTER', 'MUSE_STARTER', 'SECOND'),
  matchup('muse-vs-green-ai-first', 'MUSE_STARTER', 'GREEN_HASUNOSORA_B6', 'FIRST'),
  matchup('muse-vs-green-ai-second', 'MUSE_STARTER', 'GREEN_HASUNOSORA_B6', 'SECOND'),
  matchup('green-vs-muse-ai-first', 'GREEN_HASUNOSORA_B6', 'MUSE_STARTER', 'FIRST'),
  matchup('green-vs-muse-ai-second', 'GREEN_HASUNOSORA_B6', 'MUSE_STARTER', 'SECOND'),
  matchup('green-vs-green-ai-first', 'GREEN_HASUNOSORA_B6', 'GREEN_HASUNOSORA_B6', 'FIRST'),
  matchup('green-vs-green-ai-second', 'GREEN_HASUNOSORA_B6', 'GREEN_HASUNOSORA_B6', 'SECOND'),
] as const;

export type AiBattlePhaseZeroMatchupScenario = (typeof AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX)[number];

export const AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS = {
  pullRequestSmokeSeedsPerMatchup: 1,
  expectedPullRequestSmokeGames: 8,
  seedsPerMatchup: 32,
  expectedMinimumGames: 256,
  fullRegressionTier: 'DEDICATED_CI',
  maxTurnsPerGame: 80,
  maxDecisionsPerGame: 5_000,
  maxRepairRetriesPerWindow: 2,
  maxDecisionsWithoutAuthorityProgress: 128,
  maxWallClockMsPerGame: 30_000,
  toleratedIllegalCommandsAccepted: 0,
  toleratedExpiredLeasesAccepted: 0,
  toleratedUnhandledErrors: 0,
  toleratedWatchdogOrWallClockFailures: 0,
} as const;

export const AI_BATTLE_CONSERVATIVE_LIVENESS_LIMITS = {
  maxAiTurnsWithoutRuleProgress: 3,
  maxConservativeDecisions: 256,
  maxDegradedDurationMs: 5 * 60 * 1_000,
  terminalPolicy: 'SYSTEM_CONCEDE',
} as const;

/**
 * Phase 1B 实现主阶段保守策略时必须遵守的确定性总序。
 *
 * projectedHandIndex / slotOrder 均来自当次 typed contract；候选 ID 只作为
 * 同一 lease 内最后的稳定决胜键，不得使用隐藏实体 ID。
 */
export const AI_BATTLE_CONSERVATIVE_MAIN_ACTION_ORDER = {
  actionPriority: ['PLAY_AFFORDABLE_MEMBER', 'END_MAIN_PHASE'],
  memberCandidateOrder: ['PAYABLE_COST_ASC', 'PROJECTED_HAND_INDEX_ASC', 'CANDIDATE_ID_ASC'],
  slotOrder: ['LEFT', 'CENTER', 'RIGHT'],
  activatedAbilityPolicy: 'DECLINE_AS_OPTIONAL',
} as const;

export const AI_BATTLE_CONSERVATIVE_LIVE_CANDIDATE_ORDER = [
  'PROJECTED_HAND_INDEX_ASC',
  'CANDIDATE_ID_ASC',
] as const;

export const AI_BATTLE_CONSERVATIVE_SUCCESS_LIVE_CANDIDATE_ORDER = [
  'PROJECTED_LIVE_ZONE_INDEX_ASC',
  'CANDIDATE_ID_ASC',
] as const;

/**
 * 活性检查区分两种进展：
 *
 * - authorityStateProgress：供单窗口/连续决策 watchdog 使用；忽略 revision、
 *   日志、时间戳等审计噪音，但包含窗口与 active-effect step 的真实变化。
 * - strategicRuleProgress：供“连续 AI 回合无规则进展”使用；只统计资源、
 *   区域、成员状态、LIVE/成功区、牌库、分数或终局变化，单纯结束回合不算。
 */
export const AI_BATTLE_RULE_PROGRESS_POLICY = {
  version: 'ai-battle.rule-progress/v1',
  authorityStateProgressIncludes: [
    'TURN_PHASE_AND_SUBPHASE',
    'WAITING_PLAYER_AND_WINDOW_IDENTITY',
    'PENDING_ABILITY_IDENTITY',
    'ACTIVE_EFFECT_STEP_IDENTITY',
    'ZONE_CARD_IDENTITIES_AND_ORDER',
    'CARD_ORIENTATION_AND_FACE',
    'ENERGY_AND_COST_RESOURCES',
    'LIVE_MODIFIERS_AND_RESTRICTIONS',
    'SCORE_SUCCESS_LIVE_AND_TERMINAL_STATE',
  ],
  authorityStateProgressExcludes: [
    'AUTHORITY_REVISION_ONLY',
    'EVENT_ACTION_AND_AUDIT_LOG_APPEND_ONLY',
    'TIMESTAMP_AND_DEADLINE_COUNTDOWN_ONLY',
  ],
  strategicRuleProgressIncludes: [
    'ZONE_CARD_IDENTITIES_AND_ORDER',
    'CARD_ORIENTATION',
    'ENERGY_AND_COST_RESOURCES',
    'LIVE_MODIFIERS_AND_RESTRICTIONS',
    'DECK_OR_WAITING_ROOM_SIZE',
    'SCORE_SUCCESS_LIVE_AND_TERMINAL_STATE',
  ],
  strategicRuleProgressExcludes: [
    'TURN_PHASE_OR_ACTIVE_PLAYER_ONLY',
    'PURE_CONFIRMATION_ONLY',
    'EMPTY_MULLIGAN_OR_LIVE_SET_ONLY',
    'AUTHORITY_REVISION_OR_LOG_ONLY',
  ],
} as const;

/**
 * Phase 0 only freezes the conservative choices. The typed contracts and the
 * executable strategy that consume this matrix belong to Phase 1A/1B.
 */
export const AI_BATTLE_CONSERVATIVE_WINDOW_POLICY = [
  policy('MULLIGAN', 'NO_CHANGE', 'Submit an empty mulligan selection.'),
  policy(
    'MAIN_ACTION',
    'STABLE_MINIMUM_PROGRESS',
    'Use AI_BATTLE_CONSERVATIVE_MAIN_ACTION_ORDER; end the phase only when no affordable member play exists.'
  ),
  policy(
    'LIVE_SET',
    'STABLE_LEGAL_LIVE',
    'Use AI_BATTLE_CONSERVATIVE_LIVE_CANDIDATE_ORDER; confirm empty only when no legal LIVE exists.'
  ),
  policy('OPTIONAL_EFFECT', 'DECLINE', 'Do not activate optional effects or optional costs.'),
  policy('PURE_CONFIRMATION', 'CONFIRM', 'Confirm and continue without changing the choice.'),
  policy(
    'MANDATORY_SELECTION',
    'CONTRACT_WITNESS',
    'Use the stable legal witness supplied by the typed decision contract.'
  ),
  policy(
    'MANDATORY_ORDERING',
    'CONTRACT_WITNESS',
    'Use the stable legal ordering supplied by the typed decision contract.'
  ),
  policy(
    'MANDATORY_NUMBER_OR_POSITION',
    'CONTRACT_WITNESS',
    'Use the stable legal number or position supplied by the typed decision contract.'
  ),
  policy('SCORE_CONFIRMATION', 'AUTHORITY_VALUE', 'Submit the authority-computed score.'),
  policy(
    'SUCCESS_LIVE_SELECTION',
    'STABLE_LEGAL_CANDIDATE',
    'Use AI_BATTLE_CONSERVATIVE_SUCCESS_LIVE_CANDIDATE_ORDER.'
  ),
  policy(
    'NO_PROGRESS_LIMIT',
    'SYSTEM_CONCEDE',
    'Measure AI_BATTLE_RULE_PROGRESS_POLICY strategic progress, then apply the frozen liveness thresholds and record a distinct SYSTEM concession.'
  ),
] as const;

function matchup(
  scenarioId: string,
  playerDeckKey: AiBattlePhaseZeroDeckKey,
  aiDeckKey: AiBattlePhaseZeroDeckKey,
  aiTurnOrder: 'FIRST' | 'SECOND'
) {
  return {
    scenarioId,
    playerDeckKey,
    aiDeckKey,
    aiTurnOrder,
    manualOperationMode: 'RULES',
  } as const;
}

function policy(window: string, choice: string, rule: string) {
  return { window, choice, rule } as const;
}
