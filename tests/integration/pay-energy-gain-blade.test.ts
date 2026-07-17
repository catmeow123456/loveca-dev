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
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  PL_N_BP1_001_LIVE_START_PAY_ONE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
  S_PR_013_LIVE_START_PAY_TWO_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
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

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    cardType: CardType.LIVE,
    score: 3,
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
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
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

  const service = new GameService();
  const advanceResult = service.advancePhase(state);
  expect(advanceResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
}

describe('pay energy gain Blade workflow', () => {
  it('pays two active energy for PL!S-PR-013 and gives the source member Blade +2', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'pay-energy-gain-blade-s-pr-013-fixed-two',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!S-PR-013-PR', '高海千歌', 11),
      PLAYER1,
      'p1-s-pr-013-source'
    );
    const liveCard = createCardInstance(
      createLiveCard('PL!S-test-live', 'Live'),
      PLAYER1,
      'p1-s-pr-013-live'
    );
    let state = registerCards(session.state!, [source, liveCard]);
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
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardIds = state.players[0].energyDeck.cardIds.slice(0, 2);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCard.instanceId];
    p1.liveZone.cardStates = new Map([
      [liveCard.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    setActiveEnergy(p1, energyCardIds);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      S_PR_013_LIVE_START_PAY_TWO_ENERGY_GAIN_TWO_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('S_PR_013_LIVE_START_PAY_ENERGY');
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'pay', label: '支付[E][E]' },
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不发动');
    expect(session.state?.activeEffect?.metadata?.activeEnergyCardIds).toEqual(energyCardIds);
    expect(session.state?.activeEffect?.metadata?.energyCostCount).toBe(2);
    expect(session.state?.activeEffect?.metadata?.bladeBonus).toBe(2);

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    for (const energyCardId of energyCardIds) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: S_PR_013_LIVE_START_PAY_TWO_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            S_PR_013_LIVE_START_PAY_TWO_ENERGY_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.amount === 2 &&
          Array.isArray(action.payload.energyCardIds) &&
          action.payload.energyCardIds.length === 2
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            S_PR_013_LIVE_START_PAY_TWO_ENERGY_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'PAY_ENERGY_GAIN_BLADE' &&
          action.payload.bladeBonus === 2 &&
          Array.isArray(action.payload.paidEnergyCardIds) &&
          action.payload.paidEnergyCardIds.length === 2
      )
    ).toBe(true);
  });

  it('uses current live-zone count for HS-bp1-004 Blade bonus after paying energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'pay-energy-gain-blade-hs-bp1-004-live-zone-count',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp1-004-P', '夕霧綴理', 15),
      PLAYER1,
      'p1-hs-bp1-004-source'
    );
    const liveCards = [0, 1, 2].map((index) =>
      createCardInstance(
        createLiveCard(`PL!HS-test-live-${index}`, `Live ${index}`),
        PLAYER1,
        `p1-hs-bp1-004-live-${index}`
      )
    );
    let state = registerCards(session.state!, [source, ...liveCards]);
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
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardId = state.players[0].energyDeck.cardIds[0]!;

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = liveCards.map((card) => card.instanceId);
    p1.liveZone.cardStates = new Map(
      liveCards.map((card) => [
        card.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
      ])
    );
    setActiveEnergy(p1, [energyCardId]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP1_004_LIVE_START_PAY_ENERGY');
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'pay', label: '支付[E]' },
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不发动');
    expect(session.state?.activeEffect?.metadata?.activeEnergyCardIds).toEqual([energyCardId]);
    expect(session.state?.activeEffect?.metadata?.liveZoneCardCount).toBe(3);

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 3,
      sourceCardId: source.instanceId,
      abilityId: HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'PAY_ENERGY_GAIN_BLADE' &&
          action.payload.bladeBonus === 3 &&
          Array.isArray(action.payload.paidEnergyCardIds) &&
          action.payload.paidEnergyCardIds[0] === energyCardId
      )
    ).toBe(true);
  });

  function setupBp1001(options: {
    readonly energyOrientations: readonly OrientationState[];
    readonly markedEnergyIndices?: readonly number[];
  }): { readonly game: GameState; readonly sourceId: string; readonly otherId: string; readonly energyIds: string[] } {
    const source = createCardInstance(
      createMemberCard('PL!N-bp1-001-P', '上原歩夢', 9),
      PLAYER1,
      'bp1-001-source'
    );
    const other = createCardInstance(
      createMemberCard('PL!N-bp1-other', 'Other member', 4),
      PLAYER1,
      'bp1-001-other'
    );
    const energies = options.energyOrientations.map((_, index) =>
      createCardInstance(createEnergyCard(`BP1-001-E-${index}`), PLAYER1, `bp1-001-e-${index}`)
    );
    let game = registerCards(
      createGameState('pay-energy-gain-blade-bp1-001', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, other, ...energies]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        other.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      energyZone: energies.reduce(
        (zone, card, index) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: options.energyOrientations[index]!,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    }));
    game = {
      ...game,
      energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
        playerId: PLAYER1,
        energyCardId: energies[index]!.instanceId,
        sourceCardId: 'marker-source',
        abilityId: 'marker-ability',
      })),
      pendingAbilities: [
        {
          id: 'bp1-001-pending',
          abilityId: PL_N_BP1_001_LIVE_START_PAY_ONE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
          sourceCardId: source.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['live-start-event'],
        },
      ],
    };
    return {
      game,
      sourceId: source.instanceId,
      otherId: other.instanceId,
      energyIds: energies.map((card) => card.instanceId),
    };
  }

  function openBp1001(game: GameState): GameState {
    return resolvePendingCardEffects(game).gameState;
  }

  function choosePay(game: GameState): GameState {
    return confirmActiveEffectStep(
      game,
      PLAYER1,
      game.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'pay'
    );
  }

  it('PL!N-bp1-001 pays [E], gives only the source member [BLADE], and continues', () => {
    const scenario = setupBp1001({
      energyOrientations: [OrientationState.ACTIVE, OrientationState.ACTIVE],
    });
    let state = openBp1001(scenario.game);

    expect(state.activeEffect).toMatchObject({
      abilityId: PL_N_BP1_001_LIVE_START_PAY_ONE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
      stepId: 'PL_N_BP1_001_LIVE_START_PAY_ENERGY',
      stepText: '可以支付[E]，获得[BLADE]。',
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();

    state = choosePay(state);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[1])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.actionHistory.find((action) => action.type === 'PAY_COST')?.payload.energyCardIds
    ).toEqual([scenario.energyIds[0]]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: scenario.sourceId,
      abilityId: PL_N_BP1_001_LIVE_START_PAY_ONE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
    });
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) => modifier.kind === 'BLADE' && modifier.sourceCardId === scenario.otherId
      )
    ).toBe(false);
  });

  it('PL!N-bp1-001 decline and insufficient energy do not pay or add [BLADE]', () => {
    const payable = setupBp1001({ energyOrientations: [OrientationState.ACTIVE] });
    let declined = openBp1001(payable.game);
    declined = confirmActiveEffectStep(declined, PLAYER1, declined.activeEffect!.id);
    expect(declined.pendingAbilities).toEqual([]);
    expect(declined.players[0].energyZone.cardStates.get(payable.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(declined.liveResolution.liveModifiers).toEqual([]);

    const insufficient = setupBp1001({ energyOrientations: [OrientationState.WAITING] });
    let state = openBp1001(insufficient.game);
    expect(state.activeEffect?.selectableOptions).toEqual([]);
    expect(state.activeEffect?.canSkipSelection).toBe(true);
    expect(state.activeEffect?.skipSelectionLabel).toBe('不发动');
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);
    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('PL!N-bp1-001 uses the common exact selector for marked excess ACTIVE energy', () => {
    const scenario = setupBp1001({
      energyOrientations: [
        OrientationState.ACTIVE,
        OrientationState.ACTIVE,
        OrientationState.ACTIVE,
      ],
      markedEnergyIndices: [1],
    });
    let state = choosePay(openBp1001(scenario.game));

    expect(state.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      selectableCardIds: scenario.energyIds,
      minSelectableCards: 1,
      maxSelectableCards: 1,
    });

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.energyIds[1]!]
    );
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.actionHistory.find((action) => action.type === 'PAY_COST')?.payload.energyCardIds
    ).toEqual([scenario.energyIds[1]]);
  });

  it('PL!N-bp1-001 rejects duplicate, illegal, and stale exact energy ids without advancing', () => {
    const scenario = setupBp1001({
      energyOrientations: [OrientationState.ACTIVE, OrientationState.ACTIVE],
      markedEnergyIndices: [1],
    });
    const selecting = choosePay(openBp1001(scenario.game));

    for (const selectedCardIds of [
      [scenario.energyIds[0]!, scenario.energyIds[0]!],
      ['illegal-energy'],
    ]) {
      const rejected = confirmActiveEffectStep(
        selecting,
        PLAYER1,
        selecting.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        selectedCardIds
      );
      expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
      expect(rejected.activeEffect?.id).toBe(selecting.activeEffect?.id);
      expect(rejected.pendingAbilities).toEqual([]);
      expect(rejected.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    }

    const stale = updatePlayer(selecting, PLAYER1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: player.energyZone.cardIds.filter((id) => id !== scenario.energyIds[1]),
      },
    }));
    const rejected = confirmActiveEffectStep(
      stale,
      PLAYER1,
      stale.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.energyIds[1]!]
    );
    expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(rejected.activeEffect?.id).toBe(selecting.activeEffect?.id);
    expect(rejected.pendingAbilities).toEqual([]);
    expect(rejected.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('PL!N-bp1-001 does not pay or add a modifier when the source leaves before confirmation', () => {
    const scenario = setupBp1001({ energyOrientations: [OrientationState.ACTIVE] });
    let state = openBp1001(scenario.game);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    state = choosePay(state);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });
});
