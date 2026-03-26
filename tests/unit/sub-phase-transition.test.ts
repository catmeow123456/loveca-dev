/**
 * 子阶段转移测试
 *
 * 测试目标：
 * 1. 验证换牌阶段子阶段流转
 * 2. 验证 Live 设置阶段子阶段流转
 * 3. 验证演出阶段子阶段流转
 * 4. 验证 Live 结算阶段子阶段流转
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SubPhase, GamePhase, TurnType, CardType, HeartColor } from '../../src/shared/types/enums';
import { PhaseManager, phaseManager } from '../../src/application/phase-manager';
import { GameService, DeckConfig } from '../../src/application/game-service';
import {
  getNextSubPhase,
  getSubPhaseConfig,
  isUserActionRequired,
  isEffectWindow,
} from '../../src/shared/phase-config/sub-phase-registry';
import type { GameState } from '../../src/domain/entities/game';
import type {
  MemberCardData,
  LiveCardData,
  EnergyCardData,
  AnyCardData,
} from '../../src/domain/entities/card';
import { createHeartRequirement, createHeartIcon } from '../../src/domain/entities/card';
import {
  createMulliganAction,
  createEndPhaseAction,
  createConfirmSubPhaseAction,
} from '../../src/application/actions';

// ============================================
// 测试用卡组
// ============================================

function createTestMemberCard(cardCode: string, name: string, cost: number): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createTestLiveCard(cardCode: string, name: string, score: number): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 } as Record<HeartColor, number>),
  };
}

function createTestEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: '能量卡',
    cardType: CardType.ENERGY,
  };
}

function createTestDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  for (let i = 0; i < 48; i++) {
    mainDeck.push(createTestMemberCard(`MEMBER-${i}`, `成员 ${i}`, (i % 5) + 1));
  }

  for (let i = 0; i < 12; i++) {
    mainDeck.push(createTestLiveCard(`LIVE-${i}`, `Live ${i}`, 3));
  }

  for (let i = 0; i < 12; i++) {
    energyDeck.push(createTestEnergyCard(`ENERGY-${i}`));
  }

  return { mainDeck, energyDeck };
}

// ============================================
// 子阶段流转配置测试
// ============================================

describe('子阶段流转配置测试', () => {
  describe('换牌阶段子阶段流转', () => {
    it('先攻换牌 → 后攻换牌 → NONE', () => {
      expect(getNextSubPhase(SubPhase.MULLIGAN_FIRST_PLAYER)).toBe(SubPhase.MULLIGAN_SECOND_PLAYER);
      expect(getNextSubPhase(SubPhase.MULLIGAN_SECOND_PLAYER)).toBe(SubPhase.NONE);
    });

    it('换牌子阶段不需要用户操作（有专门的 MulliganPanel）', () => {
      expect(isUserActionRequired(SubPhase.MULLIGAN_FIRST_PLAYER)).toBe(false);
      expect(isUserActionRequired(SubPhase.MULLIGAN_SECOND_PLAYER)).toBe(false);
    });

    it('换牌子阶段不是效果窗口', () => {
      expect(isEffectWindow(SubPhase.MULLIGAN_FIRST_PLAYER)).toBe(false);
      expect(isEffectWindow(SubPhase.MULLIGAN_SECOND_PLAYER)).toBe(false);
    });
  });

  describe('Live 设置阶段子阶段流转', () => {
    it('先攻盖牌 → 先攻抽卡 → 后攻盖牌 → 后攻抽卡 → NONE', () => {
      expect(getNextSubPhase(SubPhase.LIVE_SET_FIRST_PLAYER)).toBe(SubPhase.LIVE_SET_FIRST_DRAW);
      expect(getNextSubPhase(SubPhase.LIVE_SET_FIRST_DRAW)).toBe(SubPhase.LIVE_SET_SECOND_PLAYER);
      expect(getNextSubPhase(SubPhase.LIVE_SET_SECOND_PLAYER)).toBe(SubPhase.LIVE_SET_SECOND_DRAW);
      expect(getNextSubPhase(SubPhase.LIVE_SET_SECOND_DRAW)).toBe(SubPhase.NONE);
    });

    it('盖牌子阶段需要用户操作', () => {
      expect(isUserActionRequired(SubPhase.LIVE_SET_FIRST_PLAYER)).toBe(true);
      expect(isUserActionRequired(SubPhase.LIVE_SET_SECOND_PLAYER)).toBe(true);
    });

    it('抽卡子阶段不需要用户操作（自动执行）', () => {
      expect(isUserActionRequired(SubPhase.LIVE_SET_FIRST_DRAW)).toBe(false);
      expect(isUserActionRequired(SubPhase.LIVE_SET_SECOND_DRAW)).toBe(false);
    });
  });

  describe('演出阶段子阶段流转', () => {
    it('翻开 → 判定 → NONE', () => {
      expect(getNextSubPhase(SubPhase.PERFORMANCE_REVEAL)).toBe(SubPhase.PERFORMANCE_JUDGMENT);
      expect(getNextSubPhase(SubPhase.PERFORMANCE_JUDGMENT)).toBe(SubPhase.NONE);
    });

    it('翻开子阶段不需要用户操作（自动执行）', () => {
      expect(isUserActionRequired(SubPhase.PERFORMANCE_REVEAL)).toBe(false);
    });

    it('判定子阶段需要用户操作', () => {
      expect(isUserActionRequired(SubPhase.PERFORMANCE_JUDGMENT)).toBe(true);
    });
  });

  describe('Live 结算阶段子阶段流转', () => {
    it('结算 → 回合结束 → NONE', () => {
      expect(getNextSubPhase(SubPhase.RESULT_SETTLEMENT)).toBe(SubPhase.RESULT_TURN_END);
      expect(getNextSubPhase(SubPhase.RESULT_TURN_END)).toBe(SubPhase.NONE);
    });

    it('回合结束子阶段不需要用户操作', () => {
      expect(isUserActionRequired(SubPhase.RESULT_TURN_END)).toBe(false);
    });
  });
});

// ============================================
// PhaseManager 子阶段推进测试
// ============================================

describe('PhaseManager 子阶段推进测试', () => {
  const pm = new PhaseManager();

  describe('advanceToNextSubPhase', () => {
    it('应该正确推进到下一个子阶段', () => {
      const mockGame = {
        currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
        activePlayerIndex: 0,
        firstPlayerIndex: 0,
        players: [{ id: 'p1' }, { id: 'p2' }],
      } as unknown as GameState;

      const result = pm.advanceToNextSubPhase(mockGame);

      expect(result.newSubPhase).toBe(SubPhase.LIVE_SET_FIRST_DRAW);
      expect(result.shouldAdvancePhase).toBe(false);
    });

    it('当下一个子阶段是 NONE 时，应该标记需要推进主阶段', () => {
      const mockGame = {
        currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
        activePlayerIndex: 0,
        firstPlayerIndex: 0,
        players: [{ id: 'p1' }, { id: 'p2' }],
      } as unknown as GameState;

      const result = pm.advanceToNextSubPhase(mockGame);

      expect(result.newSubPhase).toBe(SubPhase.NONE);
      expect(result.shouldAdvancePhase).toBe(true);
    });

    it('Live 设置抽卡子阶段应该返回 DRAW_CARDS_FOR_LIVE_SET 自动处理', () => {
      const mockGame = {
        currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
        activePlayerIndex: 0,
        firstPlayerIndex: 0,
        players: [{ id: 'p1' }, { id: 'p2' }],
      } as unknown as GameState;

      const result = pm.advanceToNextSubPhase(mockGame);

      expect(result.autoActions).toHaveLength(1);
      expect(result.autoActions[0].type).toBe('DRAW_CARDS_FOR_LIVE_SET');
      expect((result.autoActions[0] as { playerId: string }).playerId).toBe('p1');
    });

    it('演出阶段翻开子阶段应该推进到判定子阶段', () => {
      const mockGame = {
        currentSubPhase: SubPhase.PERFORMANCE_REVEAL,
        activePlayerIndex: 0,
        firstPlayerIndex: 0,
        players: [{ id: 'p1' }, { id: 'p2' }],
      } as unknown as GameState;

      // 从 PERFORMANCE_REVEAL 推进到 PERFORMANCE_JUDGMENT
      const result = pm.advanceToNextSubPhase(mockGame);

      expect(result.newSubPhase).toBe(SubPhase.PERFORMANCE_JUDGMENT);
    });
  });

  describe('applySubPhaseTransition', () => {
    it('应该正确应用子阶段转换到游戏状态', () => {
      const mockGame = {
        currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      } as unknown as GameState;

      const result = {
        newSubPhase: SubPhase.LIVE_SET_FIRST_DRAW,
        shouldAdvancePhase: false,
        autoActions: [],
      };

      const newState = pm.applySubPhaseTransition(mockGame, result);

      expect(newState.currentSubPhase).toBe(SubPhase.LIVE_SET_FIRST_DRAW);
    });
  });
});

// ============================================
// 完整游戏流程中的子阶段测试
// ============================================

describe('完整游戏流程中的子阶段测试', () => {
  let gameService: GameService;
  let game: GameState;

  beforeEach(() => {
    gameService = new GameService();
    const created = gameService.createGame('test', 'p1', '玩家1', 'p2', '玩家2');
    const deck = createTestDeck();
    const result = gameService.initializeGame(created, deck, deck);
    game = result.gameState;
  });

  describe('换牌阶段', () => {
    it('游戏开始应该进入换牌阶段', () => {
      expect(game.currentPhase).toBe(GamePhase.MULLIGAN_PHASE);
    });

    it('先攻玩家换牌后，应该等待后攻玩家', () => {
      // 先攻玩家换牌
      const action1 = createMulliganAction('p1', []);
      const result1 = gameService.processAction(game, action1);

      expect(result1.success).toBe(true);
      expect(result1.gameState.currentPhase).toBe(GamePhase.MULLIGAN_PHASE);
      expect(result1.gameState.mulliganCompletedPlayers).toContain('p1');
      expect(result1.gameState.mulliganCompletedPlayers).not.toContain('p2');
    });

    it('双方都换牌后，应该进入活跃阶段', () => {
      // 先攻玩家换牌
      const action1 = createMulliganAction('p1', []);
      const result1 = gameService.processAction(game, action1);
      let state = result1.gameState;

      // 后攻玩家换牌
      const action2 = createMulliganAction('p2', []);
      const result2 = gameService.processAction(state, action2);
      state = result2.gameState;

      expect(result2.success).toBe(true);
      expect(state.currentPhase).toBe(GamePhase.ACTIVE_PHASE);
    });
  });

  describe('Live 设置阶段', () => {
    let stateInLiveSet: GameState;

    beforeEach(() => {
      // 推进到 Live 设置阶段
      let state = game;

      // 换牌
      state = gameService.processAction(state, createMulliganAction('p1', [])).gameState;
      state = gameService.processAction(state, createMulliganAction('p2', [])).gameState;

      // 先攻通常阶段 (活跃 → 能量 → 抽卡 → 主要)
      for (let i = 0; i < 3; i++) {
        state = gameService.advancePhase(state).gameState;
      }
      state = gameService.processAction(state, createEndPhaseAction('p1')).gameState;

      // 后攻通常阶段
      for (let i = 0; i < 3; i++) {
        state = gameService.advancePhase(state).gameState;
      }
      state = gameService.processAction(state, createEndPhaseAction('p2')).gameState;

      stateInLiveSet = state;
    });

    it('应该正确进入 Live 设置阶段', () => {
      expect(stateInLiveSet.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);
    });

    it('Live 设置阶段应该设置初始子阶段为先攻盖牌', () => {
      expect(stateInLiveSet.currentSubPhase).toBe(SubPhase.LIVE_SET_FIRST_PLAYER);
    });

    it('先攻玩家完成设置后，后攻玩家可以设置', () => {
      // 先攻跳过设置
      const skip1 = createConfirmSubPhaseAction('p1', stateInLiveSet.currentSubPhase);
      const result1 = gameService.processAction(stateInLiveSet, skip1);

      expect(result1.success).toBe(true);
      // 先攻已完成
      expect(result1.gameState.liveSetCompletedPlayers).toContain('p1');
    });

    it('双方都完成 Live 设置后，应该进入演出阶段', () => {
      // 先攻跳过设置
      let state = gameService.processAction(
        stateInLiveSet,
        createConfirmSubPhaseAction('p1', stateInLiveSet.currentSubPhase)
      ).gameState;

      // 后攻跳过设置
      const result = gameService.processAction(state, createConfirmSubPhaseAction('p2', state.currentSubPhase));
      state = result.gameState;

      expect(result.success).toBe(true);
      expect(state.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    });
  });
});

// ============================================
// 子阶段配置完整性测试
// ============================================

describe('子阶段配置完整性测试', () => {
  it('所有子阶段都应该有配置', () => {
    const allSubPhases = Object.values(SubPhase);

    for (const subPhase of allSubPhases) {
      const config = getSubPhaseConfig(subPhase);
      expect(config, `子阶段 ${subPhase} 应该有配置`).toBeDefined();
    }
  });

  it('所有配置了 nextSubPhase 的子阶段应该指向有效的子阶段', () => {
    const allSubPhases = Object.values(SubPhase);

    for (const subPhase of allSubPhases) {
      const config = getSubPhaseConfig(subPhase);
      if (config?.behavior.nextSubPhase) {
        expect(
          Object.values(SubPhase).includes(config.behavior.nextSubPhase),
          `子阶段 ${subPhase} 的 nextSubPhase ${config.behavior.nextSubPhase} 应该是有效的子阶段`
        ).toBe(true);
      }
    }
  });

  it('子阶段流转不应该有循环（除了明确设计的）', () => {
    const visited = new Set<SubPhase>();
    const chains = [
      SubPhase.MULLIGAN_FIRST_PLAYER,
      SubPhase.LIVE_SET_FIRST_PLAYER,
      SubPhase.PERFORMANCE_REVEAL,
      SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    ];

    for (const startPhase of chains) {
      visited.clear();
      let current = startPhase;
      let iterations = 0;
      const maxIterations = 20;

      while (current !== SubPhase.NONE && iterations < maxIterations) {
        expect(
          visited.has(current),
          `子阶段链 ${startPhase} 不应该有循环，发现重复: ${current}`
        ).toBe(false);
        visited.add(current);
        current = getNextSubPhase(current);
        iterations++;
      }

      expect(iterations).toBeLessThan(maxIterations);
    }
  });
});
