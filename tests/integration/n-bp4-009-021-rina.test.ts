import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addMemberCostLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_009_LIVE_START_DRAW_TWO_HAND_TO_DECK_TOP_LOW_STAGE_COST_ABILITY_ID,
  PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupBp4009Scenario(options: {
  readonly sourceCost?: number;
  readonly opponentCost: number;
  readonly sourceCostDelta?: number;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly mainDeckCards: readonly ReturnType<typeof createCardInstance>[];
}): GameState {
  const source = createCardInstance(
    createMember('PL!N-bp4-009-R', { name: '天王寺璃奈', cost: options.sourceCost ?? 13 }),
    PLAYER1,
    'n-bp4-009-source'
  );
  const opponent = createCardInstance(
    createMember('opponent-member', { cost: options.opponentCost }),
    PLAYER2,
    'opponent-member'
  );
  const handCards = [...(options.handCards ?? [])];
  const mainDeckCards = [...options.mainDeckCards];

  let game = createGameState('n-bp4-009-rina', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, opponent, ...handCards, ...mainDeckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: mainDeckCards.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = { ...game, liveResolution: { ...game.liveResolution, performingPlayerId: PLAYER1 } };

  if (options.sourceCostDelta !== undefined) {
    const modifierResult = addMemberCostLiveModifierForMember(game, {
      playerId: PLAYER1,
      memberCardId: source.instanceId,
      sourceCardId: source.instanceId,
      abilityId: 'test:effective-cost-modifier',
      countDelta: options.sourceCostDelta,
    });
    expect(modifierResult).toBeTruthy();
    game = modifierResult!.gameState;
  }

  return game;
}

function setupBp4021Scenario(options: {
  readonly waitingRoomCards: readonly ReturnType<typeof createCardInstance>[];
  readonly mainDeckCards?: readonly ReturnType<typeof createCardInstance>[];
}): GameState {
  const source = createCardInstance(
    createMember('PL!N-bp4-021-N', { name: '天王寺璃奈', cost: 9 }),
    PLAYER1,
    'n-bp4-021-source'
  );
  const waitingRoomCards = [...options.waitingRoomCards];
  const mainDeckCards = [...(options.mainDeckCards ?? [])];
  let game = createGameState('n-bp4-021-rina', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...waitingRoomCards, ...mainDeckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: mainDeckCards.map((card) => card.instanceId) },
    waitingRoom: waitingRoomCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));

  return emitGameEvent(game, {
    eventId: 'enter-n-bp4-021-rina',
    eventType: TriggerCondition.ON_ENTER_STAGE,
    timestamp: Date.now(),
    cardInstanceId: source.instanceId,
    fromZone: ZoneType.HAND,
    toZone: ZoneType.MEMBER_SLOT,
    toSlot: SlotPosition.CENTER,
    ownerId: PLAYER1,
    controllerId: PLAYER1,
  });
}

