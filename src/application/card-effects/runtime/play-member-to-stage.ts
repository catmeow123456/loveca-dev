import { captureMemberLastKnownInformation } from '../../../domain/rules/member-last-known-information.js';
import { isMemberCardData } from '../../../domain/entities/card.js';
import {
  emitGameEvent,
  addAction,
  getCardById,
  getPlayerById,
  updateInspectionZone,
  updatePlayer,
  updateResolutionZone,
  type GameState,
} from '../../../domain/entities/game.js';
import type {
  EnterStageEvent,
  EnterWaitingRoomEvent,
  LeaveStageEvent,
} from '../../../domain/events/game-events.js';
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
  createLeaveStageEvent,
} from '../../../domain/events/game-events.js';
import {
  addCardsToZone,
  addCardToZone,
  placeCardInSlot,
  popMemberBelowMember,
  removeCardFromSlot,
  removeCardFromZone,
} from '../../../domain/entities/zone.js';
import { returnEnergyBelowMemberToEnergyDeckForPlayer } from '../../effects/energy-below.js';
import { selectRevealedCheerCardIds } from '../../effects/cheer-selection.js';
import { RuleActionType } from '../../../domain/rules/rule-actions.js';
import { resolveMemberEntryOrientation } from '../../../domain/rules/member-entry-orientation.js';
import {
  FaceState,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../shared/types/enums.js';

export interface PlayMemberFromZoneToEmptySlotResult {
  readonly gameState: GameState;
  readonly playedCardId: string;
  readonly toSlot: SlotPosition;
  readonly enterStageEvent: EnterStageEvent;
}

type EmptySlotPlaySource = ZoneType.HAND | ZoneType.INSPECTION_ZONE | ZoneType.RESOLUTION_ZONE;

export interface PlayMemberFromZoneToStageSlotWithReplacementResult {
  readonly gameState: GameState;
  readonly playedCardId: string;
  readonly toSlot: SlotPosition;
  readonly duplicateMemberRuleRemovedCardId: string | null;
  readonly movedToWaitingRoomCardIds: readonly string[];
  readonly returnedEnergyCardIds: readonly string[];
  readonly leaveStageEvents: readonly LeaveStageEvent[];
  readonly enterWaitingRoomEvents: readonly EnterWaitingRoomEvent[];
  readonly enterStageEvent: EnterStageEvent;
}

export type EnqueueCardEffectPlacementTriggers = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly leaveStageEvents?: readonly LeaveStageEvent[];
  }
) => GameState;

/**
 * Moves one member from HAND / WAITING_ROOM to a stage slot for a card effect.
 * If the slot is occupied, the incoming member enters first and the previous
 * member is then removed by the duplicate-member rule. This is not relay: it
 * never checks relay eligibility or emits relay/replacement metadata.
 *
 * Eligibility, card-specific slot rules, costs, and pending progression stay
 * with the caller. The caller must also enforce the current-turn target-slot
 * restriction before invoking this mutation helper.
 */
