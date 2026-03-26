/**
 * 模拟完整对局测试
 *
 * 这个测试模拟一场完整的游戏对局，包括：
 * - 游戏初始化
 * - 通常阶段循环（活跃→能量→抽卡→主要）
 * - 打出成员卡
 * - 阶段切换
 *
 * 每个重要步骤后都会打印游戏状态，方便观察效果
 */

import { describe, it, expect } from 'vitest';
import { CardType, HeartColor, GamePhase, SlotPosition, SubPhase } from '../../src/shared/types/enums';
import type {
  MemberCardData,
  LiveCardData,
  EnergyCardData,
  AnyCardData,
} from '../../src/domain/entities/card';
import { createHeartRequirement, createHeartIcon } from '../../src/domain/entities/card';
import { GameService, DeckConfig } from '../../src/application/game-service';
import {
  createPlayMemberAction,
  createEndPhaseAction,
  createMulliganAction,
  createConfirmSubPhaseAction,
} from '../../src/application/actions';
import { getPlayerById, getCardById } from '../../src/domain/entities/game';
import { GameVisualizer } from '../../src/debug/game-visualizer';

// ============================================
// 测试用卡牌数据
// ============================================

function createMemberCard(
  code: string,
  name: string,
  cost: number,
  blade: number = 1
): MemberCardData {
  return {
    cardCode: code,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(code: string, name: string, score: number): LiveCardData {
  return {
    cardCode: code,
    name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createEnergyCard(code: string): EnergyCardData {
  return { cardCode: code, name: '能量卡', cardType: CardType.ENERGY };
}

/**
 * 创建简化测试卡组
 */
function createSimpleDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  // 成员卡：不同费用
  for (let i = 0; i < 12; i++) {
    mainDeck.push(createMemberCard(`M-${i}`, `成员${i}号`, 1, 2)); // 费用1
  }
  for (let i = 12; i < 24; i++) {
    mainDeck.push(createMemberCard(`M-${i}`, `成员${i}号`, 2, 2)); // 费用2
  }
  for (let i = 24; i < 36; i++) {
    mainDeck.push(createMemberCard(`M-${i}`, `成员${i}号`, 3, 3)); // 费用3
  }
  for (let i = 36; i < 48; i++) {
    mainDeck.push(createMemberCard(`M-${i}`, `成员${i}号`, 4, 3)); // 费用4
  }

  // Live 卡
  for (let i = 0; i < 12; i++) {
    mainDeck.push(createLiveCard(`L-${i}`, `Live${i}号`, 3));
  }

  // 能量卡
  for (let i = 0; i < 12; i++) {
    energyDeck.push(createEnergyCard(`E-${i}`));
  }

  return { mainDeck, energyDeck };
}

/**
 * 辅助函数：跳过换牌阶段
 */
function skipMulliganPhase(
  service: GameService,
  state: import('../../src/domain/entities/game').GameState
): import('../../src/domain/entities/game').GameState {
  if (state.currentPhase !== GamePhase.MULLIGAN_PHASE) return state;

  // 先攻玩家确认不换牌
  const mulligan1 = createMulliganAction(state.players[state.firstPlayerIndex].id, []);
  const result1 = service.processAction(state, mulligan1);
  let currentState = result1.gameState;

  // 后攻玩家确认不换牌
  const secondPlayerIndex = state.firstPlayerIndex === 0 ? 1 : 0;
  const mulligan2 = createMulliganAction(state.players[secondPlayerIndex].id, []);
  const result2 = service.processAction(currentState, mulligan2);

  return result2.gameState;
}

// ============================================
// 模拟对局测试
// ============================================

describe('模拟对局测试', () => {
  const visualizer = new GameVisualizer({ colorEnabled: true });

  it('应该能完成游戏初始化并显示初始状态', () => {
    const service = new GameService();
    const game = service.createGame('sim-1', 'alice', 'Alice', 'bob', 'Bob');
    const initResult = service.initializeGame(game, createSimpleDeck(), createSimpleDeck());

    expect(initResult.success).toBe(true);

    // 跳过换牌阶段
    const state = skipMulliganPhase(service, initResult.gameState);

    // 打印初始状态

    console.log('\n========== 游戏初始化完成 ==========\n');
    visualizer.printGameState(state);

    // 验证初始状态
    const p1 = getPlayerById(state, 'alice');
    const p2 = getPlayerById(state, 'bob');

    expect(p1?.hand.cardIds.length).toBe(6);
    expect(p2?.hand.cardIds.length).toBe(6);
    expect(p1?.energyZone.cardIds.length).toBe(3);
    expect(state.currentPhase).toBe(GamePhase.ACTIVE_PHASE);
  });

  it('应该能完成先攻玩家的通常阶段', () => {
    const service = new GameService();
    let game = service.createGame('sim-2', 'alice', 'Alice', 'bob', 'Bob');
    let result = service.initializeGame(game, createSimpleDeck(), createSimpleDeck());
    let state = skipMulliganPhase(service, result.gameState);

    console.log('\n========== 模拟先攻通常阶段 ==========\n');

    // 活跃阶段 → 能量阶段
    visualizer.printAction('推进到能量阶段');
    result = service.advancePhase(state);
    state = result.gameState;
    visualizer.printSummary(state);

    // 能量阶段 → 抽卡阶段
    visualizer.printAction('推进到抽卡阶段');
    result = service.advancePhase(state);
    state = result.gameState;
    visualizer.printSummary(state);

    // 抽卡阶段 → 主要阶段
    visualizer.printAction('推进到主要阶段');
    result = service.advancePhase(state);
    state = result.gameState;
    visualizer.printSummary(state);

    // 打印此时玩家1的手牌
    visualizer.printHand(state, 'alice');

    expect(state.currentPhase).toBe(GamePhase.MAIN_PHASE);
  });

  it('应该能在主要阶段打出成员卡', () => {
    const service = new GameService();
    let game = service.createGame('sim-3', 'alice', 'Alice', 'bob', 'Bob');
    let result = service.initializeGame(game, createSimpleDeck(), createSimpleDeck());
    let state = skipMulliganPhase(service, result.gameState);

    // 推进到主要阶段 (活跃 -> 能量 -> 抽卡 -> 主要)
    for (let i = 0; i < 3; i++) {
      result = service.advancePhase(state);
      state = result.gameState;
    }

    console.log('\n========== 模拟打出成员卡 ==========\n');
    visualizer.printAction('进入主要阶段');
    visualizer.printSummary(state);
    visualizer.printHand(state, 'alice');

    // 找一张费用 <= 4 的成员卡
    const p1 = getPlayerById(state, 'alice')!;
    let targetCardId: string | null = null;

    for (const cardId of p1.hand.cardIds) {
      const card = getCardById(state, cardId);
      if (card && card.data.cardType === CardType.MEMBER) {
        const memberData = card.data as MemberCardData;
        if (memberData.cost <= 4) {
          targetCardId = cardId;
          break;
        }
      }
    }

    if (targetCardId) {
      const card = getCardById(state, targetCardId)!;
      visualizer.printAction(`打出成员: ${card.data.name}`);

      const playAction = createPlayMemberAction('alice', targetCardId, SlotPosition.CENTER);
      result = service.processAction(state, playAction);

      if (result.success) {
        visualizer.printSuccess('成员卡打出成功');
        state = result.gameState;
        visualizer.printSummary(state);
        visualizer.printGameState(state);
      } else {
        visualizer.printError(result.error ?? '未知错误');
      }

      expect(result.success).toBe(true);
    }
  });

  it('应该能完成双方通常阶段', () => {
    const service = new GameService();
    let game = service.createGame('sim-4', 'alice', 'Alice', 'bob', 'Bob');
    let result = service.initializeGame(game, createSimpleDeck(), createSimpleDeck());
    let state = skipMulliganPhase(service, result.gameState);

    console.log('\n========== 模拟完整回合 ==========\n');

    // ===== 先攻通常阶段 =====
    visualizer.printAction('开始先攻通常阶段');

    // 推进到主要阶段 (活跃 -> 能量 -> 抽卡 -> 主要)
    for (let i = 0; i < 3; i++) {
      result = service.advancePhase(state);
      state = result.gameState;
    }

    visualizer.printSummary(state);

    // 先攻玩家打出一张成员
    const p1 = getPlayerById(state, 'alice')!;
    for (const cardId of p1.hand.cardIds) {
      const card = getCardById(state, cardId);
      if (card && card.data.cardType === CardType.MEMBER) {
        const memberData = card.data as MemberCardData;
        if (memberData.cost <= 4) {
          const action = createPlayMemberAction('alice', cardId, SlotPosition.CENTER);
          result = service.processAction(state, action);
          if (result.success) {
            state = result.gameState;
            visualizer.printSuccess(`Alice 打出 ${memberData.name}`);
          }
          break;
        }
      }
    }

    // 结束主要阶段，切换到后攻玩家
    visualizer.printAction('结束先攻主要阶段');
    const endAction = createEndPhaseAction('alice');
    result = service.processAction(state, endAction);
    state = result.gameState;

    // ===== 后攻通常阶段 =====
    visualizer.printAction('开始后攻通常阶段');
    visualizer.printSummary(state);

    // 推进后攻玩家的阶段
    for (let i = 0; i < 3; i++) {
      result = service.advancePhase(state);
      state = result.gameState;
    }

    visualizer.printSummary(state);

    // 后攻玩家打出一张成员
    const p2 = getPlayerById(state, 'bob')!;
    for (const cardId of p2.hand.cardIds) {
      const card = getCardById(state, cardId);
      if (card && card.data.cardType === CardType.MEMBER) {
        const memberData = card.data as MemberCardData;
        if (memberData.cost <= 4) {
          const action = createPlayMemberAction('bob', cardId, SlotPosition.CENTER);
          result = service.processAction(state, action);
          if (result.success) {
            state = result.gameState;
            visualizer.printSuccess(`Bob 打出 ${memberData.name}`);
          }
          break;
        }
      }
    }

    // 打印最终状态
    visualizer.printSeparator();
    visualizer.printAction('双方通常阶段结束时的游戏状态');
    visualizer.printGameState(state);

    expect(state.turnCount).toBeGreaterThanOrEqual(1);
    expect(state.currentPhase).toBe(GamePhase.MAIN_PHASE);
  });

  /**
   * 测试完整的一个回合（包含 Live 阶段）
   * 根据规则 7.1.2：各回合按照'先攻通常阶段'、'后攻通常阶段'、'live阶段'的顺序推进
   */
  it('应该能完成完整的一个回合（包含 Live 阶段）', () => {
    const service = new GameService();
    let game = service.createGame('sim-5', 'alice', 'Alice', 'bob', 'Bob');
    let result = service.initializeGame(game, createSimpleDeck(), createSimpleDeck());
    let state = skipMulliganPhase(service, result.gameState);

    console.log('\n========== 模拟完整回合（含 Live 阶段） ==========\n');

    // ===== 先攻通常阶段 =====
    visualizer.printAction('【先攻通常阶段】开始');

    // 推进到主要阶段 (活跃→能量→抽卡→主要)
    for (let i = 0; i < 3; i++) {
      result = service.advancePhase(state);
      state = result.gameState;
    }

    // 先攻玩家打出一张成员
    const p1 = getPlayerById(state, 'alice')!;
    for (const cardId of p1.hand.cardIds) {
      const card = getCardById(state, cardId);
      if (card && card.data.cardType === CardType.MEMBER) {
        const memberData = card.data as MemberCardData;
        if (memberData.cost <= 4) {
          const action = createPlayMemberAction('alice', cardId, SlotPosition.CENTER);
          result = service.processAction(state, action);
          if (result.success) {
            state = result.gameState;
            visualizer.printSuccess(`Alice 打出 ${memberData.name}`);
          }
          break;
        }
      }
    }

    // 结束先攻主要阶段
    result = service.processAction(state, createEndPhaseAction('alice'));
    state = result.gameState;

    // ===== 后攻通常阶段 =====
    visualizer.printAction('【后攻通常阶段】开始');

    // 推进到主要阶段 (活跃→能量→抽卡→主要)
    for (let i = 0; i < 3; i++) {
      result = service.advancePhase(state);
      state = result.gameState;
    }

    // 后攻玩家打出一张成员
    const p2 = getPlayerById(state, 'bob')!;
    for (const cardId of p2.hand.cardIds) {
      const card = getCardById(state, cardId);
      if (card && card.data.cardType === CardType.MEMBER) {
        const memberData = card.data as MemberCardData;
        if (memberData.cost <= 4) {
          const action = createPlayMemberAction('bob', cardId, SlotPosition.CENTER);
          result = service.processAction(state, action);
          if (result.success) {
            state = result.gameState;
            visualizer.printSuccess(`Bob 打出 ${memberData.name}`);
          }
          break;
        }
      }
    }

    // 结束后攻主要阶段，进入 Live 阶段
    visualizer.printAction('结束后攻主要阶段，进入 Live 阶段');
    result = service.processAction(state, createEndPhaseAction('bob'));
    state = result.gameState;

    // ===== Live 阶段 =====
    // 规则 8.1.2：live阶段按照'live卡设置阶段'→'先攻演出阶段'→'后攻演出阶段'→'live胜败判定阶段'的顺序执行

    // 验证进入 Live 卡设置阶段
    visualizer.printAction('【Live 卡设置阶段】');
    expect(state.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);
    visualizer.printSummary(state);

    // 先攻和后攻玩家都可以设置 Live 卡（简化：这里跳过设置）
    // 规则 8.2.2/8.2.4：玩家选择手牌最多3张里侧放到live卡放置区

    // 先攻玩家跳过/完成 Live 设置
    visualizer.printAction('Alice 完成 Live 设置');
    result = service.processAction(state, createConfirmSubPhaseAction('alice', state.currentSubPhase));
    expect(result.success).toBe(true);
    state = result.gameState;

    // 后攻玩家跳过/完成 Live 设置
    visualizer.printAction('Bob 完成 Live 设置');
    result = service.processAction(state, createConfirmSubPhaseAction('bob', state.currentSubPhase));
    expect(result.success).toBe(true);
    state = result.gameState;

    // 推进到先攻演出阶段（双方完成设置后自动进入）
    visualizer.printAction('【先攻演出阶段】');
    expect(state.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    visualizer.printSummary(state);

    // 推进到后攻演出阶段
    visualizer.printAction('【后攻演出阶段】');
    result = service.advancePhase(state);
    state = result.gameState;
    expect(state.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    visualizer.printSummary(state);

    // 推进到 Live 胜败判定阶段
    visualizer.printAction('【Live 胜败判定阶段】');
    result = service.advancePhase(state);
    state = result.gameState;
    expect(state.currentPhase).toBe(GamePhase.LIVE_RESULT_PHASE);
    visualizer.printSummary(state);

    // 推进到下一回合的活跃阶段
    visualizer.printAction('【新回合开始】');
    result = service.advancePhase(state);
    state = result.gameState;

    // 验证进入新回合
    expect(state.currentPhase).toBe(GamePhase.ACTIVE_PHASE);
    expect(state.turnCount).toBe(2); // 回合数应该增加到 2

    visualizer.printSeparator();
    visualizer.printAction('第二回合开始时的游戏状态');
    visualizer.printGameState(state);

    visualizer.printSuccess('完整回合（含 Live 阶段）模拟完成！');
  });
});
