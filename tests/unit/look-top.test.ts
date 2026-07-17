import { describe, expect, it } from 'vitest';
import type { AnyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import type { GameState } from '../../src/domain/entities/game';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  clearInspectionCards,
  inspectTopCards,
  inspectTopCardsUntilMatch,
  moveInspectedCardsToWaitingRoom,
  moveInspectedSelectionToHandRestToWaitingRoom,
  moveTopDeckCardsToWaitingRoom,
  moveTopDeckCardsToWaitingRoomWithRefresh,
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

  it('inspects until the first live match and evaluates the predicate against current state', () => {
    const state = createMutableState();
    const owned = [...state.cardRegistry.values()].filter((card) => card.ownerId === PLAYER1);
    const members = owned.filter((card) => card.data.cardType === CardType.MEMBER).slice(0, 2);
    const live = owned.find((card) => card.data.cardType === CardType.LIVE)!;
    const topCardIds = [members[0]!.instanceId, members[1]!.instanceId, live.instanceId];
    setMainDeckForPlayer(state, topCardIds);

    const predicateStates: boolean[] = [];
    const result = inspectTopCardsUntilMatch(state, PLAYER1, (currentState, card) => {
      predicateStates.push(currentState.inspectionZone.cardIds.includes(card.instanceId));
      return card.data.cardType === CardType.LIVE;
    });

    expect(result).not.toBeNull();
    expect(result?.inspectedCardIds).toEqual(topCardIds);
    expect(result?.hitCardId).toBe(live.instanceId);
    expect(predicateStates).toEqual([true, true, true]);
    expect(result?.gameState.inspectionZone.cardIds).toEqual(topCardIds);
    expect(result?.gameState.inspectionZone.revealedCardIds).toEqual(topCardIds);
    expect(result?.gameState.inspectionContext).toEqual({
      ownerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    });
  });

  it('stops immediately when the first inspected card matches', () => {
    const state = createMutableState();
    const owned = [...state.cardRegistry.values()].filter((card) => card.ownerId === PLAYER1);
    const live = owned.find((card) => card.data.cardType === CardType.LIVE)!;
    const member = owned.find((card) => card.data.cardType === CardType.MEMBER)!;
    setMainDeckForPlayer(state, [live.instanceId, member.instanceId]);

    const result = inspectTopCardsUntilMatch(
      state,
      PLAYER1,
      (_currentState, card) => card.data.cardType === CardType.LIVE
    );

    expect(result?.inspectedCardIds).toEqual([live.instanceId]);
    expect(result?.hitCardId).toBe(live.instanceId);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual([member.instanceId]);
  });

  it('continues after refresh without shuffling inspected cards back into the deck', () => {
    const state = createMutableState();
    const owned = [...state.cardRegistry.values()].filter((card) => card.ownerId === PLAYER1);
    const member = owned.find((card) => card.data.cardType === CardType.MEMBER)!;
    const live = owned.find((card) => card.data.cardType === CardType.LIVE)!;
    setMainDeckForPlayer(state, [member.instanceId]);
    state.players[0]!.waitingRoom.cardIds = [live.instanceId];

    const result = inspectTopCardsUntilMatch(
      state,
      PLAYER1,
      (_currentState, card) => card.data.cardType === CardType.LIVE
    );

    expect(result?.inspectedCardIds).toEqual([member.instanceId, live.instanceId]);
    expect(result?.hitCardId).toBe(live.instanceId);
    expect(result?.gameState.inspectionZone.cardIds).toEqual([
      member.instanceId,
      live.instanceId,
    ]);
    expect(result?.gameState.players[0].mainDeck.cardIds).not.toContain(member.instanceId);
  });

  it('returns no hit after exhausting all available cards and rejects a missing player', () => {
    const state = createMutableState();
    const members = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 3)
      .map((card) => card.instanceId);
    setMainDeckForPlayer(state, members);

    const exhausted = inspectTopCardsUntilMatch(
      state,
      PLAYER1,
      (_currentState, card) => card.data.cardType === CardType.LIVE
    );
    expect(exhausted?.inspectedCardIds).toEqual(members);
    expect(exhausted?.hitCardId).toBeNull();
    expect(exhausted?.gameState.players[0].mainDeck.cardIds).toEqual([]);
    expect(exhausted?.gameState.inspectionZone.revealedCardIds).toEqual(members);
    expect(inspectTopCardsUntilMatch(state, 'missing-player', () => true)).toBeNull();
  });

  it('refreshes before main-deck inspection when the deck is short but waiting room can supply cards', () => {
    const state = createMutableState();
    const cardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 6)
      .map((card) => card.instanceId);
    const originalTopCardIds = cardIds.slice(0, 2);
    const waitingRoomCardIds = cardIds.slice(2, 6);
    setMainDeckForPlayer(state, originalTopCardIds);
    const p1 = state.players[0] as unknown as {
      waitingRoom: { cardIds: string[] };
    };
    p1.waitingRoom.cardIds = [...waitingRoomCardIds];

    const result = inspectTopCards(state, PLAYER1, { count: 5, reveal: true });

    expect(result).not.toBeNull();
    expect(result!.inspectedCardIds).toHaveLength(5);
    expect(result!.inspectedCardIds.slice(0, 2)).toEqual(originalTopCardIds);
    expect(new Set(result!.inspectedCardIds.slice(2)).size).toBe(3);
    expect(result!.inspectedCardIds.slice(2).every((cardId) => waitingRoomCardIds.includes(cardId)))
      .toBe(true);
    expect(result!.gameState.inspectionZone.cardIds).toEqual(result!.inspectedCardIds);
    expect(result!.gameState.inspectionZone.revealedCardIds).toEqual(result!.inspectedCardIds);
    expect(result!.gameState.players[0].waitingRoom.cardIds).toEqual([]);
    expect(result!.gameState.players[0].mainDeck.cardIds).toHaveLength(1);
    expect(
      result!.gameState.players[0].mainDeck.cardIds.every(
        (cardId) =>
          !result!.inspectedCardIds.includes(cardId) && waitingRoomCardIds.includes(cardId)
      )
    ).toBe(true);
    expect(
      result!.gameState.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 4 &&
          action.payload.mainDeckCountAfter === 6
      )
    ).toBe(true);
  });

  it('refreshes after inspection exactly empties the main deck while waiting room still has cards', () => {
    const state = createMutableState();
    const cardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 6)
      .map((card) => card.instanceId);
    const originalTopCardIds = cardIds.slice(0, 2);
    const waitingRoomCardIds = cardIds.slice(2, 6);
    setMainDeckForPlayer(state, originalTopCardIds);
    const p1 = state.players[0] as unknown as {
      waitingRoom: { cardIds: string[] };
    };
    p1.waitingRoom.cardIds = [...waitingRoomCardIds];

    const result = inspectTopCards(state, PLAYER1, { count: 2 });

    expect(result).not.toBeNull();
    expect(result!.inspectedCardIds).toEqual(originalTopCardIds);
    expect(result!.gameState.inspectionZone.cardIds).toEqual(originalTopCardIds);
    expect(result!.gameState.players[0].waitingRoom.cardIds).toEqual([]);
    expect(new Set(result!.gameState.players[0].mainDeck.cardIds)).toEqual(
      new Set(waitingRoomCardIds)
    );
    expect(
      result!.gameState.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 4 &&
          action.payload.mainDeckCountAfter === 4
      )
    ).toBe(true);
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

    const result = moveInspectedCardsToWaitingRoom(inspection!.gameState, PLAYER1, topCardIds);

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

  it('refreshes and continues when effect milling needs more cards than the main deck has', () => {
    const state = createMutableState();
    const topCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 3)
      .map((card) => card.instanceId);
    setMainDeckForPlayer(state, topCardIds.slice(0, 2));
    const p1 = state.players[0] as unknown as {
      waitingRoom: { cardIds: string[] };
    };
    p1.waitingRoom.cardIds = [topCardIds[2]!];

    const result = moveTopDeckCardsToWaitingRoomWithRefresh(state, PLAYER1, 3);

    expect(result).not.toBeNull();
    expect(result?.movedCardIds).toHaveLength(3);
    expect(result?.movedCardIds.slice(0, 2)).toEqual(topCardIds.slice(0, 2));
    expect(topCardIds).toContain(result?.movedCardIds[2]);
    expect(result?.refreshCount).toBe(1);
    expect(result?.gameState.players[0].mainDeck.cardIds).toHaveLength(2);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toHaveLength(1);
    expect(
      result?.gameState.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.movedCount === 3
      )
    ).toBe(true);
  });

  it('refreshes immediately after effect milling exactly empties the main deck', () => {
    const state = createMutableState();
    const topCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 3)
      .map((card) => card.instanceId);
    setMainDeckForPlayer(state, topCardIds);

    const result = moveTopDeckCardsToWaitingRoomWithRefresh(state, PLAYER1, 3);

    expect(result).not.toBeNull();
    expect(result?.movedCardIds).toEqual(topCardIds);
    expect(result?.refreshCount).toBe(1);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([]);
    expect(result?.gameState.players[0].mainDeck.cardIds).toHaveLength(3);
    expect(
      result?.gameState.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 3 &&
          action.payload.mainDeckCountAfter === 3
      )
    ).toBe(true);
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
