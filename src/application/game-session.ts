/**
 * 游戏会话管理
 *
 * 充当服务器角色，维护权威游戏状态，处理动作并自动推进阶段。
 * 为每个玩家提供独立的、脱敏的游戏状态视角。
 *
 * 支持 GameMode：
 * - DEBUG: 调试模式，双人同设备手动操作
 * - SOLITAIRE: 对墙打模式，系统自动跳过对手阶段
 */

import { GameService, type DeckConfig, type GameOperationResult } from './game-service';
import { GamePhase, GameMode, SubPhase } from '../shared/types/enums';
import type { GameState } from '../domain/entities/game';
import { getActivePlayer } from '../domain/entities/game';
import type { GameAction } from './actions';
import {
  createMulliganAction,
  createSkipLiveSetAction,
  createEndPhaseAction,
  createConfirmSubPhaseAction,
} from './actions';

// ============================================
// 类型定义
// ============================================

/**
 * 自动推进的阶段列表
 * 这些阶段不需要玩家主动操作，会自动执行并推进到下一阶段
 *
 * 注意：PERFORMANCE_PHASE 和 LIVE_RESULT_PHASE 不在此列表中，
 * 因为它们需要给 UI 时间展示动画（Cheer、判定结果等）
 */
const AUTO_ADVANCE_PHASES: readonly GamePhase[] = [
  GamePhase.ACTIVE_PHASE,
  GamePhase.ENERGY_PHASE,
  GamePhase.DRAW_PHASE,
];

/**
 * 自动推进的最大次数限制，防止无限循环
 */
const MAX_AUTO_ADVANCE_ITERATIONS = 20;

/**
 * 游戏会话事件类型
 */
export type GameSessionEvent =
  | { type: 'PHASE_CHANGED'; phase: GamePhase; activePlayerId: string }
  | { type: 'TURN_CHANGED'; turnNumber: number; activePlayerId: string }
  | { type: 'GAME_ENDED'; winnerId: string | null }
  | { type: 'ACTION_EXECUTED'; action: GameAction; playerId: string };

/**
 * 游戏会话选项
 */
export interface GameSessionOptions {
  /** 游戏模式（默认调试模式） */
  gameMode?: GameMode;
  /** 事件监听器 */
  onEvent?: (event: GameSessionEvent) => void;
}

// ============================================
// GameSession 类
// ============================================

/**
 * 游戏会话
 *
 * 管理单场游戏的生命周期，提供：
 * 1. 权威状态管理
 * 2. 动作处理与验证
 * 3. 自动阶段推进
 * 4. 玩家视角状态获取
 * 5. 对墙打模式下对手阶段自动跳过
 */
export class GameSession {
  private gameService: GameService;
  private authorityState: GameState | null = null;
  private _gameMode: GameMode;
  private options: GameSessionOptions;

  constructor(options: GameSessionOptions = {}) {
    this.gameService = new GameService();
    this._gameMode = options.gameMode ?? GameMode.DEBUG;
    this.options = options;
  }

  /**
   * 获取权威游戏状态（仅供调试）
   */
  get state(): GameState | null {
    return this.authorityState;
  }

  /**
   * 获取当前游戏模式
   */
  get gameMode(): GameMode {
    return this._gameMode;
  }

  /**
   * 设置游戏模式（支持游戏内切换）
   */
  set gameMode(mode: GameMode) {
    this._gameMode = mode;
  }

  /**
   * 创建新游戏
   */
  createGame(
    gameId: string,
    player1Id: string,
    player1Name: string,
    player2Id: string,
    player2Name: string
  ): GameState {
    this.authorityState = this.gameService.createGame(
      gameId,
      player1Id,
      player1Name,
      player2Id,
      player2Name
    );
    return this.authorityState;
  }

