/**
 * 打出成员卡动作处理器
 *
 * 基于规则 9.6.2
 */

import type { GameState } from '../../domain/entities/game.js';
import type { PlayMemberAction } from '../actions.js';
import type { ActionHandler, ActionHandlerContext } from './types.js';
import { success, failure } from './types.js';
import { TriggerCondition } from '../../shared/types/enums.js';
import { isMemberCardData } from '../../domain/entities/card.js';
import { addAction, updatePlayer } from '../../domain/entities/game.js';
import {
  removeCardFromZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
  getCardInSlot,
} from '../../domain/entities/zone.js';

/**
 * 处理打出成员卡动作
 *
 * 基于规则 9.6.2
 */
export const handlePlayMember: ActionHandler<PlayMemberAction> = (
  game: GameState,
  action: PlayMemberAction,
  ctx: ActionHandlerContext
) => {
  const { cardId, targetSlot, playerId } = action;

  // 获取玩家和卡牌
  const player = ctx.getPlayerById(game, playerId);
  if (!player) {
    return failure(game, '玩家不存在');
  }

  const card = ctx.getCardById(game, cardId);
  if (!card) {
    return failure(game, '卡牌不存在');
  }

  // 验证卡牌在手牌中
  if (!player.hand.cardIds.includes(cardId)) {
    return failure(game, '卡牌不在手牌中');
  }

  // 验证是成员卡
  if (!isMemberCardData(card.data)) {
    return failure(game, '只能打出成员卡');
  }

  const existingCardId = getCardInSlot(player.memberSlots, targetSlot);
  let replacedCardId: string | null = null;
  if (existingCardId) {
    const existingCard = ctx.getCardById(game, existingCardId);
    if (!existingCard || !isMemberCardData(existingCard.data)) {
      return failure(game, '目标槽位上的卡牌不是成员卡');
    }
    // 成员区已有成员时，本次登场按换手处理；不因该成员是否本回合新登场而被阻断。
    replacedCardId = existingCardId;
  }

  let state = game;

  // 执行：处理被替换的成员（换手）
  if (replacedCardId) {
    state = updatePlayer(state, playerId, (p) => {
      const newSlots = removeCardFromSlot(p.memberSlots, targetSlot);
      const newWaitingRoom = addCardToZone(p.waitingRoom, replacedCardId!);
      return { ...p, memberSlots: newSlots, waitingRoom: newWaitingRoom };
    });
  }

  // 执行：从手牌移除并放置到舞台
  state = updatePlayer(state, playerId, (p) => {
    const newHand = removeCardFromZone(p.hand, cardId);
    const newSlots = placeCardInSlot(p.memberSlots, targetSlot, cardId);
    return {
      ...p,
      hand: newHand,
      memberSlots: newSlots,
      movedToStageThisTurn: [...p.movedToStageThisTurn, cardId],
    };
  });

  // 记录动作
  state = addAction(state, 'PLAY_MEMBER', playerId, {
    cardId,
    targetSlot,
    isRelay: replacedCardId !== null,
    replacedCardId,
    energyPayment: 'MANUAL',
  });

  const triggeredEvents: TriggerCondition[] = [TriggerCondition.ON_ENTER_STAGE];
  if (replacedCardId) {
    triggeredEvents.unshift(TriggerCondition.ON_ENTER_WAITING_ROOM);
    triggeredEvents.unshift(TriggerCondition.ON_LEAVE_STAGE);
    triggeredEvents.push(TriggerCondition.ON_RELAY);
  }

  return success(state, {
    triggeredEvents,
  });
};
