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
  ZoneType,
} from '../../src/shared/types/enums';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { updatePlayer, type GameState } from '../../src/domain/entities/game';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createMovePublicCardToWaitingRoomCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  ABILITY_ORDER_SELECTION_ID,
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID,
  EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
  ELI_ACTIVATED_ABILITY_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
  BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
  HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
  HANAYO_ACTIVATED_ABILITY_ID,
  BP4_003_ACTIVATED_ABILITY_ID,
  HONOKA_ON_ENTER_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  KARIN_LIVE_START_ABILITY_ID,
  KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
  KOTORI_ON_ENTER_ABILITY_ID,
  KOTORI_LIVE_START_HEART_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
  NOZOMI_ON_ENTER_ABILITY_ID,
  RIN_ACTIVATED_ABILITY_ID,
  SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
  SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
  START_DASH_LIVE_SUCCESS_ABILITY_ID,
  UMI_ON_ENTER_ABILITY_ID,
  YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
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
    createMemberCard('PL!-bp3-010-N', '高坂 穂乃果', 9),
    createMemberCard('LL-bp1-001-R+', '上原 步梦', 20),
    createMemberCard('PL!HS-bp2-002-P', '村野 沙耶香', 13),
    createMemberCard('PL!HS-PR-001-PR', '日野下 花帆', 10),
    createMemberCard('PL!N-pb1-004-P+', '朝香 果林', 5),
    createMemberCard('PL!N-pb1-004-P+', '朝香 果林', 5),
    createMemberCard('PL!SP-PR-004-PR', '唐 可可', 4),
    createMemberCard('PL!SP-bp4-008-P', '若菜四季', 13),
    createMemberCard('PL!SP-bp5-003-AR', '岚 千砂都', 17),
    createMemberCard('PL!N-pb1-008-P+', '艾玛·维尔德', 17),
    createMemberCard('PL!S-bp2-006-P', '津岛善子', 11),
    createMemberCard('PL!HS-bp2-012-N', '乙宗 梢', 5),
    createMemberCard('PL!HS-bp1-006-P', '藤島 慈', 11),
    createMemberCard('PL!-pb1-019-N', '高坂 穂乃果', 2),
    createMemberCard('PL!-bp4-003-P', '南 ことり', 2),
  ];
  for (let i = 0; i < 37; i++) {
    mainDeck.push(createMemberCard(`MEM-${i}`, `Member ${i}`));
  }
  for (let i = 0; i < 12; i++) {
    mainDeck.push(createLiveCard(`LIVE-${i}`, `Live ${i}`));
  }

  const energyDeck = Array.from({ length: 24 }, (_, index) => createEnergyCard(`ENE-${index}`));
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

