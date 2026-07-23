import { describe, expect, it } from 'vitest';
import { GameCommandType } from '../../src/application/game-commands';
import {
  classifyPlayerCommand,
  getPlayerCommandPolicyDecision,
  getRulesModeConfirmStepBlockedReason,
} from '../../src/application/player-command-policy';
import { createGameState, type GameState } from '../../src/domain/entities/game';
import { GamePhase, SubPhase } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function createRulesState(): GameState {
  return {
    ...createGameState('command-policy', P1, 'P1', P2, 'P2'),
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    isStarted: true,
    manualOperationMode: 'RULES',
  };
}

describe('player command policy', () => {
  it('将手动整理、手动抽放牌与调整判定统一视为自由模式操作', () => {
    const manualCommands = [
      GameCommandType.TAP_MEMBER,
      GameCommandType.TAP_ENERGY,
      GameCommandType.OPEN_INSPECTION,
      GameCommandType.REVEAL_CHEER_CARD,
      GameCommandType.MOVE_TABLE_CARD,
      GameCommandType.MOVE_MEMBER_TO_SLOT,
      GameCommandType.ATTACH_ENERGY_TO_MEMBER,
      GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM,
      GameCommandType.MOVE_PUBLIC_CARD_TO_HAND,
      GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK,
      GameCommandType.MOVE_OWNED_CARD_TO_ZONE,
      GameCommandType.CONFIRM_PERFORMANCE_OUTCOME,
      GameCommandType.DRAW_CARD_TO_HAND,
      GameCommandType.DRAW_ENERGY_TO_ZONE,
      GameCommandType.RETURN_HAND_CARD_TO_TOP,
    ];

    for (const command of manualCommands) {
      expect(classifyPlayerCommand(command), command).toBe('MANUAL_OVERRIDE');
    }
  });

  it('规则模式拒绝手动覆写，自由模式保留现有灵活入口', () => {
    const rules = createRulesState();
    expect(getPlayerCommandPolicyDecision(rules, P1, GameCommandType.TAP_MEMBER).allowed).toBe(
      false
    );
    expect(
      getPlayerCommandPolicyDecision(
        { ...rules, manualOperationMode: 'FREE' },
        P1,
        GameCommandType.TAP_MEMBER
      ).allowed
    ).toBe(true);
  });

  it('只在主要阶段放行成员登场和起动效果', () => {
    const rules = createRulesState();
    for (const [phase, subPhase] of [
      [GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_PLAYER],
      [GamePhase.PERFORMANCE_PHASE, SubPhase.PERFORMANCE_JUDGMENT],
      [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_SETTLEMENT],
    ] as const) {
      const state = { ...rules, currentPhase: phase, currentSubPhase: subPhase };
      expect(
        getPlayerCommandPolicyDecision(state, P1, GameCommandType.PLAY_MEMBER_TO_SLOT).allowed
      ).toBe(false);
      expect(
        getPlayerCommandPolicyDecision(state, P1, GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY).allowed
      ).toBe(false);
      expect(
        getPlayerCommandPolicyDecision(state, P1, GameCommandType.ACTIVATE_ABILITY).allowed
      ).toBe(false);
    }
  });

  it('只在主要阶段的 NONE 子阶段放行 END_PHASE', () => {
    const rules = createRulesState();
    expect(getPlayerCommandPolicyDecision(rules, P1, GameCommandType.END_PHASE).allowed).toBe(true);
    expect(
      getPlayerCommandPolicyDecision(
        { ...rules, currentSubPhase: SubPhase.FREE_ACTION },
        P1,
        GameCommandType.END_PHASE
      ).allowed
    ).toBe(false);
    expect(
      getPlayerCommandPolicyDecision(
        {
          ...rules,
          currentPhase: GamePhase.PERFORMANCE_PHASE,
          currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
        },
        P1,
        GameCommandType.END_PHASE
      ).allowed
    ).toBe(false);
  });

  it('只允许当前 pending workflow 的精确确认命令', () => {
    const rules = createRulesState();
    const withEffect = {
      ...rules,
      activeEffect: {
        id: 'effect',
        abilityId: 'ability',
        sourceCardId: 'source',
        controllerId: P1,
        effectText: '效果',
        stepId: 'STEP',
        stepText: '确认',
        awaitingPlayerId: P1,
      },
    } satisfies GameState;
    expect(
      getPlayerCommandPolicyDecision(withEffect, P1, GameCommandType.CONFIRM_EFFECT_STEP).allowed
    ).toBe(true);
    expect(getPlayerCommandPolicyDecision(withEffect, P1, GameCommandType.END_PHASE).allowed).toBe(
      false
    );
    expect(
      getPlayerCommandPolicyDecision(withEffect, P2, GameCommandType.CONFIRM_EFFECT_STEP).allowed
    ).toBe(false);
  });

  it('判定前必须先生成当前玩家草案，分数确认和自动子阶段不接受 CONFIRM_STEP', () => {
    const rules = createRulesState();
    const performance = {
      ...rules,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      players: rules.players.map((player, index) =>
        index === 0 ? { ...player, liveZone: { ...player.liveZone, cardIds: ['live-1'] } } : player
      ),
    } satisfies GameState;
    expect(getRulesModeConfirmStepBlockedReason(performance, P1)).toContain('先提交');
    expect(
      getRulesModeConfirmStepBlockedReason(
        {
          ...performance,
          liveResolution: {
            ...performance.liveResolution,
            liveResults: new Map([['live-1', true]]),
          },
        },
        P1
      )
    ).toBeNull();
    expect(
      getRulesModeConfirmStepBlockedReason(
        { ...rules, currentSubPhase: SubPhase.RESULT_SCORE_CONFIRM },
        P1
      )
    ).toContain('分数确认');
    expect(
      getRulesModeConfirmStepBlockedReason(
        { ...rules, currentSubPhase: SubPhase.LIVE_SET_FIRST_DRAW },
        P1
      )
    ).toContain('不能');
  });
});