  /**
   * 初始化游戏（设置卡组、抽初始手牌等）
   * 初始化后自动推进到第一个需要玩家操作的阶段
   */
  initializeGame(player1Deck: DeckConfig, player2Deck: DeckConfig): GameOperationResult {
    if (!this.authorityState) {
      return {
        success: false,
        gameState: null as unknown as GameState,
        error: '游戏尚未创建',
      };
    }

    const result = this.gameService.initializeGame(this.authorityState, player1Deck, player2Deck);

    if (result.success) {
      this.authorityState = result.gameState;
      // 自动推进阶段
      this.authorityState = this.autoAdvance(this.authorityState);
    }

    return {
      ...result,
      gameState: this.authorityState,
    };
  }

  /**
   * 处理玩家动作
   *
   * 执行动作后自动推进阶段（如果需要）。
   * 对墙打模式下，会在玩家动作完成后自动触发对手跳过动作。
   */
  dispatch(action: GameAction): GameOperationResult {
    if (!this.authorityState) {
      return {
        success: false,
        gameState: null as unknown as GameState,
        error: '游戏尚未开始',
      };
    }

    const result = this.gameService.processAction(this.authorityState, action);

    if (result.success) {
      this.authorityState = result.gameState;

      // 发送动作执行事件
      this.emitEvent({
        type: 'ACTION_EXECUTED',
        action,
        playerId: action.playerId,
      });

      // 自动推进阶段
      this.authorityState = this.autoAdvance(this.authorityState);

      // 对墙打模式：自动处理对手阶段
      if (this._gameMode === GameMode.SOLITAIRE) {
        this.authorityState = this.handleSolitaireAutoSkip(action);
      }
    }

    return {
      ...result,
      gameState: this.authorityState,
    };
  }

  /**
   * 手动推进阶段（用于需要玩家确认的阶段转换）
   */
  advancePhase(): GameOperationResult {
    if (!this.authorityState) {
      return {
        success: false,
        gameState: null as unknown as GameState,
        error: '游戏尚未开始',
      };
    }

    const result = this.gameService.advancePhase(this.authorityState);

    if (result.success) {
      this.authorityState = result.gameState;

      // 发送阶段变更事件
      this.emitEvent({
        type: 'PHASE_CHANGED',
        phase: result.gameState.currentPhase,
        activePlayerId: getActivePlayer(result.gameState).id,
      });

      // 继续自动推进（如果新阶段是自动阶段）
      this.authorityState = this.autoAdvance(this.authorityState);
    }

    return {
      ...result,
      gameState: this.authorityState,
    };
  }

  /**
   * 获取指定玩家视角的游戏状态
   *
   * 注意：当前实现暂不做脱敏处理，直接返回权威状态的副本。
   * 未来联机功能时需要实现真正的状态脱敏。
   */
  getStateForPlayer(_playerId: string): GameState | null {
    if (!this.authorityState) {
      return null;
    }

    // TODO: 实现状态脱敏
    // 当前直接返回状态副本
    return { ...this.authorityState };
  }

  /**
   * 获取当前活跃玩家 ID
   */
  getActivePlayerId(): string | null {
    if (!this.authorityState) {
      return null;
    }
    return getActivePlayer(this.authorityState).id;
  }

  /**
   * 检查指定玩家是否是当前活跃玩家
   */
  isActivePlayer(playerId: string): boolean {
    return this.getActivePlayerId() === playerId;
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 对墙打模式：自动跳过对手阶段
   *
   * 根据刚刚执行的动作类型和当前状态，决定是否需要自动触发对手的跳过动作。
   */
  private handleSolitaireAutoSkip(lastAction: GameAction): GameState {
    if (!this.authorityState) throw new Error('Solitaire auto-skip: authorityState is null');

    const state = this.authorityState;
    const opponentId = this.getOpponentId(lastAction.playerId);
    if (!opponentId) return state;

    // 1. 玩家完成换牌 → 自动跳过对手换牌
    if (lastAction.type === 'MULLIGAN' && state.currentPhase === GamePhase.MULLIGAN_PHASE) {
      const mulliganAction = createMulliganAction(opponentId, []);
      const result = this.gameService.processAction(state, mulliganAction);
      if (result.success) {
        this.authorityState = result.gameState;
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: mulliganAction,
          playerId: opponentId,
        });
        this.authorityState = this.autoAdvance(this.authorityState);
      }
      return this.authorityState;
    }

