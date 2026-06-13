import { describe, expect, it } from 'vitest';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
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
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  ABILITY_ORDER_SELECTION_ID,
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  ELI_ACTIVATED_ABILITY_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  HANAYO_ACTIVATED_ABILITY_ID,
  HONOKA_ON_ENTER_ABILITY_ID,
  KARIN_LIVE_START_ABILITY_ID,
  KOTORI_ON_ENTER_ABILITY_ID,
  KOTORI_LIVE_START_HEART_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
  NOZOMI_ON_ENTER_ABILITY_ID,
  RIN_ACTIVATED_ABILITY_ID,
  START_DASH_LIVE_SUCCESS_ABILITY_ID,
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
    groupName: "μ's",
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
    createMemberCard('PL!-sd1-009-SD', '矢澤 にこ', 15),
    createMemberCard('PL!-sd1-011-SD', '高坂 穂乃果', 11),
    createMemberCard('PL!-sd1-003-SD', '南 ことり', 13),
    createMemberCard('PL!-sd1-015-SD', '西木野 真姫'),
    createMemberCard('PL!-sd1-008-SD', '小泉 花陽'),
    createMemberCard('PL!N-pb1-004-P+', '朝香 果林', 5),
    createMemberCard('PL!N-pb1-004-P+', '朝香 果林', 5),
  ];
  for (let i = 0; i < 39; i++) {
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
  const zones = [
    player.hand,
    player.mainDeck,
    player.waitingRoom,
    player.successZone,
    player.liveZone,
  ];
  for (const zone of zones) {
    zone.cardIds = [];
  }
}

