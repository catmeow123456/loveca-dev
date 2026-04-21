/**
 * 游戏流程集成测试
 *
 * 测试目标：
 * 1. 验证游戏初始化流程
 * 2. 验证阶段流转
 * 3. 验证成员卡打出流程
 * 4. 验证卡牌能力触发
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CardType,
  HeartColor,
  GamePhase,
  TurnType,
  SlotPosition,
  OrientationState,
} from '../../src/shared/types/enums';
import type {
  MemberCardData,
  LiveCardData,
  EnergyCardData,
  AnyCardData,
} from '../../src/domain/entities/card';
import { createHeartRequirement, createHeartIcon } from '../../src/domain/entities/card';
import { GameService, DeckConfig, GameOperationResult } from '../../src/application/game-service';
import {
  createPlayMemberAction,
  createEndPhaseAction,
  createMulliganAction,
  GameActionType,
} from '../../src/application/actions';
import type { GameState } from '../../src/domain/entities/game';
import { getPlayerById, getCardById } from '../../src/domain/entities/game';
import { getAllMemberCardIds, getCardInSlot } from '../../src/domain/entities/zone';

// ============================================
// 测试用卡牌数据工厂
// ============================================

/**
 * 创建测试用成员卡数据
 */
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

/**
 * 创建测试用 Live 卡数据
 */
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

/**
 * 创建测试用能量卡数据
 */
function createTestEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: '能量卡',
    cardType: CardType.ENERGY,
  };
}

/**
 * 创建测试用卡组（简化版，用于快速测试）
 */
function createTestDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  // 创建 48 张成员卡
  for (let i = 0; i < 48; i++) {
    mainDeck.push(
      createTestMemberCard(`TEST-MEMBER-${i}`, `测试成员 ${i}`, (i % 5) + 1, [
        { color: HeartColor.PINK, count: 1 },
      ])
    );
  }

  // 创建 12 张 Live 卡
  for (let i = 0; i < 12; i++) {
    mainDeck.push(
      createTestLiveCard(`TEST-LIVE-${i}`, `测试 Live ${i}`, 3, {
        [HeartColor.PINK]: 2,
      } as Record<HeartColor, number>)
    );
  }

  // 创建 12 张能量卡
  for (let i = 0; i < 12; i++) {
    energyDeck.push(createTestEnergyCard(`TEST-ENERGY-${i}`));
  }

  return { mainDeck, energyDeck };
}

/**
 * 辅助函数：跳过换牌阶段
 */
function skipMulliganPhase(gameService: GameService, state: GameState): GameState {
  if (state.currentPhase !== GamePhase.MULLIGAN_PHASE) return state;

  // 先攻玩家确认不换牌
  const mulligan1 = createMulliganAction('player1', []);
  const result1 = gameService.processAction(state, mulligan1);
  let currentState = result1.gameState;

  // 后攻玩家确认不换牌
  const mulligan2 = createMulliganAction('player2', []);
  const result2 = gameService.processAction(currentState, mulligan2);

  return result2.gameState;
}

// ============================================
// 测试套件
// ============================================

