/**
 * 游戏服务层
 * 整合所有组件来运行游戏流程
 *
 * 职责：
 * 1. 创建和初始化游戏
 * 2. 处理玩家动作
 * 3. 管理阶段流转
 * 4. 触发和执行能力效果
 * 5. 执行规则检查
 */

import {
  GamePhase,
  TurnType,
  ZoneType,
  SlotPosition,
  OrientationState,
  CardType,
  TriggerCondition,
  FaceState,
  GameEndReason,
  SubPhase,
} from '../shared/types/enums';
import type { GameState, GameAction as GameHistoryAction } from '../domain/entities/game';
import {
  createGameState,
  getActivePlayer,
  getNonActivePlayer,
  getPlayerById,
  getPlayerIndex,
  getCardById,
  registerCards,
  updatePlayer,
  setPhase,
  markGameStarted,
  markGameEnded,
  addAction,
  setWaitingForInput,
  switchFirstPlayer,
  getFirstPlayer,
  getSecondPlayer,
  GAME_CONFIG,
  addMulliganCompletedPlayer,
  isAllMulliganCompleted,
  markMulliganCompleted,
  setSubPhase,
} from '../domain/entities/game';
import type { PlayerState } from '../domain/entities/player';
import {
  getHandCount,
  getAvailableEnergyCount,
  findCardZone,
  hasMovedToStageThisTurn,
  recordMoveToStage,
} from '../domain/entities/player';
import type {
  CardInstance,
  MemberCardData,
  LiveCardData,
  BaseCardData,
  AnyCardData,
} from '../domain/entities/card';
import { createCardInstance, isMemberCardData, isLiveCardData } from '../domain/entities/card';
import {
  addCardToZone,
  removeCardFromZone,
  addCardToStatefulZone,
  removeCardFromStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
  tapEnergy,
  untapAllEnergy,
  shuffleZone,
  drawFromTop,
  getActiveEnergyIds,
  getAllMemberCardIds,
  getCardInSlot,
  isSlotEmpty,
} from '../domain/entities/zone';
import { PhaseManager, phaseManager, PhaseAutoAction } from './phase-manager';
import { isPlayerActive as isPlayerActiveByConfig } from '../shared/phase-config';
import {
  GameAction,
  GameActionType,
  PlayMemberAction,
  ActivateAbilityAction,
  EndPhaseAction,
  SetLiveCardAction,
  SkipLiveSetAction,
  SelectCardsAction,
  ConfirmOptionalAction,
  MulliganAction,
  ConfirmSubPhaseAction,
  ManualMoveCardAction,
  ConfirmJudgmentAction,
  ConfirmScoreAction,
  SelectSuccessCardAction,
  UndoOperationAction,
  PerformCheerAction,
} from './actions';
// 导入动作处理器模块
import {
  getActionHandler,
  hasActionHandler,
  createHandlerContext,
  type ActionHandlerContext,
} from './action-handlers';
// 导入规则处理模块
import {
  ruleActionProcessor,
  applyAllRuleActions,
  RuleActionType,
} from '../domain/rules/rule-actions';
// 注意：采用新方案后，不再自动执行卡牌效果
// 玩家通过手动拖拽执行效果，系统只负责规则处理（自动清理非法状态）

// ============================================
// 游戏服务结果类型
// ============================================

/**
 * 游戏操作结果
 */
export interface GameOperationResult {
  /** 操作是否成功 */
  readonly success: boolean;
  /** 更新后的游戏状态 */
  readonly gameState: GameState;
  /** 错误信息（如果失败） */
  readonly error?: string;
  /** 是否需要玩家输入 */
  readonly needsInput?: boolean;
  /** 输入请求详情 */
  readonly inputRequest?: {
    type: 'SELECT_CARDS' | 'CONFIRM_OPTIONAL' | 'SELECT_SLOT';
    playerId: string;
    promptText?: string;
    candidates?: readonly string[];
    minCount?: number;
    maxCount?: number;
  };
  /** 触发的事件列表 */
  readonly triggeredEvents?: readonly string[];
}

/**
 * 卡组配置
 */
