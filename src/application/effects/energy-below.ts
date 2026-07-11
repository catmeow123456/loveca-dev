import type { GameState } from '../../domain/entities/game.js';
import { getPlayerById, updatePlayer } from '../../domain/entities/game.js';
import type { PlayerState } from '../../domain/entities/player.js';
import {
  addCardToZone,
  addEnergyBelowMember,
  getCardInSlot,
  popEnergyBelowMember,
  removeCardFromStatefulZone,
} from '../../domain/entities/zone.js';
import { OrientationState, type SlotPosition } from '../../shared/types/enums.js';

export interface StackEnergyBelowResult {
  readonly gameState: GameState;
  readonly stackedEnergyCardIds: readonly string[];
}

export interface ReturnEnergyBelowResult {
  readonly gameState: GameState;
  readonly returnedEnergyCardIds: readonly string[];
}

export interface ReturnSelectedEnergyBelowResult {
  readonly gameState: GameState;
  readonly returnedEnergyCardIds: readonly string[];
}

export interface ReturnEnergyBelowPlayerResult {
  readonly playerState: PlayerState;
  readonly returnedEnergyCardIds: readonly string[];
}

export function stackEnergyFromEnergyZoneBelowMember(
  game: GameState,
  playerId: string,
  targetSlot: SlotPosition,
  count: number
): StackEnergyBelowResult | null {
  if (!Number.isInteger(count) || count < 0) {
    return null;
  }
  const player = getPlayerById(game, playerId);
  if (!player || !getCardInSlot(player.memberSlots, targetSlot)) {
    return null;
  }
  if (count === 0) {
    return { gameState: game, stackedEnergyCardIds: [] };
  }

  const waitingEnergyCardIds = player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.WAITING
  );
  const activeEnergyCardIds = player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
  const stackedEnergyCardIds = [...waitingEnergyCardIds, ...activeEnergyCardIds].slice(0, count);
  if (stackedEnergyCardIds.length < count) {
    return null;
  }

  const gameState = updatePlayer(game, playerId, (currentPlayer) => {
    let energyZone = currentPlayer.energyZone;
    let memberSlots = currentPlayer.memberSlots;
    for (const energyCardId of stackedEnergyCardIds) {
      energyZone = removeCardFromStatefulZone(energyZone, energyCardId);
      memberSlots = addEnergyBelowMember(memberSlots, targetSlot, energyCardId);
    }
    return {
      ...currentPlayer,
      energyZone,
      memberSlots,
    };
  });

  return { gameState, stackedEnergyCardIds };
}

export function returnEnergyBelowMemberToEnergyDeck(
  game: GameState,
  playerId: string,
  targetSlot: SlotPosition
): ReturnEnergyBelowResult {
  let returnedEnergyCardIds: readonly string[] = [];
  const gameState = updatePlayer(game, playerId, (player) => {
    const result = returnEnergyBelowMemberToEnergyDeckForPlayer(player, targetSlot);
    returnedEnergyCardIds = result.returnedEnergyCardIds;
    return result.playerState;
  });
  return { gameState, returnedEnergyCardIds };
}

export function returnSelectedEnergyBelowMemberToEnergyDeck(
  game: GameState,
  playerId: string,
  targetSlot: SlotPosition,
  selectedEnergyCardIds: readonly string[]
): ReturnSelectedEnergyBelowResult | null {
  const uniqueSelectedEnergyCardIds = new Set(selectedEnergyCardIds);
  if (uniqueSelectedEnergyCardIds.size !== selectedEnergyCardIds.length) {
    return null;
  }
  const player = getPlayerById(game, playerId);
  if (!player || !getCardInSlot(player.memberSlots, targetSlot)) {
    return null;
  }
  const energyBelow = player.memberSlots.energyBelow[targetSlot] ?? [];
  if (selectedEnergyCardIds.some((cardId) => !energyBelow.includes(cardId))) {
    return null;
  }
  if (selectedEnergyCardIds.length === 0) {
    return { gameState: game, returnedEnergyCardIds: [] };
  }

  const selectedSet = new Set(selectedEnergyCardIds);
  const gameState = updatePlayer(game, playerId, (currentPlayer) => ({
    ...currentPlayer,
    memberSlots: {
      ...currentPlayer.memberSlots,
      energyBelow: {
        ...currentPlayer.memberSlots.energyBelow,
        [targetSlot]: (currentPlayer.memberSlots.energyBelow[targetSlot] ?? []).filter(
          (cardId) => !selectedSet.has(cardId)
        ),
      },
    },
    energyDeck: selectedEnergyCardIds.reduce(
      (energyDeck, energyCardId) => addCardToZone(energyDeck, energyCardId),
      currentPlayer.energyDeck
    ),
  }));

  return { gameState, returnedEnergyCardIds: selectedEnergyCardIds };
}

export function returnEnergyBelowMemberToEnergyDeckForPlayer(
  player: PlayerState,
  targetSlot: SlotPosition
): ReturnEnergyBelowPlayerResult {
  const [memberSlots, returnedEnergyCardIds] = popEnergyBelowMember(player.memberSlots, targetSlot);
  if (returnedEnergyCardIds.length === 0) {
    return {
      playerState: player,
      returnedEnergyCardIds,
    };
  }
  return {
    playerState: {
      ...player,
      memberSlots,
      energyDeck: returnedEnergyCardIds.reduce(
        (energyDeck, energyCardId) => addCardToZone(energyDeck, energyCardId),
        player.energyDeck
      ),
    },
    returnedEnergyCardIds,
  };
}
