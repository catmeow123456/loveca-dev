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
  ZoneType,
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
import { createPublicObjectId } from '../../src/online/projector';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  name: string,
  cost: number,
  options: {
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly cardText?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: options.groupNames,
    unitName: options.unitName,
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
    readonly groupNames?: readonly string[];
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: `Live ${cardCode}`,
    cardType: CardType.LIVE,
    groupNames: options.groupNames,
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

function createDeck(energyCount: number = 12): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  for (let i = 0; i < 48; i++) {
    mainDeck.push(createMemberCard(`MEM-${i}`, `Member ${i}`, 2));
  }
  for (let i = 0; i < 12; i++) {
    mainDeck.push(createLiveCard(`LIVE-${i}`));
  }

  const energyDeck = Array.from({ length: energyCount }, (_, index) =>
    createEnergyCard(`ENE-${index}`)
  );
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

function setActiveEnergyCountForPlayer(
  session: ReturnType<typeof createGameSession>,
  playerIndex: number,
  count: number
): void {
  const state = session.state!;
  const player = state.players[playerIndex] as unknown as {
    energyDeck: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState }>;
    };
  };
  const cardIds = [...player.energyZone.cardIds, ...player.energyDeck.cardIds].slice(0, count);
  const cardIdSet = new Set(cardIds);
  player.energyZone.cardIds = cardIds;
  player.energyZone.cardStates = new Map(
    cardIds.map((cardId) => [cardId, { orientation: OrientationState.ACTIVE }])
  );
  player.energyDeck.cardIds = player.energyDeck.cardIds.filter((cardId) => !cardIdSet.has(cardId));
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
        energyBelow: Record<SlotPosition, string[]>;
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

  it('prevents PL!HS-bp6-006 from being relayed away by a non-Mira-Cra member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp6-006-non-miracra-relay-prohibition', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
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
      waitingRoom: { cardIds: string[] };
    };
    const ownedMemberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const incomingCardId = ownedMemberCardIds[0];
    const himeCardId = ownedMemberCardIds[1];

    expect(incomingCardId).toBeTruthy();
    expect(himeCardId).toBeTruthy();

    (state.cardRegistry.get(incomingCardId!) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!HS-test-cerise-incoming', 'Non Mira-Cra Incoming', 4, {
        groupNames: ['蓮ノ空'],
      });
    (state.cardRegistry.get(himeCardId!) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!HS-bp6-006-SEC', '安養寺 姫芽', 20, {
        groupNames: ['蓮ノ空'],
      });
    setActiveEnergyCountForPlayer(session, 0, 4);

    player.hand.cardIds = [incomingCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== incomingCardId && cardId !== himeCardId
    );
    player.memberSlots.slots[SlotPosition.CENTER] = himeCardId!;
    player.memberSlots.cardStates = new Map([
      [himeCardId!, { orientation: OrientationState.ACTIVE }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, incomingCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(false);
    expect(playResult.error).toContain('无法因换手');
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(himeCardId);
    expect(session.state?.players[0].hand.cardIds).toEqual([incomingCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(himeCardId);
  });

  it('allows PL!HS-bp6-006 to be relayed away by a Mira-Cra member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp6-006-miracra-relay-allowed', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
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
      waitingRoom: { cardIds: string[] };
    };
    const ownedMemberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const incomingCardId = ownedMemberCardIds[0];
    const himeCardId = ownedMemberCardIds[1];

    expect(incomingCardId).toBeTruthy();
    expect(himeCardId).toBeTruthy();

    (state.cardRegistry.get(incomingCardId!) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!HS-test-miracra-incoming', 'Mira-Cra Incoming', 4, {
        groupNames: ['蓮ノ空'],
        unitName: 'みらくらぱーく！',
      });
    (state.cardRegistry.get(himeCardId!) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!HS-bp6-006-SEC', '安養寺 姫芽', 20, {
        groupNames: ['蓮ノ空'],
        unitName: 'みらくらぱーく！',
      });

    player.hand.cardIds = [incomingCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== incomingCardId && cardId !== himeCardId
    );
    player.memberSlots.slots[SlotPosition.CENTER] = himeCardId!;
    player.memberSlots.cardStates = new Map([
      [himeCardId!, { orientation: OrientationState.ACTIVE }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, incomingCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(incomingCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(himeCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(incomingCardId);
  });

  it('applies PL!HS-bp6-006 hand cost reduction using pre-relay Mira-Cra stage count', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp6-006-q249-cost-payment', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
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
    const himeIncomingCardId = ownedMemberCardIds[0];
    const stageCardIds = ownedMemberCardIds.slice(1, 4);

    expect(himeIncomingCardId).toBeTruthy();
    expect(stageCardIds).toHaveLength(3);

    (state.cardRegistry.get(himeIncomingCardId!) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!HS-bp6-006-SEC', '安養寺 姫芽', 20, {
        groupNames: ['蓮ノ空'],
        unitName: 'みらくらぱーく！',
      });
    for (const stageCardId of stageCardIds) {
      (state.cardRegistry.get(stageCardId) as unknown as { data: MemberCardData }).data =
        createMemberCard(`PL!HS-test-miracra-${stageCardId}`, 'Mira-Cra Stage', 4, {
          groupNames: ['蓮ノ空'],
          unitName: 'みらくらぱーく！',
        });
    }
    setActiveEnergyCountForPlayer(session, 0, 10);

    player.hand.cardIds = [himeIncomingCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== himeIncomingCardId && !stageCardIds.includes(cardId)
    );
    player.memberSlots.slots[SlotPosition.LEFT] = stageCardIds[0]!;
    player.memberSlots.slots[SlotPosition.CENTER] = stageCardIds[1]!;
    player.memberSlots.slots[SlotPosition.RIGHT] = stageCardIds[2]!;
    player.memberSlots.cardStates = new Map(
      stageCardIds.map((cardId) => [cardId, { orientation: OrientationState.ACTIVE }])
    );

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, himeIncomingCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      himeIncomingCardId
    );
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.amount === 10
      )
    ).toBe(true);
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
      groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
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
    sourceCard.data = createMemberCard('PL!SP-test-cost10', '10费Liella!成员', 10, {
      groupNames: ['Liella!'],
    });

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
      groupNames: ['ラブライブ！スーパースター!!'],
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

  it("applies Music S.T.A.R.T!! success zone reduction on a real hand play payment path", () => {
    const session = createGameSession();
    const deck = createDeck(20);

    session.createGame('bp6-019-music-start-cost-payment', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);
    setActiveEnergyCountForPlayer(session, 0, 15);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      successZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
      };
    };
    const opponent = state.players[1] as unknown as {
      successZone: { cardIds: string[] };
    };
    const ownedMemberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const musicStartCardId = player.mainDeck.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const opponentMusicStartCardId = player.mainDeck.cardIds.find(
      (cardId) =>
        cardId !== musicStartCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const sourceCardId = ownedMemberCardIds[0];

    expect(sourceCardId).toBeTruthy();
    expect(musicStartCardId).toBeTruthy();
    expect(opponentMusicStartCardId).toBeTruthy();

    (state.cardRegistry.get(sourceCardId!) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!-test-muse-cost17', '17费μ成员', 17, {
        groupNames: ["μ's"],
      });
    (state.cardRegistry.get(musicStartCardId!) as unknown as { data: LiveCardData }).data =
      createLiveCard('PL!-bp6-019-L', {
        score: 2,
        groupNames: ["μ's"],
      });
    (state.cardRegistry.get(opponentMusicStartCardId!) as unknown as { data: LiveCardData }).data =
      createLiveCard('PL!-bp6-019-L', {
        score: 2,
        groupNames: ["μ's"],
      });

    player.hand.cardIds = [sourceCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) =>
        cardId !== sourceCardId &&
        cardId !== musicStartCardId &&
        cardId !== opponentMusicStartCardId
    );
    opponent.successZone.cardIds = [opponentMusicStartCardId!];

    const withoutOwnSuccessLive = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
    );
    expect(withoutOwnSuccessLive.success).toBe(false);
    expect(withoutOwnSuccessLive.error).toContain('需要 17 能量');
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();

    player.successZone.cardIds = [musicStartCardId!];

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success, playResult.error).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(sourceCardId);
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.amount === 15
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
    const energyBelowCardId = player.energyDeck.cardIds[0];
    expect(energyBelowCardId).toBeTruthy();
    player.energyDeck.cardIds = player.energyDeck.cardIds.filter(
      (cardId) => cardId !== energyBelowCardId
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
      groupNames: ["μ's"],
    });

    player.hand.cardIds = [sourceCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) =>
        cardId !== sourceCardId && cardId !== stageCardId && cardId !== successLiveCardId
    );
    player.successZone.cardIds = [successLiveCardId!];
    player.memberSlots.slots[SlotPosition.CENTER] = stageCardId!;
    player.memberSlots.energyBelow[SlotPosition.CENTER] = [energyBelowCardId!];
    player.memberSlots.cardStates = new Map([
      [stageCardId!, { orientation: OrientationState.ACTIVE }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceCardId);
    expect(session.state?.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(session.state?.players[0].energyDeck.cardIds).toContain(energyBelowCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(energyBelowCardId);
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

  it('plays PL!SP-bp4-004 with explicit double relay and records both replacements', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sp-bp4-004-double-relay-payment', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);
    setActiveEnergyCountForPlayer(session, 0, 9);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        energyBelow: Record<SlotPosition, string[]>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    const ownedMemberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const sourceCardId = ownedMemberCardIds[0];
    const centerCardId = ownedMemberCardIds[1];
    const leftCardId = ownedMemberCardIds[2];

    expect(sourceCardId).toBeTruthy();
    expect(centerCardId).toBeTruthy();
    expect(leftCardId).toBeTruthy();

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as {
      data: MemberCardData;
    };
    sourceCard.data = createMemberCard('PL!SP-bp4-004-P', '平安名すみれ', 22, {
      groupNames: ['Liella!'],
    });
    const centerCard = state.cardRegistry.get(centerCardId!) as unknown as {
      data: MemberCardData;
    };
    centerCard.data = createMemberCard('PL!SP-test-center', 'Center Liella', 8, {
      groupNames: ['Liella!'],
    });
    const leftCard = state.cardRegistry.get(leftCardId!) as unknown as {
      data: MemberCardData;
    };
    leftCard.data = createMemberCard('PL!SP-test-left', 'Left Liella', 5, {
      groupNames: ['Liella!'],
    });

    player.hand.cardIds = [sourceCardId!];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== sourceCardId && cardId !== centerCardId && cardId !== leftCardId
    );
    const centerEnergyBelowId = player.energyDeck.cardIds[0];
    const leftEnergyBelowId = player.energyDeck.cardIds[1];
    expect(centerEnergyBelowId).toBeTruthy();
    expect(leftEnergyBelowId).toBeTruthy();
    player.energyDeck.cardIds = player.energyDeck.cardIds.filter(
      (cardId) => cardId !== centerEnergyBelowId && cardId !== leftEnergyBelowId
    );
    player.memberSlots.slots[SlotPosition.CENTER] = centerCardId!;
    player.memberSlots.slots[SlotPosition.LEFT] = leftCardId!;
    player.memberSlots.energyBelow[SlotPosition.CENTER] = [centerEnergyBelowId!];
    player.memberSlots.energyBelow[SlotPosition.LEFT] = [leftEnergyBelowId!];
    player.memberSlots.cardStates = new Map([
      [centerCardId!, { orientation: OrientationState.ACTIVE }],
      [leftCardId!, { orientation: OrientationState.ACTIVE }],
    ]);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER, {
        relayMode: 'DOUBLE',
        relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.LEFT],
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceCardId);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(session.state?.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(
      expect.arrayContaining([centerEnergyBelowId, leftEnergyBelowId])
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([centerCardId, leftCardId])
    );
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(centerEnergyBelowId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(leftEnergyBelowId);

    const leaveEvents = session.state?.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_LEAVE_STAGE);
    expect(leaveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardInstanceId: centerCardId,
          fromSlot: SlotPosition.CENTER,
          replacingCardId: sourceCardId,
        }),
        expect.objectContaining({
          cardInstanceId: leftCardId,
          fromSlot: SlotPosition.LEFT,
          replacingCardId: sourceCardId,
        }),
      ])
    );

    const enterEvent = session.state?.eventLog.at(-1)?.event;
    expect(enterEvent).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_STAGE,
      cardInstanceId: sourceCardId,
      toSlot: SlotPosition.CENTER,
      replacedMemberCardId: centerCardId,
      replacedMemberEffectiveCost: 8,
      relayReplacements: [
        { cardId: centerCardId, slot: SlotPosition.CENTER, effectiveCost: 8 },
        { cardId: leftCardId, slot: SlotPosition.LEFT, effectiveCost: 5 },
      ],
    });

    const payCostAction = session.state?.actionHistory.find(
      (action) => action.type === 'PAY_COST' && action.payload.sourceCardId === sourceCardId
    );
    expect(payCostAction?.payload).toMatchObject({
      amount: 9,
      relayDiscount: 13,
      replacedMemberCardId: centerCardId,
      relayReplacements: [
        { cardId: centerCardId, slot: SlotPosition.CENTER, effectiveCost: 8 },
        { cardId: leftCardId, slot: SlotPosition.LEFT, effectiveCost: 5 },
      ],
    });

    const playAction = session.state?.actionHistory.find(
      (action) => action.type === 'PLAY_MEMBER' && action.payload.cardId === sourceCardId
    );
    expect(playAction?.payload).toMatchObject({
      isRelay: true,
      replacedCardId: centerCardId,
      replacedMemberCardIds: [centerCardId, leftCardId],
      relayReplacements: [
        { cardId: centerCardId, slot: SlotPosition.CENTER, effectiveCost: 8 },
        { cardId: leftCardId, slot: SlotPosition.LEFT, effectiveCost: 5 },
      ],
    });

    const publicEvents = session.getPublicEventsSince(beforeSeq);
    expect(
      publicEvents.filter(
        (event) =>
          event.type === 'CardMovedPublic' &&
          [centerCardId, leftCardId].some(
            (cardId) => event.card?.publicObjectId === createPublicObjectId(cardId!)
          ) &&
          event.from?.zone === ZoneType.MEMBER_SLOT &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toHaveLength(2);
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