export interface DeckConfig {
  /** 主卡组卡牌数据列表 */
  mainDeck: readonly AnyCardData[];
  /** 能量卡组卡牌数据列表 */
  energyDeck: readonly AnyCardData[];
}

// ============================================
// 游戏服务类
// ============================================

/**
 * 游戏服务
 * 提供游戏的核心操作接口
 */
export class GameService {
  private phaseManager: PhaseManager;

  constructor(phaseManager: PhaseManager = new PhaseManager()) {
    this.phaseManager = phaseManager;
  }

  /**
   * 创建新游戏
   *
   * @param gameId 游戏 ID
   * @param player1Id 玩家1 ID
   * @param player1Name 玩家1名称
   * @param player2Id 玩家2 ID
   * @param player2Name 玩家2名称
   * @returns 初始游戏状态
   */
  createGame(
    gameId: string,
    player1Id: string,
    player1Name: string,
    player2Id: string,
    player2Name: string
  ): GameState {
    return createGameState(gameId, player1Id, player1Name, player2Id, player2Name);
  }

  /**
   * 初始化游戏（设置卡组、抽初始手牌等）
   * 基于规则 6.2
   *
   * @param game 游戏状态
   * @param player1Deck 玩家1的卡组配置
   * @param player2Deck 玩家2的卡组配置
   * @returns 初始化后的游戏状态
   */
  initializeGame(
    game: GameState,
    player1Deck: DeckConfig,
    player2Deck: DeckConfig
  ): GameOperationResult {
    let state = game;

    // 1. 为每个玩家创建卡牌实例并注册
    const player1Cards = this.createCardsForPlayer(player1Deck, game.players[0].id);
    const player2Cards = this.createCardsForPlayer(player2Deck, game.players[1].id);

    state = registerCards(state, [...player1Cards, ...player2Cards]);

    // 2. 将卡牌放入各自的卡组
    state = this.setupPlayerDecks(state, game.players[0].id, player1Cards);
    state = this.setupPlayerDecks(state, game.players[1].id, player2Cards);

    // 3. 洗牌
    state = updatePlayer(state, game.players[0].id, (p) => ({
      ...p,
      mainDeck: shuffleZone(p.mainDeck),
    }));
    state = updatePlayer(state, game.players[1].id, (p) => ({
      ...p,
      mainDeck: shuffleZone(p.mainDeck),
    }));

    // 4. 抽初始手牌（6张）
    for (let i = 0; i < GAME_CONFIG.INITIAL_HAND_SIZE; i++) {
      state = this.drawCard(state, game.players[0].id);
      state = this.drawCard(state, game.players[1].id);
    }

    // 5. 放置初始能量（3张）
    for (let i = 0; i < GAME_CONFIG.INITIAL_ENERGY_COUNT; i++) {
      state = this.drawEnergy(state, game.players[0].id);
      state = this.drawEnergy(state, game.players[1].id);
    }

    // 6. 标记游戏开始
    state = markGameStarted(state);

    return {
      success: true,
      gameState: state,
    };
  }

