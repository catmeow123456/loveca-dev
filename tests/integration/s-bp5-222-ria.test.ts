import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createMemberSlotMovedEvent } from '../../src/domain/events/game-events';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP5_222_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID,
  S_BP5_222_AUTO_ON_THIS_MEMBER_MOVED_ACTIVATE_TWO_ENERGY_ABILITY_ID,
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

type SlotOccupant = 'aqours' | 'saintsnow' | 'other' | 'empty';

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 4,
    hearts: [createHeartIcon(HeartColor.PURPLE, 2)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createSlotOccupant(kind: SlotOccupant, slot: SlotPosition) {
  if (kind === 'empty') {
    return null;
  }
  if (kind === 'saintsnow') {
    return createCardInstance(
      createMember(`TEST-SAINTSNOW-${slot}`, {
        name: `SaintSnow ${slot}`,
        groupNames: ['ラブライブ！サンシャイン!!'],
        unitName: 'SaintSnow',
      }),
      PLAYER1,
      `p1-saintsnow-${slot}`
    );
  }
  if (kind === 'other') {
    return createCardInstance(
      createMember(`PL!SP-test-other-${slot}`, {
        name: `Other ${slot}`,
        groupNames: ['Liella!'],
        unitName: 'Liella!',
      }),
      PLAYER1,
      `p1-other-${slot}`
    );
  }
  return createCardInstance(
    createMember(`PL!S-test-aqours-${slot}`, {
      name: `Aqours ${slot}`,
      groupNames: ['Aqours'],
    }),
    PLAYER1,
    `p1-aqours-${slot}`
  );
}

interface RiaScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly leftId: string | null;
  readonly rightId: string | null;
  readonly otherOwnId: string;
  readonly energyIds: readonly string[];
}

function setupScenario(
  options: {
    readonly energyCount?: number;
    readonly activeEnergyCount?: number;
    readonly left?: SlotOccupant;
    readonly right?: SlotOccupant;
    readonly currentPhase?: GamePhase;
    readonly activePlayerIndex?: number;
  } = {}
): RiaScenario {
  const session = createGameSession();
  session.createGame('s-bp5-222-ria', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(
    createMember('PL!S-bp5-222-R', {
      name: '鹿角理亞',
      groupNames: ['ラブライブ！サンシャイン!!'],
      unitName: 'SaintSnow',
    }),
    PLAYER1,
    'ria-source'
  );
  const left = createSlotOccupant(options.left ?? 'aqours', SlotPosition.LEFT);
  const right = createSlotOccupant(options.right ?? 'empty', SlotPosition.RIGHT);
  const otherOwn = createCardInstance(
    createMember('PL!S-test-other-own', { name: 'Other own member', groupNames: ['Aqours'] }),
    PLAYER1,
    'other-own-member'
  );
  const energyCards = Array.from({ length: options.energyCount ?? 3 }, (_, index) =>
    createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );

  let game = registerCards(session.state!, [
    source,
    ...(left ? [left] : []),
    ...(right ? [right] : []),
    otherOwn,
    ...energyCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: { ...player.liveZone, cardIds: [] },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < (options.activeEnergyCount ?? 1)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.LEFT]: left?.instanceId ?? null,
        [SlotPosition.CENTER]: source.instanceId,
        [SlotPosition.RIGHT]: right?.instanceId ?? null,
      },
      cardStates: new Map(
        [source, left, right, otherOwn]
          .filter((card): card is NonNullable<typeof card> => card !== null)
          .map((card) => [
            card.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
      ),
    },
  }));
  game = {
    ...game,
    currentPhase: options.currentPhase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;

  return {
    session,
    sourceId: source.instanceId,
    leftId: left?.instanceId ?? null,
    rightId: right?.instanceId ?? null,
    otherOwnId: otherOwn.instanceId,
    energyIds: energyCards.map((card) => card.instanceId),
  };
}

function activate(scenario: RiaScenario, expectedSuccess = true): void {
  const result = scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      S_BP5_222_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID
    )
  );
  expect(result.success).toBe(expectedSuccess);
}

function confirmSlot(session: ReturnType<typeof createGameSession>, slot: SlotPosition): void {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, undefined, slot)
  );
  expect(result.success).toBe(true);
}

function withMovedSlot(
  game: GameState,
  playerId: string,
  cardId: string,
  fromSlot: SlotPosition,
  toSlot: SlotPosition
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [fromSlot]: null,
        [toSlot]: cardId,
      },
    },
  }));
}

function enqueueMove(
  game: GameState,
  playerId: string,
  cardId: string,
  fromSlot: SlotPosition,
  toSlot: SlotPosition
): GameState {
  const event = createMemberSlotMovedEvent(cardId, playerId, fromSlot, toSlot);
  return enqueueTriggeredCardEffects(
    emitGameEvent(withMovedSlot(game, playerId, cardId, fromSlot, toSlot), event),
    [TriggerCondition.ON_MEMBER_SLOT_MOVED]
  );
}

function resolvedAutoActions(game: GameState) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === S_BP5_222_AUTO_ON_THIS_MEMBER_MOVED_ACTIVATE_TWO_ENERGY_ABILITY_ID &&
      action.payload.step !== 'ABILITY_USE'
  );
}

function activatedAbilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        S_BP5_222_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!S-bp5-222 Ria activated and moved-auto workflows', () => {
  it('pays [E], moves to another Aqours/SaintSnow area, and enqueues the move event', () => {
    const scenario = setupScenario({ left: 'aqours', right: 'saintsnow', energyCount: 3 });

    activate(scenario);

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId:
        S_BP5_222_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: false,
    });
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyIds[0]!)
        ?.orientation
    ).toBe(OrientationState.WAITING);

    confirmSlot(scenario.session, SlotPosition.LEFT);

    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.sourceId
    );
    expect(
      scenario.session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          'cardInstanceId' in entry.event &&
          entry.event.cardInstanceId === scenario.sourceId
      )
    ).toBe(true);
    expect(resolvedAutoActions(scenario.session.state!).at(-1)?.payload).toMatchObject({
      step: 'ACTIVATE_TWO_ENERGY_AFTER_THIS_MEMBER_MOVED',
      activatedEnergyCardIds: [scenario.energyIds[0], scenario.energyIds[1]],
    });
  });

  it('does not activate, pay, or record per-turn use without active energy, legal target, or own main phase', () => {
    const noEnergy = setupScenario({ energyCount: 1, activeEnergyCount: 0, left: 'aqours' });
    activate(noEnergy, false);
    expect(noEnergy.session.state?.activeEffect).toBeNull();
    expect(noEnergy.session.state?.players[0].energyZone.cardStates.get(noEnergy.energyIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(activatedAbilityUseCount(noEnergy.session.state!)).toBe(0);

    const noTarget = setupScenario({ energyCount: 1, left: 'other', right: 'empty' });
    activate(noTarget, false);
    expect(noTarget.session.state?.activeEffect).toBeNull();
    expect(noTarget.session.state?.players[0].energyZone.cardStates.get(noTarget.energyIds[0]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(activatedAbilityUseCount(noTarget.session.state!)).toBe(0);

    const notOwnMainPhase = setupScenario({
      energyCount: 1,
      left: 'aqours',
      currentPhase: GamePhase.LIVE_PHASE,
      activePlayerIndex: 1,
    });
    activate(notOwnMainPhase, false);
    expect(notOwnMainPhase.session.state?.activeEffect).toBeNull();
    expect(notOwnMainPhase.session.state?.players[0].energyZone.cardStates.get(notOwnMainPhase.energyIds[0]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(activatedAbilityUseCount(notOwnMainPhase.session.state!)).toBe(0);
  });

  it('activates up to two WAITING energy after this member moves, including one or zero waiting energy', () => {
    const twoWaiting = setupScenario({ energyCount: 2, activeEnergyCount: 0 });
    const twoResolved = resolvePendingCardEffects(
      enqueueMove(twoWaiting.session.state!, PLAYER1, twoWaiting.sourceId, SlotPosition.CENTER, SlotPosition.RIGHT)
    ).gameState;
    expect(resolvedAutoActions(twoResolved).at(-1)?.payload).toMatchObject({
      step: 'ACTIVATE_TWO_ENERGY_AFTER_THIS_MEMBER_MOVED',
      activatedEnergyCardIds: [twoWaiting.energyIds[0], twoWaiting.energyIds[1]],
    });

    const oneWaiting = setupScenario({ energyCount: 1, activeEnergyCount: 0 });
    const oneResolved = resolvePendingCardEffects(
      enqueueMove(oneWaiting.session.state!, PLAYER1, oneWaiting.sourceId, SlotPosition.CENTER, SlotPosition.RIGHT)
    ).gameState;
    expect(resolvedAutoActions(oneResolved).at(-1)?.payload).toMatchObject({
      step: 'ACTIVATE_TWO_ENERGY_AFTER_THIS_MEMBER_MOVED',
      activatedEnergyCardIds: [oneWaiting.energyIds[0]],
    });

    const zeroWaiting = setupScenario({ energyCount: 1, activeEnergyCount: 1 });
    const zeroResolved = resolvePendingCardEffects(
      enqueueMove(zeroWaiting.session.state!, PLAYER1, zeroWaiting.sourceId, SlotPosition.CENTER, SlotPosition.RIGHT)
    ).gameState;
    expect(resolvedAutoActions(zeroResolved).at(-1)?.payload).toMatchObject({
      step: 'ACTIVATE_TWO_ENERGY_AFTER_THIS_MEMBER_MOVED',
      activatedEnergyCardIds: [],
    });
  });

  it('does not trigger the reward for another member moving', () => {
    const scenario = setupScenario({ left: 'aqours', right: 'empty' });

    const moved = enqueueMove(
      scenario.session.state!,
      PLAYER1,
      scenario.leftId!,
      SlotPosition.LEFT,
      SlotPosition.RIGHT
    );

    expect(moved.pendingAbilities).toEqual([]);
    expect(resolvedAutoActions(moved)).toEqual([]);
  });

  it('does not resolve the reward again after this source already used the AUTO this turn', () => {
    const scenario = setupScenario({ energyCount: 4, activeEnergyCount: 0 });
    const firstResolved = resolvePendingCardEffects(
      enqueueMove(scenario.session.state!, PLAYER1, scenario.sourceId, SlotPosition.CENTER, SlotPosition.RIGHT)
    ).gameState;

    expect(resolvedAutoActions(firstResolved).at(-1)?.payload).toMatchObject({
      step: 'ACTIVATE_TWO_ENERGY_AFTER_THIS_MEMBER_MOVED',
      activatedEnergyCardIds: [scenario.energyIds[0], scenario.energyIds[1]],
    });

    const secondQueued = enqueueMove(
      firstResolved,
      PLAYER1,
      scenario.sourceId,
      SlotPosition.RIGHT,
      SlotPosition.CENTER
    );

    expect(secondQueued.pendingAbilities).toEqual([]);
    expect(resolvedAutoActions(secondQueued)).toHaveLength(1);
    expect(secondQueued.players[0].energyZone.cardStates.get(scenario.energyIds[2]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(secondQueued.players[0].energyZone.cardStates.get(scenario.energyIds[3]!)?.orientation).toBe(
      OrientationState.WAITING
    );
  });
});
