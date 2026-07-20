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
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
  createLeaveStageEvent,
} from '../../domain/events/game-events.js';
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
import { returnEnergyBelowMemberToEnergyDeckForPlayer } from '../effects/energy-below.js';
import { canUseDoubleRelay } from '../../shared/rules/double-relay.js';
import { RuleActionType } from '../../domain/rules/rule-actions.js';

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
  let duplicateMemberRemoval: RelayReplacementExecution | null = null;
  if (existingCardId && action.isRelay === false) {
    const existingCard = ctx.getCardById(game, existingCardId);
    if (!existingCard || !isMemberCardData(existingCard.data)) {
      return failure(game, '目标槽位上的卡牌不是成员卡');
    }
    duplicateMemberRemoval = {
      cardId: existingCardId,
      slot: targetSlot,
      ownerId: existingCard.ownerId,
      effectiveCost: getMemberEffectiveCost(game, playerId, existingCardId),
    };
  }
  const removedMembers =
    replacements.length > 0 ? replacements : duplicateMemberRemoval ? [duplicateMemberRemoval] : [];

  let state = game;

  // 执行：处理因换手或重复成员规则离场的成员。
  const removedCardIdsMovedToWaitingRoom: string[] = [];
  const returnedEnergyCardIds: string[] = [];
  if (removedMembers.length > 0) {
    state = updatePlayer(state, playerId, (p) => {
      let newSlots = p.memberSlots;
      let newWaitingRoom = p.waitingRoom;
      let updatedPlayer = p;
      for (const replacement of removedMembers) {
        const energyReturnResult = returnEnergyBelowMemberToEnergyDeckForPlayer(
          { ...updatedPlayer, memberSlots: newSlots, waitingRoom: newWaitingRoom },
          replacement.slot
        );
        returnedEnergyCardIds.push(...energyReturnResult.returnedEnergyCardIds);
        updatedPlayer = energyReturnResult.playerState;
        newSlots = updatedPlayer.memberSlots;
        newWaitingRoom = updatedPlayer.waitingRoom;
        const [slotsWithoutMemberBelow, memberBelowIds] = popMemberBelowMember(
          newSlots,
          replacement.slot
        );
        removedCardIdsMovedToWaitingRoom.push(replacement.cardId, ...memberBelowIds);
        newSlots = removeCardFromSlot(slotsWithoutMemberBelow, replacement.slot);
        newWaitingRoom = addCardsToZone(
          addCardToZone(newWaitingRoom, replacement.cardId),
          memberBelowIds
        );
      }
      return { ...updatedPlayer, memberSlots: newSlots, waitingRoom: newWaitingRoom };
    });
  }

  if (replacements.length > 0) {
    state = emitRemovedMemberEvents(
      state,
      replacements,
      removedCardIdsMovedToWaitingRoom,
      playerId,
      cardId
    );
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
    createEnterStageEvent(
      cardId,
      ZoneType.HAND,
      targetSlot,
      card.ownerId,
      playerId,
      firstReplacement
        ? {
            replacedMemberCardId: firstReplacement.cardId,
            replacedMemberEffectiveCost: firstReplacement.effectiveCost,
            relayReplacements: replacements.map((replacement) => ({
              cardId: replacement.cardId,
              slot: replacement.slot,
              effectiveCost: replacement.effectiveCost,
            })),
          }
        : undefined
    )
  );

  if (duplicateMemberRemoval) {
    state = emitRemovedMemberEvents(
      state,
      [duplicateMemberRemoval],
      removedCardIdsMovedToWaitingRoom,
      playerId
    );
  }

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
    duplicateMemberRuleRemovedCardId: duplicateMemberRemoval?.cardId ?? null,
    energyPayment: 'MANUAL',
  });

  if (duplicateMemberRemoval) {
    state = addAction(state, 'RULE_ACTION', null, {
      type: RuleActionType.DUPLICATE_MEMBER,
      affectedPlayerId: playerId,
      slot: targetSlot,
      keptMemberCardId: cardId,
      movedToWaitingRoomCardIds: removedCardIdsMovedToWaitingRoom,
      returnedEnergyCardIds,
    });
  }

  const triggeredEvents: TriggerCondition[] = [TriggerCondition.ON_ENTER_STAGE];
  if (replacements.length > 0) {
    triggeredEvents.unshift(TriggerCondition.ON_ENTER_WAITING_ROOM);
    triggeredEvents.unshift(TriggerCondition.ON_LEAVE_STAGE);
    triggeredEvents.push(TriggerCondition.ON_RELAY);
  } else if (duplicateMemberRemoval) {
    triggeredEvents.push(TriggerCondition.ON_LEAVE_STAGE);
    triggeredEvents.push(TriggerCondition.ON_ENTER_WAITING_ROOM);
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

  if (action.isRelay === false) {
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

function emitRemovedMemberEvents(
  game: GameState,
  removals: readonly RelayReplacementExecution[],
  movedToWaitingRoomCardIds: readonly string[],
  controllerId: string,
  replacingCardId?: string
): GameState {
  let state = game;
  for (const removal of removals) {
    state = emitGameEvent(
      state,
      createLeaveStageEvent(
        removal.cardId,
        removal.slot,
        ZoneType.WAITING_ROOM,
        removal.ownerId,
        controllerId,
        replacingCardId
      )
    );
  }
  if (movedToWaitingRoomCardIds.length > 0) {
    state = emitGameEvent(
      state,
      createEnterWaitingRoomEvent(
        movedToWaitingRoomCardIds,
        ZoneType.MEMBER_SLOT,
        removals[0]?.ownerId ?? controllerId,
        controllerId
      )
    );
  }
  return state;
}
