import {
  RULE_RANDOM_FACT_SCHEMA_VERSION,
  RULE_RANDOM_SOURCE_SCHEMA_VERSION,
} from '../../domain/rules/rule-random.js';
import { AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS } from './phase-zero-baseline.js';
import { AI_BATTLE_PHASE_ONE_A_WINDOW_MATRIX_VERSION } from './phase-one-a-window-evidence.js';
import {
  AI_HEADLESS_FAILURE_ARTIFACT_SCHEMA_VERSION,
  AI_HEADLESS_PLAYOUT_SCHEMA_VERSION,
} from './headless-playout.js';
import {
  AI_RANDOM_LEGAL_DECISION_FACT_SCHEMA_VERSION,
  AI_RANDOM_LEGAL_POLICY_VERSION,
} from './random-legal-decision-policy.js';

export const AI_BATTLE_PHASE_ONE_C_BASELINE_VERSION = 'ai-battle.phase-one-c/v1' as const;
export const AI_BATTLE_PHASE_ONE_C_CERTIFICATION_STATUS = 'COMPLETE' as const;

export const AI_BATTLE_PHASE_ONE_C_COMPONENT_VERSIONS = {
  ruleRandomSource: RULE_RANDOM_SOURCE_SCHEMA_VERSION,
  ruleRandomFact: RULE_RANDOM_FACT_SCHEMA_VERSION,
  randomLegalPolicy: AI_RANDOM_LEGAL_POLICY_VERSION,
  randomLegalDecisionFact: AI_RANDOM_LEGAL_DECISION_FACT_SCHEMA_VERSION,
  headlessPlayout: AI_HEADLESS_PLAYOUT_SCHEMA_VERSION,
  headlessFailureArtifact: AI_HEADLESS_FAILURE_ARTIFACT_SCHEMA_VERSION,
  certifiedWindowMatrix: AI_BATTLE_PHASE_ONE_A_WINDOW_MATRIX_VERSION,
} as const;

export const AI_BATTLE_PHASE_ONE_C_RUNTIME_BOUNDARY = {
  productionRandomSource: 'SECURE',
  testRandomSource: 'SEEDED_OR_STRICT_REPLAY',
  policyInput: 'TYPED_DECISION_CONTRACT_ONLY',
  headlessAuthority: 'GAME_SESSION_COMMANDS_ONLY',
  llmDependency: false,
  productSystemSeatEnabled: false,
  aiSpecificRuleDsl: false,
} as const;

export const AI_BATTLE_PHASE_ONE_C_ACCEPTANCE = {
  ...AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS,
  matchupUnitCount: 8,
  smokeCommand:
    'pnpm exec vitest run tests/integration/ai-battle-phase-one-c-headless-playout.test.ts',
  dedicatedRegressionCommand: 'pnpm test:ai-battle:phase-one-c',
} as const;

/**
 * These deterministic seeds exposed contract/command mismatches while Phase 1C
 * was being built. They remain part of the fixed PR smoke and must not be
 * replaced to hide a regression. A failing run emits the complete rule-random
 * and per-seat strategy fact tapes plus the executed decision trace in its
 * versioned failure artifact.
 */
export const AI_BATTLE_PHASE_ONE_C_FAILURE_REGRESSION_CORPUS = [
  {
    regressionId: 'ZERO_LENGTH_ORDERED_SELECTION_COMMAND_SHAPE',
    scenarioId: 'muse-vs-muse-ai-second',
    seed: 'smoke:muse-vs-muse-ai-second',
  },
  {
    regressionId: 'SKIPPED_EXACT_ORDERED_SELECTION_COMMAND_SHAPE',
    scenarioId: 'green-vs-green-ai-first',
    seed: 'smoke:green-vs-green-ai-first',
  },
] as const;

export const AI_BATTLE_PHASE_ONE_C_GATE_EVIDENCE = [
  evidence(
    'SEEDED_SECURE_AND_REPLAYABLE_RULE_RANDOMNESS',
    'tests/unit/rule-random.test.ts',
    "it('records production-shaped rule facts in the sealed GameSession audit'"
  ),
  evidence(
    'TYPED_CONTRACT_RANDOM_LEGAL_POLICY',
    'tests/unit/random-legal-decision-policy.test.ts',
    "describe('random legal decision policy'"
  ),
  evidence(
    'FIXED_EIGHT_UNIT_SMOKE_AND_EXACT_REPLAY',
    'tests/integration/ai-battle-phase-one-c-headless-playout.test.ts',
    "it('replays the exact strategy choices and rule-random fact tape'"
  ),
  evidence(
    'FAILURE_ARTIFACT_STRICT_REPLAY',
    'tests/integration/ai-battle-phase-one-c-headless-playout.test.ts',
    "it('preserves and replays the random selection that an authority command rejects'"
  ),
  evidence(
    'MODEL_UNAVAILABLE_AND_MIDGAME_FALLBACK',
    'tests/integration/ai-battle-phase-one-c-headless-playout.test.ts',
    "it('finishes safely after a midgame model fallback'"
  ),
  evidence(
    'DEDICATED_256_GAME_REGRESSION',
    'tests/integration/ai-battle-phase-one-c-full-regression.test.ts',
    "'AI battle Phase 1C dedicated 256-game regression'"
  ),
  evidence(
    'SCHEDULED_AND_MANUAL_DEDICATED_CI',
    '.github/workflows/ai-battle-phase-one-c.yml',
    'Run 256-game deterministic regression'
  ),
] as const;

function evidence(gate: string, behaviorTest: string, evidenceAnchor: string) {
  return { gate, behaviorTest, evidenceAnchor } as const;
}
