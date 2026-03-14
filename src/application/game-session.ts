/**
 * 游戏会话管理
 *
 * 充当服务器角色，维护权威游戏状态，处理动作并自动推进阶段。
 * 为每个玩家提供独立的、脱敏的游戏状态视角。
 */

import { GameService, type DeckConfig, type GameOperationResult } from './game-service';
import { GamePhase } from '../shared/types/enums';
import type { GameState } from '../domain/entities/game';
import { getActivePlayer } from '../domain/entities/game';
import type { GameAction } from './actions';

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
const MAX_AUTO_ADVANCE_ITERATIONS = 10;

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
  /** 是否启用调试模式（跳过回合验证） */
  debugMode?: boolean;
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
 */
export class GameSession {
  private gameService: GameService;
  private authorityState: GameState | null = null;
  private options: GameSessionOptions;

  constructor(options: GameSessionOptions = {}) {
    this.gameService = new GameService();
    this.options = options;
  }

  /**
   * 获取权威游戏状态（仅供调试）
   */
  get state(): GameState | null {
    return this.authorityState;
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
   * 执行动作后自动推进阶段（如果需要）
   */
  dispatch(action: GameAction): GameOperationResult {
    if (!this.authorityState) {
      return {
        success: false,
        gameState: null as unknown as GameState,
        error: '游戏尚未开始',
      };
    }

    // 调试模式下跳过回合验证（已在 GameService 中处理）
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
   * 自动推进阶段
   *
   * 循环执行自动阶段（活跃、能量、抽卡），直到进入需要玩家操作的阶段。
   */
  private autoAdvance(state: GameState): GameState {
    let currentState = state;
    let iterations = 0;

    while (
      AUTO_ADVANCE_PHASES.includes(currentState.currentPhase) &&
      iterations < MAX_AUTO_ADVANCE_ITERATIONS &&
      currentState.currentPhase !== GamePhase.GAME_END
    ) {
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
