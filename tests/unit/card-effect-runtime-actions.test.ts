import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createDrawEvent, createMemberSlotMovedEvent } from '../../src/domain/events/game-events';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  activateWaitingEnergyCardsForPlayer,
  addBladeLiveModifierForSourceMember,
  discardHandCardsToWaitingRoomForPlayer,
  discardOneHandCardToWaitingRoomForPlayer,
  drawCardsForEachPlayer,
  drawCardsForPlayer,
  moveWaitingRoomCardsToDeckBottomForPlayer,
  recoverCardsFromWaitingRoomToHandForPlayer,
  shuffleWaitingRoomCardsToDeckBottomForPlayer,
  stackMemberCardBelowSpecialMember,
} from '../../src/application/card-effects/runtime/actions';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../src/application/card-effects/runtime/enter-waiting-room-triggers';
import {
  moveTopDeckCardsToWaitingRoomAndEnqueueTriggers,
  moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers,
} from '../../src/application/card-effects/runtime/main-deck-waiting-room-triggers';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  revealHandCardForActiveEffect,
} from '../../src/application/card-effects/runtime/active-effect';
import { getNewMemberSlotMovedEvents } from '../../src/application/card-effects/runtime/events';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
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

function createStackHelperState(options: {
  readonly hostCardCode?: string;
  readonly hostSlot?: SlotPosition;
  readonly movedCardData?: AnyCardData;
  readonly movedSourceZone?: ZoneType.HAND | ZoneType.WAITING_ROOM;
}) {
  const host = createCardInstance(
    createMemberCard(options.hostCardCode ?? 'PL!HS-pb1-002-R'),
    PLAYER1,
    'special-host'
  );
  const moved = createCardInstance(
    options.movedCardData ?? createMemberCard('PL!HS-test-moved-member'),
    PLAYER1,
    'moved-card'
  );
  const hostSlot = options.hostSlot ?? SlotPosition.CENTER;
  const movedSourceZone = options.movedSourceZone ?? ZoneType.HAND;
  let game = createGameState('stack-member-below-helper', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  game = registerCards(game, [host, moved]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, hostSlot, host.instanceId),
    hand:
      movedSourceZone === ZoneType.HAND
        ? addCardToZone(player.hand, moved.instanceId)
        : player.hand,
    waitingRoom:
      movedSourceZone === ZoneType.WAITING_ROOM
        ? addCardToZone(player.waitingRoom, moved.instanceId)
        : player.waitingRoom,
  }));

  return { game, host, moved, hostSlot, movedSourceZone };
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

