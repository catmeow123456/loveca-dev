import { describe, expect, it } from 'vitest';
import {
  createConfirmEffectStepCommand,
  createMovePublicCardToWaitingRoomCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  ABILITY_ORDER_SELECTION_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
} from '../../src/application/card-effect-runner';
import { startDrawThenDiscardCardsWorkflow } from '../../src/application/card-effects/workflows/shared/draw-then-discard';
import {
  HS_BP2_015_LEAVE_STAGE_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
  HS_BP6_019_LEAVE_STAGE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
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

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, name = cardCode, cost = 5): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 2)],
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
  const mainDeck: AnyCardData[] = Array.from({ length: 20 }, (_, index) =>
    createMemberCard(`MEM-${index}`, `Member ${index}`)
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

function createPreparedSession(
  sourceCode: string,
  sourceName: string,
  options: {
    readonly handCount?: number;
    readonly drawCount?: number;
    readonly remainingDeckCount?: number;
    readonly addHandToWaitingRoomTriggerSource?: boolean;
  } = {}
): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly handCardIds: readonly string[];
  readonly drawnCardIds: readonly string[];
  readonly triggerSourceId?: string;
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(`leave-stage-draw-discard-${sourceCode}`, PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(createMemberCard(sourceCode, sourceName, 5), PLAYER1, 'source');
  const handCards = Array.from({ length: options.handCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMemberCard(`HAND-${index}`, `Hand ${index}`),
      PLAYER1,
      `hand-${index}`
    )
  );
  const drawnCards = Array.from({ length: options.drawCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMemberCard(`DRAW-${index}`, `Draw ${index}`),
      PLAYER1,
      `draw-${index}`
    )
  );
  const remainingDeckCards = Array.from({ length: options.remainingDeckCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMemberCard(`REMAINING-${index}`, `Remaining ${index}`),
      PLAYER1,
      `remaining-${index}`
    )
  );
  const triggerSource =
    options.addHandToWaitingRoomTriggerSource === true
      ? createCardInstance(
          createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
          PLAYER1,
          'hand-to-waiting-trigger-source'
        )
      : null;

  let state = registerCards(session.state!, [
    source,
    ...handCards,
    ...drawnCards,
    ...remainingDeckCards,
    ...(triggerSource ? [triggerSource] : []),
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
  p1.hand.cardIds = handCards.map((card) => card.instanceId);
  p1.mainDeck.cardIds = [
    ...drawnCards.map((card) => card.instanceId),
    ...remainingDeckCards.map((card) => card.instanceId),
  ];
  p1.memberSlots.slots[SlotPosition.LEFT] = triggerSource?.instanceId ?? null;
  p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
  p1.memberSlots.slots[SlotPosition.RIGHT] = null;
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ...(triggerSource
      ? [[triggerSource.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }] as const]
      : []),
  ]);

  return {
    session,
    sourceId: source.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    drawnCardIds: drawnCards.map((card) => card.instanceId),
    triggerSourceId: triggerSource?.instanceId,
  };
}

