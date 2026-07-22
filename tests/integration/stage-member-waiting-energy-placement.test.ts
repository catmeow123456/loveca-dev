import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  SP_BP4_005_CONTINUOUS_ENERGY_TEN_GAIN_THREE_BLADE_ABILITY_ID,
  SP_BP4_005_ON_ENTER_LIELLA_RELAY_ENERGY_SEVEN_PLACE_TWO_WAITING_ENERGY_ABILITY_ID,
  SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
} from '../../src/domain/rules/live-modifiers';
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

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly blade?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.unitName ?? 'KALEIDOSCORE',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 30 }, (_, index) =>
    createMember(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 15 }, (_, index) => createEnergy(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhase(session: GameSession): void {
  const state = session.state!;
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
}

function setEnergyZones(
  state: GameState,
  options: {
    readonly energyZoneCount: number;
    readonly energyDeckCount: number;
    readonly activeEnergyCount?: number;
    readonly markedEnergyIndices?: readonly number[];
  }
): {
  readonly energyZoneCardIds: readonly string[];
  readonly energyDeckCardIds: readonly string[];
} {
  const p1 = state.players[0] as unknown as {
    energyDeck: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  const allEnergyCardIds = [...p1.energyDeck.cardIds];
  const energyZoneCardIds = allEnergyCardIds.slice(0, options.energyZoneCount);
  const energyDeckCardIds = allEnergyCardIds.slice(
    options.energyZoneCount,
    options.energyZoneCount + options.energyDeckCount
  );
  const activeEnergyCount = options.activeEnergyCount ?? options.energyZoneCount;
  p1.energyZone.cardIds = [...energyZoneCardIds];
  p1.energyZone.cardStates = new Map(
    energyZoneCardIds.map((cardId, index) => [
      cardId,
      {
        orientation: index < activeEnergyCount ? OrientationState.ACTIVE : OrientationState.WAITING,
        face: FaceState.FACE_UP,
      },
    ])
  );
  p1.energyDeck.cardIds = [...energyDeckCardIds];
  return { energyZoneCardIds, energyDeckCardIds };
}

function setupActivatedScenario(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly sourceOrientation?: OrientationState;
  readonly sourceOnStage?: boolean;
  readonly energyZoneCount: number;
  readonly energyDeckCount: number;
  readonly activeEnergyCount?: number;
}): {
  readonly session: GameSession;
  readonly sourceId: string;
  readonly energyZoneCardIds: readonly string[];
  readonly energyDeckCardIds: readonly string[];
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('stage-member-waiting-energy-placement', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhase(session);

  const source = createCardInstance(
    createMember(options.sourceCardCode, {
      name: options.sourceName,
      cost: options.sourceCost,
    }),
    PLAYER1,
    'source-member'
  );
  const state = registerCards(session.state!, [source]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const { energyZoneCardIds, energyDeckCardIds } = setEnergyZones(state, options);
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = [];
  p1.waitingRoom.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: options.sourceOnStage === false ? null : source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map(
    options.sourceOnStage === false
      ? []
      : [
          [
            source.instanceId,
            {
              orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            },
          ],
        ]
  );
  (
    state as GameState & {
      energyActivePhaseSkips: Array<{
        playerId: string;
        energyCardId: string;
        sourceCardId: string;
        abilityId: string;
      }>;
    }
  ).energyActivePhaseSkips = (options.markedEnergyIndices ?? []).map((index) => ({
    playerId: PLAYER1,
    energyCardId: energyZoneCardIds[index]!,
    sourceCardId: 'marker-source',
    abilityId: 'marker-ability',
  }));

  return {
    session,
    sourceId: source.instanceId,
    energyZoneCardIds,
    energyDeckCardIds,
  };
}

function activate(session: GameSession, sourceId: string, abilityId: string) {
  return session.executeCommand(createActivateAbilityCommand(PLAYER1, sourceId, abilityId));
}

function setAuthorityState(session: GameSession, game: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}

describe('PL!SP-bp5-021 Margarete activated energy placement', () => {
  it('pays self-sacrifice cost, then places one waiting energy at six or more energy', () => {
    const { session, sourceId, energyDeckCardIds } = setupActivatedScenario({
      sourceCardCode: 'PL!SP-bp5-021-N',
      sourceName: 'ウィーン・マルガレーテ',
      sourceCost: 2,
      energyZoneCount: 6,
      energyDeckCount: 2,
    });

    expect(
      activate(
        session,
        sourceId,
        SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
    expect(session.state?.players[0].energyZone.cardIds).toContain(energyDeckCardIds[0]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyDeckCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.conditionMet === true &&
          action.payload.placedEnergyCardIds?.[0] === energyDeckCardIds[0]
      )
    ).toBe(true);
  });

  it('still pays the self-sacrifice cost when energy is below six but places no energy', () => {
    const { session, sourceId, energyZoneCardIds, energyDeckCardIds } = setupActivatedScenario({
      sourceCardCode: 'PL!SP-bp5-021-N',
      sourceName: 'ウィーン・マルガレーテ',
      sourceCost: 2,
      energyZoneCount: 5,
      energyDeckCount: 1,
    });

    expect(
      activate(
        session,
        sourceId,
        SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
    expect(session.state?.players[0].energyZone.cardIds).toEqual(energyZoneCardIds);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(energyDeckCardIds);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.conditionMet === false &&
          action.payload.placedEnergyCardIds?.length === 0
      )
    ).toBe(true);
  });
});

describe('PL!SP-bp4-010 Margarete activated energy placement', () => {
  it('pays one active energy, waits itself, and places one waiting energy', () => {
    const { session, sourceId, energyZoneCardIds, energyDeckCardIds } = setupActivatedScenario({
      sourceCardCode: 'PL!SP-bp4-010-R',
      sourceName: 'ウィーン・マルガレーテ',
      sourceCost: 9,
      energyZoneCount: 1,
      energyDeckCount: 2,
    });

    expect(
      activate(
        session,
        sourceId,
        SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(true);

    expect(
      session.state?.players[0].energyZone.cardStates.get(energyZoneCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardIds).toContain(energyDeckCardIds[0]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyDeckCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);
  });

  it('does not activate without active energy or when the source is already waiting', () => {
    const noActiveEnergy = setupActivatedScenario({
      sourceCardCode: 'PL!SP-bp4-010-R',
      sourceName: 'ウィーン・マルガレーテ',
      sourceCost: 9,
      energyZoneCount: 1,
      activeEnergyCount: 0,
      energyDeckCount: 1,
    });
    expect(
      activate(
        noActiveEnergy.session,
        noActiveEnergy.sourceId,
        SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(false);

    const waitingSource = setupActivatedScenario({
      sourceCardCode: 'PL!SP-bp4-010-R',
      sourceName: 'ウィーン・マルガレーテ',
      sourceCost: 9,
      sourceOrientation: OrientationState.WAITING,
      energyZoneCount: 1,
      energyDeckCount: 1,
    });
    expect(
      activate(
        waitingSource.session,
        waitingSource.sourceId,
        SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(false);
  });

  it('enforces per-turn limit only after costs are paid', () => {
    const { session, sourceId } = setupActivatedScenario({
      sourceCardCode: 'PL!SP-bp4-010-P',
      sourceName: 'ウィーン・マルガレーテ',
      sourceCost: 9,
      energyZoneCount: 2,
      energyDeckCount: 2,
    });

    expect(
      activate(
        session,
        sourceId,
        SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(true);
    const p1 = session.state!.players[0] as unknown as {
      memberSlots: {
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    p1.memberSlots.cardStates.set(sourceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    expect(
      activate(
        session,
        sourceId,
        SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(false);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
  });
});

describe('PL!SP-sd1-011 Tomari activated waiting-energy placement', () => {
  it.each(['PL!SP-sd1-011-P', 'PL!SP-sd1-011-SD', 'PL!SP-sd1-011-SD2'])(
    '%s pays two ACTIVE energy and places one WAITING energy through the base definition',
    (sourceCardCode) => {
      const { session, sourceId, energyZoneCardIds, energyDeckCardIds } = setupActivatedScenario({
        sourceCardCode,
        sourceName: '鬼塚冬毬',
        sourceCost: 7,
        energyZoneCount: 3,
        energyDeckCount: 2,
      });

      expect(
        activate(
          session,
          sourceId,
          SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
        ).success
      ).toBe(true);
      const payCost = session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      );
      expect(payCost?.payload.energyCardIds).toEqual(energyZoneCardIds.slice(0, 2));
      expect(
        session.state?.players[0].energyZone.cardStates.get(energyZoneCardIds[2]!)?.orientation
      ).toBe(OrientationState.ACTIVE);
      expect(session.state?.players[0].energyZone.cardIds).toContain(energyDeckCardIds[0]);
      expect(
        session.state?.players[0].energyZone.cardStates.get(energyDeckCardIds[0]!)?.orientation
      ).toBe(OrientationState.WAITING);
      const placementEvent = session.state?.eventLog.find(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )?.event;
      expect(placementEvent).toMatchObject({
        targetPlayerId: PLAYER1,
        placedEnergyCardIds: [energyDeckCardIds[0]],
        orientation: OrientationState.WAITING,
        cause: {
          kind: 'CARD_EFFECT',
          playerId: PLAYER1,
          sourceCardId: sourceId,
          abilityId: SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
        },
      });
      expect(
        session.state?.actionHistory.find(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.step === 'PAY_TWO_ENERGY_PLACE_WAITING_ENERGY'
        )?.payload
      ).toMatchObject({
        paidEnergyCardIds: energyZoneCardIds.slice(0, 2),
        placedEnergyCardIds: [energyDeckCardIds[0]],
      });
    }
  );

  it('opens exact special-energy payment with governed copy and validates ids', () => {
    const scenario = setupActivatedScenario({
      sourceCardCode: 'PL!SP-sd1-011-SD',
      sourceName: '鬼塚冬毬',
      sourceCost: 7,
      energyZoneCount: 3,
      energyDeckCount: 1,
      markedEnergyIndices: [0],
    });
    expect(
      activate(
        scenario.session,
        scenario.sourceId,
        SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(true);
    const payment = scenario.session.state!.activeEffect!;
    expect(payment).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
    for (const selectedCardIds of [
      [scenario.energyZoneCardIds[0]!, scenario.energyZoneCardIds[0]!],
      [scenario.energyZoneCardIds[0]!, 'illegal-energy'],
    ]) {
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            payment.id,
            undefined,
            undefined,
            undefined,
            undefined,
            selectedCardIds
          )
        ).success
      ).toBe(false);
      expect(scenario.session.state?.activeEffect?.stepId).toBe(
        'COMMON_ENERGY_OPERATION_SELECTION'
      );
    }
    const selectedCardIds = scenario.energyZoneCardIds.slice(1, 3);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          payment.id,
          undefined,
          undefined,
          undefined,
          undefined,
          selectedCardIds
        )
      ).success
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.find((action) => action.type === 'PAY_COST')?.payload
        .energyCardIds
    ).toEqual(selectedCardIds);
  });

  it('rejects a stale special-energy id without payment, placement, or turn use', () => {
    const scenario = setupActivatedScenario({
      sourceCardCode: 'PL!SP-sd1-011-SD',
      sourceName: '鬼塚冬毬',
      sourceCost: 7,
      energyZoneCount: 3,
      energyDeckCount: 1,
      markedEnergyIndices: [0],
    });
    expect(
      activate(
        scenario.session,
        scenario.sourceId,
        SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(true);
    const payment = scenario.session.state!.activeEffect!;
    const staleId = scenario.energyZoneCardIds[0]!;
    const staleState = updatePlayer(scenario.session.state!, PLAYER1, (player) => {
      const cardStates = new Map(player.energyZone.cardStates);
      cardStates.delete(staleId);
      return {
        ...player,
        energyZone: {
          ...player.energyZone,
          cardIds: player.energyZone.cardIds.filter((cardId) => cardId !== staleId),
          cardStates,
        },
      };
    });
    setAuthorityState(scenario.session, staleState);
    const actionHistoryLength = scenario.session.state!.actionHistory.length;
    const staleResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        payment.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [staleId, scenario.energyZoneCardIds[1]!]
      )
    );
    expect(staleResult.success).toBe(false);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      id: payment.id,
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
    });
    expect(scenario.session.state?.actionHistory).toHaveLength(actionHistoryLength);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID &&
          (action.type === 'PAY_COST' ||
            action.type === 'RESOLVE_ABILITY' ||
            action.payload.step === 'ABILITY_USE')
      )
    ).toBe(false);
    expect(
      scenario.session.state?.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toBe(false);
    expect(scenario.session.state?.players[0].energyDeck.cardIds).toEqual(
      scenario.energyDeckCardIds
    );
    expect(
      scenario.energyZoneCardIds.slice(1).map(
        (cardId) =>
          scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);

    const validEnergyCardIds = scenario.energyZoneCardIds.slice(1, 3);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          payment.id,
          undefined,
          undefined,
          undefined,
          undefined,
          validEnergyCardIds
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      )?.payload.energyCardIds
    ).toEqual(validEnergyCardIds);
    expect(scenario.session.state?.players[0].energyDeck.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].energyZone.cardIds).toContain(
      scenario.energyDeckCardIds[0]
    );
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(
        scenario.energyDeckCardIds[0]!
      )?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('keeps cost and turn1 use when the energy deck is empty, then rejects a repeat', () => {
    const { session, sourceId, energyZoneCardIds } = setupActivatedScenario({
      sourceCardCode: 'PL!SP-sd1-011-P',
      sourceName: '鬼塚冬毬',
      sourceCost: 7,
      energyZoneCount: 3,
      energyDeckCount: 0,
    });
    expect(
      activate(
        session,
        sourceId,
        SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(true);
    expect(
      energyZoneCardIds
        .slice(0, 2)
        .map((cardId) => session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation)
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
    expect(
      session.state?.actionHistory.find(
        (action) => action.payload.step === 'PAY_TWO_ENERGY_PLACE_WAITING_ENERGY'
      )?.payload.placedEnergyCardIds
    ).toEqual([]);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.payload.abilityId ===
            SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
    expect(
      activate(
        session,
        sourceId,
        SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(false);
  });

  it.each([
    ['insufficient ACTIVE energy', { activeEnergyCount: 1 }],
    ['wrong phase', { wrongPhase: true }],
    ['not active player', { inactivePlayer: true }],
    ['source not on stage', { sourceOnStage: false }],
  ])('does not activate when %s', (_label, options) => {
    const scenario = setupActivatedScenario({
      sourceCardCode: 'PL!SP-sd1-011-SD',
      sourceName: '鬼塚冬毬',
      sourceCost: 7,
      sourceOnStage: options.sourceOnStage,
      energyZoneCount: 2,
      activeEnergyCount: options.activeEnergyCount,
      energyDeckCount: 1,
    });
    if (options.wrongPhase) {
      setAuthorityState(scenario.session, {
        ...scenario.session.state!,
        currentPhase: GamePhase.LIVE_SET,
      });
    }
    if (options.inactivePlayer) {
      setAuthorityState(scenario.session, { ...scenario.session.state!, activePlayerIndex: 1 });
    }
    expect(
      activate(
        scenario.session,
        scenario.sourceId,
        SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      ).success
    ).toBe(false);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
          SP_SD1_011_ACTIVATED_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      )
    ).toBe(false);
    expect(scenario.session.state?.players[0].energyDeck.cardIds).toEqual(
      scenario.energyDeckCardIds
    );
  });
});

function setupRenOnEnterScenario(options: {
  readonly replacementGroupName?: string;
  readonly includeReplacementOnStage?: boolean;
  readonly useRelay?: boolean;
  readonly energyZoneCount: number;
  readonly energyDeckCount: number;
}): {
  readonly session: GameSession;
  readonly renId: string;
  readonly replacementId: string;
  readonly energyDeckCardIds: readonly string[];
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('sp-bp4-005-ren-energy-placement', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhase(session);

  const ren = createCardInstance(
    createMember('PL!SP-bp4-005-SEC', { name: '葉月 恋', cost: 15 }),
    PLAYER1,
    'ren-source'
  );
  const replacement = createCardInstance(
    createMember(
      options.replacementGroupName === 'Aqours'
        ? 'PL!S-replacement-member'
        : 'PL!SP-replacement-member',
      {
        name: 'Replacement',
        groupNames: [options.replacementGroupName ?? 'Liella!'],
      }
    ),
    PLAYER1,
    'relay-replacement'
  );
  const state = registerCards(session.state!, [ren, replacement]);
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const { energyDeckCardIds } = setEnergyZones(state, options);

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = [ren.instanceId];
  p1.waitingRoom.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]:
      options.includeReplacementOnStage === false ? null : replacement.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates =
    options.includeReplacementOnStage === false
      ? new Map()
      : new Map([
          [
            replacement.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ],
        ]);

  return {
    session,
    renId: ren.instanceId,
    replacementId: replacement.instanceId,
    energyDeckCardIds,
  };
}

function playRen(session: GameSession, renId: string, useRelay = true): void {
  session.setManualOperationMode('FREE');
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, renId, SlotPosition.CENTER, {
      freePlay: true,
      ...(useRelay
        ? {
            relayMode: 'SINGLE' as const,
            relayReplacementSlots: [SlotPosition.CENTER],
          }
        : {}),
    })
  );
  expect(result.success).toBe(true);
}

describe('PL!SP-bp4-005 Ren on-enter and continuous abilities', () => {
  it('places two waiting energy when entering by Liella relay with seven or more energy', () => {
    const { session, renId, energyDeckCardIds } = setupRenOnEnterScenario({
      energyZoneCount: 7,
      energyDeckCount: 3,
    });

    playRen(session, renId);

    expect(session.state?.players[0].energyZone.cardIds).toEqual(
      expect.arrayContaining([energyDeckCardIds[0], energyDeckCardIds[1]])
    );
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyDeckCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_005_ON_ENTER_LIELLA_RELAY_ENERGY_SEVEN_PLACE_TWO_WAITING_ENERGY_ABILITY_ID &&
          action.payload.conditionMet === true &&
          action.payload.placedEnergyCardIds?.length === 2
      )
    ).toBe(true);
  });

  it('does not place energy for non-Liella relay, non-relay entry, or insufficient energy', () => {
    const nonLiella = setupRenOnEnterScenario({
      replacementGroupName: 'Aqours',
      energyZoneCount: 7,
      energyDeckCount: 2,
    });
    playRen(nonLiella.session, nonLiella.renId);
    expect(nonLiella.session.state?.players[0].energyDeck.cardIds).toEqual(
      nonLiella.energyDeckCardIds
    );

    const nonRelay = setupRenOnEnterScenario({
      includeReplacementOnStage: false,
      energyZoneCount: 7,
      energyDeckCount: 2,
    });
    playRen(nonRelay.session, nonRelay.renId, false);
    expect(nonRelay.session.state?.players[0].energyDeck.cardIds).toEqual(
      nonRelay.energyDeckCardIds
    );

    const lowEnergy = setupRenOnEnterScenario({
      energyZoneCount: 6,
      energyDeckCount: 2,
    });
    playRen(lowEnergy.session, lowEnergy.renId);
    expect(lowEnergy.session.state?.players[0].energyDeck.cardIds).toEqual(
      lowEnergy.energyDeckCardIds
    );
  });

  it('grants Blade +3 continuously while energy is ten or more', () => {
    const { session, sourceId } = setupActivatedScenario({
      sourceCardCode: 'PL!SP-bp4-005-P＋',
      sourceName: '葉月 恋',
      sourceCost: 15,
      energyZoneCount: 10,
      energyDeckCount: 0,
    });

    const modifiers = collectLiveModifiers(session.state!);
    expect(modifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'BLADE',
          sourceCardId: sourceId,
          abilityId: SP_BP4_005_CONTINUOUS_ENERGY_TEN_GAIN_THREE_BLADE_ABILITY_ID,
          countDelta: 3,
        }),
      ])
    );
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId, modifiers)).toBe(4);
  });
});