function startTiming(game: GameState, triggerCondition: TriggerCondition): GameState {
  const result = new GameService().executeCheckTiming(game, [triggerCondition]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function attachSession(state: GameState) {
  const session = createGameSession();
  session.createGame('n-bp4-009-021-rina-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function confirmSelection(
  session: ReturnType<typeof createGameSession>,
  selectedCardId?: string | null
): void {
  const effect = session.state?.activeEffect;
  expect(effect).toBeTruthy();
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effect!.id, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
  if (session.state?.activeEffect?.stepId === 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION') {
    const confirmed = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effect!.id)
    );
    expect(confirmed.success, confirmed.error).toBe(true);
  }
}

describe('PL!N-bp4-009 Rina live-start workflow', () => {
  it('draws two when effective stage cost is lower, then returns the selected hand card to deck top', () => {
    const existingHand = createCardInstance(createMember('existing-hand'), PLAYER1, 'existing-hand');
    const drawnOne = createCardInstance(createMember('drawn-one'), PLAYER1, 'drawn-one');
    const drawnTwo = createCardInstance(createMember('drawn-two'), PLAYER1, 'drawn-two');
    const deckRest = createCardInstance(createMember('deck-rest'), PLAYER1, 'deck-rest');
    const state = startTiming(
      setupBp4009Scenario({
        opponentCost: 10,
        sourceCostDelta: -5,
        handCards: [existingHand],
        mainDeckCards: [drawnOne, drawnTwo, deckRest],
      }),
      TriggerCondition.ON_LIVE_START
    );
    const session = attachSession(state);

    expect(session.state?.activeEffect?.abilityId).toBe(
      PL_N_BP4_009_LIVE_START_DRAW_TWO_HAND_TO_DECK_TOP_LOW_STAGE_COST_ABILITY_ID
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([
      existingHand.instanceId,
      drawnOne.instanceId,
      drawnTwo.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckRest.instanceId]);

    confirmSelection(session, existingHand.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      drawnOne.instanceId,
      drawnTwo.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      existingHand.instanceId,
      deckRest.instanceId,
    ]);
  });

  it('consumes the pending ability as no-op when own effective stage cost is not lower', () => {
    const drawnOne = createCardInstance(createMember('drawn-one'), PLAYER1, 'drawn-one');
    const state = startTiming(
      setupBp4009Scenario({
        opponentCost: 10,
        mainDeckCards: [drawnOne],
      }),
      TriggerCondition.ON_LIVE_START
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.players[0].mainDeck.cardIds).toEqual([drawnOne.instanceId]);
  });

  it('can return a newly drawn card, and rejects illegal or stale selections', () => {
    const drawnOne = createCardInstance(createMember('drawn-one'), PLAYER1, 'drawn-one');
    const drawnTwo = createCardInstance(createMember('drawn-two'), PLAYER1, 'drawn-two');
    const deckRest = createCardInstance(createMember('deck-rest'), PLAYER1, 'deck-rest');
    const illegalCard = createCardInstance(createMember('illegal-card'), PLAYER1, 'illegal-card');
    const state = startTiming(
      setupBp4009Scenario({
        opponentCost: 10,
        sourceCostDelta: -5,
        mainDeckCards: [drawnOne, drawnTwo, deckRest],
      }),
      TriggerCondition.ON_LIVE_START
    );
    const effect = state.activeEffect;
    expect(effect).toBeTruthy();

    const illegalResult = confirmActiveEffectStepThroughPublicReveal(
      state,
      PLAYER1,
      effect!.id,
      illegalCard.instanceId
    );
    expect(illegalResult.activeEffect).toBeTruthy();
    expect(illegalResult.players[0].mainDeck.cardIds).toEqual([deckRest.instanceId]);

    const staleState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((cardId) => cardId !== drawnOne.instanceId),
      },
    }));
    const staleResult = confirmActiveEffectStepThroughPublicReveal(staleState, PLAYER1, effect!.id, drawnOne.instanceId);
    expect(staleResult.activeEffect).toBeTruthy();
    expect(staleResult.players[0].mainDeck.cardIds).toEqual([deckRest.instanceId]);

    const session = attachSession(state);
    confirmSelection(session, drawnTwo.instanceId);

    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      drawnTwo.instanceId,
      deckRest.instanceId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toEqual([drawnOne.instanceId]);
  });
});

describe('PL!N-bp4-021 Rina on-enter workflow', () => {
  it('opens an optional waiting-room selection and puts the selected card on deck top', () => {
    const target = createCardInstance(createMember('waiting-target'), PLAYER1, 'waiting-target');
    const other = createCardInstance(createMember('waiting-other'), PLAYER1, 'waiting-other');
    const deckTop = createCardInstance(createMember('deck-top'), PLAYER1, 'deck-top');
    const state = startTiming(
      setupBp4021Scenario({
        waitingRoomCards: [target, other],
        mainDeckCards: [deckTop],
      }),
      TriggerCondition.ON_ENTER_STAGE
    );
    const session = attachSession(state);

    expect(session.state?.activeEffect?.abilityId).toBe(
      PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID
    );
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不发动');

    confirmSelection(session, target.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([other.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      target.instanceId,
      deckTop.instanceId,
    ]);
  });

  it('can decline without moving a waiting-room card', () => {
    const target = createCardInstance(createMember('waiting-target'), PLAYER1, 'waiting-target');
    const deckTop = createCardInstance(createMember('deck-top'), PLAYER1, 'deck-top');
    const state = startTiming(
      setupBp4021Scenario({
        waitingRoomCards: [target],
        mainDeckCards: [deckTop],
      }),
      TriggerCondition.ON_ENTER_STAGE
    );
    const session = attachSession(state);

    confirmSelection(session, null);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckTop.instanceId]);
    expect(session.state?.pendingAbilities).toHaveLength(0);
  });

  it('consumes the pending ability as no-op when waiting room is empty', () => {
    const deckTop = createCardInstance(createMember('deck-top'), PLAYER1, 'deck-top');
    const state = startTiming(
      setupBp4021Scenario({
        waitingRoomCards: [],
        mainDeckCards: [deckTop],
      }),
      TriggerCondition.ON_ENTER_STAGE
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].mainDeck.cardIds).toEqual([deckTop.instanceId]);
  });
});
