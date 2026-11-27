import { isLiveCardData, isMemberCardData } from '../../../domain/entities/card.js';
import {
  emitGameEvent,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import {
  addCardsToZone,
  addMemberBelowMember,
  findMemberBelowSlot,
  removeEnergyBelowMember,
  removeMemberBelowMember,
  removeCardFromZone,
} from '../../../domain/entities/zone.js';
import {
  createEnterWaitingRoomEvent,
  type CardEffectCause,
  type EnterWaitingRoomEvent,
} from '../../../domain/events/game-events.js';
import { getCardsBelowSourceMember } from '../../../domain/rules/member-below-queries.js';
import { TriggerCondition, ZoneType } from '../../../shared/types/enums.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from './enter-waiting-room-triggers.js';

export function stackWaitingRoomLiveBelowStageMember(
  game: GameState,
  playerId: string,
  hostCardId: string,
  cardId: string
): GameState | null {
  const player = getPlayerById(game, playerId);
  const slot = player ? findMemberSlot(player, hostCardId) : null;
  const host = getCardById(game, hostCardId);
  const card = getCardById(game, cardId);
  if (
    !player ||
    slot === null ||
    host?.ownerId !== playerId ||
    !isMemberCardData(host.data) ||
    card?.ownerId !== playerId ||
    !isLiveCardData(card.data) ||
    findMemberBelowSlot(player.memberSlots, cardId) !== null ||
    !player.waitingRoom.cardIds.includes(cardId)
  ) {
    return null;
  }

  return updatePlayer(game, playerId, (current) => ({
    ...current,
    waitingRoom: removeCardFromZone(current.waitingRoom, cardId),
    memberSlots: addMemberBelowMember(current.memberSlots, slot, cardId),
  }));
}

/** The first ID is the next card drawn from the main deck. */
export function moveLivesBelowStageMemberToDeckTop(
  game: GameState,
  playerId: string,
  hostCardId: string,
  orderedCardIds: readonly string[]
): { readonly gameState: GameState; readonly movedCardIds: readonly string[] } | null {
  const player = getPlayerById(game, playerId);
  const slot = player ? findMemberSlot(player, hostCardId) : null;
  const host = getCardById(game, hostCardId);
  const movedIds = new Set(orderedCardIds);
  if (
    !player ||
    slot === null ||
    host?.ownerId !== playerId ||
    !isMemberCardData(host.data) ||
    orderedCardIds.length === 0 ||
    movedIds.size !== orderedCardIds.length ||
    orderedCardIds.some((cardId) => {
      const card = getCardById(game, cardId);
      return (
        card?.ownerId !== playerId ||
        !isLiveCardData(card.data) ||
        !player.memberSlots.memberBelow?.[slot]?.includes(cardId)
      );
    })
  ) {
    return null;
  }

  return {
    gameState: updatePlayer(game, playerId, (current) => ({
      ...current,
      mainDeck: { ...current.mainDeck, cardIds: [...orderedCardIds, ...current.mainDeck.cardIds] },
      memberSlots: {
        ...current.memberSlots,
        memberBelow: {
          ...current.memberSlots.memberBelow,
          [slot]: current.memberSlots.memberBelow[slot].filter((cardId) => !movedIds.has(cardId)),
        },
      },
    })),
    movedCardIds: orderedCardIds,
  };
}

/** Moves selected physical cards below a host, without moving or making the host leave stage. */
export function moveCardsBelowSourceMemberToWaitingRoomAndEnqueueTriggers(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly sourceCardId: string;
    readonly selectedCardIds: readonly string[];
    readonly cause: CardEffectCause;
  },
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): {
  readonly gameState: GameState;
  readonly movedCardIds: readonly string[];
  readonly enterWaitingRoomEvent: EnterWaitingRoomEvent | null;
} | null {
  const player = getPlayerById(game, options.playerId);
  const source = getCardById(game, options.sourceCardId);
  const slot = player ? findMemberSlot(player, options.sourceCardId) : null;
  const selected = options.selectedCardIds;
  const below = getCardsBelowSourceMember(game, options.playerId, options.sourceCardId);
  if (
    !player ||
    !source ||
    source.ownerId !== player.id ||
    !isMemberCardData(source.data) ||
    slot === null ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => !below.includes(id) || getCardById(game, id)?.ownerId !== player.id)
  )
    return null;
  if (selected.length === 0) {
    return { gameState: game, movedCardIds: [], enterWaitingRoomEvent: null };
  }

  const movedCardIds = [...selected];
  let state = updatePlayer(game, player.id, (current) => {
    let memberSlots = current.memberSlots;
    for (const cardId of movedCardIds) {
      memberSlots = removeMemberBelowMember(memberSlots, slot, cardId);
      memberSlots = removeEnergyBelowMember(memberSlots, slot, cardId);
    }
    return {
      ...current,
      memberSlots,
      // Rule 10.5's energy replacement belongs to illegal-card rule processing,
      // not to this explicit card-effect movement while the host remains on stage.
      waitingRoom: addCardsToZone(current.waitingRoom, movedCardIds),
    };
  });
  const event = createEnterWaitingRoomEvent(
    movedCardIds,
    ZoneType.MEMBER_SLOT,
    player.id,
    player.id,
    options.cause
  );
  state = emitGameEvent(state, event);
  return {
    gameState: enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
      enterWaitingRoomEvents: [event],
    }),
    movedCardIds,
    enterWaitingRoomEvent: event,
  };
}