function setEnergyZoneCards(
  player: {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  },
  energyCards: readonly { readonly cardId: string; readonly orientation: OrientationState }[]
): void {
  player.energyZone.cardIds = energyCards.map((card) => card.cardId);
  player.energyZone.cardStates = new Map(
    energyCards.map((card) => [
      card.cardId,
      { orientation: card.orientation, face: FaceState.FACE_UP },
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

  it('executes PL!HS-bp1-006-P on-enter draw2 and discard1', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp1-006-on-enter-draw-discard-runner',
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
    const hsCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-006-P'
    );
    const deckCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== hsCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const firstDrawnCardId = deckCardIds[0];
    const secondDrawnCardId = deckCardIds[1];
    const remainingDeckCardId = deckCardIds[2];

    expect(hsCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(11);
    expect(firstDrawnCardId).toBeTruthy();
    expect(secondDrawnCardId).toBeTruthy();
    expect(remainingDeckCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 11));
    p1.hand.cardIds = [hsCardId!];
    p1.mainDeck.cardIds = [firstDrawnCardId!, secondDrawnCardId!, remainingDeckCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hsCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      firstDrawnCardId,
      secondDrawnCardId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toEqual([
      firstDrawnCardId,
      secondDrawnCardId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);

    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, secondDrawnCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([firstDrawnCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([secondDrawnCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          action.payload.discardedCardId === secondDrawnCardId
      )
    ).toBe(true);
  });

  it('uses the generic waiting-room-to-hand selection after PL!-pb1-019-N self-sacrifice cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-pb1-019-activated-waiting-room-member-runner',
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
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const pb1CardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-pb1-019-N'
    );
    const targetMemberCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== pb1CardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== pb1CardId &&
        cardId !== targetMemberCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(pb1CardId).toBeTruthy();
    expect(targetMemberCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [];
    p1.waitingRoom.cardIds = [targetMemberCardId!, liveCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = pb1CardId!;
    p1.memberSlots.cardStates = new Map([
      [pb1CardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, pb1CardId!, PB1_019_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(PB1_019_ACTIVATED_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(pb1CardId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([targetMemberCardId!, pb1CardId!])
    );
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(liveCardId);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMemberCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([liveCardId!, pb1CardId!])
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === PB1_019_ACTIVATED_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.selectedCardId === targetMemberCardId
      )
    ).toBe(true);
  });

  it('uses the generic waiting-room-to-hand selection after PL!-bp4-003-P self-sacrifice cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp4-003-activated-waiting-room-live-runner',
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
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kotoriCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp4-003-P'
    );
    const targetLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const memberCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== kotoriCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(kotoriCardId).toBeTruthy();
    expect(targetLiveCardId).toBeTruthy();
    expect(memberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [];
    p1.waitingRoom.cardIds = [targetLiveCardId!, memberCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = kotoriCardId!;
    p1.memberSlots.cardStates = new Map([
      [kotoriCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, kotoriCardId!, BP4_003_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(BP4_003_ACTIVATED_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(kotoriCardId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLiveCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([memberCardId!, kotoriCardId!])
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === BP4_003_ACTIVATED_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.selectedCardId === targetLiveCardId
      )
    ).toBe(true);
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

  it('executes LL-bp1-001-R+ on-enter member recovery from waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-ll-bp1-001-on-enter-recovery-runner',
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
      waitingRoom: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
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
    const llCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LL-bp1-001-R+'
    );
    const memberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== llCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== llCardId &&
        cardId !== memberCardIds[0] &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const selectedMemberCardId = memberCardIds[0];
    const llDeckFillCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== llCardId &&
        cardId !== selectedMemberCardId &&
        cardId !== liveCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(llCardId).toBeTruthy();
    expect(selectedMemberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds);
    p1.hand.cardIds = [llCardId!];
    p1.waitingRoom.cardIds = [selectedMemberCardId!, liveCardId!];
    p1.mainDeck.cardIds = [llDeckFillCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, llCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(selectedMemberCardId!);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(liveCardId!);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([selectedMemberCardId]);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toMatchObject({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedMemberCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([liveCardId!]);
  });

  it('executes PL!HS-PR-001-PR on-enter discard then takes one of top three', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pr-001-on-enter-discard-look-top-runner',
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
    const prCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-PR-001-PR'
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== prCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const inspectedCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== prCardId &&
        cardId !== discardCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const unrevealedCardId = inspectedCardIds[3];
    const selectedCardId = inspectedCardIds[0];

    expect(prCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(inspectedCardIds.length).toBeGreaterThanOrEqual(4);
    expect(unrevealedCardId).toBeTruthy();
    expect(selectedCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds);
    p1.hand.cardIds = [prCardId!, discardCardId!];
    p1.mainDeck.cardIds = [inspectedCardIds[0], inspectedCardIds[1], inspectedCardIds[2], unrevealedCardId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, prCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId!)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([inspectedCardIds[0], inspectedCardIds[1], inspectedCardIds[2]]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      inspectedCardIds[0],
      inspectedCardIds[1],
      inspectedCardIds[2],
    ]);

    const takeResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
    );

    expect(takeResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCardId,
      inspectedCardIds[1],
      inspectedCardIds[2],
    ]);
  });

  it('executes PL!-bp3-010-N on-enter by revealing a LIVE card from top five', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp3-010-on-enter-live-reveal-runner',
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
    const bp3CardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp3-010-N'
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== bp3CardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== bp3CardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE &&
        cardId !== discardCardId
    );
    const inspectedCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== bp3CardId &&
        cardId !== discardCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const extraMemberId = inspectedCardIds[0];
    const unrevealedCardId = inspectedCardIds[1];
    const candidateLiveCards = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== bp3CardId &&
        cardId !== discardCardId &&
        cardId !== extraMemberId &&
        cardId !== unrevealedCardId &&
        cardId !== liveCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(bp3CardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(candidateLiveCards.length).toBeGreaterThan(0);
    expect(extraMemberId).toBeTruthy();
    expect(unrevealedCardId).toBeTruthy();

    const topVisibleCardIds = [liveCardId!, extraMemberId!, candidateLiveCards[0], candidateLiveCards[1] ?? unrevealedCardId, unrevealedCardId];

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds);
    p1.hand.cardIds = [bp3CardId!, discardCardId!];
    p1.mainDeck.cardIds = topVisibleCardIds;
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, bp3CardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId!)
    );
    const inspectedLiveCount = session.state?.inspectionZone.cardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    ).length;

    expect(inspectedLiveCount).toBeGreaterThan(0);
    const inspectedLiveCountByPredicate = session.state!.inspectionZone.cardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    ).length;
    expect(inspectedLiveCountByPredicate).toBeGreaterThan(0);

    expect(discardResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual(topVisibleCardIds);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要加入手牌的LIVE卡');
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    const selectableLiveCardIds = session.state?.activeEffect?.selectableCardIds ?? [];
    expect(selectableLiveCardIds.length).toBeGreaterThan(0);
    expect(selectableLiveCardIds).toContain(liveCardId!);
    expect(
      selectableLiveCardIds.every(
        (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
      )
    ).toBe(true);
    const selectedLiveCardId = selectableLiveCardIds[0];

    const selectLiveResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        selectedLiveCardId
      )
    );

    expect(selectLiveResult.success).toBe(true);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([selectedLiveCardId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);

    const revealFinishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(revealFinishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toContain(selectedLiveCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(topVisibleCardIds.filter((cardId) => cardId !== selectedLiveCardId))
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId!);
  });

  it('executes PL!HS-bp2-002-P on-enter to recover up to two low-cost members from waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp2-002-on-enter-waiting-room-runner',
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
    const hsCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp2-002-P'
    );
    const lowCostMemberIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== hsCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER &&
        (state.cardRegistry.get(cardId)?.data.cost ?? 0) <= 2
    );
    const highCostMemberId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== hsCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER &&
        (state.cardRegistry.get(cardId)?.data.cost ?? 0) > 2
    );
    const hsDeckFillCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== hsCardId &&
        cardId !== lowCostMemberIds[0] &&
        cardId !== lowCostMemberIds[1] &&
        cardId !== highCostMemberId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(hsCardId).toBeTruthy();
    expect(lowCostMemberIds.length).toBeGreaterThanOrEqual(2);
    expect(highCostMemberId).toBeTruthy();

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds);
    p1.hand.cardIds = [hsCardId!];
    p1.mainDeck.cardIds = [hsDeckFillCardId!];
    p1.waitingRoom.cardIds = [lowCostMemberIds[0]!, lowCostMemberIds[1]!, highCostMemberId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    expect(p1.waitingRoom.cardIds).toEqual(
      expect.arrayContaining([lowCostMemberIds[0]!, lowCostMemberIds[1]!, highCostMemberId!])
    );

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hsCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([lowCostMemberIds[0]!, lowCostMemberIds[1]!, highCostMemberId!])
    );
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toMatchObject({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 2,
      optional: true,
    });
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([lowCostMemberIds[0]!, lowCostMemberIds[1]!])
    );
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(highCostMemberId!);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [lowCostMemberIds[0]!, lowCostMemberIds[1]!]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual(
      expect.arrayContaining([lowCostMemberIds[0]!, lowCostMemberIds[1]!])
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([highCostMemberId!]);
  });

  it('allows PL!SP-PR-004-PR on-enter effect to be declined without placing energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-keke-skip-energy-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kekeCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-PR-004-PR'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kekeCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(6);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    p1.energyDeck.cardIds = energyCardIds.slice(4, 6);
    p1.hand.cardIds = [kekeCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kekeCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(energyCardIds.slice(4, 6));
    expect(session.state?.players[0].energyZone.cardIds).toEqual(energyCardIds.slice(0, 4));
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('executes PL!SP-PR-004-PR on-enter discard one and place waiting energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-keke-place-energy-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kekeCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-PR-004-PR'
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== kekeCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const activeEnergyIds = energyCardIds.slice(0, 4);
    const effectEnergyDeckIds = energyCardIds.slice(4, 7);
    const placedEnergyCardId = effectEnergyDeckIds[0];

    expect(kekeCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(effectEnergyDeckIds.length).toBe(3);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, activeEnergyIds);
    p1.energyDeck.cardIds = [...effectEnergyDeckIds];
    p1.hand.cardIds = [kekeCardId!, discardCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kekeCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCardId
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(effectEnergyDeckIds.slice(1));
    expect(session.state?.players[0].energyZone.cardIds).toEqual([
      ...activeEnergyIds,
      placedEnergyCardId,
    ]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(placedEnergyCardId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'PLACE_WAITING_ENERGY' &&
          action.payload.discardCardId === discardCardId &&
          Array.isArray(action.payload.placedEnergyCardIds) &&
          action.payload.placedEnergyCardIds[0] === placedEnergyCardId
      )
    ).toBe(true);
  });

  it('executes PL!SP-bp4-008-P left-side on-enter effect to draw two and discard one', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-shiki-left-draw-discard-runner',
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
      energyDeck: { cardIds: string[] };
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
    const shikiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-008-P'
    );
    const relayMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const drawnCardIds = ownedP1CardIds.filter((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        cardId !== shikiCardId &&
        cardId !== relayMemberCardId &&
        card?.data.cardType === CardType.MEMBER
      );
    });
    const firstDrawnCardId = drawnCardIds[0];
    const secondDrawnCardId = drawnCardIds[1];
    const remainingDeckCardId = drawnCardIds[2];

    expect(shikiCardId).toBeTruthy();
    expect(relayMemberCardId).toBeTruthy();
    expect(drawnCardIds.length).toBeGreaterThanOrEqual(3);

    removeFromPlayerZones(p1);
    p1.energyDeck.cardIds = [];
    setEnergyZoneCards(p1, []);
    p1.hand.cardIds = [shikiCardId!];
    p1.mainDeck.cardIds = [firstDrawnCardId, secondDrawnCardId, remainingDeckCardId];
    p1.memberSlots.slots[SlotPosition.LEFT] = relayMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [relayMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, shikiCardId!, SlotPosition.LEFT)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(shikiCardId);
    expect(session.state?.activeEffect?.abilityId).toBe(
      SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.sourceSlot).toBe(SlotPosition.LEFT);
    expect(session.state?.activeEffect?.metadata?.drawnCardIds).toEqual([
      firstDrawnCardId,
      secondDrawnCardId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      firstDrawnCardId,
      secondDrawnCardId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toEqual([
      firstDrawnCardId,
      secondDrawnCardId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID &&
          action.payload.sourceSlot === SlotPosition.LEFT
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, secondDrawnCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([firstDrawnCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      relayMemberCardId,
      secondDrawnCardId,
    ]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          action.payload.discardedCardId === secondDrawnCardId &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds[0] === firstDrawnCardId &&
          action.payload.drawnCardIds[1] === secondDrawnCardId
      )
    ).toBe(true);
  });

  it('executes PL!SP-bp4-008-P right-side on-enter effect to activate two waiting energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-shiki-right-activate-energy-runner',
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
      energyDeck: { cardIds: string[] };
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
    const shikiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-008-P'
    );
    const relayMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const energyToActivate = energyCardIds.slice(0, 2);
    const waitingEnergyToLeave = energyCardIds[2];
    const activeEnergyToLeave = energyCardIds[3];

    expect(shikiCardId).toBeTruthy();
    expect(relayMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);

    removeFromPlayerZones(p1);
    p1.energyDeck.cardIds = [];
    setEnergyZoneCards(p1, [
      { cardId: energyToActivate[0], orientation: OrientationState.WAITING },
      { cardId: energyToActivate[1], orientation: OrientationState.WAITING },
      { cardId: waitingEnergyToLeave, orientation: OrientationState.WAITING },
      { cardId: activeEnergyToLeave, orientation: OrientationState.ACTIVE },
    ]);
    p1.hand.cardIds = [shikiCardId!];
    p1.memberSlots.slots[SlotPosition.RIGHT] = relayMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [relayMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, shikiCardId!, SlotPosition.RIGHT)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(shikiCardId);
    expect(session.state?.activeEffect?.abilityId).toBe(
      SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.sourceSlot).toBe(SlotPosition.RIGHT);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID &&
          action.payload.sourceSlot === SlotPosition.RIGHT
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyToActivate[0])?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyToActivate[1])?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[0].energyZone.cardStates.get(waitingEnergyToLeave)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[0].energyZone.cardStates.get(activeEnergyToLeave)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID &&
          action.payload.step === 'ACTIVATE_ENERGY' &&
          Array.isArray(action.payload.activatedEnergyCardIds) &&
          action.payload.activatedEnergyCardIds[0] === energyToActivate[0] &&
          action.payload.activatedEnergyCardIds[1] === energyToActivate[1]
      )
    ).toBe(true);
  });

  it('does not trigger PL!SP-bp4-008-P right-side on-enter effect from the center slot', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-shiki-center-no-right-energy-runner',
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
      energyDeck: { cardIds: string[] };
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
    const shikiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-008-P'
    );
    const relayMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(shikiCardId).toBeTruthy();
    expect(relayMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    removeFromPlayerZones(p1);
    p1.energyDeck.cardIds = [];
    setEnergyZoneCards(p1, [
      { cardId: energyCardIds[0], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[1], orientation: OrientationState.WAITING },
    ]);
    p1.hand.cardIds = [shikiCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = relayMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [relayMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, shikiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(shikiCardId);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.pendingAbilities.some(
        (ability) =>
          ability.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID ||
          ability.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID
      )
    ).toBe(false);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          (action.payload.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID ||
            action.payload.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID)
      )
    ).toBe(false);
  });

  it('executes PL!SP-bp4-008-P live-start optional position change', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-shiki-live-start-position-change-runner',
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
    const shikiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-008-P'
    );
    const rightMemberCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== shikiCardId && state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(shikiCardId).toBeTruthy();
    expect(rightMemberCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = shikiCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = rightMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [shikiCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [rightMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
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
    expect(session.state?.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    expect(session.state?.currentSubPhase).toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);
    expect(session.state?.activeEffect?.abilityId).toBe(
      SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(shikiCardId);
    expect(session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.metadata?.sourceSlot).toBe(SlotPosition.CENTER);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID &&
          action.payload.sourceSlot === SlotPosition.CENTER
      )
    ).toBe(true);

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
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      rightMemberCardId
    );
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(shikiCardId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID &&
          action.payload.step === 'POSITION_CHANGE' &&
          action.payload.fromSlot === SlotPosition.CENTER &&
          action.payload.toSlot === SlotPosition.RIGHT &&
          action.payload.swappedCardId === rightMemberCardId
      )
    ).toBe(true);
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

  it('executes PL!SP-bp5-003-AR live-start activation for Liella! members and all energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-chisato-live-start-activate', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
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
    const chisatoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp5-003-AR'
    );
    const liellaMemberCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== chisatoCardId &&
        state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-PR-004-PR'
    );
    const otherMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(chisatoCardId).toBeTruthy();
    expect(liellaMemberCardId).toBeTruthy();
    expect(otherMemberCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(3);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.LEFT] = liellaMemberCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = chisatoCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = otherMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [liellaMemberCardId!, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
      [chisatoCardId!, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
      [otherMemberCardId!, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    setEnergyZoneCards(p1, [
      { cardId: energyCardIds[0], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[1], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[2], orientation: OrientationState.ACTIVE },
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
    expect(session.state?.activeEffect?.abilityId).toBe(
      CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID
    );

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].memberSlots.cardStates.get(liellaMemberCardId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(session.state?.players[0].memberSlots.cardStates.get(chisatoCardId!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.players[0].memberSlots.cardStates.get(otherMemberCardId!)?.orientation
    ).toBe(OrientationState.WAITING);
    for (const energyCardId of energyCardIds.slice(0, 3)) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
  });

  it('executes PL!N-pb1-008-P+ on-enter effect activate one waiting stage member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-emma-activate-member', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const emmaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-pb1-008-P+'
    );
    const targetMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(emmaCardId).toBeTruthy();
    expect(targetMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(20);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [emmaCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 20),
        cardStates: new Map(
          energyCardIds.slice(0, 20).map((cardId) => [
            cardId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: targetMemberCardId!,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [targetMemberCardId!, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, emmaCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('EMMA_SELECT_ACTIVATE_TARGET_TYPE');
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'member', label: '选择1名成员' },
      { id: 'energy', label: '将能量变活跃' },
    ]);

    const selectMemberBranchResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'member'
      )
    );

    expect(selectMemberBranchResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('EMMA_SELECT_MEMBER_TO_ACTIVATE');
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMemberCardId]);

    const activateMemberResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMemberCardId!)
    );

    expect(activateMemberResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].memberSlots.cardStates.get(targetMemberCardId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('executes PL!N-pb1-008-P+ on-enter effect activate two waiting energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-emma-activate-energy', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const emmaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-pb1-008-P+'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(emmaCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(20);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [emmaCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 20),
        cardStates: new Map(
          energyCardIds.slice(0, 20).map((cardId) => [
            cardId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map(),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, emmaCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'energy', label: '将能量变活跃' },
    ]);
    const autoActivatedEnergyCardIds = session
      .state!.players[0].energyZone.cardIds.filter(
        (cardId) =>
          session.state!.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.WAITING
      )
      .slice(0, 2);

    const selectEnergyBranchResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'energy'
      )
    );

    expect(selectEnergyBranchResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    for (const energyCardId of autoActivatedEnergyCardIds) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
  });

  it('executes PL!S-bp2-006-P on-enter effect play from waiting room to empty slots', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-yoshiko-play-from-waiting', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
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
    const yoshikoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!S-bp2-006-P'
    );
    const waitingMemberCardIds = ['MEM-0', 'MEM-1'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(yoshikoCardId).toBeTruthy();
    expect(waitingMemberCardIds.every(Boolean)).toBe(true);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    for (const cardId of waitingMemberCardIds) {
      const card = state.cardRegistry.get(cardId!) as unknown as { data: MemberCardData };
      card.data = { ...card.data, cost: 2 };
    }

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [yoshikoCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: waitingMemberCardIds as string[] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 15),
        cardStates: new Map(
          energyCardIds.slice(0, 15).map((cardId) => [
            cardId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map(),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, yoshikoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: waitingMemberCardIds as string[] },
      })
    );
    expect(session.state?.activeEffect?.abilityId).toBe(
      YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('YOSHIKO_PAY_COST');

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('YOSHIKO_SELECT_WAITING_ROOM_LOW_COST_MEMBERS');
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(waitingMemberCardIds);

    const duplicatePayResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(duplicatePayResult.success).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe('YOSHIKO_SELECT_WAITING_ROOM_LOW_COST_MEMBERS');

    const selectMembersResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        waitingMemberCardIds as string[]
      )
    );

    expect(selectMembersResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('YOSHIKO_SELECT_STAGE_SLOT');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([waitingMemberCardIds[0]]);

    const firstSlotResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    );

    expect(firstSlotResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([waitingMemberCardIds[1]]);

    const secondSlotResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(secondSlotResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(yoshikoCardId);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      waitingMemberCardIds[0]
    );
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      waitingMemberCardIds[1]
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
          action.payload.amount === 4
      )
    ).toBe(true);
  });

  it('queues on-enter effects for members played from waiting room by PL!S-bp2-006-P', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-yoshiko-play-from-waiting-on-enter',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const yoshikoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!S-bp2-006-P'
    );
    const kotoriCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const targetMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(yoshikoCardId).toBeTruthy();
    expect(kotoriCardId).toBeTruthy();
    expect(targetMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    const kotoriCard = state.cardRegistry.get(kotoriCardId!) as unknown as {
      data: MemberCardData;
    };
    const targetMemberCard = state.cardRegistry.get(targetMemberCardId!) as unknown as {
      data: MemberCardData;
    };
    kotoriCard.data = createMemberCard('PL!-sd1-003-SD', '南 ことり', 2);
    targetMemberCard.data = createMemberCard('PL!-sd1-test-low-cost-muse', '低费用 μs 成员', 4);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [yoshikoCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [kotoriCardId!, targetMemberCardId!] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 15),
        cardStates: new Map(
          energyCardIds.slice(0, 15).map((cardId) => [
            cardId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map(),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, yoshikoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: [kotoriCardId!, targetMemberCardId!] },
      })
    );

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect?.selectableCardIds).toContain(kotoriCardId);

    const selectMemberResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [kotoriCardId!]
      )
    );

    expect(selectMemberResult.success).toBe(true);

    const slotResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    );

    expect(slotResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(kotoriCardId);
    expect(session.state?.activeEffect?.abilityId).toBe(KOTORI_ON_ENTER_ABILITY_ID);
    expect(session.state?.activeEffect?.sourceCardId).toBe(kotoriCardId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMemberCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === KOTORI_ON_ENTER_ABILITY_ID &&
          action.payload.sourceCardId === kotoriCardId &&
          action.payload.sourceSlot === SlotPosition.LEFT
      )
    ).toBe(true);
  });

  it('executes PL!HS-bp2-012-N leave-stage AUTO to reveal one top-five member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-kosuzu-leave-stage-auto',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kosuzuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp2-012-N'
    );
    const memberCardIds = ['MEM-0', 'MEM-1', 'MEM-2'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const liveCardIds = ['LIVE-0', 'LIVE-1'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );

    expect(kosuzuCardId).toBeTruthy();
    expect(memberCardIds.every(Boolean)).toBe(true);
    expect(liveCardIds.every(Boolean)).toBe(true);

    const topFiveCardIds = [
      memberCardIds[0]!,
      liveCardIds[0]!,
      memberCardIds[1]!,
      liveCardIds[1]!,
      memberCardIds[2]!,
    ];
    const selectedMemberCardId = memberCardIds[1]!;

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: topFiveCardIds },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kosuzuCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kosuzuCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        kosuzuCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topFiveCardIds);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(memberCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([kosuzuCardId]);

    const revealResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        selectedMemberCardId
      )
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID
    );
    expect(session.state?.inspectionZone.revealedCardIds).toContain(selectedMemberCardId);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      kosuzuCardId,
      topFiveCardIds[0],
      topFiveCardIds[1],
      topFiveCardIds[3],
      topFiveCardIds[4],
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('lets the player order PL!HS-bp2-012-N leave-stage AUTO with the replacing member on-enter ability', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-kosuzu-replaced-order-window',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kosuzuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp2-012-N'
    );
    const megumiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-006-P'
    );
    const topMemberCardIds = ['MEM-0', 'MEM-1', 'MEM-2', 'MEM-3', 'MEM-4'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kosuzuCardId).toBeTruthy();
    expect(megumiCardId).toBeTruthy();
    expect(topMemberCardIds.every(Boolean)).toBe(true);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(11);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [megumiCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: topMemberCardIds as string[] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 11),
        cardStates: new Map(
          energyCardIds.slice(0, 11).map((cardId) => [
            cardId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kosuzuCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kosuzuCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, megumiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([megumiCardId, kosuzuCardId]);
    expect(session.state?.pendingAbilities.map((ability) => ability.abilityId)).toEqual([
      HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
      HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
    ]);

    const chooseKosuzuResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, kosuzuCardId)
    );

    expect(chooseKosuzuResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(kosuzuCardId);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topMemberCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([kosuzuCardId]);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(megumiCardId);
  });
});
