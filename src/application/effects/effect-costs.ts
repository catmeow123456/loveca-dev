import type { GameState } from '../../domain/entities/game.js';
import { emitGameEvent, getCardById, getPlayerById, updatePlayer } from '../../domain/entities/game.js';
import { createLeaveStageEvent } from '../../domain/events/game-events.js';
import { OrientationState, SlotPosition, ZoneType } from '../../shared/types/enums.js';

export type EffectCostDefinition =
  | {
      readonly kind: 'DISCARD_HAND_TO_WAITING_ROOM';
      readonly minCount: number;
      readonly maxCount: number;
      readonly optional: boolean;
    }
  | {
      readonly kind: 'TAP_ACTIVE_ENERGY';
      readonly count: number;
    }
  | {
      readonly kind: 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM';
    }
  | {
      readonly kind: 'SET_SOURCE_MEMBER_ORIENTATION';
      readonly orientation: OrientationState;
    };

export interface EffectCostPaymentResult {
  readonly gameState: GameState;
  readonly paidEnergyCardIds: readonly string[];
  readonly movedToWaitingRoomCardIds: readonly string[];
  readonly discardedHandCardIds: readonly string[];
  readonly orientedMemberCardIds: readonly string[];
  readonly sourceSlot?: SlotPosition;
}

export function paySelectedDiscardHandCost(
  game: GameState,
  playerId: string,
  cardIds: readonly string[]
): EffectCostPaymentResult | null {
  const player = getPlayerById(game, playerId);
  if (
    !player ||
    cardIds.length === 0 ||
    new Set(cardIds).size !== cardIds.length ||
    !cardIds.every((cardId) => player.hand.cardIds.includes(cardId))
  ) {
    return null;
  }

  const state = updatePlayer(game, playerId, (currentPlayer) => ({
    ...currentPlayer,
    hand: {
      ...currentPlayer.hand,
      cardIds: currentPlayer.hand.cardIds.filter((candidate) => !cardIds.includes(candidate)),
    },
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...cardIds],
    },
  }));

  return {
    gameState: state,
    paidEnergyCardIds: [],
    movedToWaitingRoomCardIds: [],
    discardedHandCardIds: cardIds,
    orientedMemberCardIds: [],
  };
}

export function moveHandCardToWaitingRoomForEffect(
  game: GameState,
  playerId: string,
  cardId: string
): GameState | null {
  return paySelectedDiscardHandCost(game, playerId, [cardId])?.gameState ?? null;
}

export function payImmediateEffectCosts(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  costs: readonly EffectCostDefinition[]
): EffectCostPaymentResult | null {
  let state = game;
  const paidEnergyCardIds: string[] = [];
  const movedToWaitingRoomCardIds: string[] = [];
  const discardedHandCardIds: string[] = [];
  const orientedMemberCardIds: string[] = [];
  let sourceSlot: SlotPosition | undefined;

  for (const cost of costs) {
    const player = getPlayerById(state, playerId);
    if (!player) {
      return null;
    }

    switch (cost.kind) {
      case 'TAP_ACTIVE_ENERGY': {
        const activeEnergyCardIds = player.energyZone.cardIds.filter(
          (energyCardId) =>
            player.energyZone.cardStates.get(energyCardId)?.orientation !== OrientationState.WAITING
        );
        if (activeEnergyCardIds.length < cost.count) {
          return null;
        }
        const energyCardIdsForCost = activeEnergyCardIds.slice(0, cost.count);
        state = updatePlayer(state, playerId, (currentPlayer) => {
          const cardStates = new Map(currentPlayer.energyZone.cardStates);
          for (const energyCardId of energyCardIdsForCost) {
            const existingState = cardStates.get(energyCardId);
            if (existingState) {
              cardStates.set(energyCardId, {
                ...existingState,
                orientation: OrientationState.WAITING,
              });
            }
          }
          return {
            ...currentPlayer,
            energyZone: {
              ...currentPlayer.energyZone,
              cardStates,
            },
          };
        });
        paidEnergyCardIds.push(...energyCardIdsForCost);
        break;
      }

      case 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM': {
        const slot = findMemberSlot(player, sourceCardId);
        if (!slot) {
          return null;
        }
        const sourceCard = getCardById(state, sourceCardId);
        const energyBelowCardIds = player.memberSlots.energyBelow[slot] ?? [];
        const memberBelowCardIds = player.memberSlots.memberBelow[slot] ?? [];
        const cardIdsForCost = [sourceCardId, ...energyBelowCardIds, ...memberBelowCardIds];
        state = updatePlayer(state, playerId, (currentPlayer) => ({
          ...currentPlayer,
          waitingRoom: {
            ...currentPlayer.waitingRoom,
            cardIds: [...currentPlayer.waitingRoom.cardIds, ...cardIdsForCost],
          },
          memberSlots: {
            ...currentPlayer.memberSlots,
            slots: {
              ...currentPlayer.memberSlots.slots,
              [slot]: null,
            },
            energyBelow: {
              ...currentPlayer.memberSlots.energyBelow,
              [slot]: [],
            },
            memberBelow: {
              ...currentPlayer.memberSlots.memberBelow,
              [slot]: [],
            },
          },
        }));
        if (sourceCard) {
          state = emitGameEvent(
            state,
            createLeaveStageEvent(
              sourceCardId,
              slot,
              ZoneType.WAITING_ROOM,
              sourceCard.ownerId,
              playerId
            )
          );
        }
        sourceSlot = slot;
        movedToWaitingRoomCardIds.push(...cardIdsForCost);
        break;
      }

      case 'SET_SOURCE_MEMBER_ORIENTATION': {
        const slot = findMemberSlot(player, sourceCardId);
        if (!slot) {
          return null;
        }
        const existingState = player.memberSlots.cardStates.get(sourceCardId);
        if (!existingState || existingState.orientation === cost.orientation) {
          return null;
        }
        state = updatePlayer(state, playerId, (currentPlayer) => {
          const cardStates = new Map(currentPlayer.memberSlots.cardStates);
          cardStates.set(sourceCardId, {
            ...existingState,
            orientation: cost.orientation,
          });
          return {
            ...currentPlayer,
            memberSlots: {
              ...currentPlayer.memberSlots,
              cardStates,
            },
          };
        });
        sourceSlot = slot;
        orientedMemberCardIds.push(sourceCardId);
        break;
      }

      case 'DISCARD_HAND_TO_WAITING_ROOM':
        return null;
    }
  }

  return {
    gameState: state,
    paidEnergyCardIds,
    movedToWaitingRoomCardIds,
    discardedHandCardIds,
    orientedMemberCardIds,
    sourceSlot,
  };
}

function findMemberSlot(
  player: NonNullable<ReturnType<typeof getPlayerById>>,
  cardId: string
): SlotPosition | null {
  for (const slot of [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]) {
    if (player.memberSlots.slots[slot] === cardId) {
      return slot;
    }
  }

  return null;
}
