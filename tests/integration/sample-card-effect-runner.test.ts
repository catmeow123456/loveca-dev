import { describe, expect, it } from 'vitest';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import type { GameState } from '../../src/domain/entities/game';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  ABILITY_ORDER_SELECTION_ID,
  KARIN_LIVE_START_ABILITY_ID,
  NOZOMI_ON_ENTER_ABILITY_ID,
  UMI_ON_ENTER_ABILITY_ID,
} from '../../src/application/card-effect-runner';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, name: string, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `Energy ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [
    createMemberCard('PL!-sd1-004-SD', '園田 海未', 11),
    createMemberCard('PL!-sd1-007-SD', '東條 希', 7),
    createMemberCard('PL!N-pb1-004-P+', '朝香 果林', 5),
    createMemberCard('PL!N-pb1-004-P+', '朝香 果林', 5),
  ];
  for (let i = 0; i < 44; i++) {
    mainDeck.push(createMemberCard(`MEM-${i}`, `Member ${i}`));
  }
  for (let i = 0; i < 12; i++) {
    mainDeck.push(createLiveCard(`LIVE-${i}`, `Live ${i}`));
  }

  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.NONE;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

function removeFromPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
}): void {
  const zones = [player.hand, player.mainDeck, player.waitingRoom, player.successZone, player.liveZone];
  for (const zone of zones) {
    zone.cardIds = [];
  }
}

function setActiveEnergy(player: {
  energyZone: {
    cardIds: string[];
    cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
  };
}, cardIds: readonly string[]): void {
  player.energyZone.cardIds = [...cardIds];
  player.energyZone.cardStates = new Map(
    cardIds.map((cardId) => [
      cardId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
}

describe('sample card effect runner', () => {
  it('executes PL!-sd1-007-SD on-enter mill five and draw one when a Live card was milled', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-effect-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const nozomiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-007-SD'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== nozomiCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(nozomiCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(7);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(5);

    const milledCardIds = [
      otherMemberCardIds[0],
      liveCardId!,
      otherMemberCardIds[1],
      otherMemberCardIds[2],
      otherMemberCardIds[3],
    ];
    const drawnCardId = otherMemberCardIds[4];

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 7));
    p1.hand.cardIds = [nozomiCardId!];
    p1.mainDeck.cardIds = [...milledCardIds, drawnCardId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    const activeEffect = session.state?.activeEffect;
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(nozomiCardId);
    expect(session.state?.inspectionZone.cardIds).toEqual(milledCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual(milledCardIds);
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER1);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([drawnCardId]);
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(activeEffect?.abilityId).toBe(NOZOMI_ON_ENTER_ABILITY_ID);
    expect(activeEffect?.awaitingPlayerId).toBe(PLAYER1);
    expect(activeEffect?.inspectionCardIds).toEqual(milledCardIds);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === NOZOMI_ON_ENTER_ABILITY_ID
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(milledCardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([drawnCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === NOZOMI_ON_ENTER_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.drawnCardId === drawnCardId
      )
    ).toBe(true);
  });

  it('executes PL!-sd1-004-SD on-enter look five and choose one Muse Live to hand', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-choice-effect-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const umiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-004-SD'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== umiCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(umiCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(11);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(4);

    const inspectedCardIds = [
      otherMemberCardIds[0],
      liveCardId!,
      otherMemberCardIds[1],
      otherMemberCardIds[2],
      otherMemberCardIds[3],
    ];

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 11));
    p1.hand.cardIds = [umiCardId!];
    p1.mainDeck.cardIds = [...inspectedCardIds];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, umiCardId!, SlotPosition.CENTER)
    );

    const activeEffect = session.state?.activeEffect;
    expect(playResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(activeEffect?.abilityId).toBe(UMI_ON_ENTER_ABILITY_ID);
    expect(activeEffect?.selectableCardIds).toEqual([liveCardId]);
    expect(activeEffect?.canSkipSelection).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffect!.id, liveCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([liveCardId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([liveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      inspectedCardIds.filter((cardId) => cardId !== liveCardId)
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === UMI_ON_ENTER_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.selectedCardId === liveCardId
      )
    ).toBe(true);
  });

  it('executes PL!N-pb1-004-P+ live-start reveal top, add low-cost member to hand, and position change', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-live-start-effect-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const karinCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-pb1-004-P+'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const lowCostMemberCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        cardId !== karinCardId &&
        card?.data.cardType === CardType.MEMBER &&
        'cost' in card.data &&
        card.data.cost <= 9
      );
    });

    expect(karinCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(lowCostMemberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = karinCardId!;
    p1.memberSlots.cardStates = new Map([
      [karinCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.mainDeck.cardIds = [lowCostMemberCardId!];

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      currentTurnType: TurnType;
      activePlayerIndex: number;
      firstPlayerIndex: number;
      liveSetCompletedPlayers: string[];
    };
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.currentSubPhase = SubPhase.LIVE_SET_SECOND_DRAW;
    mutableState.currentTurnType = TurnType.LIVE_PHASE;
    mutableState.activePlayerIndex = 0;
    mutableState.firstPlayerIndex = 0;
    mutableState.liveSetCompletedPlayers = [PLAYER1, PLAYER2];

    const service = new GameService();
    const advanceResult = service.advancePhase(state);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    expect(session.state?.currentSubPhase).toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);
    expect(session.state?.activeEffect?.abilityId).toBe(KARIN_LIVE_START_ABILITY_ID);
    expect(session.state?.inspectionZone.cardIds).toEqual([lowCostMemberCardId]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([lowCostMemberCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(KARIN_LIVE_START_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([lowCostMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const positionResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(positionResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([lowCostMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(karinCardId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === KARIN_LIVE_START_ABILITY_ID &&
          action.payload.step === 'REVEAL_FINISH' &&
          action.payload.destination === 'HAND'
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === KARIN_LIVE_START_ABILITY_ID &&
          action.payload.step === 'POSITION_CHANGE' &&
          action.payload.fromSlot === SlotPosition.CENTER &&
          action.payload.toSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });

  it('lets the player choose or sequentially resolve multiple live-start effects', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-live-start-order-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const karinCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-pb1-004-P+'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const lowCostMemberCardIds = ownedP1CardIds.filter((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        !karinCardIds.includes(cardId) &&
        card?.data.cardType === CardType.MEMBER &&
        'cost' in card.data &&
        card.data.cost <= 9
      );
    });

    expect(karinCardIds.length).toBeGreaterThanOrEqual(2);
    expect(liveCardId).toBeTruthy();
    expect(lowCostMemberCardIds.length).toBeGreaterThanOrEqual(2);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.LEFT] = karinCardIds[0];
    p1.memberSlots.slots[SlotPosition.CENTER] = karinCardIds[1];
    p1.memberSlots.cardStates = new Map([
      [karinCardIds[0], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [karinCardIds[1], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.mainDeck.cardIds = [lowCostMemberCardIds[0], lowCostMemberCardIds[1]];

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      currentTurnType: TurnType;
      activePlayerIndex: number;
      firstPlayerIndex: number;
      liveSetCompletedPlayers: string[];
    };
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.currentSubPhase = SubPhase.LIVE_SET_SECOND_DRAW;
    mutableState.currentTurnType = TurnType.LIVE_PHASE;
    mutableState.activePlayerIndex = 0;
    mutableState.firstPlayerIndex = 0;
    mutableState.liveSetCompletedPlayers = [PLAYER1, PLAYER2];

    const service = new GameService();
    const advanceResult = service.advancePhase(state);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(karinCardIds);
    expect(session.state?.activeEffect?.canResolveInOrder).toBe(true);
    expect(session.state?.pendingAbilities).toHaveLength(2);

    const orderResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        true
      )
    );

    expect(orderResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(KARIN_LIVE_START_ABILITY_ID);
    expect(session.state?.activeEffect?.sourceCardId).toBe(karinCardIds[0]);
    expect(session.state?.activeEffect?.metadata?.orderedResolution).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([lowCostMemberCardIds[0]]);
  });
});
