/**
 * Live 卡设置阶段单元测试
 *
 * 测试目标：
 * 1. 验证双方能按规则放置成员卡/Live卡到 Live 区
 * 2. 验证放置成员卡相当于弃牌（演出阶段会被移到休息室）
 * 3. 验证放置数量限制（最多3张）
 * 4. 验证阶段限制（只能在 Live 设置阶段放置）
 *
 * 基于规则 8.2 live卡设置阶段：
 * - 先攻玩家选择自己手牌的卡牌最多3张里侧放到live卡放置区，抽与放置张数相同张数的卡牌
 * - 后攻玩家同样操作
 * - 规则 8.3.4：演出阶段开始时，live卡以外的卡牌全部放到自己的休息室
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CardType, HeartColor, GamePhase, TurnType, FaceState, SubPhase } from '../../src/shared/types/enums';
import type {
  MemberCardData,
  LiveCardData,
  EnergyCardData,
  AnyCardData,
} from '../../src/domain/entities/card';
import { createHeartRequirement, createHeartIcon } from '../../src/domain/entities/card';
import { GameService, DeckConfig } from '../../src/application/game-service';
import {
  createSetLiveCardAction,
  createEndPhaseAction,
  createMulliganAction,
  createConfirmSubPhaseAction,
} from '../../src/application/actions';
import type { GameState } from '../../src/domain/entities/game';
import { getPlayerById, getCardById } from '../../src/domain/entities/game';

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
 * 创建测试用卡组
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
 * 辅助函数：将游戏推进到 Live 设置阶段
 */
function advanceToLiveSetPhase(gameService: GameService, state: GameState): GameState {
  let currentState = state;

  // 处理换牌阶段 - 双方都确认不换牌
  if (currentState.currentPhase === GamePhase.MULLIGAN_PHASE) {
    // 先攻玩家换牌
    const mulligan1 = createMulliganAction('player1', []);
    const mulliganResult1 = gameService.processAction(currentState, mulligan1);
    currentState = mulliganResult1.gameState;

    // 后攻玩家换牌
    const mulligan2 = createMulliganAction('player2', []);
    const mulliganResult2 = gameService.processAction(currentState, mulligan2);
    currentState = mulliganResult2.gameState;
  }

  // 先攻通常阶段
  // 活跃阶段 -> 能量阶段 -> 抽卡阶段 -> 主要阶段
  for (let i = 0; i < 3; i++) {
    const result = gameService.advancePhase(currentState);
    currentState = result.gameState;
  }

  // 结束先攻主要阶段
  const endAction1 = createEndPhaseAction('player1');
  const endResult1 = gameService.processAction(currentState, endAction1);
  currentState = endResult1.gameState;

  // 后攻通常阶段
  // 活跃阶段 -> 能量阶段 -> 抽卡阶段 -> 主要阶段
  for (let i = 0; i < 3; i++) {
    const result = gameService.advancePhase(currentState);
    currentState = result.gameState;
  }

  // 结束后攻主要阶段，进入 Live 设置阶段
  const endAction2 = createEndPhaseAction('player2');
  const endResult2 = gameService.processAction(currentState, endAction2);
  currentState = endResult2.gameState;

  return currentState;
}

/**
 * 辅助函数：从手牌中找指定类型的卡牌
 */
function findCardInHand(state: GameState, playerId: string, cardType: CardType): string | null {
  const player = getPlayerById(state, playerId);
  if (!player) return null;

  for (const cardId of player.hand.cardIds) {
    const card = getCardById(state, cardId);
    if (card && card.data.cardType === cardType) {
      return cardId;
    }
  }
  return null;
}

/**
 * 辅助函数：从手牌中找多张指定类型的卡牌
 */
function findCardsInHand(
  state: GameState,
  playerId: string,
  cardType: CardType,
  count: number
): string[] {
  const player = getPlayerById(state, playerId);
  if (!player) return [];

  const result: string[] = [];
  for (const cardId of player.hand.cardIds) {
    const card = getCardById(state, cardId);
    if (card && card.data.cardType === cardType) {
      result.push(cardId);
      if (result.length >= count) break;
    }
  }
  return result;
}

