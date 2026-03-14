/**
 * 打出成员卡动作处理器
 *
 * 基于规则 9.6.2
 */

import type { GameState } from '../../domain/entities/game';
import type { PlayMemberAction } from '../actions';
import type { ActionHandler, ActionHandlerContext } from './types';
import { success, failure } from './types';
import { TriggerCondition } from '../../shared/types/enums';
import type { MemberCardData } from '../../domain/entities/card';
import { isMemberCardData } from '../../domain/entities/card';
import { addAction, updatePlayer } from '../../domain/entities/game';
import { getAvailableEnergyCount, hasMovedToStageThisTurn } from '../../domain/entities/player';
import {
  removeCardFromZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
  tapEnergy,
  getActiveEnergyIds,
  getCardInSlot,
} from '../../domain/entities/zone';

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
  const { cardId, targetSlot, playerId, isRelay } = action;

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

  const memberData = card.data as MemberCardData;

  // 验证目标槽位
  // 规则 9.6.2.1.2.1: 不能指定本回合内从非舞台领域移动到舞台的成员卡所在的成员区
  const existingCardId = getCardInSlot(player.memberSlots, targetSlot);
  if (existingCardId && hasMovedToStageThisTurn(player, existingCardId)) {
    return failure(game, '目标槽位本回合已有新成员登场');
  }

  // 计算费用
  let costToPay = memberData.cost;

  // 处理接力传递（换手）- 规则 9.6.2.3.2
  let relayDiscount = 0;
  let replacedCardId: string | null = null;

  if (isRelay && existingCardId) {
    const existingCard = ctx.getCardById(game, existingCardId);
    if (existingCard && isMemberCardData(existingCard.data)) {
      relayDiscount = (existingCard.data as MemberCardData).cost;
      replacedCardId = existingCardId;
    }
  }

  const finalCost = Math.max(0, costToPay - relayDiscount);

  // 验证费用
  const availableEnergy = getAvailableEnergyCount(player);
  if (availableEnergy < finalCost) {
    return failure(game, `能量不足，需要 ${finalCost}，只有 ${availableEnergy}`);
  }

  // 执行：支付费用
  let state = game;
  const activeEnergyIds = getActiveEnergyIds(player.energyZone);
  for (let i = 0; i < finalCost; i++) {
    if (activeEnergyIds[i]) {
      state = updatePlayer(state, playerId, (p) => ({
        ...p,
        energyZone: tapEnergy(p.energyZone, activeEnergyIds[i]),
      }));
    }
  }

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
    cost: finalCost,
    isRelay,
    replacedCardId,
  });

  return success(state, {
    triggeredEvents: [TriggerCondition.ON_ENTER_STAGE],
  });
};
