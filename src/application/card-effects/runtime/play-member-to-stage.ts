import { isMemberCardData } from '../../../domain/entities/card.js';
import {
  emitGameEvent,
  getCardById,
  getPlayerById,
  updateInspectionZone,
  updatePlayer,
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
import { canMemberBeRelayedAway } from '../../../domain/rules/cost-calculator.js';
import { getMemberEffectiveCost } from '../../effects/conditions.js';
import { returnEnergyBelowMemberToEnergyDeckForPlayer } from '../../effects/energy-below.js';
import {
  FaceState,
  OrientationState,
  SlotPosition,
  ZoneType,
} from '../../../shared/types/enums.js';

export interface PlayMemberFromZoneToEmptySlotResult {
  readonly gameState: GameState;
  readonly playedCardId: string;
  readonly toSlot: SlotPosition;
}

export interface PlayMemberFromZoneToStageSlotWithReplacementResult {
  readonly gameState: GameState;
  readonly playedCardId: string;
  readonly toSlot: SlotPosition;
  readonly replacedMemberCardId: string | null;
  readonly replacedMemberEffectiveCost: number | null;
  readonly movedToWaitingRoomCardIds: readonly string[];
  readonly leaveStageEvents: readonly LeaveStageEvent[];
  readonly enterWaitingRoomEvents: readonly EnterWaitingRoomEvent[];
  readonly enterStageEvent: EnterStageEvent;
}

/**
 * Moves one member from HAND / WAITING_ROOM to a stage slot. If the slot is
 * occupied, this performs the complete single-replacement zone/event lifecycle.
 * Eligibility, card-specific slot rules, windows, costs, and pending progression
 * stay with the caller.
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

  const replacedMemberCardId = player.memberSlots.slots[options.toSlot];
  const replacedMemberCard = replacedMemberCardId ? getCardById(game, replacedMemberCardId) : null;
  if (
    replacedMemberCardId &&
    (!replacedMemberCard ||
      !isMemberCardData(replacedMemberCard.data) ||
      !canMemberBeRelayedAway(replacedMemberCard.data, card.data))
  ) {
    return null;
  }

  const replacedMemberEffectiveCost = replacedMemberCardId
    ? getMemberEffectiveCost(game, player.id, replacedMemberCardId)
    : null;
  let movedToWaitingRoomCardIds: readonly string[] = [];
  let state = game;

  if (replacedMemberCardId && replacedMemberCard) {
    state = updatePlayer(state, player.id, (currentPlayer) => {
      const energyReturn = returnEnergyBelowMemberToEnergyDeckForPlayer(
        currentPlayer,
        options.toSlot
      );
      const [memberSlots, memberBelowIds] = popMemberBelowMember(
        energyReturn.playerState.memberSlots,
        options.toSlot
      );
      movedToWaitingRoomCardIds = [replacedMemberCardId, ...memberBelowIds];
      return {
        ...energyReturn.playerState,
        memberSlots: removeCardFromSlot(memberSlots, options.toSlot),
        waitingRoom: addCardsToZone(
          addCardToZone(energyReturn.playerState.waitingRoom, replacedMemberCardId),
          memberBelowIds
        ),
      };
    });
  }

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
      orientation: options.orientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    movedToStageThisTurn: [...currentPlayer.movedToStageThisTurn, options.cardId],
  }));

  const leaveStageEvents: LeaveStageEvent[] = [];
  const enterWaitingRoomEvents: EnterWaitingRoomEvent[] = [];
  if (replacedMemberCardId && replacedMemberCard) {
    const leaveStageEvent = createLeaveStageEvent(
      replacedMemberCardId,
      options.toSlot,
      ZoneType.WAITING_ROOM,
      replacedMemberCard.ownerId,
      player.id,
      options.cardId
    );
    state = emitGameEvent(state, leaveStageEvent);
    leaveStageEvents.push(leaveStageEvent);

    const enterWaitingRoomEvent = createEnterWaitingRoomEvent(
      movedToWaitingRoomCardIds,
      ZoneType.MEMBER_SLOT,
      replacedMemberCard.ownerId,
      player.id
    );
    state = emitGameEvent(state, enterWaitingRoomEvent);
    enterWaitingRoomEvents.push(enterWaitingRoomEvent);
  }

  const relayReplacements =
    replacedMemberCardId !== null && replacedMemberEffectiveCost !== null
      ? [
          {
            cardId: replacedMemberCardId,
            slot: options.toSlot,
            effectiveCost: replacedMemberEffectiveCost,
          },
        ]
      : [];
  const enterStageEvent = createEnterStageEvent(
    options.cardId,
    options.sourceZone,
    options.toSlot,
    card.ownerId,
    player.id,
    {
      replacedMemberCardId,
      replacedMemberEffectiveCost,
      relayReplacements,
    }
  );
  state = emitGameEvent(state, enterStageEvent);

  return {
    gameState: state,
    playedCardId: options.cardId,
    toSlot: options.toSlot,
    replacedMemberCardId,
    replacedMemberEffectiveCost,
    movedToWaitingRoomCardIds,
    leaveStageEvents,
    enterWaitingRoomEvents,
    enterStageEvent,
  };
}

export function playMemberFromZoneToEmptySlot(
  game: GameState,
  playerId: string,
  options: {
    readonly cardId: string;
    readonly sourceZone: ZoneType.HAND | ZoneType.INSPECTION_ZONE;
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

  let state =
    options.sourceZone === ZoneType.HAND
      ? updatePlayer(game, player.id, (currentPlayer) => ({
          ...currentPlayer,
          hand: removeCardFromZone(currentPlayer.hand, options.cardId),
          memberSlots: placeCardInSlot(currentPlayer.memberSlots, options.toSlot, options.cardId, {
            orientation: options.orientation ?? OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
          movedToStageThisTurn: [...currentPlayer.movedToStageThisTurn, options.cardId],
        }))
      : updateInspectionZone(
          updatePlayer(game, player.id, (currentPlayer) => ({
            ...currentPlayer,
            memberSlots: placeCardInSlot(
              currentPlayer.memberSlots,
              options.toSlot,
              options.cardId,
              {
                orientation: options.orientation ?? OrientationState.ACTIVE,
                face: FaceState.FACE_UP,
              }
            ),
            movedToStageThisTurn: [...currentPlayer.movedToStageThisTurn, options.cardId],
          })),
          (zone) => ({
            ...zone,
            cardIds: zone.cardIds.filter((cardId) => cardId !== options.cardId),
            revealedCardIds: zone.revealedCardIds.filter((cardId) => cardId !== options.cardId),
          })
        );

  state = emitGameEvent(
    state,
    createEnterStageEvent(
      options.cardId,
      options.sourceZone,
      options.toSlot,
      card.ownerId,
      player.id
    )
  );

  return {
    gameState: state,
    playedCardId: options.cardId,
    toSlot: options.toSlot,
  };
}

function isCardInSourceZone(
  game: GameState,
  playerId: string,
  cardId: string,
  sourceZone: ZoneType.HAND | ZoneType.INSPECTION_ZONE
): boolean {
  if (sourceZone === ZoneType.INSPECTION_ZONE) {
    return game.inspectionZone.cardIds.includes(cardId);
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
