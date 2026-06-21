import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { addAction, registerCards, type GameState } from '../../src/domain/entities/game';
import { createActivateAbilityCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { startKanataWaitSelfActivateEnergy } from '../../src/application/card-effects/workflows/cards/n-pb1-006-kanata';
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
    groupName: '虹咲学园学园偶像同好会',
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

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

interface KanataScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly energyCardIds: readonly string[];
}

function setupKanataScenario(options: {
  readonly sourceOrientation?: OrientationState;
  readonly energyOrientations?: readonly OrientationState[];
  readonly currentPhase?: GamePhase;
  readonly activePlayerIndex?: number;
} = {}): KanataScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('n-pb1-006-kanata', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('PL!N-pb1-006-R', '近江彼方', 9),
    PLAYER1,
    'p1-n-pb1-006-kanata'
  );
  const energyCards = (options.energyOrientations ?? []).map((_, index) =>
    createCardInstance(createEnergyCard(`ENE-kanata-${index}`), PLAYER1, `p1-kanata-energy-${index}`)
  );

  const state = registerCards(session.state!, [source, ...energyCards]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutableState.currentPhase = options.currentPhase ?? GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = options.activePlayerIndex ?? 0;
  mutableState.waitingPlayerId = null;

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
  p1.hand.cardIds = [];
  p1.mainDeck.cardIds = [];
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
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
  ]);
  p1.energyZone.cardIds = energyCards.map((card) => card.instanceId);
  p1.energyZone.cardStates = new Map(
    energyCards.map((card, index) => [
      card.instanceId,
      {
        orientation: options.energyOrientations?.[index] ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      },
    ])
  );

  return {
    session,
    sourceId: source.instanceId,
    energyCardIds: energyCards.map((card) => card.instanceId),
  };
}

function activateKanata(scenario: KanataScenario) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID
    )
  );
}

function sourceOrientation(scenario: KanataScenario): OrientationState | undefined {
  return scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.sourceId)
    ?.orientation;
}

function energyOrientation(
  scenario: KanataScenario,
  energyCardId: string
): OrientationState | undefined {
  return scenario.session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation;
}

describe('PL!N-pb1-006 Kanata activated workflow', () => {
  it('waits the source as cost and activates one waiting energy', () => {
    const scenario = setupKanataScenario({
      energyOrientations: [OrientationState.WAITING, OrientationState.WAITING],
    });

    const result = activateKanata(scenario);

    expect(result.success).toBe(true);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(energyOrientation(scenario, scenario.energyCardIds[0]!)).toBe(OrientationState.ACTIVE);
    expect(energyOrientation(scenario, scenario.energyCardIds[1]!)).toBe(OrientationState.WAITING);

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
            PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID &&
          action.payload.sourceCardId === scenario.sourceId &&
          action.payload.waitedMemberCardId === scenario.sourceId &&
          action.payload.previousOrientation === OrientationState.ACTIVE &&
          action.payload.nextOrientation === OrientationState.WAITING &&
          action.payload.memberStateChangedEventIds?.includes(memberStateEvent?.eventId)
      )
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID &&
          action.payload.sourceCardId === scenario.sourceId &&
          action.payload.step === 'WAIT_SELF_ACTIVATE_ENERGY' &&
          action.payload.activatedEnergyCardIds?.[0] === scenario.energyCardIds[0]
      )
    ).toBe(true);
  });

  it('can pay the source wait cost when there is no waiting energy', () => {
    const scenario = setupKanataScenario({
      energyOrientations: [OrientationState.ACTIVE],
    });

    const result = activateKanata(scenario);

    expect(result.success).toBe(true);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(energyOrientation(scenario, scenario.energyCardIds[0]!)).toBe(OrientationState.ACTIVE);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID &&
          Array.isArray(action.payload.activatedEnergyCardIds) &&
          action.payload.activatedEnergyCardIds.length === 0
      )
    ).toBe(true);
  });

  it('records PAY_COST before member-state-change triggers are enqueued', () => {
    const scenario = setupKanataScenario({
      energyOrientations: [OrientationState.WAITING],
    });
    let triggeredMemberStateChangedEventId: string | undefined;

    const nextState = startKanataWaitSelfActivateEnergy(
      scenario.session.state!,
      PLAYER1,
      scenario.sourceId,
      {
        enqueueTriggeredCardEffects: (game, _triggerConditions, options) => {
          triggeredMemberStateChangedEventId = options?.memberStateChangedEvents?.[0]?.eventId;
          return addAction(game, 'TRIGGER_ABILITY', PLAYER1, {
            abilityId: 'TEST_MEMBER_STATE_CHANGED_TRIGGER',
            sourceCardId: scenario.sourceId,
            memberStateChangedEventId: triggeredMemberStateChangedEventId,
          });
        },
      }
    );

    const payCostIndex = nextState.actionHistory.findIndex(
      (action) =>
        action.type === 'PAY_COST' &&
        action.payload.abilityId ===
          PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID &&
        action.payload.memberStateChangedEventIds?.includes(triggeredMemberStateChangedEventId)
    );
    const triggerIndex = nextState.actionHistory.findIndex(
      (action) =>
        action.type === 'TRIGGER_ABILITY' &&
        action.payload.memberStateChangedEventId === triggeredMemberStateChangedEventId
    );

    expect(triggeredMemberStateChangedEventId).toBeDefined();
    expect(payCostIndex).toBeGreaterThanOrEqual(0);
    expect(triggerIndex).toBeGreaterThanOrEqual(0);
    expect(payCostIndex).toBeLessThan(triggerIndex);
  });

  it('cannot activate when the source is already waiting', () => {
    const scenario = setupKanataScenario({
      sourceOrientation: OrientationState.WAITING,
      energyOrientations: [OrientationState.WAITING],
    });

    const result = activateKanata(scenario);

    expect(result.success).toBe(false);
    expect(sourceOrientation(scenario)).toBe(OrientationState.WAITING);
    expect(energyOrientation(scenario, scenario.energyCardIds[0]!)).toBe(OrientationState.WAITING);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID
      )
    ).toBe(false);
  });

  it('cannot activate outside the main phase', () => {
    const scenario = setupKanataScenario({
      currentPhase: GamePhase.LIVE_SET_PHASE,
      energyOrientations: [OrientationState.WAITING],
    });

    const result = activateKanata(scenario);

    expect(result.success).toBe(false);
    expect(sourceOrientation(scenario)).toBe(OrientationState.ACTIVE);
    expect(energyOrientation(scenario, scenario.energyCardIds[0]!)).toBe(OrientationState.WAITING);
  });

  it('cannot activate for a non-current player', () => {
    const scenario = setupKanataScenario({
      activePlayerIndex: 1,
      energyOrientations: [OrientationState.WAITING],
    });

    const result = activateKanata(scenario);

    expect(result.success).toBe(false);
    expect(sourceOrientation(scenario)).toBe(OrientationState.ACTIVE);
    expect(energyOrientation(scenario, scenario.energyCardIds[0]!)).toBe(OrientationState.WAITING);
  });
});
