import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function member(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function deck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 20 }, (_, index) => member(`DECK-${index}`)),
    energyDeck: Array.from({ length: 12 }, (_, index) => energy(`ENERGY-${index}`)),
  };
}

function setup(
  options: {
    readonly sourceCardCode?: string;
    readonly sourceOrientation?: OrientationState;
    readonly handCount?: number;
    readonly drawCount?: number;
    readonly phase?: GamePhase;
    readonly activePlayerIndex?: number;
  } = {}
) {
  const session = createGameSession();
  session.createGame('n-bp7-023-mia-taylor', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck(), deck());

  const source = createCardInstance(
    member(options.sourceCardCode ?? 'PL!N-bp7-023-N', 'ミア・テイラー', 11),
    PLAYER1,
    'mia-source'
  );
  const handCards = Array.from({ length: options.handCount ?? 2 }, (_, index) =>
    createCardInstance(member(`HAND-${index}`), PLAYER1, `hand-${index}`)
  );
  const drawCards = Array.from({ length: options.drawCount ?? 2 }, (_, index) =>
    createCardInstance(member(`DRAW-${index}`), PLAYER1, `draw-${index}`)
  );
  const state = registerCards(session.state!, [source, ...handCards, ...drawCards]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutableState.currentPhase = options.phase ?? GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = options.activePlayerIndex ?? 0;
  mutableState.waitingPlayerId = null;

  const player = state.players[0] as unknown as {
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
  player.hand.cardIds = handCards.map((card) => card.instanceId);
  player.mainDeck.cardIds = drawCards.map((card) => card.instanceId);
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
  player.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  player.memberSlots.cardStates = new Map([
    [
      source.instanceId,
      {
        orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      },
    ],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    drawCardIds: drawCards.map((card) => card.instanceId),
  };
}

function activate(scenario: ReturnType<typeof setup>) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID
    )
  );
}

describe('PL!N-bp7-023 费用11「米娅·泰勒」', () => {
  it('waits the source as cost, draws two, and discards exactly two through grouped event wrappers', () => {
    const scenario = setup({ sourceCardCode: 'PL!N-bp7-023-P' });

    expect(activate(scenario).success).toBe(true);
    expect(
      scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.sourceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      stepId: 'N_BP7_023_SELECT_TWO_DISCARD_AFTER_DRAW',
      effectText: '【起动】【1回合1次】将此成员变为待机状态：抽2张卡，将2张手牌放置入休息室。',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      metadata: expect.objectContaining({ drawCount: 2, discardCount: 2 }),
    });
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
      ...scenario.handCardIds,
      ...scenario.drawCardIds,
    ]);

    const stateChangeEvent = scenario.session.state?.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        entry.event.cardInstanceId === scenario.sourceId
    )?.event;
    expect(stateChangeEvent).toMatchObject({
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID &&
          action.payload.memberStateChangedEventIds?.includes(stateChangeEvent?.eventId)
      )
    ).toBe(true);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [scenario.handCardIds[0]!, scenario.drawCardIds[0]!]
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.handCardIds[0],
      scenario.drawCardIds[0],
    ]);
    const discardEvent = scenario.session.state?.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        entry.event.fromZone === 'HAND'
    )?.event;
    expect(discardEvent).toMatchObject({
      cardInstanceIds: [scenario.handCardIds[0], scenario.drawCardIds[0]],
    });
  });

  it('rejects duplicate, short, and stale discard selections without advancing', () => {
    const scenario = setup();
    expect(activate(scenario).success).toBe(true);
    const effectId = scenario.session.state!.activeEffect!.id;

    for (const selectedCardIds of [
      [scenario.handCardIds[0]!],
      [scenario.handCardIds[0]!, scenario.handCardIds[0]!],
      ['illegal-card', scenario.handCardIds[0]!],
    ]) {
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            effectId,
            undefined,
            undefined,
            undefined,
            undefined,
            selectedCardIds
          )
        ).success
      ).toBe(false);
      expect(scenario.session.state?.activeEffect?.id).toBe(effectId);
    }

    const mutablePlayer = scenario.session.state!.players[0] as unknown as {
      hand: { cardIds: string[] };
    };
    mutablePlayer.hand.cardIds = mutablePlayer.hand.cardIds.filter(
      (cardId) => cardId !== scenario.drawCardIds[0]
    );
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          effectId,
          undefined,
          undefined,
          undefined,
          undefined,
          [scenario.handCardIds[0]!, scenario.drawCardIds[0]!]
        )
      ).success
    ).toBe(false);
    expect(scenario.session.state?.activeEffect?.id).toBe(effectId);
  });

  it('does not pay or consume turn1 outside a legal ACTIVE current-player main-phase source', () => {
    for (const scenario of [
      setup({ sourceOrientation: OrientationState.WAITING }),
      setup({ phase: GamePhase.PERFORMANCE_PHASE }),
      setup({ activePlayerIndex: 1 }),
      setup({ sourceCardCode: 'PL!N-bp7-022-N' }),
    ]) {
      expect(activate(scenario).success).toBe(false);
      expect(
        scenario.session.state?.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId ===
              N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID &&
            action.payload.step === 'ABILITY_USE'
        )
      ).toBe(false);
    }
  });

  it('keeps the completed turn1 use after the source is made ACTIVE again in the same turn', () => {
    const scenario = setup();
    expect(activate(scenario).success).toBe(true);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [scenario.handCardIds[0]!, scenario.handCardIds[1]!]
        )
      ).success
    ).toBe(true);

    const player = scenario.session.state!.players[0] as unknown as {
      memberSlots: {
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    player.memberSlots.cardStates.set(scenario.sourceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });

    expect(activate(scenario).success).toBe(false);
    expect(
      scenario.session.state?.actionHistory.filter(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === N_BP7_023_ACTIVATED_WAIT_SELF_DRAW_TWO_DISCARD_TWO_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(
      scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.sourceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('discards only the available hand after a short draw and still finishes', () => {
    const scenario = setup({ handCount: 0, drawCount: 1 });
    expect(activate(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectableCardIds: scenario.drawCardIds,
    });
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.drawCardIds[0]
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(scenario.drawCardIds);
  });
});
