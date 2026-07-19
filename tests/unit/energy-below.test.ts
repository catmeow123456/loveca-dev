import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addEnergyBelowMember, addMemberBelowMember, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  placeEnergyFromEnergyDeckBelowStageMember,
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

function setupEnergyBelowState(options: {
  readonly energyCount: number;
  readonly orientations?: readonly OrientationState[];
}) {
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
            orientation:
              options.orientations?.[index] ??
              (index % 2 === 0 ? OrientationState.ACTIVE : OrientationState.WAITING),
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
  it('moves ENERGY_DECK index 0 below the target and returns exact ids without emitting an energy-zone placement event', () => {
    const { game, host, energies } = setupEnergyBelowState({ energyCount: 2 });
    const deckState = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: { ...player.energyZone, cardIds: [], cardStates: new Map() },
      energyDeck: { ...player.energyDeck, cardIds: energies.map((energy) => energy.instanceId) },
    }));
    const result = placeEnergyFromEnergyDeckBelowStageMember(deckState, PLAYER1, host.instanceId, 1);
    expect(result?.placedEnergyCardIds).toEqual([energies[0].instanceId]);
    expect(result?.targetSlot).toBe(SlotPosition.CENTER);
    expect(result?.gameState.players[0].energyDeck.cardIds).toEqual([energies[1].instanceId]);
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([energies[0].instanceId]);
    expect(result?.gameState.eventLog).toEqual(deckState.eventLog);
  });

  it('follows a moved target instance and treats an empty energy deck as an unchanged success', () => {
    const { game, host } = setupEnergyBelowState({ energyCount: 0 });
    const moved = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(removeCardFromSlot(player.memberSlots, SlotPosition.CENTER), SlotPosition.RIGHT, host.instanceId),
    }));
    expect(placeEnergyFromEnergyDeckBelowStageMember(moved, PLAYER1, host.instanceId, 1)).toEqual({
      gameState: moved,
      targetSlot: SlotPosition.RIGHT,
      placedEnergyCardIds: [],
    });
  });

  it('rejects stale, opponent and memberBelow targets', () => {
    const { game, host, waitingRoomCard } = setupEnergyBelowState({ energyCount: 0 });
    expect(placeEnergyFromEnergyDeckBelowStageMember(game, PLAYER1, 'missing', 1)).toBeNull();
    expect(placeEnergyFromEnergyDeckBelowStageMember(game, PLAYER2, host.instanceId, 1)).toBeNull();
    const below = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.CENTER, waitingRoomCard.instanceId),
    }));
    expect(placeEnergyFromEnergyDeckBelowStageMember(below, PLAYER1, waitingRoomCard.instanceId, 1)).toBeNull();
  });
  it('prefers a later WAITING energy over an earlier ACTIVE energy', () => {
    const { game, energies, waitingRoomCard } = setupEnergyBelowState({ energyCount: 2 });

    const result = stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 1);

    expect(result).not.toBeNull();
    expect(result?.stackedEnergyCardIds).toEqual([energies[1].instanceId]);
    expect(result?.gameState.players[0].energyZone.cardIds).toEqual([energies[0].instanceId]);
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      energies[1].instanceId,
    ]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([waitingRoomCard.instanceId]);
  });

  it('clears the next-active-phase marker when energy leaves the energy zone for member-below', () => {
    const setup = setupEnergyBelowState({
      energyCount: 1,
      orientations: [OrientationState.WAITING],
    });
    const game = {
      ...setup.game,
      energyActivePhaseSkips: [
        {
          playerId: PLAYER1,
          energyCardId: setup.energies[0].instanceId,
          sourceCardId: setup.host.instanceId,
          abilityId: 'marker',
        },
      ],
    };
    const result = stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 1);
    expect(result?.gameState.energyActivePhaseSkips).toEqual([]);
  });

  it('takes the first WAITING energy when WAITING precedes ACTIVE', () => {
    const { game, energies } = setupEnergyBelowState({
      energyCount: 2,
      orientations: [OrientationState.WAITING, OrientationState.ACTIVE],
    });
    expect(
      stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 1)
        ?.stackedEnergyCardIds
    ).toEqual([energies[0].instanceId]);
  });

  it('preserves energy-zone order among multiple WAITING energies', () => {
    const { game, energies } = setupEnergyBelowState({
      energyCount: 3,
      orientations: [OrientationState.ACTIVE, OrientationState.WAITING, OrientationState.WAITING],
    });
    expect(
      stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 1)
        ?.stackedEnergyCardIds
    ).toEqual([energies[1].instanceId]);
  });

  it('takes the first energy when all energies are ACTIVE', () => {
    const { game, energies } = setupEnergyBelowState({
      energyCount: 2,
      orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE],
    });
    expect(
      stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 1)
        ?.stackedEnergyCardIds
    ).toEqual([energies[0].instanceId]);
  });

  it('stacks WAITING energies first and then ACTIVE energies in their original order', () => {
    const { game, energies } = setupEnergyBelowState({ energyCount: 3 });

    const result = stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 2);

    expect(result).not.toBeNull();
    expect(result?.stackedEnergyCardIds).toEqual([energies[1].instanceId, energies[0].instanceId]);
    expect(result?.gameState.players[0].energyZone.cardIds).toEqual([energies[2].instanceId]);
    expect(result?.gameState.players[0].energyZone.cardStates.has(energies[0].instanceId)).toBe(
      false
    );
    expect(result?.gameState.players[0].energyZone.cardStates.has(energies[1].instanceId)).toBe(
      false
    );
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      energies[1].instanceId,
      energies[0].instanceId,
    ]);
  });

  it('fails without moving cards when the energy zone has fewer cards than requested', () => {
    const { game, energies } = setupEnergyBelowState({ energyCount: 1 });

    const result = stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 2);

    expect(result).toBeNull();
    expect(game.players[0].energyZone.cardIds).toEqual([energies[0].instanceId]);
    expect(game.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
  });

  it('keeps the existing count-zero no-op behavior', () => {
    const { game, energies } = setupEnergyBelowState({ energyCount: 2 });
    const result = stackEnergyFromEnergyZoneBelowMember(game, PLAYER1, SlotPosition.CENTER, 0);
    expect(result).toEqual({ gameState: game, stackedEnergyCardIds: [] });
    expect(game.players[0].energyZone.cardIds).toEqual(energies.map((energy) => energy.instanceId));
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

    expect(result.returnedEnergyCardIds).toEqual([energies[0].instanceId, energies[1].instanceId]);
    expect(result.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(result.gameState.players[0].energyDeck.cardIds.slice(-2)).toEqual([
      energies[0].instanceId,
      energies[1].instanceId,
    ]);
  });
});
