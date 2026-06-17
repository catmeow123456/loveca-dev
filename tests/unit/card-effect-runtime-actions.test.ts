import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon } from '../../src/domain/entities/card';
import type { GameState } from '../../src/domain/entities/game';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  activateWaitingEnergyCardsForPlayer,
  addBladeLiveModifierForSourceMember,
  discardHandCardsToWaitingRoomForPlayer,
  discardOneHandCardToWaitingRoomForPlayer,
  drawCardsForEachPlayer,
  drawCardsForPlayer,
  recoverCardsFromWaitingRoomToHandForPlayer,
  shuffleWaitingRoomCardsToDeckBottomForPlayer,
} from '../../src/application/card-effects/runtime/actions';
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
  session.createGame('runtime-actions-unit', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  return session.state!;
}

function ownedMemberIds(state: GameState, playerId: string, count: number): readonly string[] {
  return [...state.cardRegistry.values()]
    .filter((card) => card.ownerId === playerId && card.data.cardType === CardType.MEMBER)
    .slice(0, count)
    .map((card) => card.instanceId);
}

function ownedEnergyIds(state: GameState, playerId: string, count: number): readonly string[] {
  return [...state.cardRegistry.values()]
    .filter((card) => card.ownerId === playerId && card.data.cardType === CardType.ENERGY)
    .slice(0, count)
    .map((card) => card.instanceId);
}

function setPlayerZones(
  state: GameState,
  playerIndex: number,
  options: {
    readonly handCardIds?: readonly string[];
    readonly mainDeckCardIds: readonly string[];
    readonly waitingRoomCardIds?: readonly string[];
  }
): void {
  const player = state.players[playerIndex] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
  };
  player.hand.cardIds = [...(options.handCardIds ?? [])];
  player.mainDeck.cardIds = [...options.mainDeckCardIds];
  player.waitingRoom.cardIds = [...(options.waitingRoomCardIds ?? [])];
}

