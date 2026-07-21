import type { GameState } from '../../domain/entities/game.js';
import { getCardById, getPlayerById, updatePlayer } from '../../domain/entities/game.js';
import { isEnergyCardData, isMemberCardData } from '../../domain/entities/card.js';
import type { PlayerState } from '../../domain/entities/player.js';
import { findMemberSlot } from '../../domain/entities/player.js';
import {
  addCardToZone,
  addEnergyBelowMember,
  getCardInSlot,
  popEnergyBelowMember,
  removeCardFromStatefulZone,
} from '../../domain/entities/zone.js';
import type { SlotPosition } from '../../shared/types/enums.js';
import { resolveEnergySelectionForOperation } from './energy-selection.js';

export interface StackEnergyBelowResult {
  readonly gameState: GameState;
  readonly stackedEnergyCardIds: readonly string[];
}

export interface PlaceEnergyFromEnergyDeckBelowStageMemberResult {
  readonly gameState: GameState;
  readonly targetSlot: SlotPosition;
  readonly placedEnergyCardIds: readonly string[];
}

export function placeEnergyFromEnergyDeckBelowStageMember(
  game: GameState,
  playerId: string,
  targetMemberCardId: string,
  count: number
): PlaceEnergyFromEnergyDeckBelowStageMemberResult | null {
  if (!Number.isInteger(count) || count < 0) return null;
  const player = getPlayerById(game, playerId);
  const targetMember = getCardById(game, targetMemberCardId);
  const targetSlot = player ? findMemberSlot(player, targetMemberCardId) : null;
  if (
    !player ||
    !targetMember ||
    targetMember.ownerId !== playerId ||
    !isMemberCardData(targetMember.data) ||
    targetSlot === null ||
    player.memberSlots.slots[targetSlot] !== targetMemberCardId
  ) {
    return null;
  }

  const placedEnergyCardIds = player.energyDeck.cardIds.slice(0, count);
  for (const energyCardId of placedEnergyCardIds) {
    const energyCard = getCardById(game, energyCardId);
    if (!energyCard || energyCard.ownerId !== playerId || !isEnergyCardData(energyCard.data)) {
      return null;
    }
  }
  if (placedEnergyCardIds.length === 0) {
    return { gameState: game, targetSlot, placedEnergyCardIds };
  }

  const gameState = updatePlayer(game, playerId, (currentPlayer) => {
    let memberSlots = currentPlayer.memberSlots;
    for (const energyCardId of placedEnergyCardIds) {
      memberSlots = addEnergyBelowMember(memberSlots, targetSlot, energyCardId);
    }
    return {
      ...currentPlayer,
      energyDeck: {
        ...currentPlayer.energyDeck,
        cardIds: currentPlayer.energyDeck.cardIds.slice(placedEnergyCardIds.length),
      },
      memberSlots,
    };
  });
  return { gameState, targetSlot, placedEnergyCardIds };
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

  const selection = resolveEnergySelectionForOperation(
    game,
    playerId,
    'STACK_BELOW_MEMBER',
    count
  );
  if (!selection) return null;
  const stackedEnergyCardIds = selection.selectedEnergyCardIds;

  const gameState = updatePlayer(selection.gameState, playerId, (currentPlayer) => {
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

  return {
    gameState: {
      ...gameState,
      energyActivePhaseSkips: (gameState.energyActivePhaseSkips ?? []).filter(
        (skip) => !stackedEnergyCardIds.includes(skip.energyCardId)
      ),
    },
    stackedEnergyCardIds,
  };
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