export function playMemberFromZoneToStageSlotWithReplacement(
  game: GameState,
  playerId: string,
  options: {
    readonly cardId: string;
    readonly sourceZone: ZoneType.HAND | ZoneType.WAITING_ROOM;
    readonly toSlot: SlotPosition;
    readonly orientation?: OrientationState;
  }
): PlayMemberFromZoneToStageSlotWithReplacementResult | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, options.cardId);
  if (
    !player ||
    !card ||
    card.ownerId !== player.id ||
    !isMemberCardData(card.data) ||
    !isCardInReplacementSourceZone(player, options.cardId, options.sourceZone)
  ) {
    return null;
  }

  const duplicateMemberRuleRemovedCardId = player.memberSlots.slots[options.toSlot];
  const removedMemberCard = duplicateMemberRuleRemovedCardId
    ? getCardById(game, duplicateMemberRuleRemovedCardId)
    : null;
  if (
    duplicateMemberRuleRemovedCardId &&
    (!removedMemberCard || !isMemberCardData(removedMemberCard.data))
  ) {
    return null;
  }

  const removedMemberLastKnownInformation = duplicateMemberRuleRemovedCardId
    ? captureMemberLastKnownInformation(game, player.id, duplicateMemberRuleRemovedCardId)
    : undefined;

  let movedToWaitingRoomCardIds: readonly string[] = [];
  let returnedEnergyCardIds: readonly string[] = [];
  let state = game;

  // The authoritative state update is atomic, but event order still follows
  // duplicate-member processing: incoming ON_ENTER_STAGE, then old-member leave.
  if (duplicateMemberRuleRemovedCardId && removedMemberCard) {
    state = updatePlayer(state, player.id, (currentPlayer) => {
      const energyReturn = returnEnergyBelowMemberToEnergyDeckForPlayer(
        currentPlayer,
        options.toSlot
      );
      returnedEnergyCardIds = energyReturn.returnedEnergyCardIds;
      const [memberSlots, memberBelowIds] = popMemberBelowMember(
        energyReturn.playerState.memberSlots,
        options.toSlot
      );
      movedToWaitingRoomCardIds = [duplicateMemberRuleRemovedCardId, ...memberBelowIds];
      return {
        ...energyReturn.playerState,
        memberSlots: removeCardFromSlot(memberSlots, options.toSlot),
        waitingRoom: addCardsToZone(
          addCardToZone(energyReturn.playerState.waitingRoom, duplicateMemberRuleRemovedCardId),
          memberBelowIds
        ),
      };
    });
  }

  const entryOrientation = resolveMemberEntryOrientation(
    game,
    player.id,
    options.cardId,
    options.toSlot,
    options.orientation ?? OrientationState.ACTIVE
  );
  state = updatePlayer(state, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand:
      options.sourceZone === ZoneType.HAND
        ? removeCardFromZone(currentPlayer.hand, options.cardId)
        : currentPlayer.hand,
    waitingRoom:
      options.sourceZone === ZoneType.WAITING_ROOM
        ? removeCardFromZone(currentPlayer.waitingRoom, options.cardId)
        : currentPlayer.waitingRoom,
    memberSlots: placeCardInSlot(currentPlayer.memberSlots, options.toSlot, options.cardId, {
      orientation: entryOrientation,
      face: FaceState.FACE_UP,
    }),
    movedToStageThisTurn: [...currentPlayer.movedToStageThisTurn, options.cardId],
  }));

  const enterStageEvent = createEnterStageEvent(
    options.cardId,
    options.sourceZone,
    options.toSlot,
    card.ownerId,
    player.id
  );
  state = emitGameEvent(state, enterStageEvent);

  const leaveStageEvents: LeaveStageEvent[] = [];
  const enterWaitingRoomEvents: EnterWaitingRoomEvent[] = [];
  if (duplicateMemberRuleRemovedCardId && removedMemberCard) {
    const leaveStageEvent = createLeaveStageEvent(
      duplicateMemberRuleRemovedCardId,
      options.toSlot,
      ZoneType.WAITING_ROOM,
      removedMemberCard.ownerId,
      player.id,
      undefined,
      removedMemberLastKnownInformation
    );
    state = emitGameEvent(state, leaveStageEvent);
    leaveStageEvents.push(leaveStageEvent);

    const enterWaitingRoomEvent = createEnterWaitingRoomEvent(
      movedToWaitingRoomCardIds,
      ZoneType.MEMBER_SLOT,
      removedMemberCard.ownerId,
      player.id
    );
    state = emitGameEvent(state, enterWaitingRoomEvent);
    enterWaitingRoomEvents.push(enterWaitingRoomEvent);

    state = addAction(state, 'RULE_ACTION', null, {
      type: RuleActionType.DUPLICATE_MEMBER,
      affectedPlayerId: player.id,
      slot: options.toSlot,
      keptMemberCardId: options.cardId,
      movedToWaitingRoomCardIds,
      returnedEnergyCardIds,
    });
  }

  return {
    gameState: state,
    playedCardId: options.cardId,
    toSlot: options.toSlot,
    duplicateMemberRuleRemovedCardId,
    movedToWaitingRoomCardIds,
    returnedEnergyCardIds,
    leaveStageEvents,
    enterWaitingRoomEvents,
    enterStageEvent,
  };
}

/**
 * Enqueues triggers for a card-effect placement into an occupied stage slot.
 *
 * Duplicate-member cleanup is applied atomically by the mutation helper, while
 * the enter event happens before the previous member leaves. AUTO listeners
 * therefore come from the union of the stage immediately before and after the
 * placement. The two scans share the same pending state, so surviving sources
 * and the entered member are deduplicated by their ability-instance IDs.
 */