    // 2. 玩家完成 Live 设置 → 自动跳过对手 Live 设置
    if (
      lastAction.type === 'SKIP_LIVE_SET' &&
      state.currentPhase === GamePhase.LIVE_SET_PHASE
    ) {
      const skipAction = createSkipLiveSetAction(opponentId);
      const result = this.gameService.processAction(this.authorityState, skipAction);
      if (result.success) {
        this.authorityState = result.gameState;
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: skipAction,
          playerId: opponentId,
        });
        this.authorityState = this.autoAdvance(this.authorityState);
      }
      return this.authorityState;
    }

    // 3. 进入 PERFORMANCE_PHASE 且活跃玩家是对手 → 自动跳过对手演出
    if (
      state.currentPhase === GamePhase.PERFORMANCE_PHASE &&
      this.isActivePlayer(opponentId)
    ) {
      this.authorityState = this.skipOpponentPerformance(opponentId);
      return this.authorityState;
    }

    // 4. 对手通常阶段自动跳过：活跃/能量/抽卡已在 autoAdvance 中处理，
    //    主要阶段需要自动 END_PHASE
    if (
      state.currentPhase === GamePhase.MAIN_PHASE &&
      this.isActivePlayer(opponentId)
    ) {
      const endAction = createEndPhaseAction(opponentId);
      const result = this.gameService.processAction(this.authorityState, endAction);
      if (result.success) {
        this.authorityState = result.gameState;
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: endAction,
          playerId: opponentId,
        });
        this.authorityState = this.autoAdvance(this.authorityState);
      }
      return this.authorityState;
    }

    // 5. LIVE_RESULT_PHASE 中对手的成功效果子阶段自动跳过
    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS
    ) {
      // 对手没有成功卡，直接跳过
      const confirmAction = createConfirmSubPhaseAction(opponentId, SubPhase.RESULT_SECOND_SUCCESS_EFFECTS);
      const result = this.gameService.processAction(this.authorityState, confirmAction);
      if (result.success) {
        this.authorityState = result.gameState;
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: confirmAction,
          playerId: opponentId,
        });
        this.authorityState = this.autoAdvance(this.authorityState);
      }
      return this.authorityState;
    }

    // 6. LIVE_SET_PHASE 中对手的子阶段自动跳过
    //    处理 CONFIRM_SUB_PHASE 推进到对手盖牌子阶段的情况
    if (
      state.currentPhase === GamePhase.LIVE_SET_PHASE &&
      state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER
    ) {
      const confirmAction = createConfirmSubPhaseAction(opponentId, SubPhase.LIVE_SET_SECOND_PLAYER);
      const result = this.gameService.processAction(this.authorityState, confirmAction);
      if (result.success) {
        this.authorityState = result.gameState;
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: confirmAction,
          playerId: opponentId,
        });
        this.authorityState = this.autoAdvance(this.authorityState);
      }
      return this.authorityState;
    }

    return this.authorityState;
  }

  /**
   * 跳过对手的演出阶段
   *
   * 对手没有放置 Live 卡，演出阶段的翻卡/效果/判定均无实际操作。
   * 连续推进子阶段直到演出阶段结束。
   */
  private skipOpponentPerformance(opponentId: string): GameState {
    if (!this.authorityState) throw new Error('Solitaire performance skip: authorityState is null');

    let state = this.authorityState;
    const maxIterations = 10;

    for (let i = 0; i < maxIterations; i++) {
      // 不再在演出阶段或已离开演出阶段，停止
      if (state.currentPhase !== GamePhase.PERFORMANCE_PHASE) break;
      // 活跃玩家已不是对手，停止
      if (!this.isActivePlayer(opponentId)) break;

      // 根据当前子阶段决定跳过方式
      const subPhase = state.currentSubPhase;

      if (subPhase === SubPhase.PERFORMANCE_REVEAL) {
        // 翻卡子阶段：通过 advancePhase 推进
        const result = this.gameService.advancePhase(state);
        if (!result.success || !result.gameState) break;
        state = result.gameState;
        this.emitEvent({
          type: 'PHASE_CHANGED',
          phase: state.currentPhase,
          activePlayerId: getActivePlayer(state).id,
        });
      } else if (
        subPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS ||
        subPhase === SubPhase.PERFORMANCE_JUDGMENT
      ) {
        // 效果窗口/判定子阶段：dispatch CONFIRM_SUB_PHASE 跳过
        const confirmAction = createConfirmSubPhaseAction(opponentId, subPhase);
        const result = this.gameService.processAction(state, confirmAction);
        if (!result.success) break;
        state = result.gameState;
        this.emitEvent({
          type: 'ACTION_EXECUTED',
          action: confirmAction,
          playerId: opponentId,
        });
      } else {
        // 未知子阶段，尝试 advancePhase
        const result = this.gameService.advancePhase(state);
        if (!result.success || !result.gameState) break;
        state = result.gameState;
        this.emitEvent({
          type: 'PHASE_CHANGED',
          phase: state.currentPhase,
          activePlayerId: getActivePlayer(state).id,
        });
      }

      // 继续自动推进（处理自动子阶段）
      state = this.autoAdvance(state);
    }

    this.authorityState = state;
    return state;
  }

  /**
   * 获取对手玩家 ID
   */
  private getOpponentId(playerId: string): string | null {
    if (!this.authorityState) return null;
    const opponent = this.authorityState.players.find((p) => p.id !== playerId);
    return opponent?.id ?? null;
  }

  /**
   * 自动推进阶段
   *
   * 循环执行自动阶段（活跃、能量、抽卡），直到进入需要玩家操作的阶段。
   * 对墙打模式下，对手的自动阶段也会被跳过。
   */
  private autoAdvance(state: GameState): GameState {
    let currentState = state;
    let iterations = 0;

    while (
      AUTO_ADVANCE_PHASES.includes(currentState.currentPhase) &&
      iterations < MAX_AUTO_ADVANCE_ITERATIONS &&
      currentState.currentPhase !== GamePhase.GAME_END
    ) {
      // 对墙打模式：如果活跃玩家是对手，仍然自动推进（活跃/能量/抽卡阶段无实际操作意义）
      // 这些阶段本身已经是 AUTO_ADVANCE 的，直接推进即可
      const prevPhase = currentState.currentPhase;
      const result = this.gameService.advancePhase(currentState);

      if (!result.success) {
        console.warn('[GameSession] 自动推进阶段失败:', result.error);
        break;
      }

      currentState = result.gameState;
      iterations++;

      // 发送阶段变更事件
      this.emitEvent({
        type: 'PHASE_CHANGED',
        phase: currentState.currentPhase,
        activePlayerId: getActivePlayer(currentState).id,
      });

      // 检测是否发生回合切换
      if (prevPhase === GamePhase.ACTIVE_PHASE && iterations === 1) {
        this.emitEvent({
          type: 'TURN_CHANGED',
          turnNumber: currentState.turnCount,
          activePlayerId: getActivePlayer(currentState).id,
        });
      }
    }

    if (iterations >= MAX_AUTO_ADVANCE_ITERATIONS) {
      console.error('[GameSession] 自动推进阶段达到最大迭代次数，可能存在无限循环');
    }

    return currentState;
  }

  /**
   * 发送事件
   */
  private emitEvent(event: GameSessionEvent): void {
    if (this.options.onEvent) {
      this.options.onEvent(event);
    }
  }
}

/**
 * 创建游戏会话
 */
export function createGameSession(options?: GameSessionOptions): GameSession {
  return new GameSession(options);
}