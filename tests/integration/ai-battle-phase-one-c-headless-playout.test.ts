import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../../src/application/game-session';
import {
  AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS,
  AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX,
} from '../../src/server/ai-battle/phase-zero-baseline';
import { runHeadlessPlayout } from '../../src/server/ai-battle/headless-playout';
import {
  AI_BATTLE_PHASE_ONE_C_SYSTEM_PLAYER_ID,
  createAiBattlePhaseOneCPlayoutInput,
  persistHeadlessFailureArtifact,
  summarizeHeadlessFailure,
} from '../helpers/ai-battle-phase-one-c';

describe('AI battle Phase 1C headless playout', () => {
  it.each(AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX)(
    'completes the fixed pull-request smoke seed for $scenarioId',
    (scenario) => {
      const result = runHeadlessPlayout(
        createAiBattlePhaseOneCPlayoutInput(scenario, `smoke:${scenario.scenarioId}`)
      );

      if (!result.ok) {
        persistHeadlessFailureArtifact(result, `smoke-${scenario.scenarioId}`);
      }
      expect(result.ok, result.ok ? undefined : summarizeHeadlessFailure(result)).toBe(true);
      if (result.ok) {
        expect(result.decisionCount).toBeGreaterThan(0);
        expect(result.turnCount).toBeLessThanOrEqual(
          AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.maxTurnsPerGame
        );
        expect(result.ruleRandomFacts.length).toBeGreaterThan(0);
        expect(
          result.decisionTrace.some((entry) => entry.contractKind === 'JUDGMENT_CONFIRMATION')
        ).toBe(true);
      }
    },
    35_000
  );

  it('replays the exact strategy choices and rule-random fact tape', () => {
    const scenario = AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX[0];
    const input = createAiBattlePhaseOneCPlayoutInput(scenario, 'replay-smoke');
    const recorded = runHeadlessPlayout(input);
    expect(recorded.ok, recorded.ok ? undefined : summarizeHeadlessFailure(recorded)).toBe(true);
    if (!recorded.ok) return;

    const replayed = runHeadlessPlayout({
      ...input,
      replay: {
        ruleRandomFacts: recorded.ruleRandomFacts,
        randomDecisionFactsBySeat: recorded.randomDecisionFactsBySeat,
      },
    });
    expect(replayed.ok, replayed.ok ? undefined : summarizeHeadlessFailure(replayed)).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.finalAuthoritySignature).toBe(recorded.finalAuthoritySignature);
    expect(replayed.decisionTrace).toEqual(recorded.decisionTrace);
  });

  it('replays a bounded failure from the facts stored in its failure artifact', () => {
    const scenario = AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX[0];
    const baseInput = createAiBattlePhaseOneCPlayoutInput(scenario, 'failure-replay');
    const input = {
      ...baseInput,
      limits: {
        ...baseInput.limits,
        maxDecisionsPerGame: 1,
      },
    };
    const recorded = runHeadlessPlayout(input);
    expect(recorded.ok).toBe(false);
    if (recorded.ok) return;
    persistHeadlessFailureArtifact(recorded, 'bounded-failure-replay');
    expect(recorded.failure.reason).toBe('DECISION_LIMIT');

    const replayed = runHeadlessPlayout({
      ...input,
      replay: {
        ruleRandomFacts: recorded.failure.ruleRandomFacts,
        randomDecisionFactsBySeat: recorded.failure.randomDecisionFactsBySeat,
      },
    });
    expect(replayed.ok).toBe(false);
    if (replayed.ok) return;
    expect(replayed.failure.reason).toBe(recorded.failure.reason);
    expect(replayed.failure.lastState).toEqual(recorded.failure.lastState);
    expect(replayed.failure.decisionTrace).toEqual(recorded.failure.decisionTrace);
  });

  it('preserves and replays the random selection that an authority command rejects', () => {
    const executeCommand = vi
      .spyOn(GameSession.prototype, 'executeCommand')
      .mockImplementation(function (this: GameSession) {
        return {
          success: false,
          gameState: this.state!,
          error: 'forced authority rejection',
        };
      });

    try {
      const scenario = AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX[0];
      const input = createAiBattlePhaseOneCPlayoutInput(
        scenario,
        'authority-rejection-failure-replay'
      );
      const recorded = runHeadlessPlayout(input);
      expect(recorded.ok).toBe(false);
      if (recorded.ok) return;
      expect(recorded.failure.reason).toBe('COMMAND_REJECTED');
      expect(Object.values(recorded.failure.randomDecisionFactsBySeat).flat()).toHaveLength(1);

      const replayed = runHeadlessPlayout({
        ...input,
        replay: {
          ruleRandomFacts: recorded.failure.ruleRandomFacts,
          randomDecisionFactsBySeat: recorded.failure.randomDecisionFactsBySeat,
        },
      });
      expect(replayed.ok).toBe(false);
      if (replayed.ok) return;
      expect(replayed.failure.reason).toBe(recorded.failure.reason);
      expect(replayed.failure.lastState).toEqual(recorded.failure.lastState);
      expect(replayed.failure.randomDecisionFactsBySeat).toEqual(
        recorded.failure.randomDecisionFactsBySeat
      );
      expect(replayed.failure.decisionTrace).toEqual(recorded.failure.decisionTrace);
    } finally {
      executeCommand.mockRestore();
    }
  });

  it('finishes safely when the model is unavailable from the first decision', () => {
    const scenario = AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX[0];
    const result = runHeadlessPlayout(
      createAiBattlePhaseOneCPlayoutInput(scenario, 'fallback-from-start', {
        ai: { kind: 'CONSERVATIVE_FROM_START' },
      })
    );

    expect(result.ok, result.ok ? undefined : summarizeHeadlessFailure(result)).toBe(true);
    if (!result.ok) return;
    expect(
      result.decisionTrace.some(
        (entry) =>
          entry.playerId === AI_BATTLE_PHASE_ONE_C_SYSTEM_PLAYER_ID &&
          entry.strategy === 'CONSERVATIVE'
      )
    ).toBe(true);
  });

  it('finishes safely after a midgame model fallback', () => {
    const scenario = AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX[1];
    const result = runHeadlessPlayout(
      createAiBattlePhaseOneCPlayoutInput(scenario, 'fallback-midgame', {
        ai: { kind: 'CONSERVATIVE_AFTER_DECISIONS', randomDecisionCount: 8 },
      })
    );

    expect(result.ok, result.ok ? undefined : summarizeHeadlessFailure(result)).toBe(true);
    if (!result.ok) return;
    const aiTrace = result.decisionTrace.filter(
      (entry) => entry.playerId === AI_BATTLE_PHASE_ONE_C_SYSTEM_PLAYER_ID
    );
    expect(aiTrace.some((entry) => entry.strategy === 'RANDOM_LEGAL')).toBe(true);
    expect(aiTrace.some((entry) => entry.strategy === 'CONSERVATIVE')).toBe(true);
  });
});
