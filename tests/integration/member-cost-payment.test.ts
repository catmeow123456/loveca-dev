import { describe, expect, it } from 'vitest';
import {
  CardType,
  GameMode,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import type { DeckConfig } from '../../src/application/game-service';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  name: string,
  cost: number,
  options: {
    readonly groupName?: string;
    readonly cardText?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupName: options.groupName,
    cardText: options.cardText,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(
  cardCode: string,
  options: {
    readonly score?: number;
    readonly groupName?: string;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: `Live ${cardCode}`,
    cardType: CardType.LIVE,
    groupName: options.groupName,
    score: options.score ?? 3,
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
  const mainDeck: AnyCardData[] = [];
  for (let i = 0; i < 48; i++) {
    mainDeck.push(createMemberCard(`MEM-${i}`, `Member ${i}`, 2));
  }
  for (let i = 0; i < 12; i++) {
    mainDeck.push(createLiveCard(`LIVE-${i}`));
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

describe('member cost payment', () => {
  it('automatically taps energy and plays member when paying entry cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('member-cost-payment', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0];
    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = player.energyZone.cardIds.slice(0, 2);

    expect(memberCardId).toBeTruthy();
    expect(energyCardIds).toHaveLength(2);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(memberCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(memberCardId);
    for (const energyCardId of energyCardIds) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }

    const undoResult = session.undoLastStep();

    expect(undoResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(memberCardId);
    for (const energyCardId of energyCardIds) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
  });

  it('applies LL-bp2-001-R+ hand cost reduction before auto-paying entry cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('member-cost-modifier-payment', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const ownedMemberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const sourceCardId = ownedMemberCardIds[0];
    const otherHandCardIds = ownedMemberCardIds.slice(1, 18);

    expect(sourceCardId).toBeTruthy();
    expect(otherHandCardIds).toHaveLength(17);

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as {
      data: MemberCardData;
    };
    sourceCard.data = createMemberCard(
      'LL-bp2-001-R+',
      '渡边 曜&鬼冢夏美&大泽瑠璃乃',
      20
    );

    const nextHandCardIds = [sourceCardId!, ...otherHandCardIds];
    const nextHandCardIdSet = new Set(nextHandCardIds);
    player.hand.cardIds = nextHandCardIds;
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => !nextHandCardIdSet.has(cardId)
    );

    const energyCardIdsForCost = player.energyZone.cardIds.slice(0, 3);
    expect(energyCardIdsForCost).toHaveLength(3);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(sourceCardId);
    for (const energyCardId of energyCardIdsForCost) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.amount === 3
      )
    ).toBe(true);
  });

  it('prevents LL-bp2-001-R+ from being sent to waiting room by relay', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('ll-bp2-relay-prohibition-payment', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    const ownedMemberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const incomingCardId = ownedMemberCardIds[0];
    const protectedCardId = ownedMemberCardIds[1];

    expect(incomingCardId).toBeTruthy();
    expect(protectedCardId).toBeTruthy();

    (state.cardRegistry.get(incomingCardId!) as unknown as { data: MemberCardData }).data =
      createMemberCard('TEST-INCOMING', 'Incoming Member', 2);
    (state.cardRegistry.get(protectedCardId!) as unknown as { data: MemberCardData }).data =
      createMemberCard('LL-bp2-001-R+', '渡边 曜&鬼冢夏美&大泽瑠璃乃', 20);

    player.hand.cardIds = [incomingCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== incomingCardId && cardId !== protectedCardId
    );
    player.memberSlots.slots[SlotPosition.CENTER] = protectedCardId!;
    player.memberSlots.cardStates = new Map([
      [protectedCardId!, { orientation: OrientationState.ACTIVE }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, incomingCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(false);
    expect(playResult.error).toContain('无法因换手');
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(protectedCardId);
    expect(session.state?.players[0].hand.cardIds).toEqual([incomingCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(protectedCardId);
  });

  it('applies PL!N-pb1-008-P+ cost reduction when a waiting Nijigasaki member is on stage', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('emma-cost-modifier-payment', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    const ownedMemberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const sourceCardId = ownedMemberCardIds[0];
    const stageCardId = ownedMemberCardIds[1];

    expect(sourceCardId).toBeTruthy();
    expect(stageCardId).toBeTruthy();
    expect(player.energyZone.cardIds.slice(0, 3)).toHaveLength(3);

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as {
      data: MemberCardData;
    };
    sourceCard.data = createMemberCard('PL!N-pb1-008-P+', '艾玛·维尔德', 5);

    const stageCard = state.cardRegistry.get(stageCardId!) as unknown as {
      data: MemberCardData;
    };
    stageCard.data = createMemberCard('PL!N-test-waiting', '待机虹咲成员', 2, {
      groupName: 'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
    });

    player.hand.cardIds = [sourceCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== sourceCardId && cardId !== stageCardId
    );
    player.memberSlots.slots[SlotPosition.LEFT] = stageCardId!;
    player.memberSlots.cardStates = new Map([
      [stageCardId!, { orientation: OrientationState.ACTIVE }],
    ]);

    const withoutWaitingResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
    );

    expect(withoutWaitingResult.success).toBe(false);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();

    player.memberSlots.cardStates = new Map([
      [stageCardId!, { orientation: OrientationState.WAITING }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceCardId);
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.amount === 3
      )
    ).toBe(true);
  });

  it('applies PL!SP-bp5-003-AR stage source cost reduction before relay payment', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('chisato-stage-cost-modifier-payment', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    const ownedMemberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const sourceCardId = ownedMemberCardIds[0];
    const stageCardId = ownedMemberCardIds[1];

    expect(sourceCardId).toBeTruthy();
    expect(stageCardId).toBeTruthy();
    const activeEnergyCardId = player.energyZone.cardIds[0];
    expect(activeEnergyCardId).toBeTruthy();
    player.energyZone.cardIds = [activeEnergyCardId!];
    player.energyZone.cardStates = new Map([
      [activeEnergyCardId!, { orientation: OrientationState.ACTIVE }],
    ]);

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as {
      data: MemberCardData;
    };
    sourceCard.data = createMemberCard('PL!SP-test-cost10', '10费Liella!成员', 10);

    const stageCard = state.cardRegistry.get(stageCardId!) as unknown as {
      data: MemberCardData;
    };
    stageCard.data = createMemberCard('TEST-non-source', '非减费来源成员', 7);

    player.hand.cardIds = [sourceCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== sourceCardId && cardId !== stageCardId
    );
    player.memberSlots.slots[SlotPosition.CENTER] = stageCardId!;
    player.memberSlots.cardStates = new Map([
      [stageCardId!, { orientation: OrientationState.ACTIVE }],
    ]);

    const withoutChisatoResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
    );

    expect(withoutChisatoResult.success).toBe(false);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(stageCardId);

    stageCard.data = createMemberCard('PL!SP-bp5-003-AR', '岚 千砂都', 7, {
      groupName: 'ラブライブ！スーパースター!!',
    });

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceCardId);
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.amount === 1
      )
    ).toBe(true);
  });

  it('uses PL!-bp4-008-P effective stage cost for relay payment when success Live score is at least 6', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'bp4-008-effective-cost-relay-payment',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      successZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    const ownedMemberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const successLiveCardId = player.mainDeck.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const sourceCardId = ownedMemberCardIds[0];
    const stageCardId = ownedMemberCardIds[1];

    expect(sourceCardId).toBeTruthy();
    expect(stageCardId).toBeTruthy();
    expect(successLiveCardId).toBeTruthy();

    const activeEnergyCardIds = [
      ...player.energyZone.cardIds,
      ...player.energyDeck.cardIds.slice(0, 3),
    ];
    expect(activeEnergyCardIds).toHaveLength(6);
    player.energyDeck.cardIds = player.energyDeck.cardIds.filter(
      (cardId) => !activeEnergyCardIds.includes(cardId)
    );
    player.energyZone.cardIds = activeEnergyCardIds;
    player.energyZone.cardStates = new Map(
      activeEnergyCardIds.map((cardId) => [cardId, { orientation: OrientationState.ACTIVE }])
    );

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as {
      data: MemberCardData;
    };
    sourceCard.data = createMemberCard('PL!-TEST-COST11', '11费测试成员', 11);

    const stageCard = state.cardRegistry.get(stageCardId!) as unknown as {
      data: MemberCardData;
    };
    stageCard.data = createMemberCard('PL!-bp4-008-P', '小泉花阳', 4);

    const successLiveCard = state.cardRegistry.get(successLiveCardId!) as unknown as {
      data: LiveCardData;
    };
    successLiveCard.data = createLiveCard('PL!-bp6-022-L', {
      score: 9,
      groupName: "μ's",
    });

    player.hand.cardIds = [sourceCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) =>
        cardId !== sourceCardId && cardId !== stageCardId && cardId !== successLiveCardId
    );
    player.successZone.cardIds = [successLiveCardId!];
    player.memberSlots.slots[SlotPosition.CENTER] = stageCardId!;
    player.memberSlots.cardStates = new Map([
      [stageCardId!, { orientation: OrientationState.ACTIVE }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceCardId);
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.amount === 4
      )
    ).toBe(true);
    expect(
      session.state?.eventLog.at(-1)?.event
    ).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_STAGE,
      cardInstanceId: sourceCardId,
      replacedMemberCardId: stageCardId,
      replacedMemberEffectiveCost: 7,
    });
  });

  it('debug free play skips entry cost validation and payment', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('member-debug-free-play', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(memberCardId).toBeTruthy();
    player.energyZone.cardIds = [];
    player.energyZone.cardStates = new Map();

    const normalResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.CENTER)
    );

    expect(normalResult.success).toBe(false);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBeNull();

    session.localFreePlay = true;
    const localFreePlayResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.CENTER)
    );

    expect(localFreePlayResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(memberCardId);
    expect(session.state?.players[0].energyZone.cardIds).toEqual([]);
  });

  it('free play fallback remains available in solitaire mode', () => {
    const localSession = createGameSession();
    localSession.localFreePlay = true;
    expect(localSession.localFreePlay).toBe(true);
    localSession.gameMode = GameMode.SOLITAIRE;
    expect(localSession.localFreePlay).toBe(true);

    const session = createGameSession({ gameMode: GameMode.SOLITAIRE });
    const deck = createDeck();

    session.createGame('member-solitaire-free-play-guard', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(memberCardId).toBeTruthy();
    player.energyZone.cardIds = [];
    player.energyZone.cardStates = new Map();

    session.localFreePlay = true;

    expect(session.localFreePlay).toBe(true);
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(memberCardId);
    expect(session.state?.players[0].energyZone.cardIds).toEqual([]);
  });
});
