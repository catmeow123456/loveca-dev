import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon } from '../../src/domain/entities/card';
import type { GameState } from '../../src/domain/entities/game';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { drawCardsFromMainDeckToHand } from '../../src/application/effects/draw';
import { CardType, HeartColor } from '../../src/shared/types/enums';

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
  session.createGame('draw-unit', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  return session.state!;
}

function setPlayerZones(
  state: GameState,
  options: {
    readonly handCardIds?: readonly string[];
    readonly mainDeckCardIds: readonly string[];
  }
): void {
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
  };
  p1.hand.cardIds = [...(options.handCardIds ?? [])];
  p1.mainDeck.cardIds = [...options.mainDeckCardIds];
}

describe('draw effect helpers', () => {
  it('draws cards from the top of main deck to hand in order', () => {
    const state = createMutableState();
    const cardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 4)
      .map((card) => card.instanceId);
    setPlayerZones(state, { handCardIds: [cardIds[3]], mainDeckCardIds: cardIds.slice(0, 3) });

    const result = drawCardsFromMainDeckToHand(state, PLAYER1, 2);

    expect(result).not.toBeNull();
    expect(result?.drawnCardIds).toEqual(cardIds.slice(0, 2));
    expect(result?.gameState.players[0].hand.cardIds).toEqual([cardIds[3], cardIds[0], cardIds[1]]);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual([cardIds[2]]);
  });

  it('draws only available cards when the deck has fewer cards than requested', () => {
    const state = createMutableState();
    const cardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .slice(0, 2)
      .map((card) => card.instanceId);
    setPlayerZones(state, { mainDeckCardIds: cardIds });

    const result = drawCardsFromMainDeckToHand(state, PLAYER1, 5);

    expect(result).not.toBeNull();
    expect(result?.drawnCardIds).toEqual(cardIds);
    expect(result?.gameState.players[0].hand.cardIds).toEqual(cardIds);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('does not mutate state when the deck is empty and rejects non-positive counts', () => {
    const state = createMutableState();
    setPlayerZones(state, { mainDeckCardIds: [] });

    const emptyResult = drawCardsFromMainDeckToHand(state, PLAYER1, 1);

    expect(emptyResult).not.toBeNull();
    expect(emptyResult?.drawnCardIds).toEqual([]);
    expect(emptyResult?.gameState).toBe(state);
    expect(drawCardsFromMainDeckToHand(state, PLAYER1, 0)).toBeNull();
  });
});
