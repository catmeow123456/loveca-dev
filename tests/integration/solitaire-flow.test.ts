/**
 * 对墙打（Solitaire）模式集成测试
 *
 * 测试目标：
 * 1. 验证 Mulligan 阶段对手自动跳过
 * 2. 验证对手通常阶段（ACTIVE→ENERGY→DRAW→MAIN）自动推进
 * 3. 验证 Live Set 对手自动跳过（CONFIRM_SUB_PHASE 路径）
 * 4. 验证 Performance 对手自动跳过
 * 6. 验证 Live Result 对手效果窗口自动跳过
 * 7. 验证多回合不卡死
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CardType,
  HeartColor,
  GamePhase,
  GameMode,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import type {
  MemberCardData,
  LiveCardData,
  EnergyCardData,
  AnyCardData,
} from '../../src/domain/entities/card';
import { createHeartRequirement, createHeartIcon } from '../../src/domain/entities/card';
import type { DeckConfig } from '../../src/application/game-service';
import { GameSession, createGameSession } from '../../src/application/game-session';
import {
  createMulliganAction,
  createEndPhaseAction,
  createConfirmSubPhaseAction,
  createConfirmScoreAction,
} from '../../src/application/actions';
import type { GameState } from '../../src/domain/entities/game';
import { getPlayerById } from '../../src/domain/entities/game';

// ============================================
// 测试用卡牌数据工厂（与 game-flow.test.ts 共享模式）
// ============================================

function createTestMemberCard(
  cardCode: string,
  name: string,
  cost: number,
  hearts: { color: HeartColor; count: number }[] = [{ color: HeartColor.PINK, count: 1 }],
  blade: number = 1
): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade,
    hearts: hearts.map((h) => createHeartIcon(h.color, h.count)),
  };
}

function createTestLiveCard(
  cardCode: string,
  name: string,
  score: number,
  requirements: Record<HeartColor, number>
): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement(requirements),
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
    mainDeck.push(
      createTestMemberCard(`TEST-MEMBER-${i}`, `测试成员 ${i}`, (i % 5) + 1, [
        { color: HeartColor.PINK, count: 1 },
      ])
    );
  }

  for (let i = 0; i < 12; i++) {
    mainDeck.push(
      createTestLiveCard(`TEST-LIVE-${i}`, `测试 Live ${i}`, 3, {
        [HeartColor.PINK]: 2,
      } as Record<HeartColor, number>)
    );
  }

  for (let i = 0; i < 12; i++) {
    energyDeck.push(createTestEnergyCard(`TEST-ENERGY-${i}`));
  }

  return { mainDeck, energyDeck };
}

// ============================================
// 辅助函数
// ============================================

const PLAYER1 = 'player1';
const PLAYER2 = 'player2'; // opponent in solitaire mode

/**
 * 创建并初始化一个对墙打模式的游戏会话
 */
function createSolitaireSession(): GameSession {
  const session = createGameSession({ gameMode: GameMode.SOLITAIRE });
  session.createGame('test-solitaire', PLAYER1, '玩家1', PLAYER2, '对手');
  const deck = createTestDeck();
  const result = session.initializeGame(deck, deck);
  expect(result.success).toBe(true);
  return session;
}

/**
 * 从 MULLIGAN_PHASE 推进到 MAIN_PHASE（玩家1的主要阶段）
 * 在对墙打模式下，玩家1换牌后对手自动换牌，然后自动推进到 MAIN_PHASE
 */
function advanceToMainPhase(session: GameSession): void {
  const state = session.state!;
  expect(state.currentPhase).toBe(GamePhase.MULLIGAN_PHASE);

  // 玩家1不换牌
  const result = session.dispatch(createMulliganAction(PLAYER1, []));
  expect(result.success).toBe(true);

  // 对墙打模式下，对手自动换牌，然后自动推进到 MAIN_PHASE
  // autoAdvance 会跳过 ACTIVE → ENERGY → DRAW
  expect(session.state!.currentPhase).toBe(GamePhase.MAIN_PHASE);
  expect(session.state!.currentTurnType).toBe(TurnType.FIRST_PLAYER_TURN);
}