// ============================================
// 测试套件
// ============================================

describe('Live 卡设置阶段测试', () => {
  let gameService: GameService;
  let initializedGame: GameState;

  beforeEach(() => {
    gameService = new GameService();
    const game = gameService.createGame('test-game', 'player1', '玩家1', 'player2', '玩家2');
    const deck = createTestDeck();
    const result = gameService.initializeGame(game, deck, deck);
    initializedGame = result.gameState;
  });

  describe('基本放置功能', () => {
    it('应该能在 Live 设置阶段放置 Live 卡到 Live 区', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);
      expect(stateInLiveSet.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);

      // 找到手牌中的 Live 卡
      const liveCardId = findCardInHand(stateInLiveSet, 'player1', CardType.LIVE);

      if (!liveCardId) {
        console.log('手牌中没有 Live 卡，跳过测试');
        return;
      }

      // 执行放置动作
      const action = createSetLiveCardAction('player1', liveCardId, true);
      const result = gameService.processAction(stateInLiveSet, action);

      expect(result.success).toBe(true);

      // 验证卡牌已放置到 Live 区
      const player = getPlayerById(result.gameState, 'player1')!;
      expect(player.liveZone.cardIds).toContain(liveCardId);

      // 验证卡牌已从手牌移除
      expect(player.hand.cardIds).not.toContain(liveCardId);
    });

    it('应该能在 Live 设置阶段放置成员卡到 Live 区（相当于弃牌）', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);
      expect(stateInLiveSet.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);

      // 找到手牌中的成员卡
      const memberCardId = findCardInHand(stateInLiveSet, 'player1', CardType.MEMBER);

      if (!memberCardId) {
        console.log('手牌中没有成员卡，跳过测试');
        return;
      }

      // 执行放置动作
      const action = createSetLiveCardAction('player1', memberCardId, true);
      const result = gameService.processAction(stateInLiveSet, action);

      expect(result.success).toBe(true);

      // 验证卡牌已放置到 Live 区
      const player = getPlayerById(result.gameState, 'player1')!;
      expect(player.liveZone.cardIds).toContain(memberCardId);

      // 验证卡牌已从手牌移除
      expect(player.hand.cardIds).not.toContain(memberCardId);
    });

    it('应该在放置卡牌后抽取1张卡', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);

      const playerBefore = getPlayerById(stateInLiveSet, 'player1')!;
      const handCountBefore = playerBefore.hand.cardIds.length;
      const deckCountBefore = playerBefore.mainDeck.cardIds.length;

      // 找到手牌中的任意卡牌
      const cardId = playerBefore.hand.cardIds[0];

      // 执行放置动作
      const action = createSetLiveCardAction('player1', cardId, true);
      const result = gameService.processAction(stateInLiveSet, action);

      expect(result.success).toBe(true);

      // 放置后手牌减少1张（抽卡在确认子阶段完成时发生）
      const playerAfterPlace = getPlayerById(result.gameState, 'player1')!;
      expect(playerAfterPlace.hand.cardIds.length).toBe(handCountBefore - 1);

      // 完成 Live 设置（触发抽卡）
      const skipAction = createConfirmSubPhaseAction('player1', result.gameState.currentSubPhase);
      const skipResult = gameService.processAction(result.gameState, skipAction);

      expect(skipResult.success).toBe(true);

      // 验证手牌数量恢复（放1张后抽1张）
      const playerAfterSkip = getPlayerById(skipResult.gameState, 'player1')!;
      expect(playerAfterSkip.hand.cardIds.length).toBe(handCountBefore);

      // 验证卡组减少了1张
      expect(playerAfterSkip.mainDeck.cardIds.length).toBe(deckCountBefore - 1);
    });
  });

  describe('放置限制', () => {
    it('应该限制最多只能放置3张卡', () => {
      // 推进到 Live 设置阶段
      let currentState = advanceToLiveSetPhase(gameService, initializedGame);
      expect(currentState.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);

      // 放置3张卡
      for (let i = 0; i < 3; i++) {
        const player = getPlayerById(currentState, 'player1')!;
        const cardId = player.hand.cardIds[0];

        const action = createSetLiveCardAction('player1', cardId, true);
        const result = gameService.processAction(currentState, action);

        expect(result.success).toBe(true);
        currentState = result.gameState;
      }

      // 验证已放置3张
      const playerAfter3 = getPlayerById(currentState, 'player1')!;
      expect(playerAfter3.liveZone.cardIds.length).toBe(3);

      // 尝试放置第4张，应该失败
      const cardId4 = playerAfter3.hand.cardIds[0];
      const action4 = createSetLiveCardAction('player1', cardId4, true);
      const result4 = gameService.processAction(currentState, action4);

      expect(result4.success).toBe(false);
      expect(result4.error).toContain('上限');
    });

    it('应该拒绝在非 Live 设置阶段放置卡牌', () => {
      // 在主要阶段尝试放置
      let state = initializedGame;

      // 处理换牌阶段 - 双方都确认不换牌
      if (state.currentPhase === GamePhase.MULLIGAN_PHASE) {
        const mulligan1 = createMulliganAction('player1', []);
        const mulliganResult1 = gameService.processAction(state, mulligan1);
        state = mulliganResult1.gameState;

        const mulligan2 = createMulliganAction('player2', []);
        const mulliganResult2 = gameService.processAction(state, mulligan2);
        state = mulliganResult2.gameState;
      }

      // 推进到主要阶段 (活跃 -> 能量 -> 抽卡 -> 主要)
      for (let i = 0; i < 3; i++) {
        const result = gameService.advancePhase(state);
        state = result.gameState;
      }

      expect(state.currentPhase).toBe(GamePhase.MAIN_PHASE);

      const player = getPlayerById(state, 'player1')!;
      const cardId = player.hand.cardIds[0];

      const action = createSetLiveCardAction('player1', cardId, true);
      const result = gameService.processAction(state, action);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Live 设置阶段');
    });

    it('应该拒绝放置不在手牌中的卡牌', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);

      // 使用一个不存在的卡牌 ID
      const action = createSetLiveCardAction('player1', 'non-existent-card-id', true);
      const result = gameService.processAction(stateInLiveSet, action);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('双方玩家流程', () => {
    it('先攻玩家可以在 Live 设置阶段放置卡牌', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);
      expect(stateInLiveSet.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);

      // 先攻玩家放置卡牌
      const player1 = getPlayerById(stateInLiveSet, 'player1')!;
      const cardId = player1.hand.cardIds[0];

      const action = createSetLiveCardAction('player1', cardId, true);
      const result = gameService.processAction(stateInLiveSet, action);

      expect(result.success).toBe(true);
    });

    it('后攻玩家可以在 Live 设置阶段放置卡牌', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);
      expect(stateInLiveSet.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);

      // 后攻玩家放置卡牌
      const player2 = getPlayerById(stateInLiveSet, 'player2')!;
      const cardId = player2.hand.cardIds[0];

      const action = createSetLiveCardAction('player2', cardId, true);
      const result = gameService.processAction(stateInLiveSet, action);

      expect(result.success).toBe(true);
    });

    it('双方都可以放置卡牌到各自的 Live 区', () => {
      // 推进到 Live 设置阶段
      let currentState = advanceToLiveSetPhase(gameService, initializedGame);

      // 先攻玩家放置1张卡
      const player1Before = getPlayerById(currentState, 'player1')!;
      const card1 = player1Before.hand.cardIds[0];
      const action1 = createSetLiveCardAction('player1', card1, true);
      const result1 = gameService.processAction(currentState, action1);
      expect(result1.success).toBe(true);
      currentState = result1.gameState;

      // 后攻玩家放置1张卡
      const player2Before = getPlayerById(currentState, 'player2')!;
      const card2 = player2Before.hand.cardIds[0];
      const action2 = createSetLiveCardAction('player2', card2, true);
      const result2 = gameService.processAction(currentState, action2);
      expect(result2.success).toBe(true);
      currentState = result2.gameState;

      // 验证双方都有卡在 Live 区
      const player1After = getPlayerById(currentState, 'player1')!;
      const player2After = getPlayerById(currentState, 'player2')!;

      expect(player1After.liveZone.cardIds.length).toBe(1);
      expect(player2After.liveZone.cardIds.length).toBe(1);
    });

    it('双方可以各自放置最多3张卡', () => {
      // 推进到 Live 设置阶段
      let currentState = advanceToLiveSetPhase(gameService, initializedGame);

      // 先攻玩家放置3张卡
      for (let i = 0; i < 3; i++) {
        const player = getPlayerById(currentState, 'player1')!;
        const cardId = player.hand.cardIds[0];
        const action = createSetLiveCardAction('player1', cardId, true);
        const result = gameService.processAction(currentState, action);
        expect(result.success).toBe(true);
        currentState = result.gameState;
      }

      // 后攻玩家放置3张卡
      for (let i = 0; i < 3; i++) {
        const player = getPlayerById(currentState, 'player2')!;
        const cardId = player.hand.cardIds[0];
        const action = createSetLiveCardAction('player2', cardId, true);
        const result = gameService.processAction(currentState, action);
        expect(result.success).toBe(true);
        currentState = result.gameState;
      }

      // 验证双方都有3张卡在 Live 区
      const player1 = getPlayerById(currentState, 'player1')!;
      const player2 = getPlayerById(currentState, 'player2')!;

      expect(player1.liveZone.cardIds.length).toBe(3);
      expect(player2.liveZone.cardIds.length).toBe(3);
    });
  });

  describe('卡牌放置状态', () => {
    it('应该将卡牌里侧放置（faceDown=true）', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);

      const player = getPlayerById(stateInLiveSet, 'player1')!;
      const cardId = player.hand.cardIds[0];

      // 里侧放置
      const action = createSetLiveCardAction('player1', cardId, true);
      const result = gameService.processAction(stateInLiveSet, action);

      expect(result.success).toBe(true);

      // 验证卡牌状态
      const playerAfter = getPlayerById(result.gameState, 'player1')!;
      const cardState = playerAfter.liveZone.cardStates.get(cardId);

      expect(cardState).toBeDefined();
      expect(cardState?.face).toBe(FaceState.FACE_DOWN);
    });

    it('应该将 Live 卡表侧放置（faceDown=false）', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);

      // 找到手牌中的 Live 卡（只有 Live 卡表侧放置才不会被规则处理移走）
      // 规则 10.5.1: Live 区的非 Live 卡表侧时会被移到休息室
      const liveCardId = findCardInHand(stateInLiveSet, 'player1', CardType.LIVE);

      if (!liveCardId) {
        console.log('手牌中没有 Live 卡，跳过测试');
        return;
      }

      // 表侧放置 Live 卡
      const action = createSetLiveCardAction('player1', liveCardId, false);
      const result = gameService.processAction(stateInLiveSet, action);

      expect(result.success).toBe(true);

      // 验证卡牌状态
      const playerAfter = getPlayerById(result.gameState, 'player1')!;
      const cardState = playerAfter.liveZone.cardStates.get(liveCardId);

      expect(cardState).toBeDefined();
      expect(cardState?.face).toBe(FaceState.FACE_UP);
    });

    it('表侧放置的非 Live 卡应该被规则处理移到休息室（规则 10.5.1）', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);

      // 找到手牌中的成员卡
      const memberCardId = findCardInHand(stateInLiveSet, 'player1', CardType.MEMBER);

      if (!memberCardId) {
        console.log('手牌中没有成员卡，跳过测试');
        return;
      }

      // 表侧放置成员卡
      const action = createSetLiveCardAction('player1', memberCardId, false);
      const result = gameService.processAction(stateInLiveSet, action);

      expect(result.success).toBe(true);

      // 规则 10.5.1: Live 区的非 Live 卡表侧时会被移到休息室
      // 所以卡牌应该不在 Live 区，而是在休息室
      const playerAfter = getPlayerById(result.gameState, 'player1')!;
      expect(playerAfter.liveZone.cardIds).not.toContain(memberCardId);
      expect(playerAfter.waitingRoom.cardIds).toContain(memberCardId);
    });
  });

  describe('混合放置场景', () => {
    it('可以混合放置 Live 卡和成员卡', () => {
      // 推进到 Live 设置阶段
      let currentState = advanceToLiveSetPhase(gameService, initializedGame);

      // 放置一张 Live 卡
      const liveCardId = findCardInHand(currentState, 'player1', CardType.LIVE);
      if (liveCardId) {
        const action1 = createSetLiveCardAction('player1', liveCardId, true);
        const result1 = gameService.processAction(currentState, action1);
        expect(result1.success).toBe(true);
        currentState = result1.gameState;
      }

      // 放置一张成员卡
      const memberCardId = findCardInHand(currentState, 'player1', CardType.MEMBER);
      if (memberCardId) {
        const action2 = createSetLiveCardAction('player1', memberCardId, true);
        const result2 = gameService.processAction(currentState, action2);
        expect(result2.success).toBe(true);
        currentState = result2.gameState;
      }

      // 验证 Live 区有卡牌
      const player = getPlayerById(currentState, 'player1')!;
      const expectedCount = (liveCardId ? 1 : 0) + (memberCardId ? 1 : 0);
      expect(player.liveZone.cardIds.length).toBe(expectedCount);
    });

    it('可以选择不放置任何卡牌（放置0张）', () => {
      // 推进到 Live 设置阶段
      const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);

      // 不放置任何卡牌，直接验证状态
      const player1 = getPlayerById(stateInLiveSet, 'player1')!;
      const player2 = getPlayerById(stateInLiveSet, 'player2')!;

      expect(player1.liveZone.cardIds.length).toBe(0);
      expect(player2.liveZone.cardIds.length).toBe(0);
    });
  });
});

