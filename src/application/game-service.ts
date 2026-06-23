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

function secureRandomInt(max: number): number {
  const array = new Uint32Array(1);
  globalThis.crypto.getRandomValues(array);
  return array[0] % max;
}

import {
  GamePhase,
  HeartColor,
  TurnType,
  ZoneType,
  SlotPosition,
  OrientationState,
  CardType,
  TriggerCondition,
  FaceState,
  GameEndReason,
  SubPhase,
  EffectWindowType,
} from '../shared/types/enums.js';
import type { GameState, GameAction as GameHistoryAction } from '../domain/entities/game.js';
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
  emitGameEvent,
} from '../domain/entities/game.js';
import {
  createLiveStartEvent,
  createLiveSuccessEvent,
  createMemberStateChangedEvent,
} from '../domain/events/game-events.js';
import type { LiveSuccessEvent } from '../domain/events/game-events.js';
import type { PlayerState } from '../domain/entities/player.js';
import {
  clearTurnMoveRecords,
  getHandCount,
  findCardZone,
  hasMovedToStageThisTurn,
  recordMoveToStage,
} from '../domain/entities/player.js';
import type {
  CardInstance,
  MemberCardData,
  LiveCardData,
  BaseCardData,
  AnyCardData,
  BladeHeartItem,
  HeartIcon,
} from '../domain/entities/card.js';
import { createCardInstance, isMemberCardData, isLiveCardData } from '../domain/entities/card.js';
import {
  addCardToZone,
  removeCardFromZone,
  addCardToStatefulZone,
  removeCardFromStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
  untapAllEnergy,
  shuffleZone,
  drawFromTop,
  getAllMemberCardIds,
  getCardInSlot,
  isSlotEmpty,
} from '../domain/entities/zone.js';
import { PhaseManager, phaseManager, PhaseAutoAction } from './phase-manager.js';
import { isOwnDeskFreeDragWindow } from './command-availability.js';
import { isPlayerActive as isPlayerActiveByConfig } from '../shared/phase-config/index.js';
import {
  getInitialSubPhase,
  getSubPhaseConfig,
  isSuccessEffectSubPhase,
} from '../shared/phase-config/index.js';
import { GameEventType } from './events.js';
import {
  GameAction,
  GameActionType,
  PlayMemberAction,
  ActivateAbilityAction,
  EndPhaseAction,
  SetLiveCardAction,
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
} from './actions.js';
// 导入动作处理器模块
import {
  getActionHandler,
  hasActionHandler,
  createHandlerContext,
  type ActionHandlerContext,
} from './action-handlers/index.js';
import { enqueueTriggeredCardEffects, resolvePendingCardEffects } from './card-effect-runner.js';
import { liveResolver } from '../domain/rules/live-resolver.js';
import { applyHeartRequirementModifiers } from '../domain/rules/live-requirement-modifiers.js';
import {
  collectLiveModifiers,
  getLiveCardRequirementModifiers,
  getLiveCardScoreModifier,
  getMemberEffectiveHeartIcons,
  getPlayerLiveHeartModifiers,
  getPlayerLiveScoreModifier,
} from '../domain/rules/live-modifiers.js';
import { revealCheerCardsFromMainDeck } from './effects/cheer.js';
import { clearLiveProhibitionsUntilLiveEnd } from '../domain/rules/live-prohibitions.js';
import { consumeMemberActivePhaseSkipsForPlayer } from '../domain/rules/member-active-skips.js';

