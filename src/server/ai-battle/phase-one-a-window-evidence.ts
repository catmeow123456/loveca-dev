export const AI_BATTLE_PHASE_ONE_A_WINDOW_MATRIX_VERSION =
  'ai-battle.phase-one-a-window-matrix/v2' as const;

/**
 * Sorted `baseCardCode + "\0" + abilityId` rows from the Phase 0 ability
 * evidence manifest, joined with `\n` and hashed with SHA-256.
 *
 * This deliberately pins the reviewed ability set without creating a second
 * card-effect completion ledger. Completion status remains owned by
 * existing_module_map.md.
 */
export const AI_BATTLE_PHASE_ONE_A_ABILITY_EVIDENCE_SHA256 =
  'fcf6667b1823057a06ff8be8f6d0d89121e907517f753a576b96acfeffa8608e' as const;

export type AiBattlePhaseOneAWindowSurface =
  | 'MULLIGAN'
  | 'MAIN_PHASE'
  | 'LIVE_SET'
  | 'ACTIVE_EFFECT_CONFIRM'
  | 'ACTIVE_EFFECT_CARD_SINGLE'
  | 'ACTIVE_EFFECT_CARD_ORDERED'
  | 'ACTIVE_EFFECT_CARD_GROUPED'
  | 'ACTIVE_EFFECT_OPTION'
  | 'ACTIVE_EFFECT_ABILITY_ORDER'
  | 'ACTIVE_EFFECT_DEADLINE'
  | 'JUDGMENT_CONFIRMATION'
  | 'SCORE_CONFIRMATION'
  | 'SUCCESS_LIVE_SELECTION'
  | 'PHASE_CONFIRMATION';

export interface AiBattlePhaseOneAWindowEvidence {
  readonly surface: AiBattlePhaseOneAWindowSurface;
  readonly behaviorTest: string;
  readonly evidenceAnchor: string;
}

/**
 * Certification is executable: every row points at a real GameState scenario
 * that builds this surface, validates a witness and sampler result, and
 * materializes the witness through the shared command adapter.
 */
export const AI_BATTLE_PHASE_ONE_A_WINDOW_EVIDENCE = [
  evidence(
    'MULLIGAN',
    'tests/integration/ai-battle-phase-zero-rules-baseline.test.ts',
    "assertCertifiedAiDecisionSurface(session.state!, SYSTEM_PLAYER_ID, 'MULLIGAN')"
  ),
  evidence(
    'MAIN_PHASE',
    'tests/integration/ai-battle-phase-zero-rules-baseline.test.ts',
    "assertCertifiedAiDecisionSurface(session.state!, SYSTEM_PLAYER_ID, 'MAIN_PHASE')"
  ),
  evidence(
    'LIVE_SET',
    'tests/integration/ai-battle-phase-zero-rules-baseline.test.ts',
    "assertCertifiedAiDecisionSurface(session.state!, SYSTEM_PLAYER_ID, 'LIVE_SET')"
  ),
  evidence(
    'ACTIVE_EFFECT_CONFIRM',
    'tests/unit/ai-decision-contract.test.ts',
    "assertCertifiedAiDecisionSurface(confirmState, PLAYER_ID, 'ACTIVE_EFFECT_CONFIRM')"
  ),
  evidence(
    'ACTIVE_EFFECT_CARD_SINGLE',
    'tests/integration/sample-card-effect-runner.test.ts',
    "assertCertifiedAiDecisionSurface(session.state!, PLAYER1, 'ACTIVE_EFFECT_CARD_SINGLE')"
  ),
  evidence(
    'ACTIVE_EFFECT_CARD_ORDERED',
    'tests/integration/sample-card-effect-runner.test.ts',
    "assertCertifiedAiDecisionSurface(session.state!, PLAYER1, 'ACTIVE_EFFECT_CARD_ORDERED')"
  ),
  evidence(
    'ACTIVE_EFFECT_CARD_GROUPED',
    'tests/integration/sample-card-effect-runner.test.ts',
    "assertCertifiedAiDecisionSurface(session.state!, PLAYER1, 'ACTIVE_EFFECT_CARD_GROUPED')"
  ),
  evidence(
    'ACTIVE_EFFECT_OPTION',
    'tests/integration/sample-card-effect-runner.test.ts',
    "assertCertifiedAiDecisionSurface(session.state!, PLAYER1, 'ACTIVE_EFFECT_OPTION')"
  ),
  evidence(
    'ACTIVE_EFFECT_ABILITY_ORDER',
    'tests/integration/sample-card-effect-runner.test.ts',
    "assertCertifiedAiDecisionSurface(session.state!, PLAYER1, 'ACTIVE_EFFECT_ABILITY_ORDER')"
  ),
  evidence(
    'ACTIVE_EFFECT_DEADLINE',
    'tests/integration/sample-card-effect-runner.test.ts',
    "assertCertifiedAiDecisionSurface(session.state!, PLAYER1, 'ACTIVE_EFFECT_DEADLINE'"
  ),
  evidence(
    'JUDGMENT_CONFIRMATION',
    'tests/integration/ai-battle-phase-one-c-headless-playout.test.ts',
    "entry.contractKind === 'JUDGMENT_CONFIRMATION'"
  ),
  evidence(
    'SCORE_CONFIRMATION',
    'tests/unit/ai-decision-contract.test.ts',
    "assertCertifiedAiDecisionSurface(state, PLAYER_ID, 'SCORE_CONFIRMATION')"
  ),
  evidence(
    'SUCCESS_LIVE_SELECTION',
    'tests/unit/ai-decision-contract.test.ts',
    "      'SUCCESS_LIVE_SELECTION'\n    );"
  ),
  evidence(
    'PHASE_CONFIRMATION',
    'tests/unit/ai-decision-contract.test.ts',
    "      'PHASE_CONFIRMATION'\n    );"
  ),
] as const satisfies readonly AiBattlePhaseOneAWindowEvidence[];

/**
 * The contract core supports these shapes, but the two Phase 0 certified decks
 * do not currently make them reachable. They therefore cannot be used to
 * inflate the Phase 1A certification claim.
 */
export const AI_BATTLE_PHASE_ONE_A_SUPPORTED_OUTSIDE_CERTIFIED_REACHABILITY = [
  'COST_PAYMENT',
  'SPECIAL_MEMBER_PLAY',
  'ACTIVE_EFFECT_SLOT',
  'ACTIVE_EFFECT_NUMBER',
  'ACTIVE_EFFECT_STAGE_FORMATION',
] as const;

function evidence(
  surface: AiBattlePhaseOneAWindowSurface,
  behaviorTest: string,
  evidenceAnchor: string
): AiBattlePhaseOneAWindowEvidence {
  return { surface, behaviorTest, evidenceAnchor };
}
