/**
 * 动作处理器类型定义
 *
 * 将 game-service.ts 中的 handleXxx 方法抽取为独立处理器
 */

import type { GameState, GameActionType } from '../../domain/entities/game';
import type { PlayerState } from '../../domain/entities/player';
import type { CardInstance } from '../../domain/entities/card';
import type { GameOperationResult } from '../game-service';
import type { GameAction } from '../actions';

// ============================================
// 处理器上下文
// ============================================

/**
 * 动作处理器上下文
 * 提供处理器所需的游戏状态操作方法
 */
export interface ActionHandlerContext {
  /** 根据 ID 获取玩家状态 */
  getPlayerById: (game: GameState, playerId: string) => PlayerState | undefined;

  /** 根据实例 ID 获取卡牌 */
  getCardById: (game: GameState, cardId: string) => CardInstance | null;

  /** 更新玩家状态 */
  updatePlayer: (
    game: GameState,
    playerId: string,
    updater: (p: PlayerState) => PlayerState
  ) => GameState;

  /** 添加游戏动作记录 */
  addAction: (
    game: GameState,
    type: GameActionType,
    playerId: string | null,
    details: Record<string, unknown>
  ) => GameState;

  /** 抽一张卡 */
  drawCard: (game: GameState, playerId: string) => GameState;

  /** 从能量卡组放置能量到能量区 */
  drawEnergy: (game: GameState, playerId: string) => GameState;
}

// ============================================
// 动作处理器类型
// ============================================

/**
 * 动作处理器函数类型
 *
 * @template T 具体的动作类型
 * @param game 当前游戏状态
 * @param action 要处理的动作
 * @param ctx 处理器上下文
 * @returns 操作结果
 */
export type ActionHandler<T extends GameAction = GameAction> = (
  game: GameState,
  action: T,
  ctx: ActionHandlerContext
) => GameOperationResult;

// ============================================
// 辅助类型
// ============================================

/**
 * 创建成功结果的辅助函数类型
 */
export type SuccessResult = (
  gameState: GameState,
  extra?: Partial<Omit<GameOperationResult, 'success' | 'gameState'>>
) => GameOperationResult;

/**
 * 创建失败结果的辅助函数类型
 */
export type FailureResult = (game: GameState, error: string) => GameOperationResult;

// ============================================
// 结果辅助函数
// ============================================

/**
 * 创建成功结果
 */
export function success(
  gameState: GameState,
  extra?: Partial<Omit<GameOperationResult, 'success' | 'gameState'>>
): GameOperationResult {
  return {
    success: true,
    gameState,
    ...extra,
  };
}

/**
 * 创建失败结果
 */
export function failure(game: GameState, error: string): GameOperationResult {
  return {
    success: false,
    gameState: game,
    error,
  };
}