function withRevealHandActiveEffect(
  state: GameState,
  options: {
    readonly selectableCardIds: readonly string[];
    readonly revealedCardIds?: readonly string[];
  }
): GameState {
  return {
    ...state,
    activeEffect: {
      id: 'effect-1',
      abilityId: 'test:reveal-hand',
      sourceCardId: 'source-card',
      controllerId: PLAYER1,
      effectText: '公开手牌测试',
      stepId: 'SELECT_HAND',
      stepText: '选择手牌',
      awaitingPlayerId: PLAYER1,
      selectableCardIds: options.selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      revealedCardIds: options.revealedCardIds,
      selectionLabel: '选择要公开的手牌',
      confirmSelectionLabel: '公开',
      canSkipSelection: true,
      skipSelectionLabel: '不公开',
      metadata: {
        orderedResolution: true,
      },
    },
  };
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
    expect(result?.enterWaitingRoomEvent).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      cardInstanceId: cardIds[1],
      cardInstanceIds: [cardIds[1], cardIds[3]],
      fromZone: ZoneType.HAND,
      toZone: ZoneType.WAITING_ROOM,
      ownerId: PLAYER1,
      controllerId: PLAYER1,
    });
    expect(result?.gameState.eventLog.map((entry) => entry.event)).toEqual([
      result?.enterWaitingRoomEvent,
    ]);
  });

  it('does not record a hand-to-waiting-room event for zero discarded cards', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 2);
    setPlayerZones(state, 0, { handCardIds: cardIds, mainDeckCardIds: [] });

    const result = discardHandCardsToWaitingRoomForPlayer(state, PLAYER1, [], {
      count: 0,
      candidateCardIds: cardIds,
    });

    expect(result).not.toBeNull();
    expect(result?.discardedCardIds).toEqual([]);
    expect(result?.enterWaitingRoomEvent).toBeUndefined();
    expect(result?.gameState).toBe(state);
    expect(result?.gameState.eventLog).toEqual([]);
  });

  it('wraps hand discard with enter-waiting-room trigger enqueue', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 4);
    setPlayerZones(state, 0, { handCardIds: cardIds, mainDeckCardIds: [] });
    const calls: {
      readonly triggerConditions: readonly TriggerCondition[];
      readonly eventCardIds: readonly string[];
    }[] = [];
    const enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom = (
      game,
      triggerConditions,
      options
    ) => {
      calls.push({
        triggerConditions,
        eventCardIds: options?.enterWaitingRoomEvents?.[0]?.cardInstanceIds ?? [],
      });
      return { ...game, turnNumber: game.turnNumber + 1 };
    };

    const result = discardHandCardsToWaitingRoomAndEnqueueTriggers(
      state,
      PLAYER1,
      [cardIds[0], cardIds[2]],
      {
        count: 2,
        candidateCardIds: cardIds,
      },
      enqueueTriggeredCardEffects
    );

    expect(result).not.toBeNull();
    expect(result?.discardedCardIds).toEqual([cardIds[0], cardIds[2]]);
    expect(result?.enterWaitingRoomEvent?.cardInstanceIds).toEqual([cardIds[0], cardIds[2]]);
    expect(result?.gameState.turnNumber).toBe(state.turnNumber + 1);
    expect(calls).toEqual([
      {
        triggerConditions: [TriggerCondition.ON_ENTER_WAITING_ROOM],
        eventCardIds: [cardIds[0], cardIds[2]],
      },
    ]);
  });

  it('does not enqueue enter-waiting-room triggers for a zero-card wrapper discard', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 2);
    setPlayerZones(state, 0, { handCardIds: cardIds, mainDeckCardIds: [] });
    let enqueueCallCount = 0;
    const enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom = (game) => {
      enqueueCallCount += 1;
      return { ...game, turnNumber: game.turnNumber + 1 };
    };

    const result = discardHandCardsToWaitingRoomAndEnqueueTriggers(
      state,
      PLAYER1,
      [],
      {
        count: 0,
        candidateCardIds: cardIds,
      },
      enqueueTriggeredCardEffects
    );

    expect(result).not.toBeNull();
    expect(result?.discardedCardIds).toEqual([]);
    expect(result?.enterWaitingRoomEvent).toBeUndefined();
    expect(result?.gameState).toBe(state);
    expect(enqueueCallCount).toBe(0);
  });

  it('moves top deck cards to waiting room and enqueues a main-deck enter-waiting-room event', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 4);
    setPlayerZones(state, 0, { mainDeckCardIds: cardIds });
    const calls: {
      readonly triggerConditions: readonly TriggerCondition[];
      readonly eventCardIds: readonly string[];
      readonly eventFromZone: ZoneType | undefined;
      readonly eventOwnerId: string | undefined;
      readonly eventControllerId: string | undefined;
      readonly emittedEventCount: number;
    }[] = [];
    const enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom = (
      game,
      triggerConditions,
      options
    ) => {
      const event = options?.enterWaitingRoomEvents?.[0];
      calls.push({
        triggerConditions,
        eventCardIds: event?.cardInstanceIds ?? [],
        eventFromZone: event?.fromZone,
        eventOwnerId: event?.ownerId,
        eventControllerId: event?.controllerId,
        emittedEventCount: game.eventLog.length,
      });
      return { ...game, turnNumber: game.turnNumber + 1 };
    };

    const result = moveTopDeckCardsToWaitingRoomAndEnqueueTriggers(
      state,
      PLAYER1,
      2,
      enqueueTriggeredCardEffects
    );

    expect(result).not.toBeNull();
    expect(result?.movedCardIds).toEqual(cardIds.slice(0, 2));
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual(cardIds.slice(2));
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual(cardIds.slice(0, 2));
    expect(result?.gameState.turnNumber).toBe(state.turnNumber + 1);
    expect(calls).toEqual([
      {
        triggerConditions: [TriggerCondition.ON_ENTER_WAITING_ROOM],
        eventCardIds: cardIds.slice(0, 2),
        eventFromZone: ZoneType.MAIN_DECK,
        eventOwnerId: PLAYER1,
        eventControllerId: PLAYER1,
        emittedEventCount: 1,
      },
    ]);
  });

  it('does not enqueue main-deck enter-waiting-room triggers for zero moved cards', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 2);
    setPlayerZones(state, 0, { mainDeckCardIds: cardIds });
    let enqueueCallCount = 0;
    const enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom = (game) => {
      enqueueCallCount += 1;
      return { ...game, turnNumber: game.turnNumber + 1 };
    };

    const zeroCountResult = moveTopDeckCardsToWaitingRoomAndEnqueueTriggers(
      state,
      PLAYER1,
      0,
      enqueueTriggeredCardEffects
    );
    expect(zeroCountResult).not.toBeNull();
    expect(zeroCountResult?.movedCardIds).toEqual([]);
    expect(zeroCountResult?.gameState.players[0].mainDeck.cardIds).toEqual(cardIds);
    expect(zeroCountResult?.gameState.players[0].waitingRoom.cardIds).toEqual([]);
    expect(enqueueCallCount).toBe(0);

    const emptyDeckState = createMutableState();
    setPlayerZones(emptyDeckState, 0, { mainDeckCardIds: [] });
    const emptyDeckResult = moveTopDeckCardsToWaitingRoomAndEnqueueTriggers(
      emptyDeckState,
      PLAYER1,
      3,
      enqueueTriggeredCardEffects
    );
    expect(emptyDeckResult).not.toBeNull();
    expect(emptyDeckResult?.movedCardIds).toEqual([]);
    expect(emptyDeckResult?.gameState.players[0].mainDeck.cardIds).toEqual([]);
    expect(emptyDeckResult?.gameState.players[0].waitingRoom.cardIds).toEqual([]);
    expect(enqueueCallCount).toBe(0);
  });

  it('enqueues only actually milled top cards after refresh', () => {
    const state = createMutableState();
    const waitingCardIds = ownedMemberIds(state, PLAYER1, 5);
    setPlayerZones(state, 0, { mainDeckCardIds: [], waitingRoomCardIds: waitingCardIds });
    const calls: {
      readonly triggerConditions: readonly TriggerCondition[];
      readonly eventCardIds: readonly string[];
      readonly eventFromZone: ZoneType | undefined;
      readonly waitingRoomSizeAtEnqueue: number;
    }[] = [];
    const enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom = (
      game,
      triggerConditions,
      options
    ) => {
      calls.push({
        triggerConditions,
        eventCardIds: options?.enterWaitingRoomEvents?.[0]?.cardInstanceIds ?? [],
        eventFromZone: options?.enterWaitingRoomEvents?.[0]?.fromZone,
        waitingRoomSizeAtEnqueue: game.players[0].waitingRoom.cardIds.length,
      });
      return game;
    };

    const result = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
      state,
      PLAYER1,
      2,
      enqueueTriggeredCardEffects
    );

    expect(result).not.toBeNull();
    expect(result?.refreshCount).toBe(1);
    expect(result?.movedCardIds).toHaveLength(2);
    expect(result?.movedCardIds.every((cardId) => waitingCardIds.includes(cardId))).toBe(true);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual(result?.movedCardIds);
    expect(result?.gameState.players[0].mainDeck.cardIds).toHaveLength(3);
    expect(calls).toEqual([
      {
        triggerConditions: [TriggerCondition.ON_ENTER_WAITING_ROOM],
        eventCardIds: result?.movedCardIds ?? [],
        eventFromZone: ZoneType.MAIN_DECK,
        waitingRoomSizeAtEnqueue: 2,
      },
    ]);
  });

  it('prepares main-deck enter-waiting-room game state before enqueue without changing move metadata', () => {
    const state = createMutableState();
    const waitingCardIds = ownedMemberIds(state, PLAYER1, 4);
    setPlayerZones(state, 0, { mainDeckCardIds: [], waitingRoomCardIds: waitingCardIds });
    let preparedMovedCardIds: readonly string[] = [];
    let preparedRefreshCount = -1;
    const calls: {
      readonly actionStep: unknown;
      readonly actionMovedCardIds: unknown;
      readonly actionRefreshCount: unknown;
      readonly eventCardIds: readonly string[];
    }[] = [];
    const enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom = (
      game,
      _triggerConditions,
      options
    ) => {
      const action = game.actionHistory.at(-1);
      calls.push({
        actionStep: action?.payload.step,
        actionMovedCardIds: action?.payload.movedCardIds,
        actionRefreshCount: action?.payload.refreshCount,
        eventCardIds: options?.enterWaitingRoomEvents?.[0]?.cardInstanceIds ?? [],
      });
      return game;
    };

    const result = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
      state,
      PLAYER1,
      2,
      enqueueTriggeredCardEffects,
      {
        prepareGameStateBeforeEnqueue: (game, movedCardIds, refreshCount) => {
          preparedMovedCardIds = movedCardIds;
          preparedRefreshCount = refreshCount;
          return addAction(game, 'RESOLVE_ABILITY', PLAYER1, {
            step: 'PREPARE_MAIN_DECK_WAITING_ROOM_TEST',
            movedCardIds,
            refreshCount,
          });
        },
      }
    );

    expect(result).not.toBeNull();
    expect(result?.refreshCount).toBe(1);
    expect(result?.movedCardIds).toHaveLength(2);
    expect(preparedMovedCardIds).toEqual(result?.movedCardIds);
    expect(preparedRefreshCount).toBe(result?.refreshCount);
    expect(calls).toEqual([
      {
        actionStep: 'PREPARE_MAIN_DECK_WAITING_ROOM_TEST',
        actionMovedCardIds: result?.movedCardIds,
        actionRefreshCount: result?.refreshCount,
        eventCardIds: result?.movedCardIds ?? [],
      },
    ]);
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
    expect(result?.enterWaitingRoomEvent?.cardInstanceIds).toEqual([cardIds[1]]);
    expect(result?.gameState.players[0].hand.cardIds).toEqual([cardIds[0], cardIds[2]]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([cardIds[1]]);
  });

  it('wraps one-card hand discard with enter-waiting-room trigger enqueue', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, { handCardIds: cardIds, mainDeckCardIds: [] });
    const calls: TriggerCondition[][] = [];
    const enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom = (
      game,
      triggerConditions
    ) => {
      calls.push([...triggerConditions]);
      return { ...game, turnNumber: game.turnNumber + 1 };
    };

    const result = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
      state,
      PLAYER1,
      cardIds[1],
      {
        candidateCardIds: [cardIds[1]],
      },
      enqueueTriggeredCardEffects
    );

    expect(result).not.toBeNull();
    expect(result?.discardedCardIds).toEqual([cardIds[1]]);
    expect(result?.gameState.turnNumber).toBe(state.turnNumber + 1);
    expect(calls).toEqual([[TriggerCondition.ON_ENTER_WAITING_ROOM]]);
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

  it('reveals a selected hand card for the active effect and advances to the next step', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, { handCardIds: cardIds, mainDeckCardIds: [] });
    const activeState = withRevealHandActiveEffect(state, {
      selectableCardIds: [cardIds[0], cardIds[1]],
    });

    const result = revealHandCardForActiveEffect(activeState, {
      effect: activeState.activeEffect!,
      playerId: PLAYER1,
      selectedCardId: cardIds[1],
      nextStepId: 'CONFIRM_REVEALED',
      nextStepText: '已公开手牌',
      selectableCardIds: [],
      metadata: { revealedHandCardId: cardIds[1] },
      actionStep: 'REVEAL_HAND_CARD',
      actionPayload: { revealedHandCardId: cardIds[1] },
    });

    expect(result.activeEffect?.stepId).toBe('CONFIRM_REVEALED');
    expect(result.activeEffect?.stepText).toBe('已公开手牌');
    expect(result.activeEffect?.revealedCardIds).toEqual([cardIds[1]]);
    expect(result.activeEffect?.selectableCardIds).toEqual([]);
    expect(result.activeEffect?.selectableCardVisibility).toBe('PUBLIC');
    expect(result.activeEffect?.metadata).toEqual({
      orderedResolution: true,
      revealedHandCardId: cardIds[1],
    });
    expect(result.actionHistory.at(-1)?.payload).toMatchObject({
      pendingAbilityId: 'effect-1',
      abilityId: 'test:reveal-hand',
      sourceCardId: 'source-card',
      step: 'REVEAL_HAND_CARD',
      revealedHandCardId: cardIds[1],
    });
  });

  it('preserves and deduplicates existing active-effect revealed hand cards', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, { handCardIds: cardIds, mainDeckCardIds: [] });
    const activeState = withRevealHandActiveEffect(state, {
      selectableCardIds: [cardIds[1], cardIds[2]],
      revealedCardIds: [cardIds[0], cardIds[1]],
    });

    const result = revealHandCardForActiveEffect(activeState, {
      effect: activeState.activeEffect!,
      playerId: PLAYER1,
      selectedCardId: cardIds[1],
      nextStepId: 'CONFIRM_REVEALED',
      nextStepText: '已公开手牌',
      actionStep: 'REVEAL_HAND_CARD',
    });

    expect(result.activeEffect?.revealedCardIds).toEqual([cardIds[0], cardIds[1]]);
  });

  it('does not update reveal-from-hand effects for invalid candidates, missing hand cards, or missing players', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 3);
    setPlayerZones(state, 0, { handCardIds: [cardIds[0]], mainDeckCardIds: [cardIds[2]] });
    const activeState = withRevealHandActiveEffect(state, {
      selectableCardIds: [cardIds[0], cardIds[1]],
    });
    const baseOptions = {
      effect: activeState.activeEffect!,
      nextStepId: 'CONFIRM_REVEALED',
      nextStepText: '已公开手牌',
      actionStep: 'REVEAL_HAND_CARD',
    };

    expect(
      revealHandCardForActiveEffect(activeState, {
        ...baseOptions,
        playerId: PLAYER1,
        selectedCardId: cardIds[2],
      })
    ).toBe(activeState);
    expect(
      revealHandCardForActiveEffect(activeState, {
        ...baseOptions,
        playerId: PLAYER1,
        selectedCardId: cardIds[1],
      })
    ).toBe(activeState);
    expect(
      revealHandCardForActiveEffect(activeState, {
        ...baseOptions,
        playerId: 'missing-player',
        selectedCardId: cardIds[0],
      })
    ).toBe(activeState);
    expect(activeState.actionHistory).toEqual(state.actionHistory);
  });

  it('creates the default optional discard-one-hand activeEffect shell', () => {
    const activeEffect = createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability: {
        id: 'pending-1',
        abilityId: 'test:optional-discard',
        sourceCardId: 'source-card',
        controllerId: PLAYER1,
      },
      playerId: PLAYER1,
      effectText: '弃1张手牌测试',
      stepId: 'SELECT_DISCARD',
      selectableCardIds: ['hand-1', 'hand-2'],
      orderedResolution: false,
    });

    expect(activeEffect).toMatchObject({
      id: 'pending-1',
      abilityId: 'test:optional-discard',
      sourceCardId: 'source-card',
      controllerId: PLAYER1,
      effectText: '弃1张手牌测试',
      stepId: 'SELECT_DISCARD',
      stepText: '请选择要放置入休息室的手牌。也可以选择不发动此效果。',
      awaitingPlayerId: PLAYER1,
      selectableCardIds: ['hand-1', 'hand-2'],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '请选择要放置入休息室的卡牌',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(activeEffect.metadata).toMatchObject({
      orderedResolution: false,
      effectCosts: [
        {
          kind: 'DISCARD_HAND_TO_WAITING_ROOM',
          minCount: 1,
          maxCount: 1,
          optional: true,
        },
      ],
      handToWaitingRoomCost: {
        minCount: 1,
        maxCount: 1,
        optional: true,
      },
    });
  });

  it('merges optional discard metadata patches with orderedResolution and cost metadata', () => {
    const activeEffect = createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability: {
        id: 'pending-1',
        abilityId: 'test:optional-discard',
        sourceCardId: 'source-card',
        controllerId: PLAYER1,
      },
      playerId: PLAYER1,
      effectText: '弃1张手牌测试',
      stepId: 'SELECT_DISCARD',
      selectableCardIds: ['hand-1'],
      orderedResolution: true,
      metadata: {
        sourceSlot: 'CENTER',
        orderedResolution: false,
      },
    });

    expect(activeEffect.metadata).toMatchObject({
      sourceSlot: 'CENTER',
      orderedResolution: true,
      effectCosts: [
        {
          kind: 'DISCARD_HAND_TO_WAITING_ROOM',
          minCount: 1,
          maxCount: 1,
          optional: true,
        },
      ],
      handToWaitingRoomCost: {
        minCount: 1,
        maxCount: 1,
        optional: true,
      },
    });
  });

  it('keeps optional discard selectableCardIds and label overrides caller-owned', () => {
    const selectableCardIds = ['hand-1', 'hand-2'];
    const activeEffect = createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability: {
        id: 'pending-1',
        abilityId: 'test:optional-discard',
        sourceCardId: 'source-card',
        controllerId: PLAYER1,
      },
      playerId: PLAYER1,
      effectText: '弃1张手牌测试',
      stepId: 'SELECT_DISCARD',
      selectableCardIds,
      orderedResolution: false,
      stepText: '自定义弃手说明',
      selectionLabel: '自定义选择标签',
      skipSelectionLabel: '自定义跳过',
    });

    expect(activeEffect.selectableCardIds).toEqual(selectableCardIds);
    expect(activeEffect.stepText).toBe('自定义弃手说明');
    expect(activeEffect.selectionLabel).toBe('自定义选择标签');
    expect(activeEffect.skipSelectionLabel).toBe('自定义跳过');
  });

  it('returns only newly added member-slot-moved events from the event log delta', () => {
    let before = createMutableState();
    const oldSlotMovedEvent = createMemberSlotMovedEvent(
      'old-member',
      PLAYER1,
      SlotPosition.LEFT,
      SlotPosition.CENTER
    );
    before = emitGameEvent(before, oldSlotMovedEvent);

    const newSlotMovedEvent = createMemberSlotMovedEvent(
      'new-member',
      PLAYER1,
      SlotPosition.CENTER,
      SlotPosition.RIGHT
    );
    const afterDrawEvent = createDrawEvent(PLAYER1, ['drawn-card'], 1);
    let after = emitGameEvent(before, afterDrawEvent);
    after = emitGameEvent(after, newSlotMovedEvent);

    expect(getNewMemberSlotMovedEvents(before, after)).toEqual([newSlotMovedEvent]);
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

  it('moves selected waiting-room cards to deck bottom in caller order', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 5);
    setPlayerZones(state, 0, {
      mainDeckCardIds: [cardIds[0], cardIds[1]],
      waitingRoomCardIds: [cardIds[2], cardIds[3], cardIds[4]],
    });

    const result = moveWaitingRoomCardsToDeckBottomForPlayer(
      state,
      PLAYER1,
      [cardIds[3], cardIds[2]],
      {
        candidateCardIds: [cardIds[2], cardIds[3], cardIds[4]],
        minCount: 0,
        maxCount: 2,
      }
    );

    expect(result).not.toBeNull();
    expect(result?.movedCardIds).toEqual([cardIds[3], cardIds[2]]);
    expect(result?.selectedCardIds).toEqual([cardIds[3], cardIds[2]]);
    expect(result?.remainingCandidateIds).toEqual([cardIds[4]]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([cardIds[4]]);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual([
      cardIds[0],
      cardIds[1],
      cardIds[3],
      cardIds[2],
    ]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([cardIds[2], cardIds[3], cardIds[4]]);
    expect(state.players[0].mainDeck.cardIds).toEqual([cardIds[0], cardIds[1]]);
  });

  it('allows zero-card ordered waiting-room move to deck bottom without changing state', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 2);
    setPlayerZones(state, 0, {
      mainDeckCardIds: [cardIds[0]],
      waitingRoomCardIds: [cardIds[1]],
    });

    const result = moveWaitingRoomCardsToDeckBottomForPlayer(state, PLAYER1, [], {
      candidateCardIds: [cardIds[1]],
      minCount: 0,
      maxCount: 2,
    });

    expect(result).not.toBeNull();
    expect(result?.gameState).toBe(state);
    expect(result?.movedCardIds).toEqual([]);
    expect(result?.selectedCardIds).toEqual([]);
    expect(result?.remainingCandidateIds).toEqual([cardIds[1]]);
  });

  it('rejects invalid ordered waiting-room moves to deck bottom', () => {
    const state = createMutableState();
    const cardIds = ownedMemberIds(state, PLAYER1, 5);
    setPlayerZones(state, 0, {
      handCardIds: [cardIds[4]],
      mainDeckCardIds: [],
      waitingRoomCardIds: [cardIds[0], cardIds[1], cardIds[2], cardIds[3]],
    });
    const options = {
      candidateCardIds: [cardIds[0], cardIds[1], cardIds[2]],
      minCount: 0,
      maxCount: 2,
    };

    expect(
      moveWaitingRoomCardsToDeckBottomForPlayer(state, PLAYER1, [cardIds[0], cardIds[0]], options)
    ).toBeNull();
    expect(
      moveWaitingRoomCardsToDeckBottomForPlayer(state, PLAYER1, [cardIds[4]], {
        ...options,
        candidateCardIds: [cardIds[4]],
      })
    ).toBeNull();
    expect(moveWaitingRoomCardsToDeckBottomForPlayer(state, PLAYER1, [cardIds[3]], options)).toBeNull();
    expect(
      moveWaitingRoomCardsToDeckBottomForPlayer(
        state,
        PLAYER1,
        [cardIds[0], cardIds[1], cardIds[2]],
        options
      )
    ).toBeNull();
    expect(moveWaitingRoomCardsToDeckBottomForPlayer(state, 'missing-player', [cardIds[0]], options)).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      cardIds[0],
      cardIds[1],
      cardIds[2],
      cardIds[3],
    ]);
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

  it('moves a member card from hand below a special member without enqueueing triggers', () => {
    const { game, host, moved, hostSlot } = createStackHelperState({});

    const result = stackMemberCardBelowSpecialMember(game, {
      playerId: PLAYER1,
      sourceZone: ZoneType.HAND,
      movedCardId: moved.instanceId,
      hostCardId: host.instanceId,
      targetSlot: hostSlot,
    });

    expect(result).toMatchObject({
      movedCardId: moved.instanceId,
      sourceZone: ZoneType.HAND,
      hostCardId: host.instanceId,
      targetSlot: hostSlot,
    });
    expect(result?.gameState.players[0].hand.cardIds).not.toContain(moved.instanceId);
    expect(result?.gameState.players[0].memberSlots.memberBelow[hostSlot]).toEqual([
      moved.instanceId,
    ]);
    expect(result?.gameState.players[0].memberSlots.slots[hostSlot]).toBe(host.instanceId);
    expect(result?.gameState.eventLog).toEqual([]);
    expect(result?.gameState.pendingAbilities).toEqual([]);
  });

  it('moves a member card from waiting room below a special member', () => {
    const { game, host, moved, hostSlot } = createStackHelperState({
      movedSourceZone: ZoneType.WAITING_ROOM,
    });

    const result = stackMemberCardBelowSpecialMember(game, {
      playerId: PLAYER1,
      sourceZone: ZoneType.WAITING_ROOM,
      movedCardId: moved.instanceId,
      hostCardId: host.instanceId,
      targetSlot: hostSlot,
    });

    expect(result).not.toBeNull();
    expect(result?.gameState.players[0].waitingRoom.cardIds).not.toContain(moved.instanceId);
    expect(result?.gameState.players[0].memberSlots.memberBelow[hostSlot]).toEqual([
      moved.instanceId,
    ]);
  });

  it('rejects non-special hosts, empty target slots, non-member cards, wrong source zones, and duplicates', () => {
    const nonSpecialHostState = createStackHelperState({ hostCardCode: 'PL!HS-test-normal-host' });
    expect(
      stackMemberCardBelowSpecialMember(nonSpecialHostState.game, {
        playerId: PLAYER1,
        sourceZone: ZoneType.HAND,
        movedCardId: nonSpecialHostState.moved.instanceId,
        hostCardId: nonSpecialHostState.host.instanceId,
        targetSlot: nonSpecialHostState.hostSlot,
      })
    ).toBeNull();

    const emptySlotState = createStackHelperState({});
    expect(
      stackMemberCardBelowSpecialMember(emptySlotState.game, {
        playerId: PLAYER1,
        sourceZone: ZoneType.HAND,
        movedCardId: emptySlotState.moved.instanceId,
        hostCardId: emptySlotState.host.instanceId,
        targetSlot: SlotPosition.RIGHT,
      })
    ).toBeNull();
    expect(emptySlotState.game.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBeNull();
    expect(emptySlotState.game.players[0].hand.cardIds).toContain(emptySlotState.moved.instanceId);

    const nonMemberState = createStackHelperState({
      movedCardData: createEnergyCard('PL!HS-test-energy'),
    });
    expect(
      stackMemberCardBelowSpecialMember(nonMemberState.game, {
        playerId: PLAYER1,
        sourceZone: ZoneType.HAND,
        movedCardId: nonMemberState.moved.instanceId,
        hostCardId: nonMemberState.host.instanceId,
        targetSlot: nonMemberState.hostSlot,
      })
    ).toBeNull();

    const wrongSourceState = createStackHelperState({ movedSourceZone: ZoneType.HAND });
    expect(
      stackMemberCardBelowSpecialMember(wrongSourceState.game, {
        playerId: PLAYER1,
        sourceZone: ZoneType.WAITING_ROOM,
        movedCardId: wrongSourceState.moved.instanceId,
        hostCardId: wrongSourceState.host.instanceId,
        targetSlot: wrongSourceState.hostSlot,
      })
    ).toBeNull();

    const duplicateResult = stackMemberCardBelowSpecialMember(emptySlotState.game, {
      playerId: PLAYER1,
      sourceZone: ZoneType.HAND,
      movedCardId: emptySlotState.moved.instanceId,
      hostCardId: emptySlotState.host.instanceId,
      targetSlot: emptySlotState.hostSlot,
    });
    expect(duplicateResult).not.toBeNull();
    const invalidDuplicateState = updatePlayer(duplicateResult!.gameState, PLAYER1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, emptySlotState.moved.instanceId),
    }));
    expect(
      stackMemberCardBelowSpecialMember(invalidDuplicateState, {
        playerId: PLAYER1,
        sourceZone: ZoneType.HAND,
        movedCardId: emptySlotState.moved.instanceId,
        hostCardId: emptySlotState.host.instanceId,
        targetSlot: emptySlotState.hostSlot,
      })
    ).toBeNull();
  });
});
