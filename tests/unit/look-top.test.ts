import { describe, expect, it } from 'vitest';
import type { AnyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import type { GameState } from '../../src/domain/entities/game';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  clearInspectionCards,
  inspectTopCards,
  moveInspectedCardsToWaitingRoom,
  moveInspectedSelectionToHandRestToWaitingRoom,
  moveTopDeckCardsToWaitingRoom,
} from '../../src/application/effects/look-top';
import { CardType, HeartColor, ZoneType } from '../../src/shared/types/enums';

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

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [
    createMemberCard('MEM-0'),
    createLiveCard('LIVE-0'),
    createMemberCard('MEM-1'),
    createMemberCard('MEM-2'),
  ];
  for (let index = 3; index < 48; index++) {
    mainDeck.push(createMemberCard(`MEM-${index}`));
  }
  for (let index = 1; index < 12; index++) {
    mainDeck.push(createLiveCard(`LIVE-${index}`));
  }

  const energyDeck = Array.from({ length: 12 }, (_, index) => ({
    cardCode: `ENE-${index}`,
    name: `Energy ${index}`,
    cardType: CardType.ENERGY,
  }));

  return { mainDeck, energyDeck };
}

function createMutableState(): GameState {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('look-top-unit', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  return session.state!;
}

function setMainDeckForPlayer(state: GameState, cardIds: readonly string[]): void {
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
  };
  p1.hand.cardIds = [];
  p1.mainDeck.cardIds = [...cardIds];
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
}

describe('look-top helpers', () => {
  it('moves top cards from main deck to inspection and filters selectable cards', () => {
    const state = createMutableState();
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const memberCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(liveCardId).toBeTruthy();

    const topCardIds = [memberCardIds[0], liveCardId!, memberCardIds[1]];
    setMainDeckForPlayer(state, [...topCardIds, memberCardIds[2]]);

    const result = inspectTopCards(state, PLAYER1, {
      count: 3,
      selectablePredicate: (card) => card.data.cardType === CardType.MEMBER,
    });

    expect(result).not.toBeNull();
    expect(result?.inspectedCardIds).toEqual(topCardIds);
    expect(result?.selectableCardIds).toEqual([memberCardIds[0], memberCardIds[1]]);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual([memberCardIds[2]]);
    expect(result?.gameState.inspectionZone.cardIds).toEqual(topCardIds);
    expect(result?.gameState.inspectionZone.revealedCardIds).toEqual([]);
    expect(result?.gameState.inspectionContext).toEqual({
      ownerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    });
  });

  it('can reveal inspected cards immediately', () => {
    const state = createMutableState();
    const topCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 2)
      .map((card) => card.instanceId);
    setMainDeckForPlayer(state, topCardIds);

    const result = inspectTopCards(state, PLAYER1, { count: 2, reveal: true });

    expect(result?.gameState.inspectionZone.cardIds).toEqual(topCardIds);
    expect(result?.gameState.inspectionZone.revealedCardIds).toEqual(topCardIds);
  });

  it('moves selected inspected card to hand, mills the rest, and clears inspection', () => {
    const state = createMutableState();
    const topCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 3)
      .map((card) => card.instanceId);
    setMainDeckForPlayer(state, topCardIds);
    const inspection = inspectTopCards(state, PLAYER1, { count: 3 });

    expect(inspection).not.toBeNull();

    const result = moveInspectedSelectionToHandRestToWaitingRoom(
      inspection!.gameState,
      PLAYER1,
      topCardIds,
      topCardIds[1]
    );

    expect(result).not.toBeNull();
    expect(result?.selectedCardId).toBe(topCardIds[1]);
    expect(result?.waitingRoomCardIds).toEqual([topCardIds[0], topCardIds[2]]);
    expect(result?.gameState.players[0].hand.cardIds).toEqual([topCardIds[1]]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([
      topCardIds[0],
      topCardIds[2],
    ]);
    expect(result?.gameState.inspectionZone.cardIds).toEqual([]);
    expect(result?.gameState.inspectionContext).toBeNull();
  });

  it('moves all inspected cards to waiting room and clears inspection', () => {
    const state = createMutableState();
    const topCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 3)
      .map((card) => card.instanceId);
    setMainDeckForPlayer(state, topCardIds);
    const inspection = inspectTopCards(state, PLAYER1, { count: 3, reveal: true });

    expect(inspection).not.toBeNull();

    const result = moveInspectedCardsToWaitingRoom(
      inspection!.gameState,
      PLAYER1,
      topCardIds
    );

    expect(result).not.toBeNull();
    expect(result?.movedCardIds).toEqual(topCardIds);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(result?.gameState.inspectionZone.cardIds).toEqual([]);
    expect(result?.gameState.inspectionZone.revealedCardIds).toEqual([]);
  });

  it('moves top deck cards directly to waiting room', () => {
    const state = createMutableState();
    const topCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 4)
      .map((card) => card.instanceId);
    setMainDeckForPlayer(state, topCardIds);

    const result = moveTopDeckCardsToWaitingRoom(state, PLAYER1, 3);

    expect(result).not.toBeNull();
    expect(result?.movedCardIds).toEqual(topCardIds.slice(0, 3));
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual([topCardIds[3]]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual(topCardIds.slice(0, 3));
  });

  it('preserves inspection context while other inspected cards remain', () => {
    const state = createMutableState();
    const cardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 3)
      .map((card) => card.instanceId);
    const withInspection = {
      ...state,
      inspectionZone: {
        ...state.inspectionZone,
        cardIds,
        revealedCardIds: cardIds,
      },
      inspectionContext: {
        ownerPlayerId: PLAYER1,
        sourceZone: ZoneType.MAIN_DECK,
      },
    };

    const cleared = clearInspectionCards(withInspection, [cardIds[0]]);

    expect(cleared.inspectionZone.cardIds).toEqual([cardIds[1], cardIds[2]]);
    expect(cleared.inspectionZone.revealedCardIds).toEqual([cardIds[1], cardIds[2]]);
    expect(cleared.inspectionContext).toEqual(withInspection.inspectionContext);
  });
});
