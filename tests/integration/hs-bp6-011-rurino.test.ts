import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { addAction, registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { startHsBp6011WaitSelfDrawDiscard } from '../../src/application/card-effects/workflows/cards/hs-bp6-011-rurino';
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

function createMemberCard(cardCode: string, name = cardCode, cost = 2): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
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

interface RurinoScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly handCardIds: readonly string[];
  readonly drawnCardIds: readonly string[];
  readonly triggerSourceId?: string;
}

function setupRurinoScenario(
  options: {
    readonly sourceOrientation?: OrientationState;
    readonly handCount?: number;
    readonly drawCount?: number;
    readonly addHandToWaitingRoomTriggerSource?: boolean;
  } = {}
): RurinoScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('hs-bp6-011-rurino', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('PL!HS-bp6-011-R', '大沢瑠璃乃', 2),
    PLAYER1,
    'p1-hs-bp6-011-source'
  );
  const handCards = Array.from({ length: options.handCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMemberCard(`HAND-${index}`, `Hand ${index}`),
      PLAYER1,
      `p1-hs-bp6-011-hand-${index}`
    )
  );
  const drawnCards = Array.from({ length: options.drawCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMemberCard(`DRAW-${index}`, `Draw ${index}`),
      PLAYER1,
      `p1-hs-bp6-011-draw-${index}`
    )
  );
  const triggerSource =
    options.addHandToWaitingRoomTriggerSource === true
      ? createCardInstance(
          createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
          PLAYER1,
          'p1-hs-bp6-011-trigger-source'
        )
      : null;

  const state = registerCards(session.state!, [
    source,
    ...handCards,
    ...drawnCards,
    ...(triggerSource ? [triggerSource] : []),
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
  mutableState.waitingPlayerId = null;

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
  p1.hand.cardIds = handCards.map((card) => card.instanceId);
  p1.mainDeck.cardIds = drawnCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: triggerSource?.instanceId ?? null,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [
      source.instanceId,
      {
        orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      },
    ],
    ...(triggerSource
      ? [
          [
            triggerSource.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ] as const,
        ]
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

function activateRurino(scenario: RurinoScenario) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    )
  );
}

function sourceOrientation(scenario: RurinoScenario): OrientationState | undefined {
  return scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.sourceId)
    ?.orientation;
}

describe('PL!HS-bp6-011-R Rurino activated wait self draw discard workflow', () => {
  it('waits the active source as cost, draws one, and discards one through the trigger wrapper', () => {
    const scenario = setupRurinoScenario({
      handCount: 1,
      drawCount: 1,
      addHandToWaitingRoomTriggerSource: true,
    });

    const activateResult = activateRurino(scenario);

    expect(activateResult.success).toBe(true);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    expect(scenario.session.state?.activeEffect?.metadata?.drawCount).toBe(1);
    expect(scenario.session.state?.activeEffect?.metadata?.discardCount).toBe(1);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
      scenario.handCardIds[0],
      scenario.drawnCardIds[0],
    ]);

    const memberStateEvent = scenario.session.state?.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        entry.event.cardInstanceId === scenario.sourceId
    )?.event;
    expect(memberStateEvent).toMatchObject({
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID &&
          action.payload.waitedMemberCardId === scenario.sourceId &&
          action.payload.memberStateChangedEventIds?.includes(memberStateEvent?.eventId)
      )
    ).toBe(true);

    const discardResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.drawnCardIds[0]
      )
    );

    expect(discardResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.drawnCardIds[0],
    ]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          action.payload.discardedCardId === scenario.drawnCardIds[0]
      )
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === scenario.triggerSourceId &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(1);
  });

  it('cannot activate while the source is already waiting and does not consume the turn limit', () => {
    const scenario = setupRurinoScenario({
      sourceOrientation: OrientationState.WAITING,
      drawCount: 1,
    });

    const failedResult = activateRurino(scenario);

    expect(failedResult.success).toBe(false);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);

    const p1 = scenario.session.state!.players[0] as unknown as {
      memberSlots: {
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    p1.memberSlots.cardStates.set(scenario.sourceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });

    const successResult = activateRurino(scenario);

    expect(successResult.success).toBe(true);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
  });

  it('continues safely with no hand cards after drawing no cards', () => {
    const scenario = setupRurinoScenario();

    const activateResult = activateRurino(scenario);

    expect(activateResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(scenario.session.state?.activeEffect?.canSkipSelection).toBe(true);

    const continueResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
    );

    expect(continueResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('enqueues member-state-change triggers before opening the draw-discard active effect', () => {
    const scenario = setupRurinoScenario({ drawCount: 1 });
    let memberStateChangedEventId: string | undefined;

    const nextState = startHsBp6011WaitSelfDrawDiscard(
      scenario.session.state!,
      PLAYER1,
      scenario.sourceId,
      {
        enqueueTriggeredCardEffects: (game, triggerConditions, options) => {
          if (triggerConditions.includes(TriggerCondition.ON_MEMBER_STATE_CHANGED)) {
            memberStateChangedEventId = options?.memberStateChangedEvents?.[0]?.eventId;
            return addAction(
              {
                ...game,
                pendingAbilities: [
                  ...game.pendingAbilities,
                  {
                    id: `test-member-state:${memberStateChangedEventId}`,
                    abilityId: 'TEST_MEMBER_STATE_CHANGED_TRIGGER',
                    sourceCardId: scenario.sourceId,
                    controllerId: PLAYER1,
                    mandatory: true,
                    timingId: TriggerCondition.ON_MEMBER_STATE_CHANGED,
                    eventIds: memberStateChangedEventId ? [memberStateChangedEventId] : [],
                  },
                ],
              },
              'TRIGGER_ABILITY',
              PLAYER1,
              {
                abilityId: 'TEST_MEMBER_STATE_CHANGED_TRIGGER',
                sourceCardId: scenario.sourceId,
                memberStateChangedEventId,
              }
            );
          }
          return game;
        },
      }
    );

    expect(memberStateChangedEventId).toBeDefined();
    expect(nextState.activeEffect?.abilityId).toBe(
      HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    expect(nextState.pendingAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: 'TEST_MEMBER_STATE_CHANGED_TRIGGER',
          eventIds: [memberStateChangedEventId],
        }),
      ])
    );
  });

  it('enforces once per turn after the cost has been paid and the effect resolved', () => {
    const scenario = setupRurinoScenario({ drawCount: 1 });

    const firstResult = activateRurino(scenario);
    expect(firstResult.success).toBe(true);
    const finishResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.drawnCardIds[0]
      )
    );
    expect(finishResult.success).toBe(true);

    const p1 = scenario.session.state!.players[0] as unknown as {
      memberSlots: {
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    p1.memberSlots.cardStates.set(scenario.sourceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });

    const secondResult = activateRurino(scenario);

    expect(secondResult.success).toBe(false);
    expect(
      scenario.session.state?.actionHistory.filter(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID
      )
    ).toHaveLength(1);
  });
});
