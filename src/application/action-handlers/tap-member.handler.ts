/**
 * 切换成员状态动作处理器
 *
 * 将成员卡在活跃（ACTIVE）和等待（WAITING）状态之间切换
 * 参考规则 4.3.2
 *
 * "信任玩家"原则：允许自由切换，不限制阶段
 */

import type { GameState } from '../../domain/entities/game.js';
import type { TapMemberAction } from '../actions.js';
import type { ActionHandler, ActionHandlerContext } from './types.js';
import { success, failure } from './types.js';
import { addAction, updatePlayer } from '../../domain/entities/game.js';
import { toggleMemberOrientation, getCardInSlot } from '../../domain/entities/zone.js';
import { OrientationState } from '../../shared/types/enums.js';

/**
 * 处理切换成员状态动作
 */
export const handleTapMember: ActionHandler<TapMemberAction> = (
  game: GameState,
  action: TapMemberAction,
  ctx: ActionHandlerContext
) => {
  const { cardId, slot, playerId } = action;

  // 获取玩家
  const player = ctx.getPlayerById(game, playerId);
  if (!player) {
    return failure(game, '玩家不存在');
  }

  // 验证卡牌在指定槽位中
  const cardInSlot = getCardInSlot(player.memberSlots, slot);
  if (cardInSlot !== cardId) {
    return failure(game, '卡牌不在指定槽位中');
  }

  // 验证卡牌存在
  const card = ctx.getCardById(game, cardId);
  if (!card) {
    return failure(game, '卡牌不存在');
  }

  // 获取当前状态
  const currentState = player.memberSlots.cardStates.get(cardId);
  const currentOrientation = currentState?.orientation ?? OrientationState.ACTIVE;
  const newOrientation =
    currentOrientation === OrientationState.ACTIVE
      ? OrientationState.WAITING
      : OrientationState.ACTIVE;

  // 执行状态切换
  let state = updatePlayer(game, playerId, (p) => ({
    ...p,
    memberSlots: toggleMemberOrientation(p.memberSlots, cardId),
  }));

  // 记录动作
  state = addAction(state, 'TAP_MEMBER', playerId, {
    cardId,
    slot,
    cardName: card.data.name,
    fromOrientation: currentOrientation,
    toOrientation: newOrientation,
  });

  return success(state);
};
