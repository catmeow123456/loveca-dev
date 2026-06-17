import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon } from '../../src/domain/entities/card';
import type { GameState } from '../../src/domain/entities/game';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  getEnergyCardIdsByOrientation,
  placeEnergyFromDeckToZone,
  setEnergyOrientation,
  setFirstEnergyCardsOrientation,
} from '../../src/application/effects/energy';
import {
  getActiveEnergyCount,
  getActiveEnergyIds,
  toggleEnergyOrientation,
} from '../../src/domain/entities/zone';
import { CardType, FaceState, HeartColor, OrientationState } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function createMutableState(): GameState {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('energy-unit', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  return session.state!;
}

function setPlayerEnergyZones(
  state: GameState,
  options: {
    readonly energyDeckCardIds: readonly string[];
    readonly energyZoneCardIds?: readonly string[];
  }
): void {
  const p1 = state.players[0] as unknown as {
    energyDeck: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.energyDeck.cardIds = [...options.energyDeckCardIds];
  p1.energyZone.cardIds = [...(options.energyZoneCardIds ?? [])];
  p1.energyZone.cardStates = new Map(
    (options.energyZoneCardIds ?? []).map((cardId) => [
      cardId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
}

describe('energy effect helpers', () => {
  it('places cards from energy deck to energy zone with requested orientation', () => {
    const state = createMutableState();
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .slice(0, 3)
      .map((card) => card.instanceId);
    setPlayerEnergyZones(state, { energyDeckCardIds: energyCardIds });

    const result = placeEnergyFromDeckToZone(state, PLAYER1, 2, OrientationState.WAITING);

    expect(result).not.toBeNull();
    expect(result?.placedEnergyCardIds).toEqual(energyCardIds.slice(0, 2));
    expect(result?.gameState.players[0].energyDeck.cardIds).toEqual([energyCardIds[2]]);
    expect(result?.gameState.players[0].energyZone.cardIds).toEqual(energyCardIds.slice(0, 2));
    expect(
      result?.gameState.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation
    ).toBe(OrientationState.WAITING);
    expect(result?.gameState.players[0].energyZone.cardStates.get(energyCardIds[0])?.face).toBe(
      FaceState.FACE_UP
    );
  });

  it('does not mutate state when energy deck is empty and rejects non-positive counts', () => {
    const state = createMutableState();
    setPlayerEnergyZones(state, { energyDeckCardIds: [] });

    const emptyResult = placeEnergyFromDeckToZone(state, PLAYER1, 1, OrientationState.WAITING);

    expect(emptyResult).not.toBeNull();
    expect(emptyResult?.placedEnergyCardIds).toEqual([]);
    expect(emptyResult?.gameState).toBe(state);
    expect(placeEnergyFromDeckToZone(state, PLAYER1, 0, OrientationState.WAITING)).toBeNull();
  });

  it('sets the first matching energy cards to the requested orientation', () => {
    const state = createMutableState();
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .slice(0, 4)
      .map((card) => card.instanceId);
    setPlayerEnergyZones(state, { energyDeckCardIds: [], energyZoneCardIds: energyCardIds });

    const p1 = state.players[0] as unknown as {
      energyZone: {
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    p1.energyZone.cardStates.set(energyCardIds[0], {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });
    p1.energyZone.cardStates.set(energyCardIds[2], {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });
    p1.energyZone.cardStates.set(energyCardIds[3], {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });

    const result = setFirstEnergyCardsOrientation(state, PLAYER1, 2, OrientationState.ACTIVE, {
      fromOrientation: OrientationState.WAITING,
    });

    expect(result).not.toBeNull();
    expect(result?.updatedEnergyCardIds).toEqual([energyCardIds[0], energyCardIds[2]]);
    expect(result?.previousOrientations).toEqual([
      { cardId: energyCardIds[0], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[2], orientation: OrientationState.WAITING },
    ]);
    expect(
      result?.gameState.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      result?.gameState.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      result?.gameState.players[0].energyZone.cardStates.get(energyCardIds[2])?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      result?.gameState.players[0].energyZone.cardStates.get(energyCardIds[3])?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('treats missing energy card state as active when counting and toggling', () => {
    const state = createMutableState();
    const energyCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY
    )?.instanceId;
    expect(energyCardId).toBeTruthy();
    setPlayerEnergyZones(state, { energyDeckCardIds: [], energyZoneCardIds: [energyCardId!] });

    const p1 = state.players[0] as unknown as {
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    p1.energyZone.cardStates = new Map();

    expect(getActiveEnergyCount(p1.energyZone)).toBe(1);
    expect(getActiveEnergyIds(p1.energyZone)).toEqual([energyCardId]);

    const waitingZone = toggleEnergyOrientation(p1.energyZone, energyCardId!);
    expect(waitingZone.cardStates.get(energyCardId!)?.orientation).toBe(OrientationState.WAITING);
    expect(getActiveEnergyCount(waitingZone)).toBe(0);
    expect(getActiveEnergyIds(waitingZone)).toEqual([]);

    const activeZone = toggleEnergyOrientation(waitingZone, energyCardId!);
    expect(activeZone.cardStates.get(energyCardId!)?.orientation).toBe(OrientationState.ACTIVE);
  });

  it('returns energy card ids with the requested orientation without defaulting missing state', () => {
    const state = createMutableState();
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .slice(0, 3)
      .map((card) => card.instanceId);
    setPlayerEnergyZones(state, { energyDeckCardIds: [], energyZoneCardIds: energyCardIds });

    const p1 = state.players[0] as unknown as {
      energyZone: {
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    p1.energyZone.cardStates.set(energyCardIds[0], {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });
    p1.energyZone.cardStates.set(energyCardIds[1], {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    p1.energyZone.cardStates.delete(energyCardIds[2]);

    expect(getEnergyCardIdsByOrientation(state, PLAYER1, OrientationState.WAITING)).toEqual([
      energyCardIds[0],
    ]);
    expect(getEnergyCardIdsByOrientation(state, PLAYER1, OrientationState.ACTIVE)).toEqual([
      energyCardIds[1],
    ]);
    expect(getEnergyCardIdsByOrientation(state, 'missing-player', OrientationState.ACTIVE)).toEqual(
      []
    );
  });

  it('rejects invalid energy orientation requests', () => {
    const state = createMutableState();
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .slice(0, 1)
      .map((card) => card.instanceId);
    setPlayerEnergyZones(state, { energyDeckCardIds: [], energyZoneCardIds: energyCardIds });

    expect(setFirstEnergyCardsOrientation(state, PLAYER1, 0, OrientationState.ACTIVE)).toBeNull();
    expect(
      setEnergyOrientation(
        state,
        PLAYER1,
        [energyCardIds[0], energyCardIds[0]],
        OrientationState.ACTIVE
      )
    ).toBeNull();
    expect(setEnergyOrientation(state, PLAYER1, ['missing-card'], OrientationState.ACTIVE)).toBeNull();
  });
});