function isTriggerCondition(event: GameEventType | string): event is TriggerCondition {
  return Object.values(TriggerCondition).includes(event as TriggerCondition);
}
// 导入规则处理模块
import {
  ruleActionProcessor,
  applyRuleActionResult,
  RuleActionType,
  type RuleActionResult,
} from '../domain/rules/rule-actions.js';
// 卡效自动化第一阶段已经接入检查时机与命令结算流程。
// GameService 继续承担底层规则处理；具体卡效登记、入队与结算由 card-effect-runner 负责。

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
  /** 触发的内部事件列表 */
  readonly triggeredEvents?: readonly (GameEventType | string)[];
  /** 本次处理过程中即时执行的规则处理 */
  readonly ruleActions?: readonly RuleActionResult[];
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

    // Live 设置阶段双方玩家都可以放置卡牌和完成设置（规则 8.2）
    const isLiveSetPhaseAction =
      game.currentPhase === GamePhase.LIVE_SET_PHASE &&
      action.type === GameActionType.SET_LIVE_CARD;

    // Mulligan 阶段双方玩家都可以换牌
    const isMulliganPhase = game.currentPhase === GamePhase.MULLIGAN_PHASE;

    if (
      (action.type === GameActionType.MANUAL_MOVE_CARD ||
        action.type === GameActionType.TAP_ENERGY) &&
      !(action.type === GameActionType.MANUAL_MOVE_CARD && action.liveDeskMoveExempt) &&
      !isOwnDeskFreeDragWindow(game.currentPhase, game.currentSubPhase)
    ) {
      return {
        success: false,
        gameState: game,
        error: '当前不是可自由整理阶段',
      };
    }

    // "信任玩家"原则：开放大阶段内双方都可以整理自己的桌面。
    const isOwnDeskFreeDragAction =
      isOwnDeskFreeDragWindow(game.currentPhase, game.currentSubPhase) &&
      (action.type === GameActionType.PLAY_MEMBER ||
        action.type === GameActionType.TAP_MEMBER ||
        action.type === GameActionType.TAP_ENERGY ||
        action.type === GameActionType.MANUAL_MOVE_CARD);

    if (
      !canActByTiming &&
      action.type !== GameActionType.SELECT_CARDS &&
      action.type !== GameActionType.CONFIRM_OPTIONAL &&
      !isLiveSetPhaseAction &&
      !isMulliganPhase &&
      !isOwnDeskFreeDragAction
    ) {
      return {
        success: false,
        gameState: game,
        error: '不是你的回合',
      };
    }

    // END_PHASE: 验证后转化为 ADVANCE_PHASE 事件
    if (action.type === GameActionType.END_PHASE) {
      if (!this.phaseManager.canEndCurrentPhase(game)) {
        return { success: false, gameState: game, error: '当前阶段不能由玩家主动结束' };
      }
      return this.dispatchEvents(game, [GameEventType.ADVANCE_PHASE]);
    }

    // 尝试使用动作处理器注册表
    const handler = getActionHandler(action.type);
    if (handler) {
      const context = this.createHandlerContext();
      const result = handler(game, action, context);

      if (result.success) {
        let preparedState = this.prepareAutomaticSubPhaseState(result.gameState);
        if (
          action.type === GameActionType.CONFIRM_JUDGMENT &&
          action.judgmentResults.size === 0 &&
          !this.hasPerformanceDraft(preparedState, action.playerId)
        ) {
          preparedState = this.finalizeAutomaticPerformanceJudgment(preparedState, action.playerId);
        }
        // 收集处理器触发的事件，通过事件派发循环统一处理
        const events: (GameEventType | string)[] = [...(result.triggeredEvents ?? [])];
        // 始终追加 RUN_CHECK_TIMING
        events.push(GameEventType.RUN_CHECK_TIMING);
        return this.dispatchEvents(preparedState, events);
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
   * 事件派发循环
   *
   * 按顺序处理事件队列：
   * 1. RESOLVE_LIVE_WINNER — 基于双方确认分数判定胜者
   * 2. FINALIZE_LIVE_RESULT — 完成 Live 结算收尾
   * 3. ADVANCE_PHASE — 推进到下一主阶段（可能产生新事件）
   * 4. RUN_CHECK_TIMING — 规则自动纠正
   */
  private dispatchEvents(
    initialState: GameState,
    events: (GameEventType | string)[]
  ): GameOperationResult {
    let state = initialState;
    const processedEvents: (GameEventType | string)[] = [];

    // 按优先级排序处理：FINALIZE 先于 ADVANCE 先于 CHECK_TIMING
    const sortedEvents = [...events].sort((a, b) => {
      const priority: Record<string, number> = {
        [GameEventType.RESOLVE_LIVE_WINNER]: 0,
        [GameEventType.FINALIZE_LIVE_RESULT]: 1,
        [GameEventType.ADVANCE_PHASE]: 2,
        [GameEventType.RUN_CHECK_TIMING]: 3,
      };
      return (priority[a] ?? 99) - (priority[b] ?? 99);
    });

    for (const event of sortedEvents) {
      switch (event) {
        case GameEventType.RESOLVE_LIVE_WINNER: {
          const resolveResult = this.resolveLiveWinner(state);
          if (resolveResult.success) {
            state = resolveResult.gameState;
          }
          processedEvents.push(event);
          if (state.liveResolution.liveWinnerIds.length === 0) {
            const finalizeResult = this.finalizeLiveResult(state);
            if (finalizeResult.success) {
              state = finalizeResult.gameState;
            }
            processedEvents.push(GameEventType.FINALIZE_LIVE_RESULT);

            const advanceResult = this.advancePhase(state);
            if (advanceResult.success) {
              state = advanceResult.gameState;
              processedEvents.push(...(advanceResult.triggeredEvents ?? []));
            }
            processedEvents.push(GameEventType.ADVANCE_PHASE);
            break;
          }

          state = {
            ...state,
            currentSubPhase: SubPhase.RESULT_ANIMATION,
            liveResolution: {
              ...state.liveResolution,
              animationConfirmedBy: [],
              successCardMovedBy: [],
              settlementConfirmedBy: [],
            },
          };
          break;
        }
        case GameEventType.FINALIZE_LIVE_RESULT: {
          const finalizeResult = this.finalizeLiveResult(state);
          if (finalizeResult.success) {
            state = finalizeResult.gameState;
          }
          processedEvents.push(event);
          break;
        }
        case GameEventType.ADVANCE_PHASE: {
          const advanceResult = this.advancePhase(state);
          if (advanceResult.success) {
            state = advanceResult.gameState;
            processedEvents.push(...(advanceResult.triggeredEvents ?? []));
          }
          processedEvents.push(event);
          break;
        }
        case GameEventType.RUN_CHECK_TIMING: {
          const triggerConditions = events.filter(isTriggerCondition);
          let checkState = state;
          if (
            triggerConditions.includes(TriggerCondition.ON_LIVE_SUCCESS) &&
            isSuccessEffectSubPhase(checkState.currentSubPhase)
          ) {
            checkState = this.emitLiveSuccessEventForResultSubPhase(
              checkState,
              checkState.currentSubPhase
            );
          }
          const checkResult = this.executeCheckTiming(checkState, triggerConditions);
          state = checkResult.gameState;
          processedEvents.push(event);
          break;
        }
        default:
          // 非内部事件（如 TriggerCondition），透传
          processedEvents.push(event);
          break;
      }
    }

    return {
      success: true,
      gameState: state,
      triggeredEvents: processedEvents,
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
      drawTopMainDeckCard: (game, playerId) => this.drawTopMainDeckCard(game, playerId),
    });
  }

  private prepareAutomaticSubPhaseState(game: GameState): GameState {
    if (game.currentSubPhase !== SubPhase.PERFORMANCE_JUDGMENT) {
      return game;
    }

    const player = game.players[game.activePlayerIndex];
    if (!player || this.hasPerformanceDraft(game, player.id)) {
      return game;
    }

    const stateAfterCheer = this.autoRevealPerformanceCheer(game, player.id);
    if (stateAfterCheer === game) {
      return stateAfterCheer;
    }

    return this.executeCheckTiming(stateAfterCheer, [TriggerCondition.ON_CHEER]).gameState;
  }

  private hasPerformanceDraft(game: GameState, playerId: string): boolean {
    const liveCards = this.getPlayerLiveCards(game, playerId);
    if (liveCards.length === 0) {
      return true;
    }

    return liveCards.every(({ cardId }) => game.liveResolution.liveResults.has(cardId));
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
      state = { ...state, liveSetCompletedPlayers: [] };
    }
    if (
      game.currentPhase === GamePhase.LIVE_SET_PHASE &&
      transition.newPhase !== GamePhase.LIVE_SET_PHASE
    ) {
      state = { ...state, liveSetCompletedPlayers: [] };
    }
    if (
      game.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      transition.newPhase === GamePhase.ACTIVE_PHASE
    ) {
      state = clearLiveProhibitionsUntilLiveEnd(state);
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

    // 配置驱动的子阶段初始化
    const initialSubPhase = this.resolveInitialSubPhase(state, transition.newPhase);
    state = { ...state, currentSubPhase: initialSubPhase };

    // 同步 activePlayerIndex（Phase 2: applySubPhaseTransition 已处理新子阶段的情况，
    // 但 advancePhase 直接设置子阶段，需要手动同步）
    if (initialSubPhase !== SubPhase.NONE) {
      const subConfig = getSubPhaseConfig(initialSubPhase);
      if (subConfig) {
        const secondPlayerIndex = state.firstPlayerIndex === 0 ? 1 : 0;
        if (subConfig.behavior.activePlayer === 'FIRST') {
          state = { ...state, activePlayerIndex: state.firstPlayerIndex };
        } else if (subConfig.behavior.activePlayer === 'SECOND') {
          state = { ...state, activePlayerIndex: secondPlayerIndex };
        }
      }
    }

    // 执行子阶段入口的自动处理
    state = this.executeSubPhaseEntryActions(state, transition.newPhase);

    if (this.shouldAutoSkipPerformancePhase(state)) {
      return this.advancePhase(state);
    }

    return {
      success: true,
      gameState: state,
      triggeredEvents: transition.triggeredConditions,
    };
  }

  /**
   * 解析阶段的初始子阶段
   *
   * 对于 LIVE_SET_PHASE，需要根据 liveSetCompletedPlayers 状态决定正确的起始子阶段。
   * 其他阶段直接使用 phase-config 定义的 initialSubPhase。
   */
  private resolveInitialSubPhase(state: GameState, newPhase: GamePhase): SubPhase {
    if (newPhase === GamePhase.LIVE_SET_PHASE) {
      const firstPlayerId = state.players[state.firstPlayerIndex].id;
      const completedPlayers = state.liveSetCompletedPlayers;

      if (!completedPlayers.includes(firstPlayerId)) {
        return SubPhase.LIVE_SET_FIRST_PLAYER;
      }
      return SubPhase.LIVE_SET_SECOND_PLAYER;
    }

    return getInitialSubPhase(newPhase) ?? SubPhase.NONE;
  }

  /**
   * 执行子阶段入口的自动处理
   *
   * 当进入一个新阶段时，如果初始子阶段有自动动作，自动执行它们，
   * 然后连续推进直到遇到需要用户操作的子阶段。
   */
  private executeSubPhaseEntryActions(state: GameState, newPhase: GamePhase): GameState {
    // PERFORMANCE_PHASE: 翻开 Live 卡（PERFORMANCE_REVEAL 的自动动作），然后推进到 JUDGMENT
    if (newPhase === GamePhase.PERFORMANCE_PHASE) {
      if (this.shouldAutoSkipPerformancePhase(state)) {
        return {
          ...state,
          currentSubPhase: SubPhase.NONE,
          effectWindowType: EffectWindowType.NONE,
        };
      }

      state = this.revealLiveCards(state);
      state = this.executePendingRuleActions(state).gameState;
      const performingPlayerId =
        state.liveResolution.performingPlayerId ?? state.players[state.activePlayerIndex]?.id;
      const performingPlayer = performingPlayerId ? getPlayerById(state, performingPlayerId) : null;
      const liveCardIds = performingPlayer
        ? this.getLiveCardIdsInLiveZone(state, performingPlayer.id)
        : [];
      if (!performingPlayer || liveCardIds.length === 0) {
        return {
          ...state,
          currentSubPhase: SubPhase.NONE,
          effectWindowType: EffectWindowType.NONE,
          liveResolution: {
            ...state.liveResolution,
            isInLive: false,
            performingPlayerId: null,
          },
        };
      }

      state = emitGameEvent(state, createLiveStartEvent(performingPlayer.id, liveCardIds));
      state = this.executeCheckTiming(state, [TriggerCondition.ON_LIVE_START]).gameState;

      if (!this.hasLiveCardInLiveZone(state, state.players[state.activePlayerIndex].id)) {
        return {
          ...state,
          currentSubPhase: SubPhase.NONE,
          effectWindowType: EffectWindowType.NONE,
          liveResolution: {
            ...state.liveResolution,
            isInLive: false,
            performingPlayerId: null,
          },
        };
      }

      state = {
        ...state,
        currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
        effectWindowType: EffectWindowType.LIVE_START,
      };
      return state;
    }

    if (newPhase === GamePhase.LIVE_RESULT_PHASE) {
      const result = this.executeLiveResultPhase(state);
      if (result.success) {
        state = result.gameState;
      }
    }

    while (
      isSuccessEffectSubPhase(state.currentSubPhase) &&
      !this.hasSuccessfulLiveForResultSubPhase(state, state.currentSubPhase)
    ) {
      const subPhaseResult = this.phaseManager.advanceToNextSubPhase(state);
      if (
        !subPhaseResult.shouldAdvancePhase &&
        subPhaseResult.newSubPhase === state.currentSubPhase
      ) {
        break;
      }
      state = this.phaseManager.applySubPhaseTransition(state, subPhaseResult);
      state = {
        ...state,
        effectWindowType: this.phaseManager.getEffectWindowType(state.currentSubPhase),
      };
      if (!subPhaseResult.shouldAdvancePhase) {
        break;
      }
    }

    if (
      newPhase === GamePhase.LIVE_RESULT_PHASE &&
      isSuccessEffectSubPhase(state.currentSubPhase) &&
      this.hasSuccessfulLiveForResultSubPhase(state, state.currentSubPhase)
    ) {
      state = {
        ...state,
        effectWindowType: EffectWindowType.LIVE_SUCCESS,
      };
      state = this.emitLiveSuccessEventForResultSubPhase(state, state.currentSubPhase);
      state = this.executeCheckTiming(state, [TriggerCondition.ON_LIVE_SUCCESS]).gameState;
    }

    return state;
  }

  private shouldAutoSkipPerformancePhase(state: GameState): boolean {
    if (state.currentPhase !== GamePhase.PERFORMANCE_PHASE) {
      return false;
    }

    const activePlayer = state.players[state.activePlayerIndex];
    return !activePlayer || activePlayer.liveZone.cardIds.length === 0;
  }

  private hasLiveCardInLiveZone(state: GameState, playerId: string): boolean {
    return this.getLiveCardIdsInLiveZone(state, playerId).length > 0;
  }

  private getLiveCardIdsInLiveZone(state: GameState, playerId: string): readonly string[] {
    const player = getPlayerById(state, playerId);
    if (!player) {
      return [];
    }

    return player.liveZone.cardIds.filter((cardId) => {
      const card = getCardById(state, cardId);
      return card !== null && isLiveCardData(card.data);
    });
  }

  private hasSuccessfulLiveForResultSubPhase(state: GameState, subPhase: SubPhase): boolean {
    const playerId =
      subPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS
        ? state.players[state.firstPlayerIndex]?.id
        : state.players[state.firstPlayerIndex === 0 ? 1 : 0]?.id;

    if (!playerId) {
      return false;
    }

    for (const [cardId, isSuccess] of state.liveResolution.liveResults.entries()) {
      const card = state.cardRegistry.get(cardId);
      if (isSuccess && card?.ownerId === playerId) {
        return true;
      }
    }

    return false;
  }

  private emitLiveSuccessEventForResultSubPhase(state: GameState, subPhase: SubPhase): GameState {
    const playerId =
      subPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS
        ? state.players[state.firstPlayerIndex]?.id
        : state.players[state.firstPlayerIndex === 0 ? 1 : 0]?.id;

    if (!playerId) {
      return state;
    }

    const successfulLiveCardIds = [...state.liveResolution.liveResults.entries()]
      .filter(([cardId, isSuccess]) => {
        const card = state.cardRegistry.get(cardId);
        return isSuccess === true && card?.ownerId === playerId;
      })
      .map(([cardId]) => cardId);
    if (successfulLiveCardIds.length === 0) {
      return state;
    }

    const alreadyLogged = state.eventLog.some((entry) => {
      const event = entry.event;
      if (event.eventType !== TriggerCondition.ON_LIVE_SUCCESS) {
        return false;
      }
      const liveSuccessEvent = event as LiveSuccessEvent;
      return (
        liveSuccessEvent.playerId === playerId &&
        liveSuccessEvent.successfulLiveCardIds.length === successfulLiveCardIds.length &&
        liveSuccessEvent.successfulLiveCardIds.every((cardId) =>
          successfulLiveCardIds.includes(cardId)
        )
      );
    });
    if (alreadyLogged) {
      return state;
    }

    const score =
      state.liveResolution.playerScores.get(playerId) ?? this.calculateLiveScore(state, playerId);
    return emitGameEvent(state, createLiveSuccessEvent(playerId, successfulLiveCardIds, score));
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

      // 预打散：消除同 card_code 连续排列和 Member/Live 分段的初始聚类，
      // 让后续 shuffleZone 的输入更接近均匀分布
      for (let i = mainDeckIds.length - 1; i > 0; i--) {
        const j = secureRandomInt(i + 1);
        [mainDeckIds[i], mainDeckIds[j]] = [mainDeckIds[j], mainDeckIds[i]];
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
    const { gameState, cardId } = this.drawTopMainDeckCard(game, playerId);
    if (!cardId) {
      return gameState;
    }

    return updatePlayer(gameState, playerId, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, cardId),
    }));
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

  private drawTopMainDeckCard(
    game: GameState,
    playerId: string
  ): { gameState: GameState; cardId: string | null; ruleActions: readonly RuleActionResult[] } {
    let state = game;
    const appliedRuleActions: RuleActionResult[] = [];

    const preRefresh = this.applyImmediateRefreshes(state);
    state = preRefresh.gameState;
    appliedRuleActions.push(...preRefresh.ruleActions);

    let drawnCardId: string | null = null;
    state = updatePlayer(state, playerId, (player) => {
      const { zone: newDeck, cardId } = drawFromTop(player.mainDeck);
      drawnCardId = cardId;
      return {
        ...player,
        mainDeck: newDeck,
      };
    });

    if (!drawnCardId) {
      return {
        gameState: state,
        cardId: null,
        ruleActions: appliedRuleActions,
      };
    }

    const postRefresh = this.applyImmediateRefreshes(state);
    state = postRefresh.gameState;
    appliedRuleActions.push(...postRefresh.ruleActions);

    return {
      gameState: state,
      cardId: drawnCardId,
      ruleActions: appliedRuleActions,
    };
  }

  private applyImmediateRefreshes(
    game: GameState,
    options?: {
      checkTopPlayerId?: string;
      checkTopCount?: number;
    }
  ): { gameState: GameState; ruleActions: readonly RuleActionResult[] } {
    let state = game;
    const ruleActions = ruleActionProcessor.collectPendingRefreshActions(state, options);

    for (const action of ruleActions) {
      state = this.applyRuleActionWithLog(state, action);
    }

    return {
      gameState: state,
      ruleActions,
    };
  }

  private applyRuleActionWithLog(game: GameState, result: RuleActionResult): GameState {
    const beforePlayer =
      result.affectedPlayerId !== null ? getPlayerById(game, result.affectedPlayerId) : null;
    const nextState = applyRuleActionResult(game, result, (cardId) => {
      const card = getCardById(game, cardId);
      return card?.data.cardType ?? null;
    });
    const afterPlayer =
      result.affectedPlayerId !== null ? getPlayerById(nextState, result.affectedPlayerId) : null;

    const payload: Record<string, unknown> = {
      type: result.type,
      description: result.description,
      affectedPlayerId: result.affectedPlayerId,
    };

    if (result.type === RuleActionType.REFRESH && beforePlayer && afterPlayer) {
      payload.movedCount = beforePlayer.waitingRoom.cardIds.length;
      payload.mainDeckCountAfter = afterPlayer.mainDeck.cardIds.length;
    }

    return addAction(nextState, 'RULE_ACTION', null, payload);
  }

  /**
   * 执行阶段自动处理
   */
  private executeAutoAction(game: GameState, autoAction: PhaseAutoAction): GameState {
    switch (autoAction.type) {
      case 'UNTAP_ALL':
        // 活跃阶段：将所有能量和成员变为活跃状态
        return this.untapAllForActivePhase(game, autoAction.playerId);

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

  private untapAllForActivePhase(game: GameState, playerId: string): GameState {
    const skipResult = consumeMemberActivePhaseSkipsForPlayer(game, playerId);
    const skippedMemberCardIdSet = new Set(skipResult.skippedMemberCardIds);
    const player = getPlayerById(skipResult.gameState, playerId);
    if (!player) {
      return skipResult.gameState;
    }
    const waitingMembers = Object.values(SlotPosition).flatMap((slot) => {
      const cardId = player.memberSlots.slots[slot];
      const cardState = cardId ? player.memberSlots.cardStates.get(cardId) : undefined;
      return cardId &&
        cardState?.orientation === OrientationState.WAITING &&
        !skippedMemberCardIdSet.has(cardId)
        ? [{ cardId, slot }]
        : [];
    });

    let state = updatePlayer(skipResult.gameState, playerId, (player) => {
      const memberCardStates = new Map(player.memberSlots.cardStates);
      for (const [cardId, cardState] of memberCardStates) {
        if (!skippedMemberCardIdSet.has(cardId)) {
          memberCardStates.set(cardId, {
            ...cardState,
            orientation: OrientationState.ACTIVE,
          });
        }
      }

      return clearTurnMoveRecords({
        ...player,
        energyZone: untapAllEnergy(player.energyZone),
        memberSlots: {
          ...player.memberSlots,
          cardStates: memberCardStates,
        },
      });
    });
    for (const member of waitingMembers) {
      state = emitGameEvent(
        state,
        createMemberStateChangedEvent(
          member.cardId,
          playerId,
          member.slot,
          OrientationState.WAITING,
          OrientationState.ACTIVE,
          { kind: 'RULE_ACTION', playerId }
        )
      );
    }
    return state;
  }

  /**
   * 进入 Live 判定时先自动翻出规则推荐的应援牌。
   * 玩家仍可在接受判定前手动多翻、少翻或移动判定区卡牌。
   */
  private autoRevealPerformanceCheer(game: GameState, playerId: string): GameState {
    const player = getPlayerById(game, playerId);
    if (!player) {
      return game;
    }

    if (this.hasPerformanceCheerStarted(game, playerId)) {
      return game;
    }

    const liveModifiers = collectLiveModifiers(game);
    const heartBonuses = getPlayerLiveHeartModifiers(game.liveResolution, playerId, liveModifiers);
    const activeMemberCards = [...this.getActiveMemberCards(game, player, liveModifiers)];
    if (heartBonuses.length > 0) {
      activeMemberCards.push(this.createTemporaryLiveHeartSource(heartBonuses));
    }
    const cheerCount = this.calculatePerformanceBladeCount(game, player, activeMemberCards);
    return revealCheerCardsFromMainDeck(game, playerId, cheerCount, { automated: true }).gameState;
  }

  /**
   * 玩家接受当前判定区后，基于当前仍在解决区的应援牌生成判定与分数草案。
   */
  private finalizeAutomaticPerformanceJudgment(game: GameState, playerId: string): GameState {
    const player = getPlayerById(game, playerId);
    if (!player) {
      return game;
    }

    const liveModifiers = collectLiveModifiers(game);
    const heartBonuses = getPlayerLiveHeartModifiers(game.liveResolution, playerId, liveModifiers);
    const stageMemberCards = this.getStageMemberCardsForLiveJudgment(game, player, liveModifiers);
    if (heartBonuses.length > 0) {
      stageMemberCards.push(this.createTemporaryLiveHeartSource(heartBonuses));
    }
    const liveCards = this.getPlayerLiveCards(game, playerId);
    const cheerCardIds = this.getCurrentPerformanceCheerCardIds(game, playerId);
    const cheerCards = cheerCardIds.map((cardId) => ({
      cardId,
      bladeHearts: this.getCardBladeHearts(game, cardId),
    }));
    const performance = liveResolver.performLive(playerId, stageMemberCards, liveCards, cheerCards);

    let stateAfterPerformance = game;
    for (let i = 0; i < performance.cheerResult.drawCount; i++) {
      stateAfterPerformance = this.drawCard(stateAfterPerformance, playerId);
    }

    const liveResults = new Map(stateAfterPerformance.liveResolution.liveResults);
    for (const judgment of performance.liveJudgments) {
      liveResults.set(judgment.liveCardId, judgment.isSuccess);
    }

    const scoreBonus = getPlayerLiveScoreModifier(
      stateAfterPerformance.liveResolution,
      playerId,
      collectLiveModifiers(stateAfterPerformance)
    );
    const hasSuccessfulLive = performance.liveJudgments.some((judgment) => judgment.isSuccess);
    const appliedScoreBonus = hasSuccessfulLive ? scoreBonus : 0;
    const scoreDraft = hasSuccessfulLive
      ? Math.max(0, performance.totalScore + appliedScoreBonus)
      : 0;
    const playerScores = new Map(stateAfterPerformance.liveResolution.playerScores);
    playerScores.set(playerId, scoreDraft);
    const playerRemainingHearts = new Map(
      stateAfterPerformance.liveResolution.playerRemainingHearts
    );
    playerRemainingHearts.set(playerId, hasSuccessfulLive ? performance.remainingHearts : []);
    const playerLiveJudgmentHearts = new Map(
      stateAfterPerformance.liveResolution.playerLiveJudgmentHearts
    );
    playerLiveJudgmentHearts.set(playerId, performance.liveJudgmentHearts);

    const state = {
      ...stateAfterPerformance,
      liveResolution: {
        ...stateAfterPerformance.liveResolution,
        liveResults,
        playerScores,
        playerRemainingHearts,
        playerLiveJudgmentHearts,
      },
    };

    return addAction(state, 'LIVE_JUDGMENT', playerId, {
      action: 'AUTO_PERFORMANCE_JUDGMENT',
      cheerCardIds,
      liveResults: Object.fromEntries(
        performance.liveJudgments.map((j) => [j.liveCardId, j.isSuccess])
      ),
      scoreDraft,
      bonusScore: performance.bonusScore,
      effectScoreBonus: appliedScoreBonus,
      drawCount: performance.cheerResult.drawCount,
      automated: true,
    });
  }

  private calculatePerformanceBladeCount(
    game: GameState,
    player: PlayerState,
    activeMemberCards: readonly MemberCardData[]
  ): number {
    const activeMemberCardIds = new Set(
      getAllMemberCardIds(player.memberSlots).filter((cardId) => {
        const state = player.memberSlots.cardStates.get(cardId);
        return state === undefined || state.orientation === OrientationState.ACTIVE;
      })
    );
    const modifierBladeCount = collectLiveModifiers(game).reduce((total, modifier) => {
      if (modifier.kind !== 'BLADE' || modifier.playerId !== player.id) {
        return total;
      }

      if (modifier.sourceCardId === undefined) {
        return total + modifier.countDelta;
      }

      const sourceCard = getCardById(game, modifier.sourceCardId);
      if (!sourceCard || !isMemberCardData(sourceCard.data)) {
        return total + modifier.countDelta;
      }

      return activeMemberCardIds.has(modifier.sourceCardId) ? total + modifier.countDelta : total;
    }, 0);

    return liveResolver.calculateTotalBlade(activeMemberCards) + modifierBladeCount;
  }

  private hasPerformanceCheerStarted(game: GameState, playerId: string): boolean {
    return this.getPerformanceCheerCardIds(game, playerId).length > 0;
  }

  private getCurrentPerformanceCheerCardIds(game: GameState, playerId: string): string[] {
    const resolutionCardIds = new Set(game.resolutionZone.cardIds);
    return this.getPerformanceCheerCardIds(game, playerId).filter((cardId) =>
      resolutionCardIds.has(cardId)
    );
  }

  private getPerformanceCheerCardIds(game: GameState, playerId: string): readonly string[] {
    return playerId === getFirstPlayer(game).id
      ? game.liveResolution.firstPlayerCheerCardIds
      : game.liveResolution.secondPlayerCheerCardIds;
  }

  private getActiveMemberCards(
    game: GameState,
    player: PlayerState,
    liveModifiers = collectLiveModifiers(game)
  ): MemberCardData[] {
    const memberCards: MemberCardData[] = [];

    for (const cardId of getAllMemberCardIds(player.memberSlots)) {
      const state = player.memberSlots.cardStates.get(cardId);
      if (state && state.orientation !== OrientationState.ACTIVE) {
        continue;
      }

      const card = getCardById(game, cardId);
      if (card && isMemberCardData(card.data)) {
        memberCards.push({
          ...card.data,
          hearts: getMemberEffectiveHeartIcons(game, player.id, cardId, liveModifiers),
        });
      }
    }

    return memberCards;
  }

  private getStageMemberCardsForLiveJudgment(
    game: GameState,
    player: PlayerState,
    liveModifiers = collectLiveModifiers(game)
  ): MemberCardData[] {
    const memberCards: MemberCardData[] = [];

    for (const cardId of getAllMemberCardIds(player.memberSlots)) {
      const card = getCardById(game, cardId);
      if (card && isMemberCardData(card.data)) {
        memberCards.push({
          ...card.data,
          hearts: getMemberEffectiveHeartIcons(game, player.id, cardId, liveModifiers),
        });
      }
    }

    return memberCards;
  }

  private createTemporaryLiveHeartSource(hearts: readonly HeartIcon[]): MemberCardData {
    return {
      cardCode: 'SYSTEM-LIVE-HEART-BONUS',
      name: 'Live Heart Bonus',
      cardType: CardType.MEMBER,
      cost: 0,
      blade: 0,
      hearts,
    };
  }

  private getPlayerLiveCards(
    game: GameState,
    playerId: string
  ): { cardId: string; data: LiveCardData }[] {
    const player = getPlayerById(game, playerId);
    if (!player) {
      return [];
    }

    return player.liveZone.cardIds.flatMap((cardId) => {
      const card = getCardById(game, cardId);
      if (!card || !isLiveCardData(card.data)) {
        return [];
      }
      const dataWithRequirements = this.applyLiveRequirementModifiers(game, cardId, card.data);
      return [
        {
          cardId,
          data: this.applyLiveScoreModifiers(game, cardId, dataWithRequirements),
        },
      ];
    });
  }

  private applyLiveRequirementModifiers(
    game: GameState,
    cardId: string,
    liveData: LiveCardData
  ): LiveCardData {
    const modifiers = getLiveCardRequirementModifiers(
      game.liveResolution,
      cardId,
      collectLiveModifiers(game)
    );
    if (modifiers.length === 0) {
      return liveData;
    }

    return {
      ...liveData,
      requirements: applyHeartRequirementModifiers(liveData.requirements, modifiers),
    };
  }

  private applyLiveScoreModifiers(
    game: GameState,
    cardId: string,
    liveData: LiveCardData
  ): LiveCardData {
    const scoreDelta = getLiveCardScoreModifier(
      game.liveResolution,
      cardId,
      collectLiveModifiers(game)
    );
    return scoreDelta === 0
      ? liveData
      : {
          ...liveData,
          score: Math.max(0, liveData.score + scoreDelta),
        };
  }

  private getCardBladeHearts(game: GameState, cardId: string): readonly BladeHeartItem[] {
    const card = getCardById(game, cardId);
    if (!card || !('bladeHearts' in card.data)) {
      return [];
    }

    return (card.data as { bladeHearts?: readonly BladeHeartItem[] }).bladeHearts ?? [];
  }

  /**
   * 触发能力
   */
  private triggerAbilities(
    game: GameState,
    conditions: readonly TriggerCondition[],
    sourceCardId?: string
  ): GameState {
    // 旧 rule-action 自动能力入口暂保留为空实现。
    // 现行卡效通过 enqueueTriggeredCardEffects / resolvePendingCardEffects 在检查时机中处理。
    return game;
  }

  // ============================================
  // 检查时机处理（规则 9.5 + 10）
  // ============================================

  private executePendingRuleActions(game: GameState): GameOperationResult {
    let state = game;
    let hasChanges = false;
    let iterations = 0;
    const MAX_ITERATIONS = 100; // 防止无限循环
    const appliedRuleActions: RuleActionResult[] = [];

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
      let hasVictory = false;
      let winnerId: string | null = null;
      let isDraw = false;

      for (const action of pendingActions) {
        appliedRuleActions.push(action);
        if (action.type === RuleActionType.VICTORY) {
          hasVictory = true;
          winnerId = action.winnerId ?? null;
          isDraw = action.description.includes('平局');
          continue;
        }

        state = this.applyRuleActionWithLog(state, action);
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
          ruleActions: appliedRuleActions,
        };
      }
    }

    return {
      success: true,
      gameState: state,
      triggeredEvents: hasChanges ? ['RULE_ACTIONS_EXECUTED'] : undefined,
      ruleActions: appliedRuleActions,
    };
  }

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
  executeCheckTiming(
    game: GameState,
    triggerConditions: readonly TriggerCondition[] = []
  ): GameOperationResult {
    let state = enqueueTriggeredCardEffects(game, triggerConditions);
    const ruleActionResult = this.executePendingRuleActions(state);
    state = ruleActionResult.gameState;
    if (ruleActionResult.triggeredEvents?.includes('GAME_ENDED')) {
      return ruleActionResult;
    }

    const abilityResult = resolvePendingCardEffects(state);
    state = abilityResult.gameState;
    const hasChanges =
      (ruleActionResult.ruleActions?.length ?? 0) > 0 ||
      abilityResult.resolvedAbilityIds.length > 0;

    return {
      success: true,
      gameState: state,
      triggeredEvents: hasChanges ? ['RULE_ACTIONS_EXECUTED'] : undefined,
      ruleActions: ruleActionResult.ruleActions,
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
    const firstScore =
      game.liveResolution.playerScores.get(firstPlayer.id) ??
      this.calculateLiveScore(game, firstPlayer.id, liveResults);
    const secondScore =
      game.liveResolution.playerScores.get(secondPlayer.id) ??
      this.calculateLiveScore(game, secondPlayer.id, liveResults);

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
        playerScoreBonuses: game.liveResolution.playerScoreBonuses,
        playerHeartBonuses: game.liveResolution.playerHeartBonuses,
        liveRequirementReductions: game.liveResolution.liveRequirementReductions,
        liveRequirementModifiers: game.liveResolution.liveRequirementModifiers,
        liveModifiers: game.liveResolution.liveModifiers,
        scoreConfirmedBy: [],
        liveWinnerIds: [],
        animationConfirmedBy: [],
        successCardMovedBy: [],
        settlementConfirmedBy: [],
      },
    };

    // 记录 Live 判定结果
    state = addAction(state, 'LIVE_JUDGMENT', null, {
      firstPlayerId: firstPlayer.id,
      secondPlayerId: secondPlayer.id,
      firstScore,
      secondScore,
      note: '已生成分数草案，等待双方在结算阶段分别确认',
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

    // 先统一执行结算清理，避免跨回合残留应援牌/失败 Live 卡
    state = this.performSettlementCleanup(state);

    // 若尚未完成胜者判定，则在 finalize 前补判一次（兜底）
    if (state.liveResolution.liveWinnerIds.length === 0) {
      const resolveResult = this.resolveLiveWinner(state);
      if (resolveResult.success) {
        state = resolveResult.gameState;
      }
    }

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
        playerRemainingHearts: new Map(),
        playerLiveJudgmentHearts: new Map(),
        playerScoreBonuses: new Map(),
        playerHeartBonuses: new Map(),
        liveRequirementReductions: new Map(),
        liveRequirementModifiers: new Map(),
        liveModifiers: [],
        scoreConfirmedBy: [],
        liveWinnerIds: [],
        animationConfirmedBy: [],
        successCardMovedBy: [],
        settlementConfirmedBy: [],
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
    let totalScore = 0;
    let hasSuccessfulLive = false;
    const evaluatedResults = liveResults ?? game.liveResolution.liveResults;

    for (const [cardId, result] of evaluatedResults.entries()) {
      if (result === false) {
        continue;
      }

      const card = getCardById(game, cardId);
      if (!card || card.ownerId !== playerId || !isLiveCardData(card.data)) {
        continue;
      }

      hasSuccessfulLive = true;
      totalScore += this.applyLiveScoreModifiers(game, cardId, card.data as LiveCardData).score;
    }

    // 8.4.2.1: 应援的 [音符+1] 效果加分
    // 这需要从 liveResolution 中获取，简化实现暂时忽略

    if (!hasSuccessfulLive) {
      return 0;
    }

    return Math.max(
      0,
      totalScore +
        getPlayerLiveScoreModifier(game.liveResolution, playerId, collectLiveModifiers(game))
    );
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
      resolutionZone: { ...state.resolutionZone, cardIds: [], revealedCardIds: [] },
    };
  }

  /**
   * 基于当前已确认分数判定 Live 胜者（8.4.3-8.4.6）
   */
  resolveLiveWinner(game: GameState): GameOperationResult {
    if (!this.haveAllPlayersConfirmedScores(game)) {
      return { success: true, gameState: game };
    }

    const firstPlayer = getFirstPlayer(game);
    const secondPlayer = getSecondPlayer(game);

    const firstScore = game.liveResolution.playerScores.get(firstPlayer.id) ?? 0;
    const secondScore = game.liveResolution.playerScores.get(secondPlayer.id) ?? 0;
    const firstHasLive = this.hasResolvedLive(game, firstPlayer.id, firstScore);
    const secondHasLive = this.hasResolvedLive(game, secondPlayer.id, secondScore);

    const winnerIds: string[] = [];
    if (!firstHasLive && !secondHasLive) {
      // 双方都没有成功 Live，无胜者
    } else if (firstHasLive && !secondHasLive) {
      winnerIds.push(firstPlayer.id);
    } else if (!firstHasLive && secondHasLive) {
      winnerIds.push(secondPlayer.id);
    } else if (firstScore > secondScore) {
      winnerIds.push(firstPlayer.id);
    } else if (secondScore > firstScore) {
      winnerIds.push(secondPlayer.id);
    } else {
      // 分数相等：成功区卡数 < 2 的玩家获胜。0 分成功 Live 也会进入这里。
      const firstSuccessCount = firstPlayer.successZone.cardIds.length;
      const secondSuccessCount = secondPlayer.successZone.cardIds.length;
      if (firstSuccessCount < 2) winnerIds.push(firstPlayer.id);
      if (secondSuccessCount < 2) winnerIds.push(secondPlayer.id);
    }

    const state: GameState = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveWinnerIds: winnerIds,
      },
    };

    return { success: true, gameState: state };
  }
  private haveAllPlayersConfirmedScores(game: GameState): boolean {
    return game.players.every((player) => game.liveResolution.scoreConfirmedBy.includes(player.id));
  }

  private hasResolvedLive(game: GameState, playerId: string, confirmedScore: number): boolean {
    for (const [cardId, isSuccess] of game.liveResolution.liveResults.entries()) {
      if (!isSuccess) {
        continue;
      }
      const card = getCardById(game, cardId);
      if (card?.ownerId === playerId && isLiveCardData(card.data)) {
        return true;
      }
    }

    // 兼容现有"玩家可手动调整确认分数"流程：正分数表示该玩家有合计分数。
    return confirmedScore > 0;
  }

  /**
   * RESULT_SETTLEMENT 收尾清理：
   * 1) resolutionZone 的应援牌 -> 各自休息室
   * 2) LIVE_ZONE 中剩余的本轮 Live 全部 -> 休息室
   */
  private performSettlementCleanup(game: GameState): GameState {
    let state = game;

    // 清理应援牌
    const resolutionCardIds = [...state.resolutionZone.cardIds];
    for (const cardId of resolutionCardIds) {
      const card = getCardById(state, cardId);
      if (!card) continue;
      state = {
        ...state,
        resolutionZone: {
          ...state.resolutionZone,
          cardIds: state.resolutionZone.cardIds.filter((id) => id !== cardId),
          revealedCardIds: state.resolutionZone.revealedCardIds.filter((id) => id !== cardId),
        },
      };
      state = updatePlayer(state, card.ownerId, (player) => ({
        ...player,
        waitingRoom: addCardToZone(player.waitingRoom, cardId),
      }));
    }

    // 清理 LIVE_ZONE 中剩余的 Live。
    // 胜者已选择进入 SUCCESS_ZONE 的卡牌此前已经从 LIVE_ZONE 移除，
    // 因此这里将剩余卡牌全部移入休息室即可。
    for (const player of state.players) {
      const remainingLiveCardIds = [...player.liveZone.cardIds];
      for (const cardId of remainingLiveCardIds) {
        state = updatePlayer(state, player.id, (p) => ({
          ...p,
          liveZone: removeCardFromStatefulZone(p.liveZone, cardId),
          waitingRoom: addCardToZone(p.waitingRoom, cardId),
        }));
      }
    }

    return clearLiveProhibitionsUntilLiveEnd(state);
  }
}

/**
 * 游戏服务单例
 */
export const gameService = new GameService();