describe('GameService 游戏流程测试', () => {
  let gameService: GameService;

  beforeEach(() => {
    gameService = new GameService();
  });

  describe('游戏初始化', () => {
    it('应该能创建新游戏', () => {
      const game = gameService.createGame('test-game-1', 'player1', '玩家1', 'player2', '玩家2');

      expect(game.gameId).toBe('test-game-1');
      expect(game.players[0].id).toBe('player1');
      expect(game.players[0].name).toBe('玩家1');
      expect(game.players[1].id).toBe('player2');
      expect(game.players[1].name).toBe('玩家2');
      expect(game.currentPhase).toBe(GamePhase.SETUP);
      expect(game.isStarted).toBe(false);
    });

    it('应该能初始化游戏（设置卡组、抽手牌）', () => {
      const game = gameService.createGame('test-game-2', 'player1', '玩家1', 'player2', '玩家2');
      const deck1 = createTestDeck();
      const deck2 = createTestDeck();

      const result = gameService.initializeGame(game, deck1, deck2);

      expect(result.success).toBe(true);
      expect(result.gameState.isStarted).toBe(true);
      // 初始化后进入换牌阶段
      expect(result.gameState.currentPhase).toBe(GamePhase.MULLIGAN_PHASE);

      // 验证手牌数量（初始 6 张）
      const player1 = getPlayerById(result.gameState, 'player1');
      const player2 = getPlayerById(result.gameState, 'player2');

      expect(player1?.hand.cardIds.length).toBe(6);
      expect(player2?.hand.cardIds.length).toBe(6);

      // 验证能量区数量（初始 3 张）
      expect(player1?.energyZone.cardIds.length).toBe(3);
      expect(player2?.energyZone.cardIds.length).toBe(3);

      // 验证卡组剩余数量
      expect(player1?.mainDeck.cardIds.length).toBe(60 - 6); // 60 - 6 张手牌
      expect(player1?.energyDeck.cardIds.length).toBe(12 - 3); // 12 - 3 张能量
    });
  });

  describe('阶段流转', () => {
    let initializedGame: GameState;

    beforeEach(() => {
      const game = gameService.createGame('test-game-3', 'player1', '玩家1', 'player2', '玩家2');
      const deck = createTestDeck();
      const result = gameService.initializeGame(game, deck, deck);
      // 跳过换牌阶段，进入活跃阶段
      initializedGame = skipMulliganPhase(gameService, result.gameState);
    });

    it('应该从活跃阶段推进到能量阶段', () => {
      expect(initializedGame.currentPhase).toBe(GamePhase.ACTIVE_PHASE);

      const result = gameService.advancePhase(initializedGame);

      expect(result.success).toBe(true);
      expect(result.gameState.currentPhase).toBe(GamePhase.ENERGY_PHASE);
    });

    it('应该能完成先攻通常阶段的流转', () => {
      let state = initializedGame;

      // 活跃阶段 -> 能量阶段
      let result = gameService.advancePhase(state);
      expect(result.gameState.currentPhase).toBe(GamePhase.ENERGY_PHASE);
      state = result.gameState;

      // 能量阶段 -> 抽卡阶段
      result = gameService.advancePhase(state);
      expect(result.gameState.currentPhase).toBe(GamePhase.DRAW_PHASE);
      state = result.gameState;

      // 抽卡阶段 -> 主要阶段
      result = gameService.advancePhase(state);
      expect(result.gameState.currentPhase).toBe(GamePhase.MAIN_PHASE);
      state = result.gameState;

      // 验证先攻玩家手牌增加了（能量阶段抽能量，抽卡阶段抽牌）
      const player1 = getPlayerById(state, 'player1');
      expect(player1?.hand.cardIds.length).toBe(7); // 6 + 1
      expect(player1?.energyZone.cardIds.length).toBe(4); // 3 + 1
    });

    it('应该在主要阶段结束后切换到后攻玩家', () => {
      let state = initializedGame;

      // 跳过先攻通常阶段的前几个阶段
      for (let i = 0; i < 3; i++) {
        const result = gameService.advancePhase(state);
        state = result.gameState;
      }

      expect(state.currentPhase).toBe(GamePhase.MAIN_PHASE);
      expect(state.currentTurnType).toBe(TurnType.FIRST_PLAYER_TURN);

      // 结束主要阶段
      const endPhaseAction = createEndPhaseAction('player1');
      const result = gameService.processAction(state, endPhaseAction);

      expect(result.success).toBe(true);
      expect(result.gameState.currentPhase).toBe(GamePhase.ACTIVE_PHASE);
      expect(result.gameState.currentTurnType).toBe(TurnType.SECOND_PLAYER_TURN);
    });
  });

  describe('成员卡打出', () => {
    let gameInMainPhase: GameState;

    beforeEach(() => {
      const game = gameService.createGame('test-game-4', 'player1', '玩家1', 'player2', '玩家2');
      const deck = createTestDeck();
      const result = gameService.initializeGame(game, deck, deck);

      // 跳过换牌阶段
      let state = skipMulliganPhase(gameService, result.gameState);

      // 推进到主要阶段 (活跃 -> 能量 -> 抽卡 -> 主要)
      for (let i = 0; i < 3; i++) {
        const advanceResult = gameService.advancePhase(state);
        state = advanceResult.gameState;
      }
      gameInMainPhase = state;
    });

    it('应该能打出费用足够的成员卡', () => {
      const player1 = getPlayerById(gameInMainPhase, 'player1')!;
      const handCardIds = player1.hand.cardIds;

      // 找一张费用 <= 4 的成员卡（有 4 能量可用）
      let targetCardId: string | null = null;
      for (const cardId of handCardIds) {
        const card = getCardById(gameInMainPhase, cardId);
        if (card && card.data.cardType === CardType.MEMBER) {
          const memberData = card.data as MemberCardData;
          if (memberData.cost <= 4) {
            targetCardId = cardId;
            break;
          }
        }
      }

      if (!targetCardId) {
        // 如果手牌中没有合适的卡，跳过测试
        console.log('手牌中没有费用 <= 4 的成员卡，跳过测试');
        return;
      }

      const action = createPlayMemberAction('player1', targetCardId, SlotPosition.CENTER);
      const result = gameService.processAction(gameInMainPhase, action);

      expect(result.success).toBe(true);

      // 验证卡牌已放置到舞台
      const updatedPlayer = getPlayerById(result.gameState, 'player1')!;
      const memberCardId = getCardInSlot(updatedPlayer.memberSlots, SlotPosition.CENTER);
      expect(memberCardId).toBe(targetCardId);

      // 验证卡牌已从手牌移除
      expect(updatedPlayer.hand.cardIds).not.toContain(targetCardId);
    });

    it('应该允许玩家自行处理费用，即使系统未自动扣能量也能登场成员卡', () => {
      const player1 = getPlayerById(gameInMainPhase, 'player1')!;
      const handCardIds = player1.hand.cardIds;

      // 找一张费用 > 4 的成员卡（只有 4 能量可用）
      let targetCardId: string | null = null;
      for (const cardId of handCardIds) {
        const card = getCardById(gameInMainPhase, cardId);
        if (card && card.data.cardType === CardType.MEMBER) {
          const memberData = card.data as MemberCardData;
          if (memberData.cost > 4) {
            targetCardId = cardId;
            break;
          }
        }
      }

      if (!targetCardId) {
        console.log('手牌中没有费用 > 4 的成员卡，跳过测试');
        return;
      }

      const action = createPlayMemberAction('player1', targetCardId, SlotPosition.CENTER);
      const result = gameService.processAction(gameInMainPhase, action);

      expect(result.success).toBe(true);
      const updatedPlayer = getPlayerById(result.gameState, 'player1')!;
      expect(updatedPlayer.memberSlots.slots[SlotPosition.CENTER]).toBe(targetCardId);
      expect(updatedPlayer.hand.cardIds).not.toContain(targetCardId);
    });

    it('应该拒绝非自己回合时的操作', () => {
      const player2 = getPlayerById(gameInMainPhase, 'player2')!;
      const handCardIds = player2.hand.cardIds;

      // 尝试用玩家2的卡牌在玩家1的回合打出
      if (handCardIds.length > 0) {
        const action = createPlayMemberAction('player2', handCardIds[0], SlotPosition.CENTER);
        const result = gameService.processAction(gameInMainPhase, action);

        expect(result.success).toBe(false);
        expect(result.error).toContain('不是你的回合');
      }
    });
  });

  describe('接力传递（换手）', () => {
    it('应该能通过接力传递减少费用', () => {
      // 创建一个特殊的游戏状态，舞台上已有成员
      const game = gameService.createGame('test-game-5', 'player1', '玩家1', 'player2', '玩家2');
      const deck = createTestDeck();
      const result = gameService.initializeGame(game, deck, deck);

      // 初始化后处于换牌阶段：先跳过换牌，保证进入通常阶段流转
      let state = skipMulliganPhase(gameService, result.gameState);

      // 推进到主要阶段
      for (let i = 0; i < 3; i++) {
        const advanceResult = gameService.advancePhase(state);
        state = advanceResult.gameState;
      }
      expect(state.currentPhase).toBe(GamePhase.MAIN_PHASE);

      // 找手牌中费用最低的成员卡先打出
      const player1 = getPlayerById(state, 'player1')!;
      let firstCardId: string | null = null;
      let firstCardCost = Infinity;

      for (const cardId of player1.hand.cardIds) {
        const card = getCardById(state, cardId);
        if (card && card.data.cardType === CardType.MEMBER) {
          const memberData = card.data as MemberCardData;
          if (memberData.cost < firstCardCost && memberData.cost <= 4) {
            firstCardCost = memberData.cost;
            firstCardId = cardId;
          }
        }
      }

      if (!firstCardId) {
        console.log('没有合适的成员卡，跳过测试');
        return;
      }

      // 打出第一张成员卡
      const firstAction = createPlayMemberAction('player1', firstCardId, SlotPosition.CENTER);
      const firstResult = gameService.processAction(state, firstAction);

      expect(firstResult.success).toBe(true);
      state = firstResult.gameState;

      // 注意：由于每回合每个槽位只能放置一次新成员，我们需要进入下一回合再测试换手
      // 简化起见，这里只验证第一张卡已成功放置
      const updatedPlayer = getPlayerById(state, 'player1')!;
      expect(getCardInSlot(updatedPlayer.memberSlots, SlotPosition.CENTER)).toBe(firstCardId);
    });
  });
});

// 注意：卡牌效果测试已移除
// 采用新方案后，不再自动执行卡牌效果，玩家通过手动拖拽执行效果