  /**
   * 处理玩家动作
   *
   * @param game 当前游戏状态
   * @param action 玩家动作
   * @returns 操作结果
   */
  processAction(game: GameState, action: GameAction): GameOperationResult {
    // 验证是否是该玩家的行动时机（依据 phase-config 的 activePlayerStrategy）
    const canActByTiming = isPlayerActiveByConfig(game, action.playerId);
    const activePlayer = getActivePlayer(game);

    // Live 设置阶段双方玩家都可以放置卡牌和完成设置（规则 8.2）
    const isLiveSetPhaseAction =
      game.currentPhase === GamePhase.LIVE_SET_PHASE &&
      (action.type === GameActionType.SET_LIVE_CARD ||
        action.type === GameActionType.SKIP_LIVE_SET);

    // Mulligan 阶段双方玩家都可以换牌
    const isMulliganPhase = game.currentPhase === GamePhase.MULLIGAN_PHASE;

    // "信任玩家"原则：手动移动卡牌不受回合限制（系统会通过规则处理自动纠正非法状态）
    const isManualMoveAction = action.type === GameActionType.MANUAL_MOVE_CARD;

    if (
      !canActByTiming &&
      action.type !== GameActionType.SELECT_CARDS &&
      action.type !== GameActionType.CONFIRM_OPTIONAL &&
      !isLiveSetPhaseAction &&
      !isMulliganPhase &&
      !isManualMoveAction
    ) {
      return {
        success: false,
        gameState: game,
        error: '不是你的回合',
      };
    }

    // 特殊处理：END_PHASE 需要调用 advancePhase()
    if (action.type === GameActionType.END_PHASE) {
      if (!this.phaseManager.canEndCurrentPhase(game)) {
        return { success: false, gameState: game, error: '当前阶段不能由玩家主动结束' };
      }
      return this.advancePhase(game);
    }

    // 尝试使用动作处理器注册表
    const handler = getActionHandler(action.type);
    if (handler) {
      const context = this.createHandlerContext();
      const result = handler(game, action, context);

      // 特殊处理：SKIP_LIVE_SET 完成后可能需要推进阶段
      if (result.success && action.type === GameActionType.SKIP_LIVE_SET) {
        const state = result.gameState;
        // 检查双方是否都完成了 Live 设置
        const firstPlayerId = state.players[state.firstPlayerIndex].id;
        const secondPlayerId = state.players[state.firstPlayerIndex === 0 ? 1 : 0].id;
        const bothCompleted =
          state.liveSetCompletedPlayers.includes(firstPlayerId) &&
          state.liveSetCompletedPlayers.includes(secondPlayerId);

        if (bothCompleted) {
          // 推进到演出阶段
          const advanceResult = this.advancePhase(state);
          // 清空 liveSetCompletedPlayers
          return {
            success: advanceResult.success,
            gameState: {
              ...advanceResult.gameState,
              liveSetCompletedPlayers: [],
            },
            error: advanceResult.error,
            triggeredEvents: advanceResult.triggeredEvents,
          };
        }
      }

      // 在动作成功后，自动执行检查时机（规则处理）
      // 这是"信任玩家"方案的核心：系统自动清理非法状态
      if (result.success) {
        let state = result.gameState;
        const allTriggeredEvents: string[] = [...(result.triggeredEvents ?? [])];

        // 处理 FINALIZE_LIVE_RESULT 事件（Live 结算阶段完成）
        // 必须先 finalize，再推进主阶段；否则会在错误的主阶段上 finalize。
        if (
          state.currentSubPhase === SubPhase.RESULT_TURN_END ||
          result.triggeredEvents?.includes('FINALIZE_LIVE_RESULT')
        ) {
          const finalizeResult = this.finalizeLiveResult(state);
          if (finalizeResult.success) {
            state = finalizeResult.gameState;
            allTriggeredEvents.push('LIVE_RESULT_FINALIZED');
          }
        }

        // 处理 SHOULD_ADVANCE_PHASE 事件（子阶段完成后需要推进主阶段）
        if (result.triggeredEvents?.includes('SHOULD_ADVANCE_PHASE')) {
          const advanceResult = this.advancePhase(state);
          if (advanceResult.success) {
            state = advanceResult.gameState;
            allTriggeredEvents.push(...(advanceResult.triggeredEvents ?? []));
          }
        }

        const checkResult = this.executeCheckTiming(state);
        return {
          success: checkResult.success,
          gameState: checkResult.gameState,
          error: checkResult.success ? result.error : checkResult.error,
          triggeredEvents: [...allTriggeredEvents, ...(checkResult.triggeredEvents ?? [])],
        };
      }

      return {
        success: result.success,
        gameState: result.gameState,
        error: result.error,
        triggeredEvents: result.triggeredEvents,
      };
    }

    // 所有动作类型都已迁移到处理器注册表
    // 如果到这里说明动作类型未注册
    return {
      success: false,
      gameState: game,
      error: `未知的动作类型: ${(action as GameAction).type}`,
    };
  }

