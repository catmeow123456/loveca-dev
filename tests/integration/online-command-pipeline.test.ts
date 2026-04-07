import { describe, expect, it } from 'vitest';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
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
import {
  createAttachEnergyToMemberCommand,
  createConfirmPerformanceOutcomeCommand,
  createDrawCardToHandCommand,
  createDrawEnergyToZoneCommand,
  createEndPhaseCommand,
  createFinishInspectionCommand,
  createMulliganCommand,
  createRevealInspectedCardCommand,
  createMoveInspectedCardToZoneCommand,
  createMoveInspectedCardToTopCommand,
  createMoveInspectedCardToBottomCommand,
  createMoveMemberToSlotCommand,
  createMoveResolutionCardToZoneCommand,
  createMovePublicCardToHandCommand,
  createMovePublicCardToWaitingRoomCommand,
  createMoveTableCardCommand,
  createRevealCheerCardCommand,
  createOpenInspectionCommand,
  createPlayMemberToSlotCommand,
  createReorderInspectedCardCommand,
  createReturnHandCardToTopCommand,
  createSetLiveCardCommand,
  createSelectSuccessLiveCommand,
  createTapEnergyCommand,
  createTapMemberCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createPublicObjectId } from '../../src/online/projector';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createTestMemberCard(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createTestLiveCard(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createTestEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `能量 ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createTestDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  for (let i = 0; i < 48; i++) {
    mainDeck.push(createTestMemberCard(`MEM-${i}`, `成员 ${i}`));
  }

  for (let i = 0; i < 12; i++) {
    mainDeck.push(createTestLiveCard(`LIVE-${i}`, `Live ${i}`));
    energyDeck.push(createTestEnergyCard(`ENE-${i}`));
  }

  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(
  session: ReturnType<typeof createGameSession>,
  activePlayerIndex = 0
): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.NONE;
  state.activePlayerIndex = activePlayerIndex;
  state.waitingPlayerId = null;
}

describe('GameSession command pipeline', () => {
  it('按检视命令打开检视区、移动卡牌并产出公共事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-1', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const topCardId = session.state?.players[0].mainDeck.cardIds[0];
    expect(topCardId).toBeTruthy();

    const openSeq = session.getCurrentPublicEventSeq();
    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );

    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toContain(topCardId);

    const openEvents = session.getPublicEventsSince(openSeq);
    expect(
      openEvents.some(
        (event) =>
          event.type === 'CardsInspectedSummary' &&
          event.actorSeat === 'FIRST' &&
          event.sourceZone === ZoneType.MAIN_DECK &&
          event.count === 1
      )
    ).toBe(true);
    expect(
      openEvents.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(topCardId!) &&
          event.from?.zone === ZoneType.MAIN_DECK &&
          event.to?.zone === 'INSPECTION_ZONE'
      )
    ).toBe(true);

    const moveSeq = session.getCurrentPublicEventSeq();
    const moveResult = session.executeCommand(
      createMoveInspectedCardToZoneCommand(PLAYER1, topCardId!, ZoneType.HAND)
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).not.toContain(topCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(topCardId);

    const moveEvents = session.getPublicEventsSince(moveSeq);
    expect(
      moveEvents.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(topCardId!) &&
          event.from?.zone === 'INSPECTION_ZONE' &&
          event.to?.zone === ZoneType.HAND
      )
    ).toBe(true);

    const finishSeq = session.getCurrentPublicEventSeq();
    const finishResult = session.executeCommand(createFinishInspectionCommand(PLAYER1));

    expect(finishResult.success).toBe(true);

    const finishEvents = session.getPublicEventsSince(finishSeq);
    expect(
      finishEvents.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.actorSeat === 'FIRST' &&
          event.declarationType === 'INSPECTION_FINISHED' &&
          event.publicValue === 0
      )
    ).toBe(true);
  });

  it('检视区重排会更新检视顺序并产出同区公共移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-2', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const firstTopCardId = session.state?.players[0].mainDeck.cardIds[0];
    const secondTopCardId = session.state?.players[0].mainDeck.cardIds[1];
    expect(firstTopCardId).toBeTruthy();
    expect(secondTopCardId).toBeTruthy();

    session.executeCommand(createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 2));
    expect(session.state?.inspectionZone.cardIds.slice(0, 2)).toEqual([
      firstTopCardId,
      secondTopCardId,
    ]);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const reorderResult = session.executeCommand(
      createReorderInspectedCardCommand(PLAYER1, secondTopCardId!, 0)
    );

    expect(reorderResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds.slice(0, 2)).toEqual([
      secondTopCardId,
      firstTopCardId,
    ]);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(secondTopCardId!) &&
          event.from?.zone === 'INSPECTION_ZONE' &&
          event.to?.zone === 'INSPECTION_ZONE' &&
          event.from?.index === 1 &&
          event.to?.index === 0
      )
    ).toBe(true);
  });

  it('从能量卡组打开检视后，回顶和回底会回到原来源区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-energy-inspection', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const firstEnergyId = session.state?.players[0].energyDeck.cardIds[0];
    const secondEnergyId = session.state?.players[0].energyDeck.cardIds[1];
    expect(firstEnergyId).toBeTruthy();
    expect(secondEnergyId).toBeTruthy();

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.ENERGY_DECK, 2)
    );
    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionContext?.sourceZone).toBe(ZoneType.ENERGY_DECK);

    const topResult = session.executeCommand(
      createMoveInspectedCardToTopCommand(PLAYER1, firstEnergyId!)
    );
    expect(topResult.success).toBe(true);
    expect(session.state?.players[0].energyDeck.cardIds[0]).toBe(firstEnergyId);

    const bottomResult = session.executeCommand(
      createMoveInspectedCardToBottomCommand(PLAYER1, secondEnergyId!)
    );
    expect(bottomResult.success).toBe(true);
    expect(session.state?.players[0].energyDeck.cardIds.at(-1)).toBe(secondEnergyId);
  });

  it('检视流程进行中时会拒绝非检视命令，并要求清空后才能结束', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-inspection-guard', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const inspectedCardId = session.state?.players[0].mainDeck.cardIds[0];
    const handCardId = session.state?.players[0].hand.cardIds[0];
    expect(inspectedCardId).toBeTruthy();
    expect(handCardId).toBeTruthy();

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);

    const endPhaseResult = session.executeCommand(createEndPhaseCommand(PLAYER1));
    expect(endPhaseResult.success).toBe(false);
    expect(endPhaseResult.error).toContain('检视流程');

    const prematureFinishResult = session.executeCommand(createFinishInspectionCommand(PLAYER1));
    expect(prematureFinishResult.success).toBe(false);
    expect(prematureFinishResult.error).toContain('未处理');

    const outsiderResult = session.executeCommand(
      createReturnHandCardToTopCommand(PLAYER2, handCardId!)
    );
    expect(outsiderResult.success).toBe(false);
    expect(outsiderResult.error).toContain('检视玩家');

    const moveResult = session.executeCommand(
      createMoveInspectedCardToZoneCommand(PLAYER1, inspectedCardId!, ZoneType.HAND)
    );
    expect(moveResult.success).toBe(true);

    const finishResult = session.executeCommand(createFinishInspectionCommand(PLAYER1));
    expect(finishResult.success).toBe(true);
    expect(session.state?.inspectionContext).toBeNull();
  });

  it('检视区中的牌可以被公开，并让对手看到 FRONT', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-inspection-reveal', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const inspectedCardId = session.state?.players[0].mainDeck.cardIds[0];
    expect(inspectedCardId).toBeTruthy();

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const revealResult = session.executeCommand(
      createRevealInspectedCardCommand(PLAYER1, inspectedCardId!)
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(inspectedCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardRevealed' &&
          event.actorSeat === 'FIRST' &&
          event.reason === 'INSPECTION_REVEAL' &&
          event.card.publicObjectId === createPublicObjectId(inspectedCardId!)
      )
    ).toBe(true);

    const opponentView = session.getPlayerViewState(PLAYER2);
    const inspectionObjectId = createPublicObjectId(inspectedCardId!);
    expect(opponentView?.objects[inspectionObjectId]?.surface).toBe('FRONT');
    expect(opponentView?.objects[inspectionObjectId]?.frontInfo?.cardCode).toBeDefined();
  });

  it('翻开应援牌会进入解决区并产出 CardRevealed', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-3', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
    };
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    state.activePlayerIndex = 0;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createRevealCheerCardCommand(PLAYER1));
    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.to?.zone === ZoneType.RESOLUTION_ZONE &&
          event.card.cardCode === undefined
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'CardRevealed' &&
          event.actorSeat === 'FIRST' &&
          event.reason === 'CHEER_REVEAL' &&
          event.card.cardCode !== undefined
      )
    ).toBe(true);
    expect(session.state?.resolutionZone.revealedCardIds).toHaveLength(1);
  });

  it('进入演出阶段时系统自动翻开 Live 会产出系统公开事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-performance-reveal', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      liveSetCompletedPlayers: string[];
    };
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      liveZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    player.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_DOWN,
        },
      ],
    ]);

    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.currentSubPhase = SubPhase.LIVE_SET_SECOND_DRAW;
    mutableState.activePlayerIndex = 0;
    mutableState.liveSetCompletedPlayers = [PLAYER1, PLAYER2];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.advancePhase();
    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardRevealed' &&
          event.source === 'SYSTEM' &&
          event.reason === 'PERFORMANCE_REVEAL' &&
          event.card.publicObjectId === createPublicObjectId(liveCardId!)
      )
    ).toBe(true);
  });

  it('系统自动补能量到公开能量区时会产出公开移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-system-draw-energy', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const topEnergyCardId = session.state?.players[0].energyDeck.cardIds[0];
    expect(topEnergyCardId).toBeTruthy();

    const state = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    state.currentPhase = GamePhase.ACTIVE_PHASE;
    state.currentSubPhase = SubPhase.NONE;
    state.activePlayerIndex = 0;
    state.waitingPlayerId = null;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.advancePhase();
    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.source === 'SYSTEM' &&
          event.card?.publicObjectId === createPublicObjectId(topEnergyCardId!) &&
          event.from?.zone === ZoneType.ENERGY_DECK &&
          event.from?.index === 0 &&
          event.to?.zone === ZoneType.ENERGY_ZONE
      )
    ).toBe(true);
  });

  it('主阶段允许用专用命令把能量卡组顶牌放到能量区，并拒绝跨边界万能移动', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-draw-energy-to-zone', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const topEnergyCardId = session.state?.players[0].energyDeck.cardIds[0];
    expect(topEnergyCardId).toBeTruthy();

    const genericMoveResult = session.executeCommand(
      createMoveTableCardCommand(PLAYER1, topEnergyCardId!, ZoneType.ENERGY_DECK, ZoneType.ENERGY_ZONE)
    );
    expect(genericMoveResult.success).toBe(false);
    expect(genericMoveResult.error).toContain('专用命令');

    const beforeSeq = session.getCurrentPublicEventSeq();
    const drawEnergyResult = session.executeCommand(
      createDrawEnergyToZoneCommand(PLAYER1, topEnergyCardId!)
    );

    expect(drawEnergyResult.success).toBe(true);
    expect(session.state?.players[0].energyDeck.cardIds).not.toContain(topEnergyCardId);
    expect(session.state?.players[0].energyZone.cardIds).toContain(topEnergyCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(topEnergyCardId!) &&
          event.from?.zone === ZoneType.ENERGY_DECK &&
          event.to?.zone === ZoneType.ENERGY_ZONE
      )
    ).toBe(true);
  });

  it('Live 放置阶段允许把己方 Live 回手，但其他公开区回手命令仍不在判定阶段开放', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-live-return', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    const player = state.players[0];
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    player.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_DOWN,
        },
      ],
    ]);

    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.currentSubPhase = SubPhase.LIVE_SET_FIRST_PLAYER;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const returnResult = session.executeCommand(
      createMovePublicCardToHandCommand(PLAYER1, liveCardId!, ZoneType.LIVE_ZONE)
    );
    expect(returnResult.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(liveCardId);

    const nextPlayer = session.state!.players[0];
    nextPlayer.hand.cardIds = nextPlayer.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    nextPlayer.liveZone.cardIds = [liveCardId!];
    nextPlayer.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_DOWN,
        },
      ],
    ]);

    const blockedPhaseState = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
    };
    blockedPhaseState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    blockedPhaseState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;

    const blockedResult = session.executeCommand(
      createMovePublicCardToHandCommand(PLAYER1, liveCardId!, ZoneType.LIVE_ZONE)
    );
    expect(blockedResult.success).toBe(false);
    expect(blockedResult.error).toContain('可回手阶段');
  });

  it('解决区命令可在 Live 判定阶段处理应援牌', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-resolution-move', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
    };
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    state.activePlayerIndex = 0;

    const revealResult = session.executeCommand(createRevealCheerCardCommand(PLAYER1));
    expect(revealResult.success).toBe(true);

    const resolutionCardId = session.state?.resolutionZone.cardIds[0];
    expect(resolutionCardId).toBeTruthy();

    const beforeSeq = session.getCurrentPublicEventSeq();
    const moveResult = session.executeCommand(
      createMoveResolutionCardToZoneCommand(PLAYER1, resolutionCardId!, ZoneType.WAITING_ROOM)
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.resolutionZone.cardIds).not.toContain(resolutionCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(resolutionCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(resolutionCardId!) &&
          event.from?.zone === ZoneType.RESOLUTION_ZONE &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
  });

  it('确认 Live 失败会清空应援区与 Live 区到休息室', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-4', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      resolutionZone: { cardIds: string[]; revealedCardIds: string[] };
    };
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    mutableState.activePlayerIndex = 0;

    const player = state.players[0] as unknown as {
      mainDeck: { cardIds: string[] };
      hand: { cardIds: string[] };
      liveZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    const resolutionCardId = player.mainDeck.cardIds.find((cardId) => cardId !== liveCardId);

    expect(resolutionCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== resolutionCardId && cardId !== liveCardId
    );
    player.hand.cardIds = player.hand.cardIds.filter(
      (cardId) => cardId !== resolutionCardId && cardId !== liveCardId
    );
    mutableState.resolutionZone.cardIds = [resolutionCardId!];
    mutableState.resolutionZone.revealedCardIds = [resolutionCardId!];
    player.liveZone.cardIds = [liveCardId!];
    player.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        },
      ],
    ]);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createConfirmPerformanceOutcomeCommand(PLAYER1, false));
    expect(result.success).toBe(true);

    expect(session.state?.resolutionZone.cardIds).not.toContain(resolutionCardId);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(resolutionCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(liveCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.actorSeat === 'FIRST' &&
          event.declarationType === 'PERFORMANCE_FAILED'
      )
    ).toBe(true);
  });

  it('桌面移动命令只处理公开区之间的移动，抽卡与放回顶部走专用命令', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-5', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    forceMainPhaseForPlayer(session);

    const drawResult = session.executeCommand(createDrawCardToHandCommand(PLAYER1));
    expect(drawResult.success).toBe(true);

    const returnedCardId = session.state?.players[0].hand.cardIds.at(-1);
    expect(returnedCardId).toBeTruthy();

    const returnResult = session.executeCommand(
      createReturnHandCardToTopCommand(PLAYER1, returnedCardId!)
    );
    expect(returnResult.success).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(returnedCardId);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
    };
    const publicCardId = player.hand.cardIds[0];
    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== publicCardId);
    player.waitingRoom.cardIds = [publicCardId!];
    expect(publicCardId).toBeTruthy();

    const beforeSeq = session.getCurrentPublicEventSeq();
    const moveResult = session.executeCommand(
      createMoveTableCardCommand(
        PLAYER1,
        publicCardId!,
        ZoneType.WAITING_ROOM,
        ZoneType.SUCCESS_ZONE
      )
    );
    expect(moveResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(publicCardId);
    expect(session.state?.players[0].successZone.cardIds).toContain(publicCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(publicCardId!) &&
          event.from?.zone === ZoneType.WAITING_ROOM &&
          event.to?.zone === ZoneType.SUCCESS_ZONE
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.actorSeat === 'FIRST' &&
          event.declarationType === 'TABLE_CARD_MOVED'
      )
    ).toBe(true);
  });

  it('成员槽位换位命令会移动成员并产出带 slot 的公共事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-6', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const memberCardId = player.hand.cardIds[0];
    expect(memberCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== memberCardId);
    player.memberSlots.slots[SlotPosition.LEFT] = memberCardId!;
    player.memberSlots.slots[SlotPosition.CENTER] = null;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createMoveMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.LEFT, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(memberCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.from?.zone === ZoneType.MEMBER_SLOT &&
          event.from?.slot === SlotPosition.LEFT &&
          event.to?.zone === ZoneType.MEMBER_SLOT &&
          event.to?.slot === SlotPosition.CENTER
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' && event.declarationType === 'MEMBER_MOVED_TO_SLOT'
      )
    ).toBe(true);
  });

  it('能量附着命令会把能量移到成员下方并产出成员槽位公共事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-7', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      energyZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        energyBelow: Record<SlotPosition, string[]>;
      };
    };

    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardId = player.energyZone.cardIds[0];
    expect(memberCardId).toBeTruthy();
    expect(energyCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== memberCardId);
    player.memberSlots.slots[SlotPosition.CENTER] = memberCardId!;
    player.memberSlots.energyBelow[SlotPosition.CENTER] = [];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createAttachEnergyToMemberCommand(
        PLAYER1,
        energyCardId!,
        ZoneType.ENERGY_ZONE,
        SlotPosition.CENTER
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].energyZone.cardIds).not.toContain(energyCardId);
    expect(session.state?.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toContain(
      energyCardId
    );

    const events = session.getPublicEventsSince(beforeSeq);
    const moveEvent = events.find(
      (event) =>
        event.type === 'CardMovedPublic' &&
        event.from?.zone === ZoneType.ENERGY_ZONE &&
        event.to?.zone === ZoneType.MEMBER_SLOT &&
        event.to?.slot === SlotPosition.CENTER
    );
    expect(moveEvent).toBeTruthy();
    expect(moveEvent?.to?.overlayIndex).toBe(0);
    expect(moveEvent?.card?.cardCode).toBe(state.cardRegistry.get(energyCardId!)?.data.cardCode);
    expect(moveEvent?.card?.cardType).toBe(CardType.ENERGY);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' && event.declarationType === 'ENERGY_ATTACHED_TO_MEMBER'
      )
    ).toBe(true);
  });

  it('成员登场命令会从手牌进入成员区，并在换手时把原成员送去休息室', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-8', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const enteringCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const existingStageCardId = player.hand.cardIds.find(
      (cardId) =>
        cardId !== enteringCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(enteringCardId).toBeTruthy();
    expect(existingStageCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== existingStageCardId);
    player.memberSlots.slots[SlotPosition.CENTER] = existingStageCardId!;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, enteringCardId!, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(enteringCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(enteringCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(existingStageCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(existingStageCardId!) &&
          event.from?.zone === ZoneType.MEMBER_SLOT &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'CardRevealedAndMoved' &&
          event.card?.publicObjectId === createPublicObjectId(enteringCardId!) &&
          event.from?.zone === ZoneType.HAND &&
          event.to?.zone === ZoneType.MEMBER_SLOT &&
          event.to?.slot === SlotPosition.CENTER &&
          event.card?.cardCode === state.cardRegistry.get(enteringCardId!)?.data.cardCode &&
          event.reason === 'PLAY_MEMBER'
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' && event.declarationType === 'PLAY_MEMBER_TO_SLOT'
      )
    ).toBe(true);
  });

  it('切换能量状态命令会更新能量朝向并产出公开声明', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-energy-toggle', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const energyCardId = state.players[0].energyZone.cardIds[0];
    expect(energyCardId).toBeTruthy();

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createTapEnergyCommand(PLAYER1, energyCardId!));

    expect(result.success).toBe(true);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardId!)?.orientation).toBe(
      OrientationState.WAITING
    );

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.declarationType === 'ENERGY_STATE_TOGGLED' &&
          event.publicValue === energyCardId
      )
    ).toBe(true);
  });

  it('成功 Live 选择命令会把 Live 卡移入成功区并产出公共移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-9', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      liveZone: { cardIds: string[] };
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const mutableState = state as unknown as {
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      liveResolution: { liveWinnerIds: string[] };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution.liveWinnerIds = [PLAYER1];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createSelectSuccessLiveCommand(PLAYER1, liveCardId!));

    expect(result.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].successZone.cardIds).toContain(liveCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(liveCardId!) &&
          event.from?.zone === ZoneType.LIVE_ZONE &&
          event.to?.zone === ZoneType.SUCCESS_ZONE
      )
    ).toBe(true);
  });

  it('公开区进入休息室命令会发出公开移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-10', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      successZone: { cardIds: string[] };
      hand: { cardIds: string[] };
    };
    const publicCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(publicCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== publicCardId);
    player.successZone.cardIds = [publicCardId!];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(PLAYER1, publicCardId!, ZoneType.SUCCESS_ZONE)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].successZone.cardIds).not.toContain(publicCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(publicCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    const moveEvent = events.find(
      (event) =>
        event.type === 'CardMovedPublic' &&
        event.card?.publicObjectId === createPublicObjectId(publicCardId!) &&
        event.from?.zone === ZoneType.SUCCESS_ZONE &&
        event.to?.zone === ZoneType.WAITING_ROOM
    );
    expect(moveEvent).toBeTruthy();
    expect(moveEvent?.card?.cardCode).toBe(state.cardRegistry.get(publicCardId!)?.data.cardCode);
    expect(moveEvent?.card?.name).toBe(state.cardRegistry.get(publicCardId!)?.data.name);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.declarationType === 'MOVE_PUBLIC_CARD_TO_WAITING_ROOM'
      )
    ).toBe(true);
  });

  it('公开区进入手牌命令会发出进入私有区的公共移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-public-to-hand', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      memberSlots: { slots: Record<SlotPosition, string | null> };
      hand: { cardIds: string[] };
    };
    const publicCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(publicCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== publicCardId);
    player.memberSlots.slots[SlotPosition.LEFT] = publicCardId!;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createMovePublicCardToHandCommand(
        PLAYER1,
        publicCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.LEFT
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(publicCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    const moveEvent = events.find(
      (event) =>
        event.type === 'CardMovedPublic' &&
        event.card?.publicObjectId === createPublicObjectId(publicCardId!) &&
        event.from?.zone === ZoneType.MEMBER_SLOT &&
        event.from?.slot === SlotPosition.LEFT &&
        event.to?.zone === ZoneType.HAND
    );
    expect(moveEvent).toBeTruthy();
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' && event.declarationType === 'MOVE_PUBLIC_CARD_TO_HAND'
      )
    ).toBe(true);
  });

  it('错误 seat 在非当前操作时机提交命令会被拒绝', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-11', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const player2HandCardId = session.state?.players[1].hand.cardIds[0];
    expect(player2HandCardId).toBeTruthy();

    const mulliganResult = session.executeCommand(createMulliganCommand(PLAYER2, []));
    expect(mulliganResult.success).toBe(false);
    expect(mulliganResult.error).toContain('当前不是该玩家的操作时机');

    const setLiveResult = session.executeCommand(
      createSetLiveCardCommand(PLAYER2, player2HandCardId!, true)
    );
    expect(setLiveResult.success).toBe(false);
    expect(setLiveResult.error).toContain('当前不是该玩家的操作时机');
  });

  it('公开拖拽命令不允许直接跨公开/隐藏边界', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-12', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const handCardId = session.state?.players[0].hand.cardIds[0];
    expect(handCardId).toBeTruthy();

    const result = session.executeCommand(
      createMoveTableCardCommand(PLAYER1, handCardId!, ZoneType.HAND, ZoneType.WAITING_ROOM)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('跨公开/隐藏边界的移动必须使用专用命令');
  });

  it('主要阶段命令在非主要阶段会被拒绝', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-main-phase-guard', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const memberCardId = session.state?.players[0].hand.cardIds.find(
      (cardId) => session.state?.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(memberCardId).toBeTruthy();

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.LEFT)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('当前不是主要阶段');
  });

  it('明置 Live 会产出 CardRevealedAndMoved，盖放 Live 仍只产出背面移动', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-face-up-live', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      activePlayerIndex: number;
    };
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    if (!player.hand.cardIds.includes(liveCardId!)) {
      player.hand.cardIds = [liveCardId!, ...player.hand.cardIds];
    }
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.activePlayerIndex = 0;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createSetLiveCardCommand(PLAYER1, liveCardId!, false));

    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    const revealAndMoveEvent = events.find(
      (event) =>
        event.type === 'CardRevealedAndMoved' &&
        event.card.publicObjectId === createPublicObjectId(liveCardId!) &&
        event.from?.zone === ZoneType.HAND &&
        event.to?.zone === ZoneType.LIVE_ZONE
    );
    expect(revealAndMoveEvent).toBeTruthy();
    expect(revealAndMoveEvent?.card.cardCode).toBe(
      state.cardRegistry.get(liveCardId!)?.data.cardCode
    );
    expect(revealAndMoveEvent?.reason).toBe('SET_LIVE_CARD');
  });

  it('盖放 Live 的公开移动事件不会泄露牌面信息', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-face-down-live', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      activePlayerIndex: number;
    };
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    if (!player.hand.cardIds.includes(liveCardId!)) {
      player.hand.cardIds = [liveCardId!, ...player.hand.cardIds];
    }
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.activePlayerIndex = 0;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createSetLiveCardCommand(PLAYER1, liveCardId!, true));

    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    const moveEvent = events.find(
      (event) =>
        event.type === 'CardMovedPublic' &&
        event.card?.publicObjectId === createPublicObjectId(liveCardId!) &&
        event.to?.zone === ZoneType.LIVE_ZONE
    );
    expect(moveEvent).toBeTruthy();
    expect(moveEvent?.card?.cardCode).toBeUndefined();
    expect(moveEvent?.card?.name).toBeUndefined();
    expect(moveEvent?.card?.cardType).toBeUndefined();
  });

  it('常用基础命令会通过命令层落到既有动作处理', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-13', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      activePlayerIndex: number;
    };
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    expect(memberCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    if (!player.hand.cardIds.includes(liveCardId!)) {
      player.hand.cardIds = [liveCardId!, ...player.hand.cardIds];
    }
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.activePlayerIndex = 0;

    const setLiveResult = session.executeCommand(
      createSetLiveCardCommand(PLAYER1, liveCardId!, true)
    );
    expect(setLiveResult.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).toContain(liveCardId);

    forceMainPhaseForPlayer(session);
    const playMemberResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.LEFT)
    );
    expect(playMemberResult.success).toBe(true);

    const tapResult = session.executeCommand(
      createTapMemberCommand(PLAYER1, memberCardId!, SlotPosition.LEFT)
    );
    expect(tapResult.success).toBe(true);

    const endPhaseResult = session.executeCommand(createEndPhaseCommand(PLAYER1));
    expect(endPhaseResult.success).toBe(true);
  });
});
