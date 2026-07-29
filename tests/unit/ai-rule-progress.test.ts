import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../../src/domain/entities/game';
import {
  captureAiRuleProgress,
  createMachineLivenessState,
  recordMachineLivenessDecision,
  type MachineLivenessLimits,
} from '../../src/server/ai-battle/rule-progress';
import { GamePhase, SubPhase } from '../../src/shared/types/enums';

const GENEROUS_LIMITS: MachineLivenessLimits = {
  maxAiTurnsWithoutRuleProgress: 99,
  maxConservativeDecisions: 99,
  maxDegradedDurationMs: 99_000,
  maxDecisionsWithoutAuthorityProgress: 99,
};

function createState(): GameState {
  const game = createGameState('progress-test', 'system', 'System', 'user', 'User');
  return {
    ...game,
    turnCount: 1,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    players: [
      {
        ...game.players[0],
        hand: { ...game.players[0].hand, cardIds: ['hand-1'] },
        mainDeck: { ...game.players[0].mainDeck, cardIds: ['deck-1', 'deck-2'] },
      },
      game.players[1],
    ],
  };
}

describe('AI rule progress fingerprints', () => {
  it('treats phase and active-window movement as authority progress but not strategic progress', () => {
    const before = createState();
    const after = {
      ...before,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
      activePlayerIndex: 1,
      waitingForInput: true,
      waitingPlayerId: 'user',
    };
    const beforeProgress = captureAiRuleProgress(before);
    const afterProgress = captureAiRuleProgress(after);

    expect(afterProgress.authorityStateSignature).not.toBe(beforeProgress.authorityStateSignature);
    expect(afterProgress.strategicRuleSignature).toBe(beforeProgress.strategicRuleSignature);
  });

  it('ignores audit-log and timestamp-only noise', () => {
    const before = createState();
    const after: GameState = {
      ...before,
      actionSequence: 1,
      actionHistory: [
        {
          id: 'audit-only',
          type: 'PHASE_CHANGE',
          playerId: 'system',
          timestamp: 9_999,
          payload: { from: 'A', to: 'B' },
          sequence: 1,
        },
      ],
      activeEffect: {
        id: 'effect-1',
        abilityId: 'ability-1',
        sourceCardId: 'source-1',
        controllerId: 'system',
        effectText: '公开展示',
        stepId: 'step-1',
        stepText: '等待',
        awaitingPlayerId: 'system',
        publicCardSelectionAutoAdvanceAt: 10_000,
      },
    };
    const laterDeadline: GameState = {
      ...after,
      activeEffect: {
        ...after.activeEffect!,
        publicCardSelectionAutoAdvanceAt: 20_000,
      },
    };

    expect(captureAiRuleProgress(laterDeadline)).toEqual(captureAiRuleProgress(after));
    expect(captureAiRuleProgress({ ...before, actionHistory: after.actionHistory })).toEqual(
      captureAiRuleProgress(before)
    );
  });

  it('treats zone identity changes as both authority and strategic progress', () => {
    const before = createState();
    const first = before.players[0];
    const after: GameState = {
      ...before,
      players: [
        {
          ...first,
          hand: { ...first.hand, cardIds: ['hand-1', 'deck-1'] },
          mainDeck: { ...first.mainDeck, cardIds: ['deck-2'] },
        },
        before.players[1],
      ],
    };

    const beforeProgress = captureAiRuleProgress(before);
    const afterProgress = captureAiRuleProgress(after);
    expect(afterProgress.authorityStateSignature).not.toBe(beforeProgress.authorityStateSignature);
    expect(afterProgress.strategicRuleSignature).not.toBe(beforeProgress.strategicRuleSignature);
  });
});