  /**
   * 创建动作处理器上下文
   * 将 GameService 的辅助方法包装为上下文对象
   */
  private createHandlerContext(): ActionHandlerContext {
    return createHandlerContext({
      getPlayerById: (game, playerId) => getPlayerById(game, playerId) ?? undefined,
      getCardById: (game, cardId) => getCardById(game, cardId),
      updatePlayer: (game, playerId, updater) => updatePlayer(game, playerId, updater),
      addAction: (game, type, playerId, details) => addAction(game, type, playerId, details),
      drawCard: (game, playerId) => this.drawCard(game, playerId),
      drawEnergy: (game, playerId) => this.drawEnergy(game, playerId),
    });
  }

  /**
   * 推进游戏到下一个阶段
   *
   * @param game 当前游戏状态
   * @returns 操作结果
   */
  advancePhase(game: GameState): GameOperationResult {
    const transition = this.phaseManager.getNextPhase(game);
    let state = this.phaseManager.applyTransition(game, transition);

    // 进入/离开 Live Set 阶段时，重置该阶段用的一次性完成标记，避免跨回合污染。
    // 注意：Live Set 阶段内部为了切换先/后攻会出现 "LIVE_SET_PHASE -> LIVE_SET_PHASE" 的自循环，
    // 这种情况下不能清空，否则会导致条件判断永远不成立。
    if (
      transition.newPhase === GamePhase.LIVE_SET_PHASE &&
      game.currentPhase !== GamePhase.LIVE_SET_PHASE
    ) {
      state = {
        ...state,
        liveSetCompletedPlayers: [],
      };
    }
    if (
      game.currentPhase === GamePhase.LIVE_SET_PHASE &&
      transition.newPhase !== GamePhase.LIVE_SET_PHASE
    ) {
      state = {
        ...state,
        liveSetCompletedPlayers: [],
      };
    }

    // 执行阶段自动处理
    for (const autoAction of transition.autoActions) {
      state = this.executeAutoAction(state, autoAction);
    }

    // 记录阶段变更
    state = addAction(state, 'PHASE_CHANGE', null, {
      from: game.currentPhase,
      to: transition.newPhase,
    });

    // 触发相关能力
    state = this.triggerAbilities(state, transition.triggeredConditions);

    // 处理 LIVE_SET_PHASE 的子阶段设置
    if (transition.newPhase === GamePhase.LIVE_SET_PHASE) {
      const firstPlayerId = state.players[state.firstPlayerIndex].id;
      const secondPlayerId = state.players[state.firstPlayerIndex === 0 ? 1 : 0].id;
      const completedPlayers = state.liveSetCompletedPlayers;

      // 根据完成状态设置正确的子阶段
      if (!completedPlayers.includes(firstPlayerId)) {
        // 先手尚未完成 → 先手盖牌子阶段
        state = {
          ...state,
          currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
        };
      } else if (!completedPlayers.includes(secondPlayerId)) {
        // 先手已完成，后手尚未完成 → 后手盖牌子阶段
        state = {
          ...state,
          currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
        };
      }
      // 如果双方都完成了，子阶段会在进入 PERFORMANCE_PHASE 时设置
    }

    // 处理 PERFORMANCE_PHASE 的特殊逻辑
    if (transition.newPhase === GamePhase.PERFORMANCE_PHASE) {
      // 设置初始子阶段：翻开 Live 卡
      state = {
        ...state,
        currentSubPhase: SubPhase.PERFORMANCE_REVEAL,
      };

      // 翻开 Live 卡（自动执行）
      state = this.revealLiveCards(state);

      // 翻开后直接进入判定子阶段（用户点击判定按钮打开 JudgmentPanel）
      state = {
        ...state,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      };

      // 注意：Cheer（应援）现在由用户通过点击卡组翻牌到 CheerPeekModal 手动执行
    }

    // 处理 LIVE_RESULT_PHASE 的特殊逻辑（结算）
    if (transition.newPhase === GamePhase.LIVE_RESULT_PHASE) {
      // 设置初始子阶段：结算
      state = {
        ...state,
        currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      };

      const resultPhaseResult = this.executeLiveResultPhase(state);
      if (resultPhaseResult.success) {
        state = resultPhaseResult.gameState;
      }
    }

    // 进入非 Live 阶段时清除子阶段
    if (
      transition.newPhase !== GamePhase.LIVE_SET_PHASE &&
      transition.newPhase !== GamePhase.PERFORMANCE_PHASE &&
      transition.newPhase !== GamePhase.LIVE_RESULT_PHASE
    ) {
      state = {
        ...state,
        currentSubPhase: SubPhase.NONE,
      };
    }

    return {
      success: true,
      gameState: state,
      triggeredEvents: transition.triggeredConditions,
    };
  }

