import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP4_005_LIVE_START_POSITION_CHANGE_IF_NO_HIGH_BLADE_MUSE_ABILITY_ID,
  BP4_005_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMuseMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly blade?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createRin(): MemberCardData {
  return createMuseMember('PL!-bp4-005-R＋', {
    name: '星空 凛',
    cost: 13,
    blade: 1,
  });
}

function createSessionFromGame(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('pl-bp4-005-rin-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function resolveTiming(game: GameState, timing: TriggerCondition): GameState {
  return resolvePendingCardEffects(enqueueTriggeredCardEffects(game, [timing])).gameState;
}

function setupOnEnter(options: {
  readonly includeCandidate?: boolean;
  readonly candidateCost?: number;
} = {}) {
  const source = createCardInstance(createRin(), PLAYER1, 'rin-source');
  const candidate = createCardInstance(
    createMuseMember('PL!-low-cost-member', {
      name: 'Low Cost Member',
      cost: options.candidateCost ?? 2,
    }),
    PLAYER1,
    'waiting-candidate'
  );
  let game = createGameState('pl-bp4-005-on-enter', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, candidate]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.includeCandidate === false ? [] : [candidate.instanceId],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  const enterStageEvent = createEnterStageEvent(
    source.instanceId,
    ZoneType.HAND,
    SlotPosition.CENTER,
    PLAYER1,
    PLAYER1
  );
  game = emitGameEvent(game, enterStageEvent);
  const state = resolvePendingCardEffects(
    enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], {
      enterStageEvents: [enterStageEvent],
    })
  ).gameState;
  return { game: state, sourceId: source.instanceId, candidateId: candidate.instanceId };
}

function setupStage(options: {
  readonly sourceSlot?: SlotPosition;
  readonly left?: MemberCardData | null;
  readonly center?: MemberCardData | null;
  readonly right?: MemberCardData | null;
  readonly sourceOnStage?: boolean;
} = {}) {
  const sourceSlot = options.sourceSlot ?? SlotPosition.CENTER;
  const source = createCardInstance(createRin(), PLAYER1, 'rin-source');
  const left =
    sourceSlot === SlotPosition.LEFT
      ? source
      : options.left
        ? createCardInstance(options.left, PLAYER1, 'left-member')
        : null;
  const center =
    sourceSlot === SlotPosition.CENTER
      ? source
      : options.center
        ? createCardInstance(options.center, PLAYER1, 'center-member')
        : null;
  const right =
    sourceSlot === SlotPosition.RIGHT
      ? source
      : options.right
        ? createCardInstance(options.right, PLAYER1, 'right-member')
        : null;
  const cards = [source, left, center, right].filter(
    (card): card is typeof source => card !== null
  );
  let game = createGameState('pl-bp4-005-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, cards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeSlotCards(player.memberSlots, {
            [SlotPosition.LEFT]: left?.instanceId ?? null,
            [SlotPosition.CENTER]: center?.instanceId ?? null,
            [SlotPosition.RIGHT]: right?.instanceId ?? null,
          }),
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.sourceOnStage === false ? [source.instanceId] : [],
    },
  }));
  return {
    game,
    sourceId: source.instanceId,
    leftId: left?.instanceId ?? null,
    centerId: center?.instanceId ?? null,
    rightId: right?.instanceId ?? null,
  };
}

describe('PL!-bp4-005 Rin workflow', () => {
  it('recovers one cost two or less MEMBER from waiting room on enter', () => {
    const { game, candidateId } = setupOnEnter();

    expect(game.activeEffect).toMatchObject({
      abilityId: BP4_005_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
      selectableCardIds: [candidateId],
      canSkipSelection: false,
    });

    const session = createSessionFromGame(game);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, game.activeEffect!.id, candidateId)
      ).success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toContain(candidateId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(candidateId);
  });

  it('consumes on-enter pending no-op when there is no legal waiting-room member', () => {
    const { game, candidateId } = setupOnEnter({ candidateCost: 3 });

    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(game.players[0].waitingRoom.cardIds).toContain(candidateId);
    expect(
      game.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === BP4_005_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID &&
          action.payload.step === 'NO_LOW_COST_MEMBER_IN_WAITING_ROOM'
      )
    ).toBe(true);
  });

  it('opens non-center position change and swaps with the selected slot when no high-BLADE μ’s member exists', () => {
    const { game, sourceId, rightId } = setupStage({
      sourceSlot: SlotPosition.CENTER,
      right: createMuseMember('PL!-right-member', { name: '右メンバー', blade: 1 }),
    });
    const started = resolveTiming(game, TriggerCondition.ON_LIVE_START);

    expect(started.activeEffect).toMatchObject({
      abilityId: BP4_005_LIVE_START_POSITION_CHANGE_IF_NO_HIGH_BLADE_MUSE_ABILITY_ID,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: false,
    });

    const session = createSessionFromGame(started);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          started.activeEffect!.id,
          undefined,
          SlotPosition.RIGHT
        )
      ).success
    ).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(sourceId);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(rightId);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);
  });

  it('consumes live-start pending no-op when an effective BLADE five μ’s member exists', () => {
    const { game, sourceId } = setupStage({
      sourceSlot: SlotPosition.CENTER,
      left: createMuseMember('PL!-high-blade-muse', { blade: 5 }),
    });
    const state = resolveTiming(game, TriggerCondition.ON_LIVE_START);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceId);
  });

  it('does not treat non-μ’s BLADE five members as blockers', () => {
    const { game } = setupStage({
      sourceSlot: SlotPosition.CENTER,
      left: createMuseMember('PL!S-high-blade-aqours', {
        groupNames: ['Aqours'],
        blade: 5,
      }),
    });
    const started = resolveTiming(game, TriggerCondition.ON_LIVE_START);

    expect(started.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
  });

  it.each([
    [SlotPosition.CENTER, [SlotPosition.LEFT, SlotPosition.RIGHT]],
    [SlotPosition.LEFT, [SlotPosition.RIGHT]],
    [SlotPosition.RIGHT, [SlotPosition.LEFT]],
  ] as const)('locks selectable slots for source slot %s', (sourceSlot, selectableSlots) => {
    const { game } = setupStage({ sourceSlot });
    const started = resolveTiming(game, TriggerCondition.ON_LIVE_START);

    expect(started.activeEffect?.selectableSlots).toEqual(selectableSlots);
  });

  it('consumes stale live-start pending no-op when source is not on stage', () => {
    const { game, sourceId } = setupStage({ sourceOnStage: false });
    const state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        {
          id: 'manual-rin-live-start',
          abilityId: BP4_005_LIVE_START_POSITION_CHANGE_IF_NO_HIGH_BLADE_MUSE_ABILITY_ID,
          sourceCardId: sourceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['manual-live-start'],
          sourceSlot: SlotPosition.CENTER,
        },
      ],
    }).gameState;

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP4_005_LIVE_START_POSITION_CHANGE_IF_NO_HIGH_BLADE_MUSE_ABILITY_ID &&
          action.payload.step === 'SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });
});

function placeSlotCards(
  memberSlots: GameState['players'][number]['memberSlots'],
  slots: Record<SlotPosition, string | null>
): GameState['players'][number]['memberSlots'] {
  let next = { ...memberSlots, slots: { ...memberSlots.slots }, cardStates: new Map() };
  for (const slot of [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]) {
    const cardId = slots[slot];
    next = {
      ...next,
      slots: { ...next.slots, [slot]: cardId },
      cardStates:
        cardId === null
          ? next.cardStates
          : new Map([
              ...next.cardStates,
              [cardId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
            ]),
    };
  }
  return next;
}
