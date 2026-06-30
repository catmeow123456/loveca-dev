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
  S_BP5_111_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID,
  S_BP5_111_AUTO_ON_THIS_MEMBER_MOVED_WAIT_OPPONENT_LOW_PRINTED_BLADE_ABILITY_ID,
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
    readonly blade?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: 4,
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

interface SeiraScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly leftId: string | null;
  readonly rightId: string | null;
  readonly energyIds: readonly string[];
  readonly lowOpponentId: string;
  readonly highOpponentId: string;
  readonly otherOwnId: string;
}

function setupScenario(
  options: {
    readonly energyCount?: number;
    readonly activeEnergyCount?: number;
    readonly left?: SlotOccupant;
    readonly right?: SlotOccupant;
    readonly lowOpponentOrientation?: OrientationState;
    readonly includeLowOpponent?: boolean;
    readonly includePrintedBladeModifier?: boolean;
  } = {}
): SeiraScenario {
  const session = createGameSession();
  session.createGame('s-bp5-111-seira', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(
    createMember('PL!S-bp5-111-R', {
      name: '鹿角聖良',
      groupNames: ['ラブライブ！サンシャイン!!'],
      unitName: 'SaintSnow',
      blade: 2,
    }),
    PLAYER1,
    'seira-source'
  );
  const left = createSlotOccupant(options.left ?? 'aqours', SlotPosition.LEFT);
  const right = createSlotOccupant(options.right ?? 'empty', SlotPosition.RIGHT);
  const otherOwn = createCardInstance(
    createMember('PL!S-test-other-own', { name: 'Other own member', groupNames: ['Aqours'] }),
    PLAYER1,
    'other-own-member'
  );
  const lowOpponent = createCardInstance(
    createMember('PL!S-test-opponent-low', {
      name: 'Opponent low blade',
      groupNames: ['Aqours'],
      blade: 2,
    }),
    PLAYER2,
    'opponent-low-blade'
  );
  const highOpponent = createCardInstance(
    createMember('PL!S-test-opponent-high', {
      name: 'Opponent high blade',
      groupNames: ['Aqours'],
      blade: 3,
    }),
    PLAYER2,
    'opponent-high-blade'
  );
  const energyCards = Array.from({ length: options.energyCount ?? 1 }, (_, index) =>
    createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );

  let game = registerCards(session.state!, [
    source,
    ...(left ? [left] : []),
    ...(right ? [right] : []),
    otherOwn,
    lowOpponent,
    highOpponent,
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
              index < (options.activeEnergyCount ?? energyCards.length)
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
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.LEFT]: options.includeLowOpponent === false ? null : lowOpponent.instanceId,
        [SlotPosition.RIGHT]: highOpponent.instanceId,
      },
      cardStates: new Map([
        ...(options.includeLowOpponent === false
          ? []
          : [
              [
                lowOpponent.instanceId,
                {
                  orientation: options.lowOpponentOrientation ?? OrientationState.ACTIVE,
                  face: FaceState.FACE_UP,
                },
              ] as const,
            ]),
        [highOpponent.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveModifiers: options.includePrintedBladeModifier
        ? [
            ...game.liveResolution.liveModifiers,
            {
              kind: 'BLADE',
              playerId: PLAYER2,
              countDelta: -2,
              sourceCardId: highOpponent.instanceId,
              abilityId: 'test:printed-blade-check',
            },
          ]
        : game.liveResolution.liveModifiers,
    },
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;

  return {
    session,
    sourceId: source.instanceId,
    leftId: left?.instanceId ?? null,
    rightId: right?.instanceId ?? null,
    energyIds: energyCards.map((card) => card.instanceId),
    lowOpponentId: lowOpponent.instanceId,
    highOpponentId: highOpponent.instanceId,
    otherOwnId: otherOwn.instanceId,
  };
}

function activate(scenario: SeiraScenario, expectedSuccess = true): void {
  const result = scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      S_BP5_111_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID
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

function confirmCard(session: ReturnType<typeof createGameSession>, cardId: string): void {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, cardId)
  );
  expect(result.success).toBe(true);
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        S_BP5_111_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
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
  cardId: string,
  fromSlot: SlotPosition,
  toSlot: SlotPosition
): GameState {
  const event = createMemberSlotMovedEvent(cardId, PLAYER1, fromSlot, toSlot);
  return enqueueTriggeredCardEffects(
    emitGameEvent(withMovedSlot(game, PLAYER1, cardId, fromSlot, toSlot), event),
    [TriggerCondition.ON_MEMBER_SLOT_MOVED]
  );
}

describe('PL!S-bp5-111 Seira activated and moved-auto workflows', () => {
  it('pays one energy and only offers other slots with Aqours or SaintSnow members', () => {
    const scenario = setupScenario({ left: 'aqours', right: 'saintsnow', energyCount: 1 });

    activate(scenario);

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId:
        S_BP5_111_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: false,
    });
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyIds[0]!)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);
  });

  it('position changes by activation and then resolves this card moved AUTO', () => {
    const scenario = setupScenario({ left: 'aqours', right: 'other', energyCount: 1 });

    activate(scenario);
    expect(scenario.session.state?.activeEffect?.selectableSlots).toEqual([SlotPosition.LEFT]);

    confirmSlot(scenario.session, SlotPosition.LEFT);

    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.sourceId
    );
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      scenario.leftId
    );
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: S_BP5_111_AUTO_ON_THIS_MEMBER_MOVED_WAIT_OPPONENT_LOW_PRINTED_BLADE_ABILITY_ID,
      selectableCardIds: [scenario.lowOpponentId],
    });

    confirmCard(scenario.session, scenario.lowOpponentId);

    expect(
      scenario.session.state?.players[1].memberSlots.cardStates.get(scenario.lowOpponentId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('does not activate, pay, or record per-turn use without active energy or legal target slots', () => {
    const noEnergy = setupScenario({ energyCount: 1, activeEnergyCount: 0, left: 'aqours' });
    activate(noEnergy, false);
    expect(noEnergy.session.state?.activeEffect).toBeNull();
    expect(noEnergy.session.state?.players[0].energyZone.cardStates.get(noEnergy.energyIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(abilityUseCount(noEnergy.session.state!)).toBe(0);

    const noTarget = setupScenario({ energyCount: 1, left: 'other', right: 'empty' });
    activate(noTarget, false);
    expect(noTarget.session.state?.activeEffect).toBeNull();
    expect(noTarget.session.state?.players[0].energyZone.cardStates.get(noTarget.energyIds[0]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(abilityUseCount(noTarget.session.state!)).toBe(0);
  });

  it('AUTO triggers only when this member itself moves', () => {
    const scenario = setupScenario();

    const otherMoved = enqueueMove(
      scenario.session.state!,
      scenario.leftId!,
      SlotPosition.LEFT,
      SlotPosition.RIGHT
    );
    expect(otherMoved.pendingAbilities).toEqual([]);

    const seiraMoved = enqueueMove(
      scenario.session.state!,
      scenario.sourceId,
      SlotPosition.CENTER,
      SlotPosition.RIGHT
    );
    expect(seiraMoved.pendingAbilities.map((ability) => ability.abilityId)).toEqual([
      S_BP5_111_AUTO_ON_THIS_MEMBER_MOVED_WAIT_OPPONENT_LOW_PRINTED_BLADE_ABILITY_ID,
    ]);
  });

  it('AUTO only selects non-WAITING opponent members with printed BLADE <= 2', () => {
    const scenario = setupScenario({ lowOpponentOrientation: OrientationState.ACTIVE });
    const started = resolvePendingCardEffects(
      enqueueMove(scenario.session.state!, scenario.sourceId, SlotPosition.CENTER, SlotPosition.RIGHT)
    ).gameState;

    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.lowOpponentId]);
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.highOpponentId);
  });

  it('AUTO safely consumes pending when no legal opponent target exists', () => {
    const scenario = setupScenario({
      includeLowOpponent: false,
    });
    const state = resolvePendingCardEffects(
      enqueueMove(scenario.session.state!, scenario.sourceId, SlotPosition.CENTER, SlotPosition.RIGHT)
    ).gameState;

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            S_BP5_111_AUTO_ON_THIS_MEMBER_MOVED_WAIT_OPPONENT_LOW_PRINTED_BLADE_ABILITY_ID &&
          action.payload.step === 'NO_OPPONENT_LOW_PRINTED_BLADE_TARGET'
      )
    ).toBe(true);
  });

  it('uses printed BLADE, ignoring live modifiers that would lower effective BLADE', () => {
    const scenario = setupScenario({
      includeLowOpponent: false,
      includePrintedBladeModifier: true,
    });
    const state = resolvePendingCardEffects(
      enqueueMove(scenario.session.state!, scenario.sourceId, SlotPosition.CENTER, SlotPosition.RIGHT)
    ).gameState;

    expect(state.activeEffect).toBeNull();
    expect(state.players[1].memberSlots.cardStates.get(scenario.highOpponentId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            S_BP5_111_AUTO_ON_THIS_MEMBER_MOVED_WAIT_OPPONENT_LOW_PRINTED_BLADE_ABILITY_ID &&
          action.payload.step === 'NO_OPPONENT_LOW_PRINTED_BLADE_TARGET'
      )
    ).toBe(true);
  });
});
