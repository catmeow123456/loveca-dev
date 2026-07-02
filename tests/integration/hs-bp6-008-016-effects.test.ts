import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID,
  HS_BP6_008_LIVE_START_LOW_SCORE_LIVE_ACTIVATE_SELF_ABILITY_ID,
  HS_BP6_008_ON_ENTER_WAIT_SELF_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP6_016_ACTIVATED_TURN_ONCE_PAY_FOUR_ENERGY_PLAY_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
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
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(options: {
  readonly cardCode: string;
  readonly name?: string;
  readonly cost?: number;
  readonly groupNames?: readonly string[];
  readonly unitName?: string;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name ?? options.cardCode,
    groupNames: options.groupNames ?? ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: options.unitName ?? 'EdelNote',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLive(options: {
  readonly cardCode: string;
  readonly score: number;
  readonly groupNames?: readonly string[];
}): LiveCardData {
  return {
    cardCode: options.cardCode,
    name: options.cardCode,
    groupNames: options.groupNames ?? ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.LIVE,
    score: options.score,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function baseGame(testId: string): GameState {
  return {
    ...createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2'),
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}

function setupBp6008(options: {
  readonly sourceOrientation?: OrientationState;
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly liveZoneCards?: readonly ReturnType<typeof createCardInstance>[];
}): {
  readonly game: GameState;
  readonly sourceId: string;
} {
  const source = createCardInstance(
    createMember({
      cardCode: 'PL!HS-bp6-008-R',
      name: '桂城 泉',
      cost: 11,
    }),
    PLAYER1,
    'bp6-008-source'
  );
  const allCards = [source, ...(options.waitingRoomCards ?? []), ...(options.liveZoneCards ?? [])];
  let game = registerCards(baseGame('bp6-008'), allCards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    waitingRoom: (options.waitingRoomCards ?? []).reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
    liveZone: (options.liveZoneCards ?? []).reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.liveZone
    ),
  }));

  return {
    game,
    sourceId: source.instanceId,
  };
}

function withBp6008Pending(
  game: GameState,
  sourceCardId: string,
  abilityId:
    | typeof HS_BP6_008_ON_ENTER_WAIT_SELF_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID
    | typeof HS_BP6_008_LIVE_START_LOW_SCORE_LIVE_ACTIVATE_SELF_ABILITY_ID,
  timingId: TriggerCondition
): GameState {
  return {
    ...game,
    pendingAbilities: [
      {
        id: `${abilityId}:${sourceCardId}:pending`,
        abilityId,
        sourceCardId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId,
        eventIds: ['manual-event'],
        sourceSlot: SlotPosition.CENTER,
      },
    ],
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(game: GameState, selectedCardId?: string | null): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function memberOrientation(game: GameState, cardId: string): OrientationState | undefined {
  return game.players[0].memberSlots.cardStates.get(cardId)?.orientation;
}

function hasMemberStateChangedEvent(game: GameState, cardId: string): boolean {
  return game.eventLog.some(
    (entry) =>
      entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
      entry.event.cardInstanceId === cardId
  );
}

function countBp6016AbilityUseActions(game: GameState | null, sourceCardId: string): number {
  return (
    game?.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          HS_BP6_016_ACTIVATED_TURN_ONCE_PAY_FOUR_ENERGY_PLAY_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID &&
        action.payload.sourceCardId === sourceCardId &&
        action.payload.step === 'ABILITY_USE'
    ).length ?? 0
  );
}

function setupBp6016(options: {
  readonly activeEnergyCount: number;
  readonly waitingRoomCards: readonly ReturnType<typeof createCardInstance>[];
  readonly occupiedSlots?: readonly SlotPosition[];
}) {
  const source = createCardInstance(
    createMember({
      cardCode: 'PL!HS-bp6-016-R',
      name: '桂城 泉',
      cost: 9,
    }),
    PLAYER1,
    'bp6-016-source'
  );
  const energyCards = Array.from({ length: options.activeEnergyCount }, (_, index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `bp6-016-energy-${index}`)
  );
  const occupiedMembers = (options.occupiedSlots ?? []).map((slot) =>
    createCardInstance(
      createMember({
        cardCode: `occupied-${slot}`,
        name: `Occupied ${slot}`,
      }),
      PLAYER1,
      `occupied-${slot}`
    )
  );

  const session = createGameSession();
  session.createGame('bp6-016', PLAYER1, 'P1', PLAYER2, 'P2');
  let game = registerCards(baseGame('bp6-016'), [
    source,
    ...energyCards,
    ...options.waitingRoomCards,
    ...occupiedMembers,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    for (const [index, slot] of (options.occupiedSlots ?? []).entries()) {
      memberSlots = placeCardInSlot(memberSlots, slot, occupiedMembers[index]!.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    let energyZone = player.energyZone;
    for (const energy of energyCards) {
      energyZone = addCardToStatefulZone(energyZone, energy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    let waitingRoom = player.waitingRoom;
    for (const card of options.waitingRoomCards) {
      waitingRoom = addCardToZone(waitingRoom, card.instanceId);
    }

    return {
      ...player,
      energyZone,
      waitingRoom,
      memberSlots,
    };
  });
  (session as unknown as { authorityState: GameState }).authorityState = game;

  return {
    session,
    source,
    energyCards,
  };
}

function activateBp6016(session: ReturnType<typeof createGameSession>, sourceId: string) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      sourceId,
      HS_BP6_016_ACTIVATED_TURN_ONCE_PAY_FOUR_ENERGY_PLAY_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID
    )
  );
}

function confirmBp6016Card(session: ReturnType<typeof createGameSession>, selectedCardId: string) {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
}

function confirmBp6016Slot(session: ReturnType<typeof createGameSession>, slot: SlotPosition) {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, undefined, slot)
  );
  expect(result.success, result.error).toBe(true);
}

describe('PL!HS-bp6-008 Izumi workflow', () => {
  it('waits itself on enter, then recovers one legal low-score Hasunosora live card', () => {
    const legalLive = createCardInstance(
      createLive({ cardCode: 'legal-live', score: 4 }),
      PLAYER1,
      'legal-live'
    );
    const highScoreLive = createCardInstance(
      createLive({ cardCode: 'high-score-live', score: 5 }),
      PLAYER1,
      'high-score-live'
    );
    const nonHasunosoraLive = createCardInstance(
      createLive({
        cardCode: 'non-hasunosora-live',
        score: 4,
        groupNames: ['Liella!'],
      }),
      PLAYER1,
      'non-hasunosora-live'
    );
    const memberCard = createCardInstance(
      createMember({ cardCode: 'member-not-live', cost: 1 }),
      PLAYER1,
      'member-not-live'
    );
    const scenario = setupBp6008({
      waitingRoomCards: [legalLive, highScoreLive, nonHasunosoraLive, memberCard],
    });

    const started = resolve(
      withBp6008Pending(
        scenario.game,
        scenario.sourceId,
        HS_BP6_008_ON_ENTER_WAIT_SELF_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
        TriggerCondition.ON_ENTER_STAGE
      )
    );

    expect(memberOrientation(started, scenario.sourceId)).toBe(OrientationState.WAITING);
    expect(hasMemberStateChangedEvent(started, scenario.sourceId)).toBe(true);
    expect(started.activeEffect).toMatchObject({
      abilityId: HS_BP6_008_ON_ENTER_WAIT_SELF_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
      selectableCardIds: [legalLive.instanceId],
    });

    const finished = confirm(started, legalLive.instanceId);
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].hand.cardIds).toContain(legalLive.instanceId);
    expect(finished.players[0].waitingRoom.cardIds).not.toContain(legalLive.instanceId);
    expect(finished.players[0].waitingRoom.cardIds).toEqual([
      highScoreLive.instanceId,
      nonHasunosoraLive.instanceId,
      memberCard.instanceId,
    ]);
  });

  it('still waits itself when no recovery target exists', () => {
    const invalidLive = createCardInstance(
      createLive({ cardCode: 'too-high-live', score: 5 }),
      PLAYER1,
      'too-high-live'
    );
    const scenario = setupBp6008({ waitingRoomCards: [invalidLive] });

    const state = resolve(
      withBp6008Pending(
        scenario.game,
        scenario.sourceId,
        HS_BP6_008_ON_ENTER_WAIT_SELF_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
        TriggerCondition.ON_ENTER_STAGE
      )
    );

    expect(memberOrientation(state, scenario.sourceId)).toBe(OrientationState.WAITING);
    expect(hasMemberStateChangedEvent(state, scenario.sourceId)).toBe(true);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([invalidLive.instanceId]);
    expect(state.actionHistory.at(-1)?.payload.step).toBe(
      'NO_LOW_SCORE_HASUNOSORA_LIVE_TO_RECOVER'
    );
  });

  it('activates itself on LIVE start when own current live zone has a score 2 or lower live card', () => {
    const lowScoreLive = createCardInstance(
      createLive({ cardCode: 'score-two-live', score: 2 }),
      PLAYER1,
      'score-two-live'
    );
    const scenario = setupBp6008({
      sourceOrientation: OrientationState.WAITING,
      liveZoneCards: [lowScoreLive],
    });

    const preview = resolve(
      withBp6008Pending(
        scenario.game,
        scenario.sourceId,
        HS_BP6_008_LIVE_START_LOW_SCORE_LIVE_ACTIVATE_SELF_ABILITY_ID,
        TriggerCondition.ON_LIVE_START
      )
    );

    expect(preview.activeEffect).toMatchObject({
      stepId: 'CONFIRM_ONLY_EFFECT',
    });
    expect(preview.activeEffect?.effectText).toContain('当前LIVE中分数2以下LIVE 1张');
    expect(preview.activeEffect?.effectText).toContain('确认后会变为活跃状态');

    const state = confirm(preview);
    expect(memberOrientation(state, scenario.sourceId)).toBe(OrientationState.ACTIVE);
    expect(hasMemberStateChangedEvent(state, scenario.sourceId)).toBe(true);
  });

  it('no-ops on LIVE start without a score 2 or lower live card and explains realtime conditions', () => {
    const scoreThreeLive = createCardInstance(
      createLive({ cardCode: 'score-three-live', score: 3 }),
      PLAYER1,
      'score-three-live'
    );
    const scenario = setupBp6008({
      sourceOrientation: OrientationState.WAITING,
      liveZoneCards: [scoreThreeLive],
    });

    const preview = resolve(
      withBp6008Pending(
        scenario.game,
        scenario.sourceId,
        HS_BP6_008_LIVE_START_LOW_SCORE_LIVE_ACTIVATE_SELF_ABILITY_ID,
        TriggerCondition.ON_LIVE_START
      )
    );

    expect(preview.activeEffect).toMatchObject({
      stepId: 'CONFIRM_ONLY_EFFECT',
    });
    expect(preview.activeEffect?.effectText).toContain('当前LIVE中分数2以下LIVE 0张');
    expect(preview.activeEffect?.effectText).toContain('来源当前待机状态');
    expect(preview.activeEffect?.effectText).toContain('确认后不会变为活跃状态');

    const state = confirm(preview);
    expect(memberOrientation(state, scenario.sourceId)).toBe(OrientationState.WAITING);
    expect(hasMemberStateChangedEvent(state, scenario.sourceId)).toBe(false);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'LOW_SCORE_LIVE_CONDITION_NOT_MET',
      lowScoreLiveCount: 0,
    });
  });
});

