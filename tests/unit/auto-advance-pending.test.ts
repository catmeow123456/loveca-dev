import { describe, expect, it } from 'vitest';
import { GameSession } from '../../src/application/game-session';
import { createGameState, type GameState } from '../../src/domain/entities/game';
import { GamePhase, TurnType } from '../../src/shared/types/enums';

function createActivePhaseState(): GameState {
  return {
    ...createGameState('auto-advance-pending', 'p1', 'P1', 'p2', 'P2'),
    turnCount: 1,
    currentPhase: GamePhase.ACTIVE_PHASE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
  };
}

function runAutoAdvance(session: GameSession, state: GameState): GameState {
  return (
    session as unknown as {
      autoAdvance(state: GameState): GameState;
    }
  ).autoAdvance(state);
}

describe('自动推进遇到待处理卡效/选择时应停住', () => {
  it('没有待处理事项时，会从自动阶段推进到主要阶段', () => {
    const session = new GameSession();
    const result = runAutoAdvance(session, createActivePhaseState());

    expect(result.currentPhase).toBe(GamePhase.MAIN_PHASE);
  });

  it('有待处理能力时，不应跳过当前自动阶段', () => {
    const session = new GameSession();
    const state: GameState = {
      ...createActivePhaseState(),
      pendingAbilities: [
        {
          id: 'pending-ability-1',
          abilityId: 'test-on-active-start',
          sourceCardId: 'source-card-1',
          controllerId: 'p1',
          mandatory: true,
          timingId: 'ACTIVE_PHASE_START:turn-1',
          eventIds: ['event-1'],
        },
      ],
    };

    const result = runAutoAdvance(session, state);

    expect(result.currentPhase).toBe(GamePhase.ACTIVE_PHASE);
    expect(result.pendingAbilities).toHaveLength(1);
  });

  it('有待玩家选择时，不应跳过当前自动阶段', () => {
    const session = new GameSession();
    const state: GameState = {
      ...createActivePhaseState(),
      pendingChoice: {
        id: 'pending-choice-1',
        playerId: 'p1',
        kind: 'CONFIRM_OPTIONAL',
        sourceAbilityId: 'test-optional-ability',
        promptText: '是否发动这个能力？',
      },
    };

    const result = runAutoAdvance(session, state);

    expect(result.currentPhase).toBe(GamePhase.ACTIVE_PHASE);
    expect(result.pendingChoice?.id).toBe('pending-choice-1');
  });
});