describe('machine liveness monitor', () => {
  it('counts completed AI turns without strategic progress and resets after material progress', () => {
    let before = createState();
    let monitor = createMachineLivenessState(before, 1_000);
    for (let turn = 1; turn <= 2; turn += 1) {
      before = { ...before, turnCount: turn, activePlayerIndex: 0 };
      const after = { ...before, activePlayerIndex: 1 };
      const result = recordMachineLivenessDecision({
        previous: monitor,
        before,
        after,
        systemPlayerId: 'system',
        now: 1_000 + turn,
        limits: GENEROUS_LIMITS,
      });
      monitor = result.state;
    }
    expect(monitor.aiTurnsWithoutStrategicProgress).toBe(2);

    before = { ...before, turnCount: 3, activePlayerIndex: 0 };
    const first = before.players[0];
    const progressed: GameState = {
      ...before,
      players: [
        {
          ...first,
          hand: { ...first.hand, cardIds: [...first.hand.cardIds, 'deck-1'] },
          mainDeck: { ...first.mainDeck, cardIds: ['deck-2'] },
        },
        before.players[1],
      ],
    };
    const result = recordMachineLivenessDecision({
      previous: monitor,
      before,
      after: progressed,
      systemPlayerId: 'system',
      now: 1_010,
      limits: GENEROUS_LIMITS,
    });

    expect(result.strategicRuleProgress).toBe(true);
    expect(result.state.aiTurnsWithoutStrategicProgress).toBe(0);
  });

  it('emits the frozen terminal reasons at their respective bounds', () => {
    const game = createState();
    const authorityWatchdog = recordMachineLivenessDecision({
      previous: {
        ...createMachineLivenessState(game, 1_000),
        decisionsWithoutAuthorityProgress: 1,
      },
      before: game,
      after: game,
      systemPlayerId: 'system',
      now: 1_001,
      limits: { ...GENEROUS_LIMITS, maxDecisionsWithoutAuthorityProgress: 2 },
    });
    expect(authorityWatchdog.terminalReason).toBe('AUTHORITY_PROGRESS_WATCHDOG');

    const decisionLimit = recordMachineLivenessDecision({
      previous: {
        ...createMachineLivenessState(game, 1_000),
        conservativeDecisionCount: 1,
      },
      before: game,
      after: { ...game, currentSubPhase: SubPhase.FREE_ACTION },
      systemPlayerId: 'system',
      now: 1_001,
      limits: { ...GENEROUS_LIMITS, maxConservativeDecisions: 2 },
    });
    expect(decisionLimit.terminalReason).toBe('CONSERVATIVE_DECISION_LIMIT');

    const durationLimit = recordMachineLivenessDecision({
      previous: createMachineLivenessState(game, 1_000),
      before: game,
      after: { ...game, currentSubPhase: SubPhase.FREE_ACTION },
      systemPlayerId: 'system',
      now: 2_000,
      limits: { ...GENEROUS_LIMITS, maxDegradedDurationMs: 1_000 },
    });
    expect(durationLimit.terminalReason).toBe('DEGRADED_DURATION_LIMIT');
  });

  it('keeps the authority watchdog active without applying fallback limits to primary strategy', () => {
    const game = createState();
    const primary = recordMachineLivenessDecision({
      previous: createMachineLivenessState(game, 1_000, 'PRIMARY'),
      before: game,
      after: { ...game, currentSubPhase: SubPhase.FREE_ACTION },
      systemPlayerId: 'system',
      now: 10_000,
      strategyMode: 'PRIMARY',
      limits: {
        maxAiTurnsWithoutRuleProgress: 1,
        maxConservativeDecisions: 1,
        maxDegradedDurationMs: 1,
        maxDecisionsWithoutAuthorityProgress: 2,
      },
    });

    expect(primary.terminalReason).toBeNull();
    expect(primary.state).toMatchObject({
      strategyMode: 'PRIMARY',
      degradedAt: null,
      conservativeDecisionCount: 0,
      aiTurnsWithoutStrategicProgress: 0,
    });

    const authorityWatchdog = recordMachineLivenessDecision({
      previous: primary.state,
      before: game,
      after: game,
      systemPlayerId: 'system',
      now: 10_001,
      strategyMode: 'PRIMARY',
      limits: {
        maxAiTurnsWithoutRuleProgress: 1,
        maxConservativeDecisions: 1,
        maxDegradedDurationMs: 1,
        maxDecisionsWithoutAuthorityProgress: 1,
      },
    });
    expect(authorityWatchdog.terminalReason).toBe('AUTHORITY_PROGRESS_WATCHDOG');
  });

  it('triggers the frozen three-turn strategic no-progress boundary', () => {
    let monitor = createMachineLivenessState(createState(), 1_000);
    let terminalReason = null;
    for (let turn = 1; turn <= 3; turn += 1) {
      const before = { ...createState(), turnCount: turn, activePlayerIndex: 0 };
      const after = { ...before, activePlayerIndex: 1 };
      const result = recordMachineLivenessDecision({
        previous: monitor,
        before,
        after,
        systemPlayerId: 'system',
        now: 1_000 + turn,
        limits: {
          ...GENEROUS_LIMITS,
          maxAiTurnsWithoutRuleProgress: 3,
        },
      });
      monitor = result.state;
      terminalReason = result.terminalReason;
    }

    expect(monitor.aiTurnsWithoutStrategicProgress).toBe(3);
    expect(terminalReason).toBe('AI_TURNS_WITHOUT_STRATEGIC_PROGRESS');
  });
});