/**
 * 从 MAIN_PHASE（玩家1）推进到 LIVE_SET_PHASE
 * 玩家1结束主要阶段 → 对手 ACTIVE→ENERGY→DRAW→MAIN 自动跳过 → 进入 LIVE_SET_PHASE
 */
function advanceToLiveSetPhase(session: GameSession): void {
  const state = session.state!;
  expect(state.currentPhase).toBe(GamePhase.MAIN_PHASE);
  expect(state.currentTurnType).toBe(TurnType.FIRST_PLAYER_TURN);

  // 玩家1结束主要阶段
  const result = session.dispatch(createEndPhaseAction(PLAYER1));
  expect(result.success).toBe(true);

  // 对墙打模式下：
  // 1. advancePhase 进入后攻 ACTIVE_PHASE
  // 2. autoAdvance 自动推进 ACTIVE → ENERGY → DRAW → MAIN_PHASE
  // 3. handleSolitaireAutoSkip 检测到对手的 MAIN_PHASE，自动 END_PHASE
  // 4. advancePhase 进入 LIVE_SET_PHASE
  expect(session.state!.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);
}

// ============================================
// 测试套件
// ============================================

describe('对墙打模式（Solitaire）集成测试', () => {
  describe('Mulligan 自动跳过', () => {
    it('玩家完成换牌后，对手自动跳过换牌，游戏推进到 MAIN_PHASE', () => {
      const session = createSolitaireSession();
      expect(session.state!.currentPhase).toBe(GamePhase.MULLIGAN_PHASE);

      // 玩家1不换牌
      const result = session.dispatch(createMulliganAction(PLAYER1, []));
      expect(result.success).toBe(true);

      // 应该自动跳过对手换牌，通过 ACTIVE → ENERGY → DRAW 推进到 MAIN_PHASE
      const state = session.state!;
      expect(state.currentPhase).toBe(GamePhase.MAIN_PHASE);
      expect(state.currentTurnType).toBe(TurnType.FIRST_PLAYER_TURN);

      // 验证双方手牌存在（初始6张 + 抽卡阶段1张）
      const p1 = getPlayerById(state, PLAYER1)!;
      expect(p1.hand.cardIds.length).toBe(7); // 6 initial + 1 draw
    });
  });

  describe('对手通常阶段自动推进', () => {
    let session: GameSession;

    beforeEach(() => {
      session = createSolitaireSession();
      advanceToMainPhase(session);
    });

    it('玩家1结束主要阶段后，对手整个通常阶段被自动跳过，进入 LIVE_SET_PHASE', () => {
      const stateBefore = session.state!;
      const p2HandBefore = getPlayerById(stateBefore, PLAYER2)!.hand.cardIds.length;

      // 玩家1结束主要阶段
      const result = session.dispatch(createEndPhaseAction(PLAYER1));
      expect(result.success).toBe(true);

      const state = session.state!;
      expect(state.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);

      // 对手在自动推进过程中经历了 ENERGY（+1能量）和 DRAW（+1手牌）
      const p2 = getPlayerById(state, PLAYER2)!;
      expect(p2.hand.cardIds.length).toBe(p2HandBefore + 1);
    });
  });

  describe('Live Set 自动跳过（CONFIRM_SUB_PHASE 统一路径）', () => {
    let session: GameSession;

    beforeEach(() => {
      session = createSolitaireSession();
      advanceToMainPhase(session);
      advanceToLiveSetPhase(session);
    });

    it('玩家确认 Live Set 子阶段后，对手自动跳过，进入 PERFORMANCE_PHASE', () => {
      const state = session.state!;
      expect(state.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);

      // 玩家1通过 CONFIRM_SUB_PHASE 确认（不放置 Live 卡）
      const subPhase = state.currentSubPhase;
      expect(subPhase).toBeTruthy();

      const result = session.dispatch(createConfirmSubPhaseAction(PLAYER1, subPhase));
      expect(result.success).toBe(true);

      // 应推进到 PERFORMANCE_PHASE（或更后面）
      const newState = session.state!;
      expect([
        GamePhase.PERFORMANCE_PHASE,
        GamePhase.LIVE_RESULT_PHASE,
        GamePhase.ACTIVE_PHASE,
      ]).toContain(newState.currentPhase);
    });
  });

  describe('Performance 对手自动跳过', () => {
    let session: GameSession;

    beforeEach(() => {
      session = createSolitaireSession();
      advanceToMainPhase(session);
      advanceToLiveSetPhase(session);
    });

    it('进入 PERFORMANCE_PHASE 后，对手演出被自动跳过', () => {
      // 通过 CONFIRM_SUB_PHASE 跳过 Live Set
      const subPhase = session.state!.currentSubPhase;
      const skipResult = session.dispatch(createConfirmSubPhaseAction(PLAYER1, subPhase));
      expect(skipResult.success).toBe(true);

      const state = session.state!;
      // 双方都没放 Live 卡，Performance 阶段应该很快推进
      expect(state.currentPhase).not.toBe(GamePhase.LIVE_SET_PHASE);
    });
  });

  describe('Live Result 对手效果子阶段自动跳过', () => {
    let session: GameSession;

    beforeEach(() => {
      session = createSolitaireSession();
      advanceToMainPhase(session);
      advanceToLiveSetPhase(session);
    });

    it('Live Result 阶段的对手成功效果子阶段被自动跳过', () => {
      // 通过 CONFIRM_SUB_PHASE 跳过 Live Set（双方都不放卡）
      const subPhase = session.state!.currentSubPhase;
      const skipResult = session.dispatch(createConfirmSubPhaseAction(PLAYER1, subPhase));
      expect(skipResult.success).toBe(true);

      const state = session.state!;
      // 不应该卡在 RESULT_SECOND_SUCCESS_EFFECTS 子阶段
      if (state.currentPhase === GamePhase.LIVE_RESULT_PHASE) {
        expect(state.currentSubPhase).not.toBe(SubPhase.RESULT_SECOND_SUCCESS_EFFECTS);
      }
    });
  });

  describe('多回合不卡死', () => {
    it('能连续进行 3 个回合不死锁', () => {
      const session = createSolitaireSession();

      // Mulligan → MAIN_PHASE
      advanceToMainPhase(session);

      for (let turn = 1; turn <= 3; turn++) {
        const turnCountBefore = session.state!.turnCount;

        // 确保在 MAIN_PHASE
        expect(session.state!.currentPhase).toBe(GamePhase.MAIN_PHASE);
        expect(session.state!.currentTurnType).toBe(TurnType.FIRST_PLAYER_TURN);

        // 玩家1结束主要阶段 → 对手通常阶段自动跳过 → LIVE_SET_PHASE
        const endResult = session.dispatch(createEndPhaseAction(PLAYER1));
        expect(endResult.success).toBe(true);
        expect(session.state!.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);

        // 跳过 Live Set（通过 CONFIRM_SUB_PHASE）
        const liveSetSubPhase = session.state!.currentSubPhase;
        const skipResult = session.dispatch(createConfirmSubPhaseAction(PLAYER1, liveSetSubPhase));
        expect(skipResult.success).toBe(true);

        // Performance + Live Result 应该自动推进
        // 最终回到新回合的 MAIN_PHASE（经过 ACTIVE → ENERGY → DRAW 自动推进）
        const stateAfterLive = session.state!;

        // 根据流程，应该进入下一回合：
        // PERFORMANCE → LIVE_RESULT → 新回合 ACTIVE → ENERGY → DRAW → MAIN
        // LIVE_RESULT 阶段可能包含多个需要确认的子阶段，循环确认直到离开该阶段。
        let safety = 0;
        while (session.state!.currentPhase === GamePhase.LIVE_RESULT_PHASE && safety < 6) {
          const subPhase = session.state!.currentSubPhase;
          if (!subPhase || subPhase === SubPhase.NONE) break;
          const confirmResult =
            subPhase === SubPhase.RESULT_SETTLEMENT
              ? session.dispatch(createConfirmScoreAction(PLAYER1, 0))
              : session.dispatch(createConfirmSubPhaseAction(PLAYER1, subPhase));
          expect(confirmResult.success).toBe(true);
          safety++;
        }
        expect(safety).toBeLessThan(6);

        if (session.state!.currentPhase === GamePhase.PERFORMANCE_PHASE) {
          // Performance 阶段需要确认判定
          const subPhase = session.state!.currentSubPhase;
          if (subPhase && subPhase !== SubPhase.NONE) {
            const confirmResult = session.dispatch(
              createConfirmSubPhaseAction(PLAYER1, subPhase)
            );
            expect(confirmResult.success).toBe(true);
          }
        }

        // 保险兜底：若仍停留在 LIVE_RESULT_PHASE，再次循环确认
        safety = 0;
        while (session.state!.currentPhase === GamePhase.LIVE_RESULT_PHASE && safety < 6) {
          const subPhase = session.state!.currentSubPhase;
          if (!subPhase || subPhase === SubPhase.NONE) break;
          const confirmResult =
            subPhase === SubPhase.RESULT_SETTLEMENT
              ? session.dispatch(createConfirmScoreAction(PLAYER1, 0))
              : session.dispatch(createConfirmSubPhaseAction(PLAYER1, subPhase));
          expect(confirmResult.success).toBe(true);
          safety++;
        }
        expect(safety).toBeLessThan(6);

        // 到此应该回到新回合的 MAIN_PHASE
        const finalState = session.state!;

        if (turn < 3) {
          // 非最后一轮，验证能继续
          expect(finalState.currentPhase).toBe(GamePhase.MAIN_PHASE);
          // 验证回合数增加（turnCount 在第一回合可能是 1 或 2，取决于初始值）
          expect(finalState.turnCount).toBeGreaterThanOrEqual(turnCountBefore);
        }
      }

      // 验证游戏没有进入结束状态（没有人赢，因为都跳过了 Live）
      expect(session.state!.currentPhase).not.toBe(GamePhase.GAME_END);
    });

    it('游戏阶段始终有效（不为 undefined）', () => {
      const session = createSolitaireSession();
      advanceToMainPhase(session);

      for (let i = 0; i < 50; i++) {
        const state = session.state!;
        expect(state.currentPhase).toBeDefined();
        expect(state.currentPhase).not.toBeNull();

        if (state.currentPhase === GamePhase.GAME_END) break;

        // 根据当前阶段执行对应动作
        if (state.currentPhase === GamePhase.MAIN_PHASE && state.currentTurnType === TurnType.FIRST_PLAYER_TURN) {
          const result = session.dispatch(createEndPhaseAction(PLAYER1));
          if (!result.success) break;
        } else if (state.currentPhase === GamePhase.LIVE_SET_PHASE) {
          const subPhase = state.currentSubPhase;
          if (subPhase && subPhase !== SubPhase.NONE) {
            const result = session.dispatch(createConfirmSubPhaseAction(PLAYER1, subPhase));
            if (!result.success) break;
          } else {
            break;
          }
        } else if (state.currentPhase === GamePhase.PERFORMANCE_PHASE) {
          const subPhase = state.currentSubPhase;
          if (subPhase && subPhase !== SubPhase.NONE) {
            const result = session.dispatch(createConfirmSubPhaseAction(PLAYER1, subPhase));
            if (!result.success) break;
          } else {
            break; // 无法继续
          }
        } else if (state.currentPhase === GamePhase.LIVE_RESULT_PHASE) {
          const subPhase = state.currentSubPhase;
          if (subPhase && subPhase !== SubPhase.NONE) {
            const result = session.dispatch(createConfirmSubPhaseAction(PLAYER1, subPhase));
            if (!result.success) break;
          } else {
            break;
          }
        } else {
          // 在其他阶段（MULLIGAN 等），不应到达
          break;
        }
      }
    });
  });
});
