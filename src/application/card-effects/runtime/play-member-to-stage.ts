import { isMemberCardData } from '../../../domain/entities/card.js';
import {
  emitGameEvent,
  getCardById,
  getPlayerById,
  updateInspectionZone,
  updatePlayer,
  type GameState,
} from '../../../domain/entities/game.js';
import { createEnterStageEvent } from '../../../domain/events/game-events.js';
import { placeCardInSlot, removeCardFromZone } from '../../../domain/entities/zone.js';
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