describe('Live 区卡牌类型验证', () => {
  let gameService: GameService;
  let initializedGame: GameState;

  beforeEach(() => {
    gameService = new GameService();
    const game = gameService.createGame('test-game', 'player1', '玩家1', 'player2', '玩家2');
    const deck = createTestDeck();
    const result = gameService.initializeGame(game, deck, deck);
    initializedGame = result.gameState;
  });

  it('放置的 Live 卡应该保持 LIVE 类型', () => {
    // 推进到 Live 设置阶段
    const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);

    // 找到手牌中的 Live 卡
    const liveCardId = findCardInHand(stateInLiveSet, 'player1', CardType.LIVE);

    if (!liveCardId) {
      console.log('手牌中没有 Live 卡，跳过测试');
      return;
    }

    // 放置 Live 卡
    const action = createSetLiveCardAction('player1', liveCardId, true);
    const result = gameService.processAction(stateInLiveSet, action);

    expect(result.success).toBe(true);

    // 验证卡牌类型
    const card = getCardById(result.gameState, liveCardId);
    expect(card).toBeDefined();
    expect(card?.data.cardType).toBe(CardType.LIVE);
  });

  it('放置的成员卡应该保持 MEMBER 类型', () => {
    // 推进到 Live 设置阶段
    const stateInLiveSet = advanceToLiveSetPhase(gameService, initializedGame);

    // 找到手牌中的成员卡
    const memberCardId = findCardInHand(stateInLiveSet, 'player1', CardType.MEMBER);

    if (!memberCardId) {
      console.log('手牌中没有成员卡，跳过测试');
      return;
    }

    // 放置成员卡
    const action = createSetLiveCardAction('player1', memberCardId, true);
    const result = gameService.processAction(stateInLiveSet, action);

    expect(result.success).toBe(true);

    // 验证卡牌类型
    const card = getCardById(result.gameState, memberCardId);
    expect(card).toBeDefined();
    expect(card?.data.cardType).toBe(CardType.MEMBER);
  });
});
