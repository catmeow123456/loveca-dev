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
import type { SlotPosition } from '../../shared/types/enums.js';

export interface StackEnergyBelowResult {
  readonly gameState: GameState;
  readonly stackedEnergyCardIds: readonly string[];
}

export interface ReturnEnergyBelowResult {
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

  const stackedEnergyCardIds = player.energyZone.cardIds.slice(0, count);
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
