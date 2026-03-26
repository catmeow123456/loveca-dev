/**
 * 动作处理器模块入口
 *
 * 提供处理器注册表和统一的处理器查询接口
 */

import type { GameState, GameActionType as ActionType } from '../../domain/entities/game';
import type { PlayerState } from '../../domain/entities/player';
import type { CardInstance } from '../../domain/entities/card';
import { GameActionType, type GameAction } from '../actions';
import type { ActionHandler, ActionHandlerContext } from './types';

// 导入各处理器
import { handleMulligan } from './mulligan.handler';
import { handlePlayMember } from './play-member.handler';
import { handleSetLiveCard } from './live-set.handler';
import { handleTapMember } from './tap-member.handler';
import {
  handleConfirmSubPhase,
  handleManualMoveCard,
  handleConfirmJudgment,
  handleConfirmScore,
  handleSelectSuccessCard,
  handleUndoOperation,
  handlePerformCheer,
} from './phase-ten.handler';
import {
  handleActivateAbility,
  handleEndPhase,
  handleSelectCards,
  handleConfirmOptional,
} from './misc.handler';

// ============================================
// 导出类型
// ============================================

export type { ActionHandler, ActionHandlerContext } from './types';
export { success, failure } from './types';

// ============================================
// 导出区域操作
// ============================================

export {
  removeCardFromPlayerZone,
  addCardToPlayerZone,
  moveCardBetweenZones,
} from './zone-operations';

// ============================================
// 处理器注册表
// ============================================

/**
 * 动作处理器注册表
 *
 * 将动作类型映射到对应的处理器函数
 * 使用类型断言处理泛型处理器的类型兼容性问题
 */
const ACTION_HANDLERS: Partial<Record<GameActionType, ActionHandler>> = {
  // 换牌
  [GameActionType.MULLIGAN]: handleMulligan as ActionHandler,

  // 成员卡
  [GameActionType.PLAY_MEMBER]: handlePlayMember as ActionHandler,

  // Live 设置
  [GameActionType.SET_LIVE_CARD]: handleSetLiveCard as ActionHandler,

  // 成员状态切换
  [GameActionType.TAP_MEMBER]: handleTapMember as ActionHandler,

  // 阶段十新增
  [GameActionType.CONFIRM_SUB_PHASE]: handleConfirmSubPhase as ActionHandler,
  [GameActionType.MANUAL_MOVE_CARD]: handleManualMoveCard as ActionHandler,
  [GameActionType.CONFIRM_JUDGMENT]: handleConfirmJudgment as ActionHandler,
  [GameActionType.CONFIRM_SCORE]: handleConfirmScore as ActionHandler,
  [GameActionType.SELECT_SUCCESS_CARD]: handleSelectSuccessCard as ActionHandler,
  [GameActionType.UNDO_OPERATION]: handleUndoOperation as ActionHandler,
  [GameActionType.PERFORM_CHEER]: handlePerformCheer as ActionHandler,

  // 杂项动作
  [GameActionType.ACTIVATE_ABILITY]: handleActivateAbility as ActionHandler,
  [GameActionType.END_PHASE]: handleEndPhase as ActionHandler,
  [GameActionType.SELECT_CARDS]: handleSelectCards as ActionHandler,
  [GameActionType.CONFIRM_OPTIONAL]: handleConfirmOptional as ActionHandler,
};

// ============================================
// 公开接口
// ============================================

/**
 * 获取指定动作类型的处理器
 *
 * @param type 动作类型
 * @returns 处理器函数，如果不存在则返回 undefined
 */
export function getActionHandler(type: GameActionType): ActionHandler | undefined {
  return ACTION_HANDLERS[type];
}

/**
 * 检查动作类型是否有对应的处理器
 *
 * @param type 动作类型
 * @returns 是否有处理器
 */
export function hasActionHandler(type: GameActionType): boolean {
  return type in ACTION_HANDLERS;
}

/**
 * 创建处理器上下文
 *
 * 将 GameService 的方法包装为上下文对象
 *
 * @param options 上下文选项
 * @returns 处理器上下文
 */
export function createHandlerContext(options: {
  getPlayerById: (game: GameState, playerId: string) => PlayerState | undefined;
  getCardById: (game: GameState, cardId: string) => CardInstance | null;
  updatePlayer: (
    game: GameState,
    playerId: string,
    updater: (p: PlayerState) => PlayerState
  ) => GameState;
  addAction: (
    game: GameState,
    type: ActionType,
    playerId: string | null,
    details: Record<string, unknown>
  ) => GameState;
  drawCard: (game: GameState, playerId: string) => GameState;
  drawEnergy: (game: GameState, playerId: string) => GameState;
}): ActionHandlerContext {
  return options;
}

// ============================================
// 导出各处理器（供单独使用）
// ============================================

export { handleMulligan } from './mulligan.handler';
export { handlePlayMember } from './play-member.handler';
export { handleSetLiveCard } from './live-set.handler';
export { handleTapMember } from './tap-member.handler';
export {
  handleConfirmSubPhase,
  handleManualMoveCard,
  handleConfirmJudgment,
  handleConfirmScore,
  handleSelectSuccessCard,
  handleUndoOperation,
  handlePerformCheer,
} from './phase-ten.handler';
export {
  handleActivateAbility,
  handleEndPhase,
  handleSelectCards,
  handleConfirmOptional,
} from './misc.handler';
