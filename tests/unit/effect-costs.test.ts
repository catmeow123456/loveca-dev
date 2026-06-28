import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon } from '../../src/domain/entities/card';
import type { GameState } from '../../src/domain/entities/game';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  payImmediateEffectCosts,
  paySelectedDiscardHandCost,
} from '../../src/application/effects/effect-costs';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

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
  session.createGame('effect-costs-unit', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  return session.state!;
}

describe('effect cost helpers', () => {
  it('pays selected hand discard cost by moving cards to waiting room', () => {
    const state = createMutableState();
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
    };
    const handCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 2)
      .map((card) => card.instanceId);

    p1.hand.cardIds = handCardIds;
    p1.waitingRoom.cardIds = [];

    const result = paySelectedDiscardHandCost(state, PLAYER1, [handCardIds[0]]);

    expect(result).not.toBeNull();
    expect(result?.discardedHandCardIds).toEqual([handCardIds[0]]);
    expect(result?.gameState.players[0].hand.cardIds).toEqual([handCardIds[1]]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([handCardIds[0]]);
    expect(paySelectedDiscardHandCost(state, PLAYER1, [handCardIds[0], handCardIds[0]])).toBeNull();
    expect(paySelectedDiscardHandCost(state, PLAYER1, ['missing-card'])).toBeNull();
  });

  it('pays active energy cost by marking the first active energy as waiting', () => {
    const state = createMutableState();
    const p1 = state.players[0] as unknown as {
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .slice(0, 2)
      .map((card) => card.instanceId);

    p1.energyZone.cardIds = energyCardIds;
    p1.energyZone.cardStates = new Map([
      [energyCardIds[0], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [energyCardIds[1], { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
    ]);

    const result = payImmediateEffectCosts(state, PLAYER1, 'source-card', [
      { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
    ]);

    expect(result).not.toBeNull();
    expect(result?.paidEnergyCardIds).toEqual([energyCardIds[0]]);
    expect(
      result?.gameState.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      payImmediateEffectCosts(state, PLAYER1, 'source-card', [
        { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
      ])
    ).toBeNull();
  });

  it('pays source-member-to-waiting-room cost and clears attachments below that slot', () => {
    const state = createMutableState();
    const p1 = state.players[0] as unknown as {
      waitingRoom: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        energyBelow: Record<SlotPosition, string[]>;
        memberBelow: Record<SlotPosition, string[]>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const memberCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 2)
      .map((card) => card.instanceId);
    const energyCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY
    )?.instanceId;

    expect(energyCardId).toBeTruthy();

    p1.waitingRoom.cardIds = [];
    p1.memberSlots.slots[SlotPosition.CENTER] = memberCardIds[0];
    p1.memberSlots.energyBelow[SlotPosition.CENTER] = [energyCardId!];
    p1.memberSlots.memberBelow[SlotPosition.CENTER] = [memberCardIds[1]];
    p1.memberSlots.cardStates.set(memberCardIds[0], {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });

    const result = payImmediateEffectCosts(state, PLAYER1, memberCardIds[0], [
      { kind: 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM' },
    ]);

    expect(result).not.toBeNull();
    expect(result?.sourceSlot).toBe(SlotPosition.CENTER);
    expect(result?.movedToWaitingRoomCardIds).toEqual([memberCardIds[0], memberCardIds[1]]);
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(result?.gameState.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(result?.gameState.players[0].memberSlots.cardStates.has(memberCardIds[0])).toBe(false);
    expect(result?.gameState.players[0].waitingRoom.cardIds).not.toContain(energyCardId);
    expect(result?.gameState.players[0].energyDeck.cardIds).toContain(energyCardId);
  });

  it('pays source-member orientation cost by setting the staged source member to waiting', () => {
    const state = createMutableState();
    const p1 = state.players[0] as unknown as {
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const sourceCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER
    )?.instanceId;

    expect(sourceCardId).toBeTruthy();

    p1.memberSlots.slots[SlotPosition.CENTER] = sourceCardId!;
    p1.memberSlots.cardStates = new Map([
      [sourceCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const result = payImmediateEffectCosts(state, PLAYER1, sourceCardId!, [
      { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
    ]);

    expect(result).not.toBeNull();
    expect(result?.sourceSlot).toBe(SlotPosition.CENTER);
    expect(result?.orientedMemberCardIds).toEqual([sourceCardId]);
    expect(
      result?.gameState.players[0].memberSlots.cardStates.get(sourceCardId!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      payImmediateEffectCosts(result!.gameState, PLAYER1, sourceCardId!, [
        { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
      ])
    ).toBeNull();
  });
});