describe('Hasunosora leave-stage draw then discard AUTO workflows', () => {
  it('resolves PL!HS-bp6-019-N leave-stage AUTO by drawing two then discarding two', () => {
    const { session, sourceId, handCardIds, drawnCardIds, triggerSourceId } =
      createPreparedSession('PL!HS-bp6-019-N', '大沢瑠璃乃', {
        handCount: 2,
        drawCount: 2,
        remainingDeckCount: 1,
        addHandToWaitingRoomTriggerSource: true,
      });

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        sourceId,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_019_LEAVE_STAGE_DRAW_TWO_DISCARD_TWO_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.drawCount).toBe(2);
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(2);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      ...handCardIds,
      ...drawnCardIds,
    ]);

    const selectedDiscardIds = [handCardIds[0]!, drawnCardIds[0]!];
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
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      sourceId,
      ...selectedDiscardIds,
    ]);
    expect(session.state?.players[0].hand.cardIds).toEqual([handCardIds[1], drawnCardIds[1]]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP6_019_LEAVE_STAGE_DRAW_TWO_DISCARD_TWO_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          Array.isArray(action.payload.discardedCardIds) &&
          action.payload.discardedCardIds.length === 2
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === triggerSourceId &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(1);
  });

  it('resolves PL!HS-bp2-015-N leave-stage AUTO by drawing two then discarding one', () => {
    const { session, sourceId, handCardIds, drawnCardIds } = createPreparedSession(
      'PL!HS-bp2-015-N',
      '藤島 慈',
      { handCount: 1, drawCount: 2, remainingDeckCount: 1 }
    );

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        sourceId,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_015_LEAVE_STAGE_DRAW_TWO_DISCARD_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.drawCount).toBe(2);
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(1);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, drawnCardIds[0])
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([sourceId, drawnCardIds[0]]);
    expect(session.state?.players[0].hand.cardIds).toEqual([handCardIds[0], drawnCardIds[1]]);
  });

  it('lets PL!HS-bp6-019-N discard only the refreshed source when it is the only available card', () => {
    const { session, sourceId, drawnCardIds } = createPreparedSession(
      'PL!HS-bp6-019-N',
      '大沢瑠璃乃',
      { drawCount: 0 }
    );

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        sourceId,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_019_LEAVE_STAGE_DRAW_TWO_DISCARD_TWO_ABILITY_ID
    );
    expect(drawnCardIds).toEqual([]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([sourceId]);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(1);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(1);

    const continueResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [sourceId]
      )
    );

    expect(continueResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([sourceId]);
  });

  it('puts PL!HS-bp2-015-N leave-stage AUTO and the replacing member ON_ENTER into one order window', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('leave-stage-draw-discard-replace-order', PLAYER1, 'P1', PLAYER2, 'P2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp2-015-N', '藤島 慈', 5),
      PLAYER1,
      'replace-source'
    );
    const entering = createCardInstance(
      createMemberCard('PL!HS-bp1-006-P', '藤島 慈', 11),
      PLAYER1,
      'replace-entering'
    );
    const drawnCards = [0, 1].map((index) =>
      createCardInstance(
        createMemberCard(`REPLACE-DRAW-${index}`, `Replace Draw ${index}`),
        PLAYER1,
        `replace-draw-${index}`
      )
    );

    let state = registerCards(session.state!, [source, entering, ...drawnCards]);
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
    p1.hand.cardIds = [entering.instanceId];
    p1.mainDeck.cardIds = drawnCards.map((card) => card.instanceId);
    p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, entering.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    const leaveStageEvent = session.state?.eventLog
      .map((entry) => entry.event)
      .find(
        (event) =>
          event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          event.cardInstanceId === source.instanceId
      );
    expect(leaveStageEvent).toMatchObject({
      eventType: TriggerCondition.ON_LEAVE_STAGE,
      cardInstanceId: source.instanceId,
      fromSlot: SlotPosition.CENTER,
      toZone: ZoneType.WAITING_ROOM,
      replacingCardId: entering.instanceId,
    });
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.pendingAbilities.map((ability) => ability.abilityId)).toEqual([
      HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
      HS_BP2_015_LEAVE_STAGE_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    ]);

    const chooseLeaveStageResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, source.instanceId)
    );

    expect(chooseLeaveStageResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_015_LEAVE_STAGE_DRAW_TWO_DISCARD_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(source.instanceId);
    expect(session.state?.activeEffect?.metadata?.drawCount).toBe(2);
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(1);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      entering.instanceId
    );
  });

  it('throws instead of consuming pending when leave-stage metadata is missing toZone', () => {
    const { session, sourceId } = createPreparedSession('PL!HS-bp6-019-N', '大沢瑠璃乃', {
      drawCount: 2,
    });

    expect(() =>
      startDrawThenDiscardCardsWorkflow(session.state!, {
        ability: {
          id: 'missing-to-zone',
          abilityId: HS_BP6_019_LEAVE_STAGE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
          sourceCardId: sourceId,
          controllerId: PLAYER1,
          sourceSlot: SlotPosition.CENTER,
          metadata: {},
        },
        effectText: 'draw then discard',
        drawCount: 2,
        discardCount: 2,
        stepId: 'TEST_SELECT_DISCARD',
        orderedResolution: false,
        requiresLeaveStageToWaitingRoom: true,
      })
    ).toThrow(/metadata\.toZone/);
  });
});
