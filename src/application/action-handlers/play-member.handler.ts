/**
 * 打出成员卡动作处理器
 *
 * 基于规则 9.6.2
 */

import type { GameState } from '../../domain/entities/game.js';
import type { PlayMemberAction } from '../actions.js';
import type { ActionHandler, ActionHandlerContext } from './types.js';
import { success, failure } from './types.js';
import { SlotPosition, TriggerCondition, ZoneType } from '../../shared/types/enums.js';
import { isMemberCardData, type MemberCardData } from '../../domain/entities/card.js';
import { addAction, emitGameEvent, updatePlayer } from '../../domain/entities/game.js';
import { createEnterStageEvent, createLeaveStageEvent } from '../../domain/events/game-events.js';
import {
  addCardsToZone,
  removeCardFromZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
  getCardInSlot,
  popMemberBelowMember,
} from '../../domain/entities/zone.js';
import { canMemberBeRelayedAway } from '../../domain/rules/cost-calculator.js';
import { getMemberEffectiveCost } from '../effects/conditions.js';
import { canUseDoubleRelay } from '../../shared/rules/double-relay.js';

interface RelayReplacementExecution {
  readonly cardId: string;
  readonly slot: SlotPosition;
  readonly ownerId: string;
  readonly effectiveCost: number;
}

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
  const relayReplacements = collectRelayReplacements(
    game,
    action,
    ctx,
    card.data,
    existingCardId
  );
  if (!relayReplacements.ok) {
    return failure(game, relayReplacements.error);
  }
  const replacements = relayReplacements.replacements;
  const firstReplacement = replacements[0] ?? null;

  let state = game;

  // 执行：处理被替换的成员（换手）
  if (replacements.length > 0) {
    state = updatePlayer(state, playerId, (p) => {
      let newSlots = p.memberSlots;
      let newWaitingRoom = p.waitingRoom;
      for (const replacement of replacements) {
        const [slotsWithoutMemberBelow, memberBelowIds] = popMemberBelowMember(
          newSlots,
          replacement.slot
        );
        newSlots = removeCardFromSlot(slotsWithoutMemberBelow, replacement.slot);
        newWaitingRoom = addCardsToZone(
          addCardToZone(newWaitingRoom, replacement.cardId),
          memberBelowIds
        );
      }
      return { ...p, memberSlots: newSlots, waitingRoom: newWaitingRoom };
    });
    for (const replacement of replacements) {
      state = emitGameEvent(
        state,
        createLeaveStageEvent(
          replacement.cardId,
          replacement.slot,
          ZoneType.WAITING_ROOM,
          replacement.ownerId,
          playerId,
          cardId
        )
      );
    }
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
  state = emitGameEvent(
    state,
    createEnterStageEvent(cardId, ZoneType.HAND, targetSlot, card.ownerId, playerId, {
      replacedMemberCardId: firstReplacement?.cardId ?? null,
      replacedMemberEffectiveCost: firstReplacement?.effectiveCost ?? null,
      relayReplacements: replacements.map((replacement) => ({
        cardId: replacement.cardId,
        slot: replacement.slot,
        effectiveCost: replacement.effectiveCost,
      })),
    })
  );

  // 记录动作
  state = addAction(state, 'PLAY_MEMBER', playerId, {
    cardId,
    targetSlot,
    isRelay: replacements.length > 0,
    replacedCardId: firstReplacement?.cardId ?? null,
    replacedMemberCardIds: replacements.map((replacement) => replacement.cardId),
    relayReplacements: replacements.map((replacement) => ({
      cardId: replacement.cardId,
      slot: replacement.slot,
      effectiveCost: replacement.effectiveCost,
    })),
    energyPayment: 'MANUAL',
  });

  const triggeredEvents: TriggerCondition[] = [TriggerCondition.ON_ENTER_STAGE];
  if (replacements.length > 0) {
    triggeredEvents.unshift(TriggerCondition.ON_ENTER_WAITING_ROOM);
    triggeredEvents.unshift(TriggerCondition.ON_LEAVE_STAGE);
    triggeredEvents.push(TriggerCondition.ON_RELAY);
  }

  return success(state, {
    triggeredEvents,
  });
};

function collectRelayReplacements(
  game: GameState,
  action: PlayMemberAction,
  ctx: ActionHandlerContext,
  incomingMemberData: MemberCardData,
  existingCardId: string | null
):
  | { readonly ok: true; readonly replacements: readonly RelayReplacementExecution[] }
  | { readonly ok: false; readonly error: string } {
  if (action.relayMode === 'DOUBLE') {
    if (!canUseDoubleRelay(incomingMemberData)) {
      return { ok: false, error: '只有 PL!SP-bp4-004 支持双换手' };
    }
    const selectedSlots = action.relayReplacementSlots ?? [];
    const uniqueSlots = new Set(selectedSlots);
    if (selectedSlots.length !== 2 || uniqueSlots.size !== 2) {
      return { ok: false, error: '双换手必须选择正好2个不同成员槽位' };
    }
    if (!uniqueSlots.has(action.targetSlot)) {
      return { ok: false, error: '双换手必须包含拖拽目标格成员' };
    }
    if (!existingCardId) {
      return { ok: false, error: '双换手暂不支持拖拽到空成员区' };
    }
    return collectReplacementsFromSlots(
      game,
      action,
      ctx,
      incomingMemberData,
      [action.targetSlot, ...selectedSlots.filter((slot) => slot !== action.targetSlot)]
    );
  }

  if (!existingCardId) {
    return { ok: true, replacements: [] };
  }

  return collectReplacementsFromSlots(game, action, ctx, incomingMemberData, [action.targetSlot]);
}

function collectReplacementsFromSlots(
  game: GameState,
  action: PlayMemberAction,
  ctx: ActionHandlerContext,
  incomingMemberData: MemberCardData,
  slots: readonly SlotPosition[]
):
  | { readonly ok: true; readonly replacements: readonly RelayReplacementExecution[] }
  | { readonly ok: false; readonly error: string } {
  const player = ctx.getPlayerById(game, action.playerId);
  if (!player) {
    return { ok: false, error: '玩家不存在' };
  }

  const replacements: RelayReplacementExecution[] = [];
  for (const slot of slots) {
    const cardId = getCardInSlot(player.memberSlots, slot);
    if (!cardId) {
      return { ok: false, error: '双换手选择的槽位必须都有己方成员' };
    }
    const replacementCard = ctx.getCardById(game, cardId);
    if (!replacementCard || !isMemberCardData(replacementCard.data)) {
      return { ok: false, error: '目标槽位上的卡牌不是成员卡' };
    }
    if (!canMemberBeRelayedAway(replacementCard.data, incomingMemberData)) {
      return { ok: false, error: '该成员无法因换手放置入休息室' };
    }
    replacements.push({
      cardId,
      slot,
      ownerId: replacementCard.ownerId,
      effectiveCost: getMemberEffectiveCost(game, action.playerId, cardId),
    });
  }

  return { ok: true, replacements };
}