  // ============================================
  // 私有方法 - 辅助功能
  // ============================================

  /**
   * 为玩家创建卡牌实例
   */
  private createCardsForPlayer(deck: DeckConfig, playerId: string): CardInstance[] {
    const cards: CardInstance[] = [];
    let instanceId = 0;

    for (const cardData of deck.mainDeck) {
      cards.push(createCardInstance(cardData, playerId, `${playerId}-main-${instanceId++}`));
    }

    for (const cardData of deck.energyDeck) {
      cards.push(createCardInstance(cardData, playerId, `${playerId}-energy-${instanceId++}`));
    }

    return cards;
  }

  /**
   * 设置玩家的卡组
   */
  private setupPlayerDecks(game: GameState, playerId: string, cards: CardInstance[]): GameState {
    return updatePlayer(game, playerId, (player) => {
      let mainDeckIds: string[] = [];
      let energyDeckIds: string[] = [];

      for (const card of cards) {
        if (card.data.cardType === CardType.ENERGY) {
          energyDeckIds.push(card.instanceId);
        } else {
          mainDeckIds.push(card.instanceId);
        }
      }

      return {
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: mainDeckIds },
        energyDeck: { ...player.energyDeck, cardIds: energyDeckIds },
      };
    });
  }

  /**
   * 抽一张卡
   */
  private drawCard(game: GameState, playerId: string): GameState {
    return updatePlayer(game, playerId, (player) => {
      const { zone: newDeck, cardId } = drawFromTop(player.mainDeck);
      if (!cardId) return player;
      return {
        ...player,
        mainDeck: newDeck,
        hand: addCardToZone(player.hand, cardId),
      };
    });
  }

  /**
   * 从能量卡组放置能量到能量区
   */
  private drawEnergy(game: GameState, playerId: string): GameState {
    return updatePlayer(game, playerId, (player) => {
      const { zone: newDeck, cardId } = drawFromTop(player.energyDeck);
      if (!cardId) return player;
      return {
        ...player,
        energyDeck: newDeck,
        energyZone: addCardToStatefulZone(player.energyZone, cardId),
      };
    });
  }

  /**
   * 执行阶段自动处理
   */
  private executeAutoAction(game: GameState, autoAction: PhaseAutoAction): GameState {
    switch (autoAction.type) {
      case 'UNTAP_ALL':
        // 活跃阶段：将所有能量和成员变为活跃状态
        return updatePlayer(game, autoAction.playerId, (player) => ({
          ...player,
          energyZone: untapAllEnergy(player.energyZone),
          // TODO: 也需要将成员变为活跃状态
        }));

      case 'DRAW_ENERGY':
        return this.drawEnergy(game, autoAction.playerId);

      case 'DRAW_CARD':
        let state = game;
        for (let i = 0; i < autoAction.count; i++) {
          state = this.drawCard(state, autoAction.playerId);
        }
        return state;
    }
  }

  /**
   * 触发能力
   */
  private triggerAbilities(
    game: GameState,
    conditions: readonly TriggerCondition[],
    sourceCardId?: string
  ): GameState {
    // 简化实现：遍历所有卡牌，检查是否有匹配的自动能力
    // 实际实现需要更复杂的能力系统集成
    return game;
  }

  // ============================================
  // 检查时机处理（规则 9.5 + 10）
  // ============================================

  /**
   * 执行检查时机
   * 根据规则 9.5.3 和第 10 章，自动执行规则处理
   *
   * 这是"信任玩家"方案的核心：
   * - 系统自动清理非法状态
   * - 玩家可以自由拖拽，系统帮助纠正
   *
   * @param game 当前游戏状态
   * @returns 操作结果
   */
  executeCheckTiming(game: GameState): GameOperationResult {
    let state = game;
    let hasChanges = false;
    let iterations = 0;
    const MAX_ITERATIONS = 100; // 防止无限循环

    // 获取卡牌类型的辅助函数
    const getCardType = (cardId: string): CardType | null => {
      const card = getCardById(state, cardId);
      return card?.data.cardType ?? null;
    };

    // 规则处理循环（规则 9.5.3.1）
    for (;;) {
      iterations++;
      if (iterations > MAX_ITERATIONS) {
        console.warn('检查时机处理达到最大迭代次数，可能存在无限循环');
        break;
      }

      // 收集所有需要执行的规则处理
      const pendingActions = ruleActionProcessor.collectPendingRuleActions(state, getCardType);

      if (pendingActions.length === 0) {
        break;
      }

      hasChanges = true;

      // 应用所有规则处理
      const {
        state: newState,
        hasVictory,
        winnerId,
        isDraw,
      } = applyAllRuleActions(state, pendingActions, getCardType);

      state = newState;

      // 记录规则处理到日志
      for (const action of pendingActions) {
        state = addAction(state, 'RULE_ACTION', null, {
          type: action.type,
          description: action.description,
          affectedPlayerId: action.affectedPlayerId,
        });
      }

      // 如果有胜利处理，结束游戏
      if (hasVictory) {
        if (isDraw) {
          state = markGameEnded(state, GameEndReason.DRAW, null);
        } else if (winnerId) {
          state = markGameEnded(state, GameEndReason.VICTORY_CONDITION, winnerId);
        }
        return {
          success: true,
          gameState: state,
          triggeredEvents: ['GAME_ENDED'],
        };
      }
    }

    // TODO: 步骤 2-3 处理自动能力（需要能力系统支持）
    // 目前采用"信任玩家"方案，自动能力由玩家手动执行

    return {
      success: true,
      gameState: state,
      triggeredEvents: hasChanges ? ['RULE_ACTIONS_EXECUTED'] : undefined,
    };
  }

  // ============================================
  // 演出阶段处理（规则 8.3）
  // ============================================

  /**
   * 翻开玩家的 Live 区卡牌
   * 基于规则 8.3.4
   *
   * @param game 当前游戏状态
   * @returns 更新后的游戏状态
   */
  private revealLiveCards(game: GameState): GameState {
    const activePlayer = getActivePlayer(game);
    const playerId = activePlayer.id;

    // 8.3.4 将 Live 区的卡牌全部变为表侧
    let state = updatePlayer(game, playerId, (player) => {
      const newCardStates = new Map(player.liveZone.cardStates);
      for (const cardId of player.liveZone.cardIds) {
        const existing = newCardStates.get(cardId);
        newCardStates.set(cardId, {
          orientation: existing?.orientation ?? OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        });
      }
      return {
        ...player,
        liveZone: { ...player.liveZone, cardStates: newCardStates },
      };
    });

    // 更新 liveResolution 状态
    const isFirstPlayer = playerId === getFirstPlayer(state).id;
    state = {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        isInLive: true,
        performingPlayerId: playerId,
      },
    };

    return state;
  }

  // ============================================
  // Live 结算阶段处理（规则 8.4）
  // 重构说明：采用"信任玩家"方案
  // - 系统只计算分数和推荐胜者
  // - 卡牌移动由玩家手动操作
  // - 清理休息室由玩家手动操作
  // - 先攻更新和胜利检测在 finalizeLiveResult() 中执行
  // ============================================

  /**
   * 执行 Live 结算阶段初始化
   * 基于规则 8.4
   *
   * 只计算分数和推荐胜者，不自动移动卡牌
   * 卡牌移动由玩家通过 SELECT_SUCCESS_CARD 和 MANUAL_MOVE_CARD 完成
   *
   * @param game 当前游戏状态
   * @returns 操作结果
   */
  executeLiveResultPhase(game: GameState): GameOperationResult {
    const firstPlayer = getFirstPlayer(game);
    const secondPlayer = getSecondPlayer(game);

    // 使用此前在 PERFORMANCE_JUDGMENT 已确认的结果（若缺失再补默认值）
    const liveResults = new Map(game.liveResolution.liveResults);
    for (const cardId of firstPlayer.liveZone.cardIds) {
      if (!liveResults.has(cardId)) {
        liveResults.set(cardId, true);
      }
    }
    for (const cardId of secondPlayer.liveZone.cardIds) {
      if (!liveResults.has(cardId)) {
        liveResults.set(cardId, true);
      }
    }

    // 8.4.2 计算双方基础分数（玩家可在 UI 中调整）
    const firstScore = this.calculateLiveScore(game, firstPlayer.id, liveResults);
    const secondScore = this.calculateLiveScore(game, secondPlayer.id, liveResults);

    const firstHasSuccessfulLive = firstPlayer.liveZone.cardIds.some(
      (cardId) => liveResults.get(cardId) !== false
    );
    const secondHasSuccessfulLive = secondPlayer.liveZone.cardIds.some(
      (cardId) => liveResults.get(cardId) !== false
    );

    // 8.4.3-8.4.6 决定推荐胜者（玩家可在 UI 中覆盖）
    const winnerIds: string[] = [];

    if (!firstHasSuccessfulLive && !secondHasSuccessfulLive) {
      // 8.4.3.1 / 8.4.6.1: 双方都没有 Live 卡，无人获胜
    } else if (firstHasSuccessfulLive && !secondHasSuccessfulLive) {
      // 8.4.3.2: 先攻有卡，后攻无卡，先攻获胜
      winnerIds.push(firstPlayer.id);
    } else if (!firstHasSuccessfulLive && secondHasSuccessfulLive) {
      // 8.4.3.2: 后攻有卡，先攻无卡，后攻获胜
      winnerIds.push(secondPlayer.id);
    } else {
      // 8.4.3.3 / 8.4.6.2: 双方都有卡，比较分数
      if (firstScore > secondScore) {
        winnerIds.push(firstPlayer.id);
      } else if (secondScore > firstScore) {
        winnerIds.push(secondPlayer.id);
      } else {
        // 分数相等，双方都获胜
        winnerIds.push(firstPlayer.id);
        winnerIds.push(secondPlayer.id);
      }
    }

    let state = game;

    // 更新 liveResolution 状态（用于 UI 显示）
    const playerScores = new Map<string, number>();
    playerScores.set(firstPlayer.id, firstScore);
    playerScores.set(secondPlayer.id, secondScore);

    state = {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        liveResults,
        playerScores,
        liveWinnerIds: winnerIds,
        // 新增字段：追踪谁已移动卡牌到成功区
        successCardMovedBy: [],
      },
    };

    // 记录 Live 判定结果
    state = addAction(state, 'LIVE_JUDGMENT', null, {
      firstPlayerId: firstPlayer.id,
      secondPlayerId: secondPlayer.id,
      firstScore,
      secondScore,
      recommendedWinnerIds: winnerIds,
      note: '分数和胜者由系统推荐，玩家可在 UI 中调整',
    });

    // 不再自动移动卡牌、不再自动清理、不再自动更新先攻
    // 这些操作由玩家在对应子阶段手动完成

    return {
      success: true,
      gameState: state,
    };
  }

  /**
   * 完成 Live 结算阶段
   * 在玩家完成所有手动操作后调用
   *
   * 职责：
   * - 更新先攻玩家（规则 8.4.13）
   * - 检查胜利条件（规则 10.3）
   * - 进入下一回合
   *
   * @param game 当前游戏状态
   * @returns 操作结果
   */
  finalizeLiveResult(game: GameState): GameOperationResult {
    const firstPlayer = getFirstPlayer(game);
    const secondPlayer = getSecondPlayer(game);

    let state = game;

    // 8.4.13 更新先攻玩家
    // 规则：胜者成为下回合先攻
    const winnerIds = state.liveResolution.liveWinnerIds;

    // 仅有一方胜利时，胜者成为先攻
    if (winnerIds.length === 1) {
      const winnerId = winnerIds[0];
      if (winnerId === secondPlayer.id) {
        // 后攻胜利，后攻成为新的先攻
        state = switchFirstPlayer(state);
      }
      // 先攻胜利，先攻权不变（已经是先攻）
    }
    // 双方都胜利或都没有胜利时，先攻权不变

    // 重置 liveResolution 状态
    state = {
      ...state,
      liveResolution: {
        isInLive: false,
        performingPlayerId: null,
        firstPlayerCheerCardIds: [],
        secondPlayerCheerCardIds: [],
        liveResults: new Map(),
        playerScores: new Map(),
        liveWinnerIds: [],
        successCardMovedBy: [],
      },
    };

    // 检查胜利条件
    for (const player of state.players) {
      if (player.successZone.cardIds.length >= GAME_CONFIG.VICTORY_LIVE_COUNT) {
        // 检查是否双方同时达成
        const otherPlayer = state.players.find((p) => p.id !== player.id);
        if (
          otherPlayer &&
          otherPlayer.successZone.cardIds.length >= GAME_CONFIG.VICTORY_LIVE_COUNT
        ) {
          // 平局
          return {
            success: true,
            gameState: markGameEnded(state, GameEndReason.DRAW, null),
          };
        }
        // 单方胜利
        return {
          success: true,
          gameState: markGameEnded(state, GameEndReason.VICTORY_CONDITION, player.id),
        };
      }
    }

    return {
      success: true,
      gameState: state,
    };
  }

  /**
   * 计算玩家的 Live 分数
   * 基于规则 8.4.2
   *
   * @param game 游戏状态
   * @param playerId 玩家 ID
   * @returns 分数
   */
  private calculateLiveScore(
    game: GameState,
    playerId: string,
    liveResults?: ReadonlyMap<string, boolean>
  ): number {
    const player = getPlayerById(game, playerId);
    if (!player) return 0;

    let totalScore = 0;

    for (const cardId of player.liveZone.cardIds) {
      // 判定失败的 Live 不计分
      if (liveResults && liveResults.get(cardId) === false) {
        continue;
      }
      const card = getCardById(game, cardId);
      if (card && isLiveCardData(card.data)) {
        totalScore += (card.data as LiveCardData).score;
      }
    }

    // 8.4.2.1: 应援的 [音符+1] 效果加分
    // 这需要从 liveResolution 中获取，简化实现暂时忽略

    return totalScore;
  }

  /**
   * 清理玩家 Live 区的剩余卡牌到休息室
   * 基于规则 8.4.8
   *
   * @param game 游戏状态
   * @param playerId 玩家 ID
   * @returns 更新后的游戏状态
   */
  private cleanupLiveZone(game: GameState, playerId: string): GameState {
    return updatePlayer(game, playerId, (player) => {
      let newWaitingRoom = player.waitingRoom;
      for (const cardId of player.liveZone.cardIds) {
        newWaitingRoom = addCardToZone(newWaitingRoom, cardId);
      }

      return {
        ...player,
        liveZone: { ...player.liveZone, cardIds: [], cardStates: new Map() },
        waitingRoom: newWaitingRoom,
      };
    });
  }

  /**
   * 清理解决区域
   * 基于规则 8.4.8
   *
   * @param game 游戏状态
   * @returns 更新后的游戏状态
   */
  private cleanupResolutionZone(game: GameState): GameState {
    // 将解决区域的卡牌移回各自玩家的休息室
    let state = game;

    for (const cardId of game.resolutionZone.cardIds) {
      const card = getCardById(state, cardId);
      if (card) {
        state = updatePlayer(state, card.ownerId, (player) => ({
          ...player,
          waitingRoom: addCardToZone(player.waitingRoom, cardId),
        }));
      }
    }

    // 清空解决区域
    return {
      ...state,
      resolutionZone: { ...state.resolutionZone, cardIds: [] },
    };
  }
}

/**
 * 游戏服务单例
 */
export const gameService = new GameService();
