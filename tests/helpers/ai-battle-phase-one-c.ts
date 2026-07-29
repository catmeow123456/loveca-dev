import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS,
  type AiBattlePhaseZeroMatchupScenario,
} from '../../src/server/ai-battle/phase-zero-baseline';
import type {
  HeadlessPlayoutInput,
  HeadlessPlayoutResult,
  HeadlessSeatStrategy,
} from '../../src/server/ai-battle/headless-playout';
import { loadAiBattlePhaseZeroRuntimeDeck } from './ai-battle-phase-zero-decks';

export const AI_BATTLE_PHASE_ONE_C_SYSTEM_PLAYER_ID = 'loveca-ai-standard-v1';
export const AI_BATTLE_PHASE_ONE_C_OPPONENT_PLAYER_ID = 'phase-one-c-opponent';

export function createAiBattlePhaseOneCPlayoutInput(
  scenario: AiBattlePhaseZeroMatchupScenario,
  seed: string,
  strategies: {
    readonly ai?: HeadlessSeatStrategy;
    readonly opponent?: HeadlessSeatStrategy;
  } = {}
): HeadlessPlayoutInput {
  const aiIsFirst = scenario.aiTurnOrder === 'FIRST';
  const firstDeckKey = aiIsFirst ? scenario.aiDeckKey : scenario.playerDeckKey;
  const secondDeckKey = aiIsFirst ? scenario.playerDeckKey : scenario.aiDeckKey;
  const aiStrategy = strategies.ai ?? { kind: 'RANDOM_LEGAL' };
  const opponentStrategy = strategies.opponent ?? { kind: 'RANDOM_LEGAL' };
  return {
    scenarioId: scenario.scenarioId,
    firstPlayer: {
      playerId: aiIsFirst
        ? AI_BATTLE_PHASE_ONE_C_SYSTEM_PLAYER_ID
        : AI_BATTLE_PHASE_ONE_C_OPPONENT_PLAYER_ID,
      playerName: aiIsFirst ? 'Phase 1C AI' : 'Phase 1C Opponent',
      deck: loadAiBattlePhaseZeroRuntimeDeck(firstDeckKey),
      strategy: aiIsFirst ? aiStrategy : opponentStrategy,
    },
    secondPlayer: {
      playerId: aiIsFirst
        ? AI_BATTLE_PHASE_ONE_C_OPPONENT_PLAYER_ID
        : AI_BATTLE_PHASE_ONE_C_SYSTEM_PLAYER_ID,
      playerName: aiIsFirst ? 'Phase 1C Opponent' : 'Phase 1C AI',
      deck: loadAiBattlePhaseZeroRuntimeDeck(secondDeckKey),
      strategy: aiIsFirst ? opponentStrategy : aiStrategy,
    },
    ruleSeed: `rules:${seed}`,
    strategySeed: `strategy:${seed}`,
    limits: {
      maxTurnsPerGame: AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.maxTurnsPerGame,
      maxDecisionsPerGame: AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.maxDecisionsPerGame,
      maxRepairRetriesPerWindow: AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.maxRepairRetriesPerWindow,
      maxDecisionsWithoutAuthorityProgress:
        AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.maxDecisionsWithoutAuthorityProgress,
      maxWallClockMsPerGame: AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.maxWallClockMsPerGame,
    },
  };
}

export function summarizeHeadlessFailure(
  result: Extract<HeadlessPlayoutResult, { ok: false }>
): string {
  const { failure } = result;
  return JSON.stringify({
    scenarioId: failure.scenarioId,
    ruleSeed: failure.ruleSeed,
    strategySeed: failure.strategySeed,
    reason: failure.reason,
    detail: failure.detail,
    turnCount: failure.turnCount,
    decisionCount: failure.decisionCount,
    authorityRevision: failure.authorityRevision,
    lastState: failure.lastState,
    lastDecision: failure.lastDecision,
    ruleRandomFactCount: failure.ruleRandomFacts.length,
    decisionTraceCount: failure.decisionTrace.length,
  });
}

export function persistHeadlessFailureArtifact(
  result: Extract<HeadlessPlayoutResult, { ok: false }>,
  label: string
): void {
  const artifactDirectory = process.env.AI_BATTLE_PHASE_ONE_C_ARTIFACT_DIR;
  if (!artifactDirectory) return;
  mkdirSync(artifactDirectory, { recursive: true });
  const safeLabel = label.replace(/[^a-zA-Z0-9_.-]+/g, '-');
  writeFileSync(
    join(artifactDirectory, `${safeLabel}.json`),
    `${JSON.stringify(result.failure, null, 2)}\n`,
    'utf8'
  );
}
