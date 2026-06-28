import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addEnergyBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  returnEnergyBelowMemberToEnergyDeck,
  stackEnergyFromEnergyZoneBelowMember,
} from '../../src/application/effects/energy-below';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'p1';
const PLAYER2 = 'p2';

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupEnergyBelowState(options: { readonly energyCount: number }) {
  const host = createCardInstance(createMember('MEM-HOST'), PLAYER1, 'host');
  const waitingRoomCard = createCardInstance(createMember('MEM-WAITING'), PLAYER1, 'waiting-card');
  const energies = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(createEnergy(`ENE-${index}`), PLAYER1, `energy-${index}`)
  );
  let game = createGameState('energy-below-helper', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [host, waitingRoomCard, ...energies]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, host.instanceId),
    energyZone: {
      ...player.energyZone,
      cardIds: energies.map((energy) => energy.instanceId),
      cardStates: new Map(
        energies.map((energy, index) => [
          energy.instanceId,
          {
            orientation: index % 2 === 0 ? OrientationState.ACTIVE : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [waitingRoomCard.instanceId],
    },
  }));
  return { game, host, waitingRoomCard, energies };
}

describe('energy below application helpers', () => {
  it('automatically stacks the first energy from energy zone below a member', () => {
    const { game, energies, waitingRoomCard } = setupEnergyBelowState({ energyCount: 2 });

    const result = stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 1);

    expect(result).not.toBeNull();
    expect(result?.stackedEnergyCardIds).toEqual([energies[0].instanceId]);
    expect(result?.gameState.players[0].energyZone.cardIds).toEqual([energies[1].instanceId]);
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      energies[0].instanceId,
    ]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([waitingRoomCard.instanceId]);
  });

  it('stacks ACTIVE and WAITING energy in energy-zone order when count is two', () => {
    const { game, energies } = setupEnergyBelowState({ energyCount: 3 });

    const result = stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 2);

    expect(result).not.toBeNull();
    expect(result?.stackedEnergyCardIds).toEqual([
      energies[0].instanceId,
      energies[1].instanceId,
    ]);
    expect(result?.gameState.players[0].energyZone.cardIds).toEqual([energies[2].instanceId]);
    expect(result?.gameState.players[0].energyZone.cardStates.has(energies[0].instanceId)).toBe(
      false
    );
    expect(result?.gameState.players[0].energyZone.cardStates.has(energies[1].instanceId)).toBe(
      false
    );
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      energies[0].instanceId,
      energies[1].instanceId,
    ]);
  });

  it('fails without moving cards when the energy zone has fewer cards than requested', () => {
    const { game, energies } = setupEnergyBelowState({ energyCount: 1 });

    const result = stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 2);

    expect(result).toBeNull();
    expect(game.players[0].energyZone.cardIds).toEqual([energies[0].instanceId]);
    expect(game.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
  });

  it('returns energy below a leaving member to the energy deck in deterministic order', () => {
    const { game, energies } = setupEnergyBelowState({ energyCount: 2 });
    const stacked = updatePlayer(game, PLAYER1, (player) => {
      let memberSlots = player.memberSlots;
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, energies[0].instanceId);
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, energies[1].instanceId);
      return {
        ...player,
        energyZone: {
          ...player.energyZone,
          cardIds: [],
          cardStates: new Map(),
        },
        memberSlots,
      };
    });

    const result = returnEnergyBelowMemberToEnergyDeck(stacked, PLAYER1, SlotPosition.CENTER);

    expect(result.returnedEnergyCardIds).toEqual([
      energies[0].instanceId,
      energies[1].instanceId,
    ]);
    expect(result.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(result.gameState.players[0].energyDeck.cardIds.slice(-2)).toEqual([
      energies[0].instanceId,
      energies[1].instanceId,
    ]);
  });
});
