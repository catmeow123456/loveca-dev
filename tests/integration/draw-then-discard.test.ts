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
import type { DeckConfig } from '../../src/application/game-service';
import {
  HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
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
} from '../../src/shared/types/enums';

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
});