function setActiveEnergy(
  player: {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  },
  cardIds: readonly string[]
): void {
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
        cardId !== nozomiCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
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

  it('executes PL!-sd1-007-SD on-enter mill five without drawing when no Live card was milled', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-effect-runner-no-live', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
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
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== nozomiCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(nozomiCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(7);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(6);

    const milledCardIds = otherMemberCardIds.slice(0, 5);
    const remainingDeckCardId = otherMemberCardIds[5];

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 7));
    p1.hand.cardIds = [nozomiCardId!];
    p1.mainDeck.cardIds = [...milledCardIds, remainingDeckCardId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    const activeEffect = session.state?.activeEffect;
    expect(session.state?.inspectionZone.cardIds).toEqual(milledCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual(milledCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);
    expect(activeEffect?.abilityId).toBe(NOZOMI_ON_ENTER_ABILITY_ID);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(milledCardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === NOZOMI_ON_ENTER_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.hasMilledLiveCard === false &&
          action.payload.drawnCardId === null
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
    const liveCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const liveCardId = liveCardIds[0];
    const nonMuseLiveCardId = liveCardIds[1];
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== umiCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(umiCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(nonMuseLiveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(11);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(3);

    const nonMuseLiveCard = state.cardRegistry.get(nonMuseLiveCardId!) as unknown as {
      data: LiveCardData;
    };
    nonMuseLiveCard.data = {
      ...nonMuseLiveCard.data,
      cardCode: 'OTHER-LIVE-0',
      groupName: 'Other',
    };

    const inspectedCardIds = [
      otherMemberCardIds[0],
      nonMuseLiveCardId!,
      liveCardId!,
      otherMemberCardIds[1],
      otherMemberCardIds[2],
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

  it('uses the generic waiting-room-to-hand selection after PL!-sd1-002-SD self-sacrifice cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-zone-selection-eli', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const eliCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const targetMemberCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== eliCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(eliCardId).toBeTruthy();
    expect(targetMemberCardId).toBeTruthy();

    const eliCard = state.cardRegistry.get(eliCardId!) as unknown as { data: MemberCardData };
    eliCard.data = createMemberCard('PL!-sd1-002-SD', '絢瀬 絵里', 2);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = eliCardId!;
    p1.memberSlots.cardStates = new Map([
      [eliCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.waitingRoom.cardIds = [targetMemberCardId!];

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, eliCardId!, ELI_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ELI_ACTIVATED_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(eliCardId);
    expect(session.state?.activeEffect?.selectableCardIds).toContain(targetMemberCardId);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMemberCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([eliCardId]);
  });

  it('executes PL!-sd1-001-SD on-enter recovery of a Live from waiting room when two success Lives exist', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-honoka-waiting-room-live-recovery', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
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
    const honokaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const nonLiveWaitingRoomCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== honokaCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(honokaCardId).toBeTruthy();
    expect(liveCardIds.length).toBeGreaterThanOrEqual(3);
    expect(nonLiveWaitingRoomCardId).toBeTruthy();

    const honokaCard = state.cardRegistry.get(honokaCardId!) as unknown as { data: MemberCardData };
    honokaCard.data = createMemberCard('PL!-sd1-001-SD', '高坂 穂乃果', 0);

    const targetLiveCardId = liveCardIds[0];
    const successLiveCardIds = liveCardIds.slice(1, 3);
    const deckFillerCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== honokaCardId &&
        cardId !== targetLiveCardId &&
        !successLiveCardIds.includes(cardId) &&
        cardId !== nonLiveWaitingRoomCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const targetLiveCard = state.cardRegistry.get(targetLiveCardId) as unknown as {
      data: LiveCardData;
    };
    expect(deckFillerCardId).toBeTruthy();
    targetLiveCard.data = createLiveCard('PL!-sd1-target-live', 'Target Live');

    removeFromPlayerZones(p1);
    p1.mainDeck.cardIds = [deckFillerCardId!];
    p1.hand.cardIds = [honokaCardId!];
    p1.successZone.cardIds = successLiveCardIds;
    p1.waitingRoom.cardIds = [targetLiveCardId, nonLiveWaitingRoomCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, honokaCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(HONOKA_ON_ENTER_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLiveCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([nonLiveWaitingRoomCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFillerCardId]);
    expect(session.state?.players[0].successZone.cardIds).toEqual(successLiveCardIds);
  });

  it('executes PL!-sd1-003-SD on-enter recovery of a low-cost Muse member from waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-kotori-waiting-room-member-recovery', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
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
    const kotoriCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const waitingRoomMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== kotoriCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(kotoriCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(12);
    expect(waitingRoomMemberCardIds.length).toBeGreaterThanOrEqual(4);

    const targetMemberCardId = waitingRoomMemberCardIds[0];
    const highCostMuseMemberCardId = waitingRoomMemberCardIds[1];
    const nonMuseMemberCardId = waitingRoomMemberCardIds[2];
    const deckFillerCardId = waitingRoomMemberCardIds[3];
    const targetMemberCard = state.cardRegistry.get(targetMemberCardId) as unknown as {
      data: MemberCardData;
    };
    const highCostMuseMemberCard = state.cardRegistry.get(highCostMuseMemberCardId) as unknown as {
      data: MemberCardData;
    };
    const nonMuseMemberCard = state.cardRegistry.get(nonMuseMemberCardId) as unknown as {
      data: MemberCardData;
    };
    const kotoriCard = state.cardRegistry.get(kotoriCardId!) as unknown as {
      data: MemberCardData;
    };
    kotoriCard.data = createMemberCard('PL!-sd1-003-SD', '南 ことり', 1);
    targetMemberCard.data = createMemberCard('PL!-sd1-test-low-cost-muse', '低费用 μs 成员', 4);
    highCostMuseMemberCard.data = createMemberCard('PL!-sd1-test-high-cost-muse', '高费用 μs 成员', 5);
    nonMuseMemberCard.data = createMemberCard('OTHER-MEMBER-0', 'Other Member', 4);

    removeFromPlayerZones(p1);
    p1.mainDeck.cardIds = [deckFillerCardId];
    setActiveEnergy(p1, energyCardIds.slice(0, 12));
    p1.hand.cardIds = [kotoriCardId!];
    p1.waitingRoom.cardIds = [targetMemberCardId, highCostMuseMemberCardId, nonMuseMemberCardId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kotoriCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(KOTORI_ON_ENTER_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMemberCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMemberCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      highCostMuseMemberCardId,
      nonMuseMemberCardId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFillerCardId]);
  });

  it('uses the generic waiting-room-to-hand selection after PL!-sd1-005-SD self-sacrifice cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-zone-selection-rin', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const rinCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const targetLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const nonLiveWaitingRoomCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== rinCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(rinCardId).toBeTruthy();
    expect(targetLiveCardId).toBeTruthy();
    expect(nonLiveWaitingRoomCardId).toBeTruthy();

    const rinCard = state.cardRegistry.get(rinCardId!) as unknown as { data: MemberCardData };
    rinCard.data = createMemberCard('PL!-sd1-005-SD', '星空 凛', 6);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = rinCardId!;
    p1.memberSlots.cardStates = new Map([
      [rinCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.waitingRoom.cardIds = [targetLiveCardId!, nonLiveWaitingRoomCardId!];

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, rinCardId!, RIN_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(RIN_ACTIVATED_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(rinCardId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLiveCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      nonLiveWaitingRoomCardId,
      rinCardId,
    ]);
  });

  it('executes PL!-sd1-011-SD on-enter discard then requires taking one of top three', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-discard-look-top-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
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
    const honokaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-011-SD'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== honokaCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(honokaCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(11);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(5);

    const discardCardId = otherMemberCardIds[0];
    const inspectedCardIds = [otherMemberCardIds[1], otherMemberCardIds[2], otherMemberCardIds[3]];
    const unrevealedCardId = otherMemberCardIds[4];
    const selectedCardId = inspectedCardIds[1];

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 11));
    p1.hand.cardIds = [honokaCardId!, discardCardId];
    p1.mainDeck.cardIds = [...inspectedCardIds, unrevealedCardId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, honokaCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.sourceCardId).toBe(honokaCardId);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不发动');
    expect(session.state?.activeEffect?.metadata?.handToWaitingRoomCost).toEqual({
      minCount: 1,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.activeEffect?.metadata?.effectCosts).toEqual([
      {
        kind: 'DISCARD_HAND_TO_WAITING_ROOM',
        minCount: 1,
        maxCount: 1,
        optional: true,
      },
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要加入手牌的卡牌');
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(inspectedCardIds);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([unrevealedCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);

    const skipTakeResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipTakeResult.success).toBe(false);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);

    const takeResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
    );

    expect(takeResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCardId,
      inspectedCardIds[0],
      inspectedCardIds[2],
    ]);
  });

  it('executes PL!-sd1-015-SD by revealing the selected member before adding it to hand', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-discard-look-top-reveal-member-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
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
    const makiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-015-SD'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== makiCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(makiCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(1);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(5);

    const discardCardId = otherMemberCardIds[0];
    const inspectedCardIds = [
      otherMemberCardIds[1],
      liveCardId!,
      otherMemberCardIds[2],
      otherMemberCardIds[3],
      otherMemberCardIds[4],
    ];
    const unrevealedCardId = otherMemberCardIds[5];
    const selectedCardId = otherMemberCardIds[2];

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 1));
    p1.hand.cardIds = [makiCardId!, discardCardId];
    p1.mainDeck.cardIds = [...inspectedCardIds, unrevealedCardId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, makiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要加入手牌的成员卡');
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不加入');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      inspectedCardIds.filter((cardId) => cardId !== liveCardId)
    );

    const revealResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([selectedCardId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCardId,
      inspectedCardIds[0],
      inspectedCardIds[1],
      inspectedCardIds[3],
      inspectedCardIds[4],
    ]);
  });

  it('limits PL!-sd1-008-SD activated ability to once per turn', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hanayo-once-per-turn-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
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
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const hanayoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-008-SD'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const deckCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== hanayoCardId && state.cardRegistry.get(cardId)?.data.cardType !== CardType.ENERGY
    );

    expect(hanayoCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);
    expect(deckCardIds.length).toBeGreaterThanOrEqual(20);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    p1.mainDeck.cardIds = deckCardIds.slice(0, 20);
    p1.memberSlots.slots[SlotPosition.CENTER] = hanayoCardId!;
    p1.memberSlots.cardStates = new Map([
      [hanayoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const firstActivateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, hanayoCardId!, HANAYO_ACTIVATED_ABILITY_ID)
    );

    expect(firstActivateResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(deckCardIds.slice(0, 10));
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(deckCardIds.slice(10, 20));
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HANAYO_ACTIVATED_ABILITY_ID &&
          action.payload.step === 'ACTIVATED_ABILITY_USE' &&
          action.payload.turnCount === session.state?.turnCount
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === HANAYO_ACTIVATED_ABILITY_ID &&
          Array.isArray(action.payload.energyCardIds) &&
          action.payload.energyCardIds.length === 2
      )
    ).toBe(true);

    const secondActivateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, hanayoCardId!, HANAYO_ACTIVATED_ABILITY_ID)
    );

    expect(secondActivateResult.success).toBe(false);
    expect(secondActivateResult.error).toContain('本回合已发动 1/1 次');
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(deckCardIds.slice(0, 10));
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(deckCardIds.slice(10, 20));
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

  it('queues PL!-sd1-009-SD with other live-start effects for order selection', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-nico-order-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
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
    const nicoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-009-SD'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const lowCostMemberCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        cardId !== karinCardId &&
        cardId !== nicoCardId &&
        card?.data.cardType === CardType.MEMBER &&
        'cost' in card.data &&
        card.data.cost <= 9
      );
    });

    expect(karinCardId).toBeTruthy();
    expect(nicoCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(lowCostMemberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.LEFT] = karinCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = nicoCardId!;
    p1.memberSlots.cardStates = new Map([
      [karinCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [nicoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
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
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([karinCardId, nicoCardId]);
    expect(session.state?.pendingAbilities.map((ability) => ability.abilityId)).toEqual([
      KARIN_LIVE_START_ABILITY_ID,
      NICO_LIVE_START_SCORE_ABILITY_ID,
    ]);

    const chooseNicoResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, nicoCardId)
    );
    expect(chooseNicoResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(NICO_LIVE_START_SCORE_ABILITY_ID);
    expect(session.state?.activeEffect?.sourceCardId).toBe(nicoCardId);
  });

  it('labels PL!-sd1-003-SD live-start discard choice as discarding hand to activate', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-kotori-label-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
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
    const kotoriCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return card?.data.cardType === CardType.MEMBER && card.data.cardCode === 'PL!-sd1-003-SD';
    });
    const discardCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return cardId !== kotoriCardId && card?.data.cardType === CardType.MEMBER;
    });
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(kotoriCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [discardCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = kotoriCardId!;
    p1.memberSlots.cardStates = new Map([
      [kotoriCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

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
    expect(session.state?.activeEffect?.abilityId).toBe(KOTORI_LIVE_START_HEART_ABILITY_ID);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不发动');
    expect(session.state?.activeEffect?.metadata?.handToWaitingRoomCost).toEqual({
      minCount: 1,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.activeEffect?.metadata?.effectCosts).toEqual([
      {
        kind: 'DISCARD_HAND_TO_WAITING_ROOM',
        minCount: 1,
        maxCount: 1,
        optional: true,
      },
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: HeartColor.PINK, label: '粉心' },
      { id: HeartColor.YELLOW, label: '黄心' },
      { id: HeartColor.PURPLE, label: '紫心' },
    ]);

    const heartResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        HeartColor.YELLOW
      )
    );

    expect(heartResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.playerHeartBonuses.get(PLAYER1)).toEqual([
      { color: HeartColor.YELLOW, count: 1 },
    ]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      sourceCardId: kotoriCardId,
      abilityId: KOTORI_LIVE_START_HEART_ABILITY_ID,
    });
  });

  it('queues PL!-sd1-022-SD from the Live zone and records its requirement reduction', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-bokuima-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
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
    const liveCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const liveCardId = liveCardIds[0];
    expect(liveCardId).toBeTruthy();
    expect(liveCardIds.length).toBeGreaterThanOrEqual(4);

    const liveCard = state.cardRegistry.get(liveCardId!) as unknown as { data: LiveCardData };
    liveCard.data = {
      ...liveCard.data,
      cardCode: 'PL!-sd1-022-SD',
      name: '如今的我们',
      requirements: createHeartRequirement({
        [HeartColor.PINK]: 1,
        [HeartColor.RAINBOW]: 6,
      }),
    };

    removeFromPlayerZones(p1);
    p1.successZone.cardIds = liveCardIds.slice(1, 3);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

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
    expect(session.state?.activeEffect?.abilityId).toBe(BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID);
    expect(session.state?.activeEffect?.sourceCardId).toBe(liveCardId);
    expect(session.state?.activeEffect?.effectText).toContain('当前成功LIVE 2张');
    expect(
      session.state?.liveResolution.liveRequirementReductions.get(liveCardId!)
    ).toBeUndefined();

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveRequirementReductions.get(liveCardId!)).toBe(4);
    expect(session.state?.liveResolution.liveRequirementModifiers.get(liveCardId!)).toEqual([
      { color: HeartColor.RAINBOW, countDelta: -4 },
    ]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -4 }],
      sourceCardId: liveCardId,
      abilityId: BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
    });
  });

  it('executes PL!-sd1-019-SD live-success inspect top 3, order selected cards to deck top, and mill the rest', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-live-success-start-dash', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const topCardIds = ownedP1CardIds
      .filter((cardId) => cardId !== liveCardId)
      .filter((cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER)
      .slice(0, 4);

    expect(liveCardId).toBeTruthy();
    expect(topCardIds).toHaveLength(4);

    const liveCard = state.cardRegistry.get(liveCardId!) as unknown as { data: LiveCardData };
    liveCard.data = createLiveCard('PL!-sd1-019-SD', 'START:DASH!!');
    removeFromPlayerZones(p1);
    p1.successZone.cardIds = [liveCardId!];
    p1.mainDeck.cardIds = topCardIds;

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      firstPlayerIndex: number;
      activePlayerIndex: number;
      liveResolution: GameState['liveResolution'];
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.firstPlayerIndex = 0;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution = {
      ...state.liveResolution,
      liveResults: new Map([[liveCardId!, true]]),
    };

    const service = new GameService();
    const checkResult = service.executeCheckTiming(state, [TriggerCondition.ON_LIVE_SUCCESS]);
    (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

    expect(checkResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(START_DASH_LIVE_SUCCESS_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(0);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(3);
    expect(session.state?.inspectionZone.cardIds).toEqual(topCardIds.slice(0, 3));
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCardIds[3]]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [topCardIds[2], topCardIds[0]]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      topCardIds[2],
      topCardIds[0],
      topCardIds[3],
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([topCardIds[1]]);
  });

  it('does not trigger PL!-sd1-019-SD live-success effect when the Live failed', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-success-start-dash-fail',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(liveCardId).toBeTruthy();

    const liveCard = state.cardRegistry.get(liveCardId!) as unknown as { data: LiveCardData };
    liveCard.data = createLiveCard('PL!-sd1-019-SD', 'START:DASH!!');

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      firstPlayerIndex: number;
      activePlayerIndex: number;
      liveResolution: GameState['liveResolution'];
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.firstPlayerIndex = 0;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution = {
      ...state.liveResolution,
      liveResults: new Map([[liveCardId!, false]]),
    };

    const service = new GameService();
    const checkResult = service.executeCheckTiming(state, [TriggerCondition.ON_LIVE_SUCCESS]);

    expect(checkResult.success).toBe(true);
    expect(checkResult.gameState.activeEffect).toBeNull();
    expect(checkResult.gameState.pendingAbilities).toEqual([]);
  });
});