describe('PL!HS-bp6-016 Izumi activated workflow', () => {
  it('pays four energy, plays one legal low-cost Hasunosora member active, and enqueues ON_ENTER_STAGE', () => {
    const legalTarget = createCardInstance(
      createMember({ cardCode: 'PL!HS-bp1-008-R', name: '徒町 小鈴', cost: 4 }),
      PLAYER1,
      'legal-target'
    );
    const highCostTarget = createCardInstance(
      createMember({ cardCode: 'high-cost-target', cost: 5 }),
      PLAYER1,
      'high-cost-target'
    );
    const nonHasunosoraTarget = createCardInstance(
      createMember({
        cardCode: 'non-hasunosora-target',
        cost: 4,
        groupNames: ['Liella!'],
      }),
      PLAYER1,
      'non-hasunosora-target'
    );
    const liveCard = createCardInstance(
      createLive({ cardCode: 'live-not-member', score: 3 }),
      PLAYER1,
      'live-not-member'
    );
    const scenario = setupBp6016({
      activeEnergyCount: 4,
      waitingRoomCards: [legalTarget, highCostTarget, nonHasunosoraTarget, liveCard],
    });

    const activateResult = activateBp6016(scenario.session, scenario.source.instanceId);
    expect(activateResult.success, activateResult.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId:
        HS_BP6_016_ACTIVATED_TURN_ONCE_PAY_FOUR_ENERGY_PLAY_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
      selectableCardIds: [legalTarget.instanceId],
    });
    for (const energy of scenario.energyCards) {
      expect(
        scenario.session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation
      ).toBe(OrientationState.WAITING);
    }

    confirmBp6016Card(scenario.session, legalTarget.instanceId);
    expect(scenario.session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);

    confirmBp6016Slot(scenario.session, SlotPosition.CENTER);

    const player = scenario.session.state!.players[0]!;
    expect(player.waitingRoom.cardIds).not.toContain(legalTarget.instanceId);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(legalTarget.instanceId);
    expect(player.memberSlots.cardStates.get(legalTarget.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      scenario.session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === legalTarget.instanceId &&
          entry.event.fromZone === ZoneType.WAITING_ROOM &&
          entry.event.toSlot === SlotPosition.CENTER
      )
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID &&
          action.payload.sourceCardId === legalTarget.instanceId
      )
    ).toBe(true);

    const secondActivate = activateBp6016(scenario.session, scenario.source.instanceId);
    expect(secondActivate.success).toBe(false);
    expect(countBp6016AbilityUseActions(scenario.session.state, scenario.source.instanceId)).toBe(
      1
    );
  });

  it.each([
    {
      name: 'insufficient active energy',
      activeEnergyCount: 3,
      waitingRoomCards: [
        createCardInstance(
          createMember({ cardCode: 'energy-fail-target', cost: 4 }),
          PLAYER1,
          'energy-fail-target'
        ),
      ],
      occupiedSlots: [],
    },
    {
      name: 'no legal waiting-room target',
      activeEnergyCount: 4,
      waitingRoomCards: [
        createCardInstance(
          createMember({ cardCode: 'cost-fail-target', cost: 5 }),
          PLAYER1,
          'cost-fail-target'
        ),
      ],
      occupiedSlots: [],
    },
    {
      name: 'no empty member area',
      activeEnergyCount: 4,
      waitingRoomCards: [
        createCardInstance(
          createMember({ cardCode: 'slot-fail-target', cost: 4 }),
          PLAYER1,
          'slot-fail-target'
        ),
      ],
      occupiedSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
    },
  ])('does not start, pay, or consume once-per-turn when $name', (config) => {
    const scenario = setupBp6016(config);

    const result = activateBp6016(scenario.session, scenario.source.instanceId);

    expect(result.success).toBe(false);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(countBp6016AbilityUseActions(scenario.session.state, scenario.source.instanceId)).toBe(
      0
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            HS_BP6_016_ACTIVATED_TURN_ONCE_PAY_FOUR_ENERGY_PLAY_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID
      )
    ).toBe(false);
    for (const energy of scenario.energyCards) {
      expect(
        scenario.session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation
      ).toBe(OrientationState.ACTIVE);
    }
  });
});