function setPlayerEnergyZone(
  state: GameState,
  playerIndex: number,
  cardIds: readonly string[],
  orientations: Readonly<Record<string, OrientationState>>
): void {
  const player = state.players[playerIndex] as unknown as {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  player.energyZone.cardIds = [...cardIds];
  player.energyZone.cardStates = new Map(
    cardIds.map((cardId) => [
      cardId,
      {
        orientation: orientations[cardId] ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      },
    ])
  );
}

describe('card effect runtime actions', () => {
  it('draws cards for one player using existing card-effect draw semantics', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 4);
    setPlayerZones(state, 0, { handCardIds: [cardIds[3]], mainDeckCardIds: cardIds.slice(0, 3) });

    const result = drawCardsForPlayer(state, PLAYER1, 2);

    expect(result).not.toBeNull();
    expect(result?.drawnCardIds).toEqual(cardIds.slice(0, 2));
    expect(result?.gameState.players[0].hand.cardIds).toEqual([cardIds[3], cardIds[0], cardIds[1]]);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual([cardIds[2]]);
  });

  it('draws for each player in order and records drawn card ids by player', () => {
    const state = createMutableState();
    const p1CardIds = ownedMemberIds(state, PLAYER1, 3);
    const p2CardIds = ownedMemberIds(state, PLAYER2, 2);
    setPlayerZones(state, 0, { mainDeckCardIds: p1CardIds });
    setPlayerZones(state, 1, { mainDeckCardIds: p2CardIds });

    const result = drawCardsForEachPlayer(state, [PLAYER1, PLAYER2], 2);

    expect(result).not.toBeNull();
    expect(result?.drawnCardIdsByPlayer).toEqual({
      [PLAYER1]: p1CardIds.slice(0, 2),
      [PLAYER2]: p2CardIds,
    });
    expect(result?.gameState.players[0].hand.cardIds).toEqual(p1CardIds.slice(0, 2));
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual([p1CardIds[2]]);
    expect(result?.gameState.players[1].hand.cardIds).toEqual(p2CardIds);
    expect(result?.gameState.players[1].mainDeck.cardIds).toEqual([]);
  });

  it('discards exact hand cards to waiting room and records discarded ids', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 4);
    setPlayerZones(state, 0, { handCardIds: cardIds, mainDeckCardIds: [] });

    const result = discardHandCardsToWaitingRoomForPlayer(
      state,
      PLAYER1,
      [cardIds[1], cardIds[3]],
      {
        count: 2,
        candidateCardIds: cardIds.slice(1),
      }
    );

    expect(result).not.toBeNull();
    expect(result?.discardedCardIds).toEqual([cardIds[1], cardIds[3]]);
    expect(result?.gameState.players[0].hand.cardIds).toEqual([cardIds[0], cardIds[2]]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([cardIds[1], cardIds[3]]);
  });

  it('discards one hand card to waiting room with the single-card helper', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, { handCardIds: cardIds, mainDeckCardIds: [] });

    const result = discardOneHandCardToWaitingRoomForPlayer(state, PLAYER1, cardIds[1], {
      candidateCardIds: [cardIds[1]],
    });

    expect(result).not.toBeNull();
    expect(result?.discardedCardIds).toEqual([cardIds[1]]);
    expect(result?.gameState.players[0].hand.cardIds).toEqual([cardIds[0], cardIds[2]]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([cardIds[1]]);
  });

  it('rejects discard selections outside exact count or candidates', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, { handCardIds: cardIds, mainDeckCardIds: [] });

    expect(
      discardHandCardsToWaitingRoomForPlayer(state, PLAYER1, [cardIds[0]], {
        count: 2,
        candidateCardIds: cardIds,
      })
    ).toBeNull();
    expect(
      discardHandCardsToWaitingRoomForPlayer(state, PLAYER1, [cardIds[0], cardIds[2]], {
        count: 2,
        candidateCardIds: [cardIds[0], cardIds[1]],
      })
    ).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual(cardIds);
    expect(state.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('recovers one waiting-room card to hand without mutating the original state', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, {
      handCardIds: [cardIds[0]],
      mainDeckCardIds: [],
      waitingRoomCardIds: [cardIds[1], cardIds[2]],
    });

    const result = recoverCardsFromWaitingRoomToHandForPlayer(state, PLAYER1, [cardIds[1]], {
      candidateCardIds: [cardIds[1], cardIds[2]],
      exactCount: 1,
    });

    expect(result).not.toBeNull();
    expect(result?.movedCardIds).toEqual([cardIds[1]]);
    expect(result?.selectedCardIds).toEqual([cardIds[1]]);
    expect(result?.remainingCandidateIds).toEqual([cardIds[2]]);
    expect(result?.gameState.players[0].hand.cardIds).toEqual([cardIds[0], cardIds[1]]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([cardIds[2]]);
    expect(state.players[0].hand.cardIds).toEqual([cardIds[0]]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([cardIds[1], cardIds[2]]);
  });

  it('recovers multiple waiting-room cards in selected order', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 4);
    setPlayerZones(state, 0, {
      mainDeckCardIds: [],
      waitingRoomCardIds: cardIds,
    });

    const result = recoverCardsFromWaitingRoomToHandForPlayer(
      state,
      PLAYER1,
      [cardIds[2], cardIds[0]],
      {
        candidateCardIds: cardIds,
        minCount: 0,
        maxCount: 2,
      }
    );

    expect(result).not.toBeNull();
    expect(result?.movedCardIds).toEqual([cardIds[2], cardIds[0]]);
    expect(result?.gameState.players[0].hand.cardIds).toEqual([cardIds[2], cardIds[0]]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([cardIds[1], cardIds[3]]);
  });

  it('rejects recovery selections outside candidates or with duplicate ids', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, {
      mainDeckCardIds: [],
      waitingRoomCardIds: cardIds,
    });

    expect(
      recoverCardsFromWaitingRoomToHandForPlayer(state, PLAYER1, [cardIds[2]], {
        candidateCardIds: [cardIds[0], cardIds[1]],
        exactCount: 1,
      })
    ).toBeNull();
    expect(
      recoverCardsFromWaitingRoomToHandForPlayer(state, PLAYER1, [cardIds[0], cardIds[0]], {
        candidateCardIds: cardIds,
        minCount: 0,
        maxCount: 2,
      })
    ).toBeNull();
  });

  it('rejects recovery selections that do not satisfy exact or min-max counts', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, {
      mainDeckCardIds: [],
      waitingRoomCardIds: cardIds,
    });

    expect(
      recoverCardsFromWaitingRoomToHandForPlayer(state, PLAYER1, [cardIds[0], cardIds[1]], {
        candidateCardIds: cardIds,
        exactCount: 1,
      })
    ).toBeNull();
    expect(
      recoverCardsFromWaitingRoomToHandForPlayer(state, PLAYER1, [], {
        candidateCardIds: cardIds,
        minCount: 1,
        maxCount: 2,
      })
    ).toBeNull();
    expect(
      recoverCardsFromWaitingRoomToHandForPlayer(state, PLAYER1, cardIds, {
        candidateCardIds: cardIds,
        minCount: 0,
        maxCount: 2,
      })
    ).toBeNull();
  });

  it('allows zero-card optional recovery and reports remaining candidates', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 2);
    setPlayerZones(state, 0, {
      mainDeckCardIds: [],
      waitingRoomCardIds: cardIds,
    });

    const result = recoverCardsFromWaitingRoomToHandForPlayer(state, PLAYER1, [], {
      candidateCardIds: cardIds,
      minCount: 0,
      maxCount: 2,
    });

    expect(result).not.toBeNull();
    expect(result?.movedCardIds).toEqual([]);
    expect(result?.remainingCandidateIds).toEqual(cardIds);
    expect(result?.gameState).toBe(state);
  });

  it('rejects recovery for invalid players or cards outside waiting room', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 2);
    setPlayerZones(state, 0, {
      handCardIds: [cardIds[1]],
      mainDeckCardIds: [],
      waitingRoomCardIds: [cardIds[0]],
    });

    expect(
      recoverCardsFromWaitingRoomToHandForPlayer(state, 'missing-player', [cardIds[0]], {
        candidateCardIds: [cardIds[0]],
        exactCount: 1,
      })
    ).toBeNull();
    expect(
      recoverCardsFromWaitingRoomToHandForPlayer(state, PLAYER1, [cardIds[1]], {
        candidateCardIds: [cardIds[1]],
        exactCount: 1,
      })
    ).toBeNull();
  });

  it('shuffles selected waiting-room cards to the bottom of the main deck', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 5);
    setPlayerZones(state, 0, {
      mainDeckCardIds: [cardIds[0], cardIds[1]],
      waitingRoomCardIds: [cardIds[2], cardIds[3], cardIds[4]],
    });

    const result = shuffleWaitingRoomCardsToDeckBottomForPlayer(state, PLAYER1, [
      cardIds[3],
      cardIds[2],
    ]);

    expect(result).not.toBeNull();
    expect(result?.originalCardIds).toEqual([cardIds[3], cardIds[2]]);
    expect([...result!.movedCardIds].sort()).toEqual([cardIds[2], cardIds[3]].sort());
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([cardIds[4]]);
    expect(result?.gameState.players[0].mainDeck.cardIds.slice(0, 2)).toEqual([
      cardIds[0],
      cardIds[1],
    ]);
    expect(result?.gameState.players[0].mainDeck.cardIds.slice(2)).toEqual(result?.movedCardIds);
    expect(state.players[0].waitingRoom.cardIds).toEqual([cardIds[2], cardIds[3], cardIds[4]]);
    expect(state.players[0].mainDeck.cardIds).toEqual([cardIds[0], cardIds[1]]);
  });

  it('allows zero-card waiting-room shuffle to deck bottom without changing state', () => {
    const state = createMutableState();
    const result = shuffleWaitingRoomCardsToDeckBottomForPlayer(state, PLAYER1, []);

    expect(result).not.toBeNull();
    expect(result?.gameState).toBe(state);
    expect(result?.movedCardIds).toEqual([]);
    expect(result?.originalCardIds).toEqual([]);
  });

  it('rejects invalid waiting-room shuffle to deck bottom requests', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, {
      handCardIds: [cardIds[2]],
      mainDeckCardIds: [],
      waitingRoomCardIds: [cardIds[0], cardIds[1]],
    });

    expect(
      shuffleWaitingRoomCardsToDeckBottomForPlayer(state, PLAYER1, [cardIds[0], cardIds[0]])
    ).toBeNull();
    expect(shuffleWaitingRoomCardsToDeckBottomForPlayer(state, PLAYER1, [cardIds[2]])).toBeNull();
    expect(
      shuffleWaitingRoomCardsToDeckBottomForPlayer(state, 'missing-player', [cardIds[0]])
    ).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toEqual([cardIds[0], cardIds[1]]);
    expect(state.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('activates the requested number of waiting energy cards', () => {
    const state = createMutableState();
    const energyCardIds = ownedEnergyIds(state, PLAYER1, 4);
    setPlayerEnergyZone(state, 0, energyCardIds, {
      [energyCardIds[0]]: OrientationState.WAITING,
      [energyCardIds[1]]: OrientationState.ACTIVE,
      [energyCardIds[2]]: OrientationState.WAITING,
      [energyCardIds[3]]: OrientationState.WAITING,
    });

    const result = activateWaitingEnergyCardsForPlayer(state, PLAYER1, 2);

    expect(result).not.toBeNull();
    expect(result?.activatedEnergyCardIds).toEqual([energyCardIds[0], energyCardIds[2]]);
    expect(result?.previousOrientations).toEqual([
      { cardId: energyCardIds[0], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[2], orientation: OrientationState.WAITING },
    ]);
    expect(result?.nextOrientation).toBe(OrientationState.ACTIVE);
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

  it('returns null when there are not enough waiting energy cards and does not change state', () => {
    const state = createMutableState();
    const energyCardIds = ownedEnergyIds(state, PLAYER1, 3);
    setPlayerEnergyZone(state, 0, energyCardIds, {
      [energyCardIds[0]]: OrientationState.ACTIVE,
      [energyCardIds[1]]: OrientationState.WAITING,
      [energyCardIds[2]]: OrientationState.ACTIVE,
    });

    const result = activateWaitingEnergyCardsForPlayer(state, PLAYER1, 2);

    expect(result).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[0].energyZone.cardStates.get(energyCardIds[2])?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('allows zero waiting energy activation without changing state', () => {
    const state = createMutableState();
    const energyCardIds = ownedEnergyIds(state, PLAYER1, 2);
    setPlayerEnergyZone(state, 0, energyCardIds, {
      [energyCardIds[0]]: OrientationState.ACTIVE,
      [energyCardIds[1]]: OrientationState.WAITING,
    });

    const result = activateWaitingEnergyCardsForPlayer(state, PLAYER1, 0);

    expect(result).not.toBeNull();
    expect(result?.gameState).toBe(state);
    expect(result?.activatedEnergyCardIds).toEqual([]);
    expect(result?.previousOrientations).toEqual([]);
    expect(result?.nextOrientation).toBe(OrientationState.ACTIVE);
    expect(state.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('rejects invalid waiting energy activation counts or players', () => {
    const state = createMutableState();

    expect(activateWaitingEnergyCardsForPlayer(state, PLAYER1, -1)).toBeNull();
    expect(activateWaitingEnergyCardsForPlayer(state, PLAYER1, 1.5)).toBeNull();
    expect(activateWaitingEnergyCardsForPlayer(state, 'missing-player', 0)).toBeNull();
  });

  it('adds a source member BLADE live modifier without mutating the original state', () => {
    const state = createMutableState();
    const [sourceCardId] = ownedMemberIds(state, PLAYER1, 1);

    const result = addBladeLiveModifierForSourceMember(state, {
      playerId: PLAYER1,
      sourceCardId,
      abilityId: 'test-blade-ability',
      amount: 2,
    });

    expect(result).not.toBeNull();
    expect(result?.bladeBonus).toBe(2);
    expect(result?.modifier).toEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId,
      abilityId: 'test-blade-ability',
    });
    expect(result?.gameState.liveResolution.liveModifiers).toEqual([result?.modifier]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('rejects invalid source member BLADE modifier requests', () => {
    const state = createMutableState();
    const [player1MemberId] = ownedMemberIds(state, PLAYER1, 1);
    const [player2MemberId] = ownedMemberIds(state, PLAYER2, 1);
    const [energyCardId] = ownedEnergyIds(state, PLAYER1, 1);

    const baseOptions = {
      playerId: PLAYER1,
      sourceCardId: player1MemberId,
      abilityId: 'test-blade-ability',
      amount: 1,
    };

    expect(addBladeLiveModifierForSourceMember(state, { ...baseOptions, amount: 0 })).toBeNull();
    expect(addBladeLiveModifierForSourceMember(state, { ...baseOptions, amount: -1 })).toBeNull();
    expect(addBladeLiveModifierForSourceMember(state, { ...baseOptions, amount: 1.5 })).toBeNull();
    expect(
      addBladeLiveModifierForSourceMember(state, { ...baseOptions, playerId: 'missing-player' })
    ).toBeNull();
    expect(
      addBladeLiveModifierForSourceMember(state, {
        ...baseOptions,
        sourceCardId: 'missing-source',
      })
    ).toBeNull();
    expect(
      addBladeLiveModifierForSourceMember(state, {
        ...baseOptions,
        sourceCardId: energyCardId,
      })
    ).toBeNull();
    expect(
      addBladeLiveModifierForSourceMember(state, {
        ...baseOptions,
        sourceCardId: player2MemberId,
      })
    ).toBeNull();
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });
});
