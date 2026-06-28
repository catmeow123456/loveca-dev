import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupName: 'test',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
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

interface Scenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly handCardIds: readonly string[];
  readonly drawnCardIds: readonly string[];
  readonly triggerSourceId?: string;
}

function setupScenario(
  sourceCardCode: string,
  options: {
    readonly sourceOrientation?: OrientationState;
    readonly handCount?: number;
    readonly drawCount?: number;
    readonly sourceOnStage?: boolean;
    readonly phase?: GamePhase;
    readonly addHandToWaitingRoomTriggerSource?: boolean;
  } = {}
): Scenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('pr-wait-self-discard-draw', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard(sourceCardCode, sourceCardCode, 4),
    PLAYER1,
    'pr-wait-self-source'
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(createMemberCard(`HAND-${index}`, `Hand ${index}`), PLAYER1, `hand-${index}`)
  );
  const drawnCards = Array.from({ length: options.drawCount ?? 1 }, (_, index) =>
    createCardInstance(createMemberCard(`DRAW-${index}`, `Draw ${index}`), PLAYER1, `draw-${index}`)
  );
  const triggerSource =
    options.addHandToWaitingRoomTriggerSource === true
      ? createCardInstance(
          createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
          PLAYER1,
          'hand-to-waiting-trigger-source'
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
  mutableState.currentPhase = options.phase ?? GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
  mutableState.waitingPlayerId = null;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = handCards.map((card) => card.instanceId);
  p1.mainDeck.cardIds = drawnCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: triggerSource?.instanceId ?? null,
    [SlotPosition.CENTER]: options.sourceOnStage === false ? null : source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    ...(options.sourceOnStage === false
      ? []
      : [
          [
            source.instanceId,
            {
              orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            },
          ] as const,
        ]),
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

function activate(scenario: Scenario) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(PLAYER1, scenario.sourceId, PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID)
  );
}

function sourceOrientation(scenario: Scenario): OrientationState | undefined {
  return scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.sourceId)
    ?.orientation;
}

describe('PR shared activated wait self discard draw workflow', () => {
  for (const cardCode of ['PL!-PR-012-PR', 'PL!S-PR-038-PR', 'PL!SP-PR-017-PR'] as const) {
    it(`waits, discards, and draws for ${cardCode}`, () => {
      const scenario = setupScenario(cardCode, { addHandToWaitingRoomTriggerSource: true });

      const activateResult = activate(scenario);

      expect(activateResult.success).toBe(true);
      expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
      expect(scenario.session.state?.activeEffect).toMatchObject({
        abilityId: PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
        selectableCardIds: [scenario.handCardIds[0]],
      });

      const memberStateEvent = scenario.session.state?.eventLog.find(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.sourceId
      )?.event;
      expect(memberStateEvent).toMatchObject({
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
      });

      const finishResult = scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.handCardIds[0]
        )
      );

      expect(finishResult.success).toBe(true);
      expect(scenario.session.state?.activeEffect).toBeNull();
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
        scenario.handCardIds[0],
      ]);
      expect(scenario.session.state?.players[0].hand.cardIds).toEqual([scenario.drawnCardIds[0]]);
      expect(
        scenario.session.state?.eventLog.some(
          (entry) =>
            entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            entry.event.cardInstanceId === scenario.handCardIds[0]
        )
      ).toBe(true);
      expect(
        scenario.session.state?.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId ===
              HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
            action.payload.sourceCardId === scenario.triggerSourceId &&
            action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
        )
      ).toBe(true);
      expect(
        scenario.session.state?.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID &&
            action.payload.step === 'ABILITY_USE'
        )
      ).toBe(true);
    });
  }

  it('does not activate without hand cards and does not wait the source', () => {
    const scenario = setupScenario('PL!-PR-012-PR', { handCount: 0 });

    const result = activate(scenario);

    expect(result.success).toBe(false);
    expect(sourceOrientation(scenario)).toBe(OrientationState.ACTIVE);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not activate from a waiting source, off-stage source, or non-main phase', () => {
    const waiting = setupScenario('PL!-PR-012-PR', {
      sourceOrientation: OrientationState.WAITING,
    });
    expect(activate(waiting).success).toBe(false);
    expect(sourceOrientation(waiting)).toBe(OrientationState.WAITING);

    const offStage = setupScenario('PL!S-PR-038-PR', { sourceOnStage: false });
    expect(activate(offStage).success).toBe(false);
    expect(offStage.session.state?.activeEffect).toBeNull();

    const nonMain = setupScenario('PL!SP-PR-017-PR', { phase: GamePhase.LIVE_SET_PHASE });
    expect(activate(nonMain).success).toBe(false);
    expect(sourceOrientation(nonMain)).toBe(OrientationState.ACTIVE);
  });

  it('enforces once per turn after the discard cost resolves', () => {
    const scenario = setupScenario('PL!-PR-012-PR');

    expect(activate(scenario).success).toBe(true);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.handCardIds[0]
        )
      ).success
    ).toBe(true);

    const p1 = scenario.session.state!.players[0] as unknown as {
      memberSlots: {
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    p1.memberSlots.cardStates.set(scenario.sourceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });

    expect(activate(scenario).success).toBe(false);
    expect(
      scenario.session.state?.actionHistory.filter(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID &&
          action.payload.waitedMemberCardId === scenario.sourceId
      )
    ).toHaveLength(1);
  });
});
