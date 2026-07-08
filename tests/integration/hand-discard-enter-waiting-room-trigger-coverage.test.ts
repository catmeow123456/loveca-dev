import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
  BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID,
  HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
  HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  name = cardCode,
  cost = 1,
  groupName = '蓮ノ空',
  unitName = 'みらくらぱーく！'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(
  cardCode: string,
  name = cardCode,
  score = 3,
  groupName = '蓮ノ空'
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.MAIN_FREE;
  state.currentTurnType = TurnType.NORMAL;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

function advanceToLiveStartEffects(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
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

  const result = new GameService().advancePhase(state);
  expect(result.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
}

function removeFromPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
}): void {
  player.hand.cardIds = [];
  player.mainDeck.cardIds = [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
}

function setActiveEnergy(
  player: {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face?: FaceState }>;
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

function placeStageMember(
  player: {
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  },
  slot: SlotPosition,
  cardId: string
): void {
  player.memberSlots.slots[slot] = cardId;
  player.memberSlots.cardStates.set(cardId, {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  });
}

function expectPb1003AutoResolvedOnce(
  game: GameState | null | undefined,
  sourceCardId: string
): void {
  expect(
    game?.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
        action.payload.sourceCardId === sourceCardId &&
        action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
    )
  ).toHaveLength(1);
}

describe('hand discard enter-waiting-room trigger coverage', () => {
  it('covers discard-cost waiting-room recovery after activated discard', () => {
    const session = createGameSession();
    session.createGame('discard-cost-pb1-003-trigger', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(createDeck(), createDeck());
    forceMainPhaseForPlayer(session);

    let state = session.state!;
    const ownedMemberIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .map((card) => card.instanceId);
    const sourceId = ownedMemberIds[0]!;
    const pb1003SourceId = ownedMemberIds[1]!;
    const discardCardIds = ownedMemberIds.slice(2, 4);
    (state.cardRegistry.get(sourceId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!-bp4-002-SEC', '絢瀬 絵里', 11, "μ's");
    (state.cardRegistry.get(pb1003SourceId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15);
    for (const [index, cardId] of discardCardIds.entries()) {
      (state.cardRegistry.get(cardId) as unknown as { data: MemberCardData }).data =
        createMemberCard(`BP4-002-DISCARD-${index}`);
    }
    const successLive = createCardInstance(
      createLiveCard('BP4-002-SUCCESS-LIVE', 'Success Live', 6, "μ's"),
      PLAYER1,
      'bp4-002-success-live'
    );
    state = registerCards(state, [successLive]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

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
    removeFromPlayerZones(p1);
    p1.memberSlots.cardStates = new Map();
    placeStageMember(p1, SlotPosition.CENTER, sourceId);
    placeStageMember(p1, SlotPosition.RIGHT, pb1003SourceId);
    p1.hand.cardIds = discardCardIds;
    p1.successZone.cardIds = [successLive.instanceId];
    (session.state as unknown as { currentSubPhase: SubPhase }).currentSubPhase = SubPhase.NONE;

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
      )
    );
    expect(activateResult.success, activateResult.error).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          null,
          undefined,
          null,
          discardCardIds
        )
      ).success
    ).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);

    expectPb1003AutoResolvedOnce(session.state, pb1003SourceId);
  });

  it('covers grouped recovery after an on-enter two-card discard', () => {
    const session = createGameSession();
    session.createGame(
      'grouped-recovery-pb1-003-trigger',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(createDeck(), createDeck());
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!-bp6-005-R', '星空凛', 11, "μ's"),
      PLAYER1,
      'bp6-005-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'bp6-005-pb1-003'
    );
    const discardCards = [0, 1].map((index) =>
      createCardInstance(
        createMemberCard(`BP6-005-DISCARD-${index}`),
        PLAYER1,
        `bp6-005-discard-${index}`
      )
    );
    let state = registerCards(session.state!, [source, pb1003Source, ...discardCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

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
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, ...discardCards.map((card) => card.instanceId)];
    p1.memberSlots.cardStates = new Map();
    placeStageMember(p1, SlotPosition.RIGHT, pb1003Source.instanceId);

    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          null,
          undefined,
          null,
          discardCards.map((card) => card.instanceId)
        )
      ).success
    ).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);

    expectPb1003AutoResolvedOnce(session.state, pb1003Source.instanceId);
  });

  it('covers BP5-003 activated discard branch with no recovery target', () => {
    const session = createGameSession();
    session.createGame('bp5-003-pb1-003-trigger', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(createDeck(), createDeck());
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedMemberIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.MEMBER)
      .map((card) => card.instanceId);
    const sourceId = ownedMemberIds[0]!;
    const pb1003SourceId = ownedMemberIds[1]!;
    const discardCardId = ownedMemberIds[2]!;
    (state.cardRegistry.get(sourceId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!-bp5-003-P', '南ことり', 11, "μ's");
    (state.cardRegistry.get(pb1003SourceId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15);
    (state.cardRegistry.get(discardCardId) as unknown as { data: MemberCardData }).data =
      createMemberCard('BP5-003-NON-MUSE-DISCARD', '中須かすみ', 4, '虹咲');

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
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    removeFromPlayerZones(p1);
    p1.memberSlots.cardStates = new Map();
    placeStageMember(p1, SlotPosition.CENTER, sourceId);
    placeStageMember(p1, SlotPosition.RIGHT, pb1003SourceId);
    p1.hand.cardIds = [discardCardId];
    setActiveEnergy(p1, energyCardIds.slice(0, 2));
    (session.state as unknown as { currentSubPhase: SubPhase }).currentSubPhase = SubPhase.NONE;

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      )
    );
    expect(activateResult.success, activateResult.error).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
      ).success
    ).toBe(true);

    expectPb1003AutoResolvedOnce(session.state, pb1003SourceId);
  });

  it('covers HS-bp5-003 live-start discard before target Heart selection', () => {
    const session = createGameSession();
    session.createGame(
      'hs-bp5-003-live-start-pb1-003-trigger',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(createDeck(), createDeck());

    const source = createCardInstance(
      createMemberCard('PL!HS-bp5-003-R', '大沢瑠璃乃', 11, '蓮ノ空'),
      PLAYER1,
      'hs-bp5-003-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15, '蓮ノ空'),
      PLAYER1,
      'hs-bp5-003-pb1-003'
    );
    const target = createCardInstance(
      createMemberCard('HS-BP5-003-TARGET', 'Target', 4, '蓮ノ空'),
      PLAYER1,
      'hs-bp5-003-target'
    );
    const discardCard = createCardInstance(
      createMemberCard('HS-BP5-003-DISCARD', 'Discard', 4, '蓮ノ空'),
      PLAYER1,
      'hs-bp5-003-discard'
    );
    const live = createCardInstance(createLiveCard('HS-BP5-003-LIVE'), PLAYER1, 'hs-bp5-003-live');
    const state = registerCards(session.state!, [source, pb1003Source, target, discardCard, live]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

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
    removeFromPlayerZones(p1);
    p1.memberSlots.cardStates = new Map();
    placeStageMember(p1, SlotPosition.LEFT, target.instanceId);
    placeStageMember(p1, SlotPosition.CENTER, source.instanceId);
    placeStageMember(p1, SlotPosition.RIGHT, pb1003Source.instanceId);
    p1.hand.cardIds = [discardCard.instanceId];
    p1.liveZone.cardIds = [live.instanceId];
    p1.liveZone.cardStates = new Map([
      [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

    advanceToLiveStartEffects(session);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
      ).success
    ).toBe(true);

    expectPb1003AutoResolvedOnce(session.state, pb1003Source.instanceId);
  });

  it('covers HS-bp5-008 on-enter wait and discard look-top workflow', () => {
    const session = createGameSession();
    session.createGame('hs-bp5-008-pb1-003-trigger', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(createDeck(), createDeck());
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp5-008-R', '泉', 9),
      PLAYER1,
      'hs-bp5-008-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'hs-bp5-008-pb1-003'
    );
    const discardCard = createCardInstance(
      createMemberCard('HS-BP5-008-DISCARD'),
      PLAYER1,
      'hs-bp5-008-discard'
    );
    const topCards = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(
        createMemberCard(`HS-BP5-008-TOP-${index}`, `Top ${index}`, 1),
        PLAYER1,
        `hs-bp5-008-top-${index}`
      )
    );
    const state = registerCards(session.state!, [source, pb1003Source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

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
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);
    p1.memberSlots.cardStates = new Map();
    placeStageMember(p1, SlotPosition.RIGHT, pb1003Source.instanceId);

    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
    );
    const beforeCostSeq = session.getCurrentPublicEventSeq();
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          discardCard.instanceId
        )
      ).success
    ).toBe(true);
    const startedSummary = session
      .getPublicEventsSince(beforeCostSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'STARTED');
    expect(startedSummary?.type).toBe('CardEffectSummary');
    if (startedSummary?.type === 'CardEffectSummary') {
      expect(startedSummary.abilityId).toBe(HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID);
      expect(startedSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(startedSummary.summaryStatus).toBe('STARTED');
      expect(startedSummary.sourceOrientationCost).toBe('WAITING');
      expect(startedSummary.sourceCard?.publicObjectId).toBe(`obj_${source.instanceId}`);
      expect(startedSummary.discardedCostCards).toEqual([]);
      expect(startedSummary.hiddenDiscardedCostCardCount).toBe(1);
      expect(startedSummary.requestedInspectCount).toBe(5);
      expect(startedSummary.actualInspectedCount).toBe(5);
    }
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    const completedSummary = session
      .getPublicEventsSince(beforeCostSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'COMPLETED');
    expect(completedSummary?.type).toBe('CardEffectSummary');
    if (completedSummary?.type === 'CardEffectSummary') {
      expect(completedSummary.abilityId).toBe(
        HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
      );
      expect(completedSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(completedSummary.summaryStatus).toBe('COMPLETED');
      expect(completedSummary.sourceOrientationCost).toBe('WAITING');
      expect(completedSummary.selectedCards).toEqual([]);
      expect(completedSummary.noSelectedCards).toBe(true);
      expect(completedSummary.waitingRoomCardCount).toBe(5);
    }
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([discardCard.instanceId]);

    expectPb1003AutoResolvedOnce(session.state, pb1003Source.instanceId);
  });

  it('covers HS-pb1-004 pay-energy discard mill workflow', () => {
    const session = createGameSession();
    session.createGame('hs-pb1-004-pb1-003-trigger', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(createDeck(), createDeck());
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-pb1-004-R', '百生吟子', 4),
      PLAYER1,
      'hs-pb1-004-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'hs-pb1-004-pb1-003'
    );
    const discardCard = createCardInstance(
      createMemberCard('HS-PB1-004-DISCARD'),
      PLAYER1,
      'hs-pb1-004-discard'
    );
    const topCards = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(
        createMemberCard(`HS-PB1-004-MILL-${index}`),
        PLAYER1,
        `hs-pb1-004-mill-${index}`
      )
    );
    const state = registerCards(session.state!, [source, pb1003Source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

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
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);
    p1.memberSlots.cardStates = new Map();
    placeStageMember(p1, SlotPosition.RIGHT, pb1003Source.instanceId);
    setActiveEnergy(p1, energyCardIds.slice(0, 1));

    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          discardCard.instanceId
        )
      ).success
    ).toBe(true);

    expectPb1003AutoResolvedOnce(session.state, pb1003Source.instanceId);
  });

  it('covers HS-bp6-004 live-start discard gain blade workflow', () => {
    const session = createGameSession();
    session.createGame('hs-bp6-004-pb1-003-trigger', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(createDeck(), createDeck());

    const source = createCardInstance(
      createMemberCard('PL!HS-bp6-004-R', '百生吟子', 11),
      PLAYER1,
      'hs-bp6-004-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'hs-bp6-004-pb1-003'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!HS-bp6-004-P', '百生吟子', 11),
      PLAYER1,
      'hs-bp6-004-discard'
    );
    const live = createCardInstance(createLiveCard('HS-BP6-004-LIVE'), PLAYER1, 'hs-bp6-004-live');
    const state = registerCards(session.state!, [source, pb1003Source, discardCard, live]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

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
    removeFromPlayerZones(p1);
    p1.memberSlots.cardStates = new Map();
    placeStageMember(p1, SlotPosition.CENTER, source.instanceId);
    placeStageMember(p1, SlotPosition.RIGHT, pb1003Source.instanceId);
    p1.hand.cardIds = [discardCard.instanceId];
    p1.liveZone.cardIds = [live.instanceId];
    p1.liveZone.cardStates = new Map([
      [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

    advanceToLiveStartEffects(session);
    const activeEffect = session.state?.activeEffect;
    if (activeEffect?.abilityId === 'system:select-pending-card-effect') {
      const discardOptionId = activeEffect.selectableOptions!.find((option) =>
        option.id.includes(HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID)
      )!.id;
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            activeEffect.id,
            undefined,
            null,
            undefined,
            discardOptionId
          )
        ).success
      ).toBe(true);
    }
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          discardCard.instanceId
        )
      ).success
    ).toBe(true);

    expectPb1003AutoResolvedOnce(session.state, pb1003Source.instanceId);
  });
});
