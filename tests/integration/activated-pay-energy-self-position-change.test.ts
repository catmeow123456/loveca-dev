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
  SP_BP2_008_ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
  SP_SD2_002_ACTIVATED_PAY_TWO_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
  SP_SD2_002_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
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

function createMemberCard(cardCode: string, name = cardCode, cost = 2): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
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
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

interface EnergyPositionChangeScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly otherId: string;
  readonly energyCardIds: readonly string[];
  readonly abilityId: string;
}

function setupScenario(options: {
  readonly cardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly abilityId: string;
  readonly energyCount: number;
  readonly otherInLeft?: boolean;
}): EnergyPositionChangeScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('activated-pay-energy-self-position-change', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard(options.cardCode, options.sourceName, options.sourceCost),
    PLAYER1,
    'p1-pay-energy-position-source'
  );
  const other = createCardInstance(
    createMemberCard('PL!SP-test-other-member', 'Other Liella member', 4),
    PLAYER1,
    'p1-pay-energy-position-other'
  );
  const energies = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(createEnergyCard(`TEST-ENERGY-${index}`), PLAYER1, `p1-energy-${index}`)
  );

  const state = registerCards(session.state!, [source, other, ...energies]);
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
  p1.hand.cardIds = [];
  p1.mainDeck.cardIds = [];
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.energyZone.cardIds = energies.map((card) => card.instanceId);
  p1.energyZone.cardStates = new Map(
    energies.map((card) => [
      card.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: options.otherInLeft === false ? null : other.instanceId,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ...(options.otherInLeft === false
      ? []
      : [
          [
            other.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ] as const,
        ]),
  ]);

  return {
    session,
    sourceId: source.instanceId,
    otherId: other.instanceId,
    energyCardIds: energies.map((card) => card.instanceId),
    abilityId: options.abilityId,
  };
}

function activate(scenario: EnergyPositionChangeScenario, expectedSuccess = true): void {
  const result = scenario.session.executeCommand(
    createActivateAbilityCommand(PLAYER1, scenario.sourceId, scenario.abilityId)
  );
  expect(result.success).toBe(expectedSuccess);
}

function abilityUseCount(game: GameState, abilityId: string): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === abilityId &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('activated pay-energy self position-change shared workflow', () => {
  it('PL!SP-bp2-008 pays 1 active energy before opening a mandatory position-change window', () => {
    const scenario = setupScenario({
      cardCode: 'PL!SP-bp2-008-R',
      sourceName: '若菜四季',
      sourceCost: 9,
      abilityId: SP_BP2_008_ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      energyCount: 1,
    });

    activate(scenario);

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP2_008_ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: false,
    });
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === scenario.abilityId &&
          action.payload.energyCardIds?.[0] === scenario.energyCardIds[0]
      )
    ).toBe(true);
  });

  it('PL!SP-sd2-002 pays 2 active energy, moves, and triggers its own purple Heart auto ability', () => {
    const scenario = setupScenario({
      cardCode: 'PL!SP-sd2-002-SD2',
      sourceName: '唐 可可',
      sourceCost: 13,
      abilityId: SP_SD2_002_ACTIVATED_PAY_TWO_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      energyCount: 2,
    });

    activate(scenario);
    const moveResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(moveResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      scenario.sourceId
    );
    expect(scenario.session.state?.players[0].positionMovedThisTurn).toContain(
      scenario.sourceId
    );
    expect(
      scenario.session.state?.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.abilityId === SP_SD2_002_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID
      )
    ).toEqual([
      {
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        playerId: PLAYER1,
        sourceCardId: scenario.sourceId,
        abilityId: SP_SD2_002_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.PURPLE, count: 1 }],
      },
    ]);
  });

  it('does not pay, open a window, or record ability use when active energy is insufficient', () => {
    const scenario = setupScenario({
      cardCode: 'PL!SP-sd2-002-SD2',
      sourceName: '唐 可可',
      sourceCost: 13,
      abilityId: SP_SD2_002_ACTIVATED_PAY_TWO_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      energyCount: 1,
    });

    activate(scenario, false);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(abilityUseCount(scenario.session.state!, scenario.abilityId)).toBe(0);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === scenario.abilityId
      )
    ).toBe(false);
  });

  it('records positionMovedThisTurn and ON_MEMBER_SLOT_MOVED for an empty-slot move', () => {
    const scenario = setupScenario({
      cardCode: 'PL!SP-bp2-008-P',
      sourceName: '若菜四季',
      sourceCost: 9,
      abilityId: SP_BP2_008_ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      energyCount: 1,
      otherInLeft: false,
    });

    activate(scenario);
    const moveResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(moveResult.success).toBe(true);
    expect(scenario.session.state?.players[0].positionMovedThisTurn).toEqual([
      scenario.sourceId,
    ]);
    expect(
      scenario.session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          entry.event.cardInstanceId === scenario.sourceId &&
          entry.event.fromSlot === SlotPosition.CENTER &&
          entry.event.toSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });

  it('records both members as moved when the selected slot is occupied', () => {
    const scenario = setupScenario({
      cardCode: 'PL!SP-bp2-008-R',
      sourceName: '若菜四季',
      sourceCost: 9,
      abilityId: SP_BP2_008_ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      energyCount: 1,
    });

    activate(scenario);
    const moveResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    );

    expect(moveResult.success).toBe(true);
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.sourceId
    );
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      scenario.otherId
    );
    expect(scenario.session.state?.players[0].positionMovedThisTurn).toEqual([
      scenario.sourceId,
      scenario.otherId,
    ]);
  });
});
