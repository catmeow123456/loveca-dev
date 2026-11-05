import { isMemberCardData } from '../../../domain/entities/card.js';
import {
  emitGameEvent,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import {
  addCardToZone,
  addCardsToZone,
  popMemberBelowMember,
  removeCardFromSlot,
} from '../../../domain/entities/zone.js';
import {
  createEnterHandEvent,
  createEnterWaitingRoomEvent,
  createLeaveStageEvent,
  type EnterHandEvent,
  type EnterWaitingRoomEvent,
  type LeaveStageEvent,
} from '../../../domain/events/game-events.js';
import { captureMemberLastKnownInformation } from '../../../domain/rules/member-last-known-information.js';
import { TriggerCondition, ZoneType } from '../../../shared/types/enums.js';
import { returnEnergyBelowMemberToEnergyDeckForPlayer } from '../../effects/energy-below.js';
import { clearPreviousStageMemberInstanceState } from '../../effects/member-state.js';

export type EnqueueStageMemberReturnTriggers = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options: {
    readonly leaveStageEvents: readonly LeaveStageEvent[];
    readonly enterHandEvents: readonly EnterHandEvent[];
    readonly enterWaitingRoomEvents: readonly EnterWaitingRoomEvent[];
  }
) => GameState;

export function returnStageMemberToHandAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  memberCardId: string,
  enqueue: EnqueueStageMemberReturnTriggers
) {
  const player = getPlayerById(game, playerId);
  const member = getCardById(game, memberCardId);
  if (!player || member?.ownerId !== playerId || !isMemberCardData(member.data)) return null;

  const slot = findMemberSlot(player, memberCardId);
  const lastKnownInformation = captureMemberLastKnownInformation(game, playerId, memberCardId);
  if (slot === null || !lastKnownInformation) return null;

  const { playerState } = returnEnergyBelowMemberToEnergyDeckForPlayer(player, slot);
  const [memberSlots, belowCardIds] = popMemberBelowMember(playerState.memberSlots, slot);
  let state = updatePlayer(game, playerId, () => ({
    ...playerState,
    memberSlots: removeCardFromSlot(memberSlots, slot),
    hand: addCardToZone(playerState.hand, memberCardId),
    waitingRoom: addCardsToZone(playerState.waitingRoom, belowCardIds),
  }));

  const leaveStageEvent = createLeaveStageEvent(
    memberCardId,
    slot,
    ZoneType.HAND,
    member.ownerId,
    playerId,
    undefined,
    lastKnownInformation
  );
  const enterHandEvent = createEnterHandEvent(
    [memberCardId],
    ZoneType.MEMBER_SLOT,
    member.ownerId,
    playerId
  );
  state = emitGameEvent(emitGameEvent(state, leaveStageEvent), enterHandEvent);
  const triggers = [TriggerCondition.ON_LEAVE_STAGE, TriggerCondition.ON_ENTER_HAND];
  const enterWaitingRoomEvents: EnterWaitingRoomEvent[] = [];
  if (belowCardIds.length > 0) {
    const event = createEnterWaitingRoomEvent(
      belowCardIds,
      ZoneType.MEMBER_SLOT,
      playerId,
      playerId
    );
    state = emitGameEvent(state, event);
    triggers.push(TriggerCondition.ON_ENTER_WAITING_ROOM);
    enterWaitingRoomEvents.push(event);
  }

  const triggered = enqueue(state, triggers, {
    leaveStageEvents: [leaveStageEvent],
    enterHandEvents: [enterHandEvent],
    enterWaitingRoomEvents,
  });
  return {
    gameState: clearPreviousStageMemberInstanceState(triggered, playerId, memberCardId),
    returnedMemberEffectiveCost: lastKnownInformation.effectiveCost,
  };
}
