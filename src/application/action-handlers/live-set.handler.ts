/**
 * Live 设置阶段动作处理器
 *
 * 基于规则 8.2
 *
 * Live 设置的完成统一使用 CONFIRM_SUB_PHASE。
 */

import type { GameState } from '../../domain/entities/game.js';
import type { SetLiveCardAction } from '../actions.js';
import type { ActionHandler, ActionHandlerContext } from './types.js';
import { success, failure } from './types.js';
import {
  FaceState,
  GamePhase,
  OrientationState,
  TriggerCondition,
  ZoneType,
} from '../../shared/types/enums.js';
import {
  addAction,
  emitGameEvent,
  getLiveSetCardCountForPlayer,
  getLiveSetCardLimitForPlayer,
  incrementLiveSetCardCountForPlayer,
  updatePlayer,
} from '../../domain/entities/game.js';
import { removeCardFromZone, addCardToStatefulZone } from '../../domain/entities/zone.js';
import { createEnterLiveZoneEvent } from '../../domain/events/game-events.js';

/**
 * 处理放置 Live 卡动作
 *
 * 基于规则 8.2
 */
export const handleSetLiveCard: ActionHandler<SetLiveCardAction> = (
  game: GameState,
  action: SetLiveCardAction,
  ctx: ActionHandlerContext
) => {
  const { cardId, playerId, faceDown } = action;

  const player = ctx.getPlayerById(game, playerId);
  if (!player) {
    return failure(game, '玩家不存在');
  }

  // 验证卡牌在手牌中
  if (!player.hand.cardIds.includes(cardId)) {
    return failure(game, '卡牌不在手牌中');
  }

  // 验证是否在 Live 设置阶段
  if (game.currentPhase !== GamePhase.LIVE_SET_PHASE) {
    return failure(game, '只能在 Live 设置阶段放置 Live 卡');
  }

  // 检查本次 Live 设置阶段已经由 SET_LIVE_CARD 放置的 Live 卡数量。
  if (getLiveSetCardCountForPlayer(game, playerId) >= getLiveSetCardLimitForPlayer(game, playerId)) {
    return failure(game, '已达到 Live 卡放置上限');
  }

  // 执行：从手牌移除并放置到 Live 区
  let state = updatePlayer(game, playerId, (p) => {
    const newHand = removeCardFromZone(p.hand, cardId);
    const newLiveZone = addCardToStatefulZone(p.liveZone, cardId, {
      orientation: OrientationState.ACTIVE,
      face: faceDown ? FaceState.FACE_DOWN : FaceState.FACE_UP,
    });
    return { ...p, hand: newHand, liveZone: newLiveZone };
  });

  // 注意：抽卡逻辑由子阶段自动处理（DRAW_CARDS_FOR_LIVE_SET）
  // 根据规则 8.2.2，玩家先盖完所有牌，然后一次性抽与盖牌数量相同的卡牌

  // 记录动作
  state = addAction(state, 'SET_LIVE_CARD', playerId, { cardId, faceDown });
  state = incrementLiveSetCardCountForPlayer(state, playerId);
  const enterLiveZoneEvent = createEnterLiveZoneEvent(
    cardId,
    ZoneType.HAND,
    playerId,
    playerId,
    faceDown ? FaceState.FACE_DOWN : FaceState.FACE_UP
  );
  state = emitGameEvent(state, enterLiveZoneEvent);

  return success(state, { triggeredEvents: [TriggerCondition.ON_ENTER_LIVE_ZONE] });
};