export function enqueueCardEffectPlacementTriggersWithStageSnapshot(
  beforePlacement: GameState,
  afterPlacement: GameState,
  result: PlayMemberFromZoneToStageSlotWithReplacementResult,
  enqueueTriggeredCardEffects: EnqueueCardEffectPlacementTriggers
): GameState {
  let state = afterPlacement;
  const controllerId = result.enterStageEvent.controllerId;
  const beforePlayer = getPlayerById(beforePlacement, controllerId);

  if (result.duplicateMemberRuleRemovedCardId && beforePlayer) {
    const finalPlayer = getPlayerById(state, controllerId);
    if (finalPlayer) {
      const finalMemberSlots = finalPlayer.memberSlots;
      const eventTimeSnapshot = updatePlayer(state, controllerId, (player) => ({
        ...player,
        memberSlots: beforePlayer.memberSlots,
      }));
      const withPreviousStageListeners = enqueueTriggeredCardEffects(
        eventTimeSnapshot,
        [TriggerCondition.ON_ENTER_STAGE],
        { enterStageEvents: [result.enterStageEvent] }
      );
      state = updatePlayer(withPreviousStageListeners, controllerId, (player) => ({
        ...player,
        memberSlots: finalMemberSlots,
      }));
    }
  }

  state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: [result.enterStageEvent],
  });

  return enqueueTriggeredCardEffects(
    state,
    [
      ...(result.leaveStageEvents.length > 0 ? [TriggerCondition.ON_LEAVE_STAGE] : []),
      ...(result.enterWaitingRoomEvents.length > 0 ? [TriggerCondition.ON_ENTER_WAITING_ROOM] : []),
    ],
    {
      leaveStageEvents: result.leaveStageEvents,
      enterWaitingRoomEvents: result.enterWaitingRoomEvents,
    }
  );
}

export function playMemberFromZoneToEmptySlot(
  game: GameState,
  playerId: string,
  options: {
    readonly cardId: string;
    readonly sourceZone: EmptySlotPlaySource;
    readonly toSlot: SlotPosition;
    readonly orientation?: OrientationState;
  }
): PlayMemberFromZoneToEmptySlotResult | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, options.cardId);
  if (
    !player ||
    !card ||
    card.ownerId !== player.id ||
    !isMemberCardData(card.data) ||
    player.memberSlots.slots[options.toSlot] !== null ||
    !isCardInSourceZone(game, player.id, options.cardId, options.sourceZone)
  ) {
    return null;
  }

  const entryOrientation = resolveMemberEntryOrientation(
    game,
    player.id,
    options.cardId,
    options.toSlot,
    options.orientation ?? OrientationState.ACTIVE
  );

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand:
      options.sourceZone === ZoneType.HAND
        ? removeCardFromZone(currentPlayer.hand, options.cardId)
        : currentPlayer.hand,
    memberSlots: placeCardInSlot(currentPlayer.memberSlots, options.toSlot, options.cardId, {
      orientation: entryOrientation,
      face: FaceState.FACE_UP,
    }),
    movedToStageThisTurn: [...currentPlayer.movedToStageThisTurn, options.cardId],
  }));
  const removeFromSharedZone = <
    Zone extends { readonly cardIds: readonly string[]; readonly revealedCardIds: readonly string[] },
  >(
    zone: Zone
  ): Zone => ({
    ...zone,
    cardIds: zone.cardIds.filter((cardId) => cardId !== options.cardId),
    revealedCardIds: zone.revealedCardIds.filter((cardId) => cardId !== options.cardId),
  });
  if (options.sourceZone === ZoneType.INSPECTION_ZONE) {
    state = updateInspectionZone(state, removeFromSharedZone);
  }
  if (options.sourceZone === ZoneType.RESOLUTION_ZONE) {
    state = updateResolutionZone(state, removeFromSharedZone);
  }

  const enterStageEvent = createEnterStageEvent(
    options.cardId,
    options.sourceZone,
    options.toSlot,
    card.ownerId,
    player.id
  );

  return {
    gameState: emitGameEvent(state, enterStageEvent),
    playedCardId: options.cardId,
    toSlot: options.toSlot,
    enterStageEvent,
  };
}

function isCardInSourceZone(
  game: GameState,
  playerId: string,
  cardId: string,
  sourceZone: EmptySlotPlaySource
): boolean {
  if (sourceZone === ZoneType.INSPECTION_ZONE) {
    return game.inspectionZone.cardIds.includes(cardId);
  }
  if (sourceZone === ZoneType.RESOLUTION_ZONE) {
    return selectRevealedCheerCardIds(game, playerId).includes(cardId);
  }
  return getPlayerById(game, playerId)?.hand.cardIds.includes(cardId) === true;
}

function isCardInReplacementSourceZone(
  player: NonNullable<ReturnType<typeof getPlayerById>>,
  cardId: string,
  sourceZone: ZoneType.HAND | ZoneType.WAITING_ROOM
): boolean {
  return sourceZone === ZoneType.HAND
    ? player.hand.cardIds.includes(cardId)
    : player.waitingRoom.cardIds.includes(cardId);
}
