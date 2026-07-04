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
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  MEMBER_LIVE_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
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
import { createPublicObjectId } from '../../src/online/projector';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹咲学园学园偶像同好会'],
    cardType: CardType.MEMBER,
    cost,
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

function createLiveCard(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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

describe('draw-then-discard shared workflow', () => {
  it('handles on-enter draw two discard two with selectedCardIds', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('draw-then-discard-two-shizuku', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!N-PR-005-PR', '桜坂しずく', 13),
      PLAYER1,
      'p1-n-pr-005-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'p1-draw-discard-pb1-003'
    );
    const handCards = [0, 1].map((index) =>
      createCardInstance(
        createMemberCard(`PL!N-test-hand-${index}`, `Hand ${index}`),
        PLAYER1,
        `p1-n-pr-005-hand-${index}`
      )
    );
    const drawnCards = [0, 1].map((index) =>
      createCardInstance(
        createMemberCard(`PL!N-test-draw-${index}`, `Draw ${index}`),
        PLAYER1,
        `p1-n-pr-005-draw-${index}`
      )
    );

    let state = registerCards(session.state!, [source, pb1003Source, ...handCards, ...drawnCards]);
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
    p1.hand.cardIds = [source.instanceId, ...handCards.map((card) => card.instanceId)];
    p1.mainDeck.cardIds = drawnCards.map((card) => card.instanceId);
    p1.memberSlots.slots[SlotPosition.RIGHT] = pb1003Source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [pb1003Source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.drawCount).toBe(2);
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(2);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      ...handCards.map((card) => card.instanceId),
      ...drawnCards.map((card) => card.instanceId),
    ]);

    const selectedDiscardIds = [handCards[0]!.instanceId, drawnCards[0]!.instanceId];
    const beforeDiscardSeq = session.getCurrentPublicEventSeq();
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        selectedDiscardIds
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(selectedDiscardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([
      handCards[1]!.instanceId,
      drawnCards[1]!.instanceId,
    ]);
    const publicEvents = session.getPublicEventsSince(beforeDiscardSeq);
    for (const cardId of selectedDiscardIds) {
      const cardCode = session.state?.cardRegistry.get(cardId)?.data.cardCode;
      expect(cardCode).toBeTruthy();
      expect(
        publicEvents.some(
          (event) =>
            event.type === 'CardMovedPublic' &&
            event.card?.publicObjectId === createPublicObjectId(cardId) &&
            event.card.cardCode === cardCode &&
            event.from?.zone === ZoneType.HAND &&
            event.to?.zone === ZoneType.WAITING_ROOM &&
            !('name' in event.card) &&
            !('cardType' in event.card)
        )
      ).toBe(true);
    }
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          Array.isArray(action.payload.discardedCardIds) &&
          action.payload.discardedCardIds.length === 2 &&
          action.payload.discardedCardIds[0] === selectedDiscardIds[0] &&
          action.payload.discardedCardIds[1] === selectedDiscardIds[1]
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === pb1003Source.instanceId &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(1);
  });

  it('allows draw two discard two to discard one when only one hand card is available', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'draw-then-discard-two-shizuku-only-one-card',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!N-PR-005-PR', '桜坂しずく', 13),
      PLAYER1,
      'p1-n-pr-005-edge-source'
    );
    const drawnCard = createCardInstance(
      createMemberCard('PL!N-test-edge-draw', 'Only Draw'),
      PLAYER1,
      'p1-n-pr-005-edge-draw'
    );

    let state = registerCards(session.state!, [source, drawnCard]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId];
    p1.mainDeck.cardIds = [drawnCard.instanceId];

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(2);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([drawnCard.instanceId]);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(1);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(1);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [drawnCard.instanceId]
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([drawnCard.instanceId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          Array.isArray(action.payload.discardedCardIds) &&
          action.payload.discardedCardIds.length === 1 &&
          action.payload.discardedCardIds[0] === drawnCard.instanceId
      )
    ).toBe(true);
  });

  it('handles PL!HS-bp6-030-L live-start draw one discard one with enter-waiting-room triggers', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp6-030-live-start-draw-discard', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const sourceLive = createCardInstance(
      createLiveCard('PL!HS-bp6-030-L', 'Very! Very! COCO夏っ'),
      PLAYER1,
      'p1-hs-bp6-030-live'
    );
    const handCard = createCardInstance(
      createMemberCard('PL!HS-bp6-030-hand', 'Hand Card'),
      PLAYER1,
      'p1-hs-bp6-030-hand'
    );
    const drawCard = createCardInstance(
      createMemberCard('PL!HS-bp6-030-draw', 'Draw Card'),
      PLAYER1,
      'p1-hs-bp6-030-draw'
    );

    let state = registerCards(session.state!, [sourceLive, handCard, drawCard]);
    state = {
      ...state,
      pendingAbilities: [
        {
          id: 'hs-bp6-030-live-start-pending',
          abilityId: HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
          sourceCardId: sourceLive.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['manual-live-start'],
        },
      ],
    };
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [handCard.instanceId];
    p1.mainDeck.cardIds = [drawCard.instanceId];
    p1.liveZone.cardIds = [sourceLive.instanceId];

    (session as unknown as { authorityState: GameState }).authorityState =
      resolvePendingCardEffects(session.state!).gameState;

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.drawCount).toBe(1);
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(1);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      handCard.instanceId,
      drawCard.instanceId,
    ]);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, handCard.instanceId)
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([drawCard.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([handCard.instanceId]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === handCard.instanceId
      )
    ).toBe(true);
  });

  it('handles member live-success draw one discard one with enter-waiting-room triggers', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'member-live-success-draw-one-discard-one',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!N-bp5-016-N', '朝香果林', 2),
      PLAYER1,
      'p1-bp5-016-source'
    );
    const triggerSource = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'p1-live-success-trigger-source'
    );
    const live = createCardInstance(
      createLiveCard('PL!N-live-success-test-live', 'Test Live'),
      PLAYER1,
      'p1-live-success-live'
    );
    const handCard = createCardInstance(
      createMemberCard('PL!N-live-success-hand', 'Hand Card'),
      PLAYER1,
      'p1-live-success-hand'
    );
    const drawCard = createCardInstance(
      createMemberCard('PL!N-live-success-draw', 'Draw Card'),
      PLAYER1,
      'p1-live-success-draw'
    );

    let state = registerCards(session.state!, [source, triggerSource, live, handCard, drawCard]);
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
    p1.hand.cardIds = [handCard.instanceId];
    p1.mainDeck.cardIds = [drawCard.instanceId];
    p1.liveZone.cardIds = [live.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
    p1.memberSlots.slots[SlotPosition.RIGHT] = triggerSource.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [triggerSource.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    state = {
      ...state,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      firstPlayerIndex: 0,
      activePlayerIndex: 0,
      liveResolution: {
        ...state.liveResolution,
        liveResults: new Map([[live.instanceId, true]]),
        playerScores: new Map([[PLAYER1, 1]]),
        performingPlayerId: PLAYER1,
      },
    };

    const timingResult = new GameService().executeCheckTiming(state, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    expect(timingResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;

    expect(session.state?.activeEffect?.abilityId).toBe(
      MEMBER_LIVE_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(source.instanceId);
    expect(session.state?.activeEffect?.metadata?.drawCount).toBe(1);
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(1);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      handCard.instanceId,
      drawCard.instanceId,
    ]);

    const beforeDiscardSeq = session.getCurrentPublicEventSeq();
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, handCard.instanceId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([drawCard.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([handCard.instanceId]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === handCard.instanceId
      )
    ).toBe(true);
    const publicEvents = session.getPublicEventsSince(beforeDiscardSeq);
    expect(
      publicEvents.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(handCard.instanceId) &&
          event.from?.zone === ZoneType.HAND &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === triggerSource.instanceId &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(1);
  });

  it('handles member live-success draw one discard one when no hand cards are available', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'member-live-success-draw-one-discard-one-no-hand',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!N-bp5-023-N', 'ミア・テイラー', 2),
      PLAYER1,
      'p1-bp5-023-source'
    );
    const live = createCardInstance(
      createLiveCard('PL!N-live-success-no-hand-live', 'Test Live'),
      PLAYER1,
      'p1-live-success-no-hand-live'
    );

    let state = registerCards(session.state!, [source, live]);
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
    p1.liveZone.cardIds = [live.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    state = {
      ...state,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      firstPlayerIndex: 0,
      activePlayerIndex: 0,
      liveResolution: {
        ...state.liveResolution,
        liveResults: new Map([[live.instanceId, true]]),
        playerScores: new Map([[PLAYER1, 1]]),
        performingPlayerId: PLAYER1,
      },
    };

    const timingResult = new GameService().executeCheckTiming(state, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    expect(timingResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;

    expect(session.state?.activeEffect?.abilityId).toBe(
      MEMBER_LIVE_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('continues to the next member live-success pending after draw one discard one', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'member-live-success-draw-one-discard-one-continuation',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const firstSource = createCardInstance(
      createMemberCard('PL!S-sd1-014-SD', '渡辺 曜', 2),
      PLAYER1,
      'p1-s-sd1-014-source'
    );
    const secondSource = createCardInstance(
      createMemberCard('PL!SP-sd2-017-SD2', '桜小路きな子', 2),
      PLAYER1,
      'p1-sp-sd2-017-source'
    );
    const live = createCardInstance(
      createLiveCard('PL!N-live-success-continuation-live', 'Test Live'),
      PLAYER1,
      'p1-live-success-continuation-live'
    );
    const handCard = createCardInstance(
      createMemberCard('PL!N-live-success-continuation-hand', 'Hand Card'),
      PLAYER1,
      'p1-live-success-continuation-hand'
    );
    const drawCards = [0, 1].map((index) =>
      createCardInstance(
        createMemberCard(`PL!N-live-success-continuation-draw-${index}`, `Draw ${index}`),
        PLAYER1,
        `p1-live-success-continuation-draw-${index}`
      )
    );

    let state = registerCards(session.state!, [
      firstSource,
      secondSource,
      live,
      handCard,
      ...drawCards,
    ]);
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
    p1.hand.cardIds = [handCard.instanceId];
    p1.mainDeck.cardIds = drawCards.map((card) => card.instanceId);
    p1.liveZone.cardIds = [live.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = firstSource.instanceId;
    p1.memberSlots.slots[SlotPosition.LEFT] = secondSource.instanceId;
    p1.memberSlots.cardStates = new Map([
      [firstSource.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [secondSource.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    state = {
      ...state,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      firstPlayerIndex: 0,
      activePlayerIndex: 0,
      liveResolution: {
        ...state.liveResolution,
        liveResults: new Map([[live.instanceId, true]]),
        playerScores: new Map([[PLAYER1, 1]]),
        performingPlayerId: PLAYER1,
      },
    };

    const timingResult = new GameService().executeCheckTiming(state, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    expect(timingResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;

    expect(session.state?.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    const orderResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        true
      )
    );
    expect(orderResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      MEMBER_LIVE_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    const firstActiveSourceCardId = session.state?.activeEffect?.sourceCardId;

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, handCard.instanceId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      MEMBER_LIVE_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).not.toBe(firstActiveSourceCardId);
    expect(session.state?.activeEffect?.metadata?.drawCount).toBe(1);
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(1);
  });
});
