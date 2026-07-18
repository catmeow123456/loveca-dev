import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  PL_BP4_011_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE_ABILITY_ID,
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
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

const WORKFLOW_CASES = [
  {
    label: 'PL!-bp4-017-N Hanayo',
    abilityId: BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
    sourceCardCode: 'PL!-bp4-017-N',
    sourceName: '小泉花陽',
    sourceCost: 2,
    bladeAmount: 1,
    successStep: 'WAIT_SELF_CENTER_MUSE_GAIN_BLADE',
  },
  {
    label: 'PL!-bp4-011-N Eli',
    abilityId: PL_BP4_011_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE_ABILITY_ID,
    sourceCardCode: 'PL!-bp4-011-N',
    sourceName: '絢瀬絵里',
    sourceCost: 4,
    bladeAmount: 2,
    successStep: 'WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE',
  },
] as const;

function activateWaitSelfCost(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    undefined,
    'activate'
  );
}

function createMemberData(
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
    cost: options.cost ?? 2,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createMember(
  cardCode: string,
  instanceId: string,
  options: Parameters<typeof createMemberData>[1] = {}
) {
  return createCardInstance(createMemberData(cardCode, options), PLAYER1, instanceId);
}

function createPending(
  abilityId: string,
  sourceCardId: string,
  index = 0,
  sourceSlot = SlotPosition.LEFT
): PendingAbilityState {
  return {
    id: `wait-self-pending-${index}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot,
  };
}

function setupState(options: {
  readonly workflowIndex?: 0 | 1;
  readonly sourceCardCode?: string;
  readonly sourceInStage?: boolean;
  readonly sourceOrientation?: OrientationState;
  readonly sourceAtCenter?: boolean;
  readonly centerKind?: 'muse' | 'non-muse' | 'empty';
  readonly centerFace?: FaceState;
} = {}) {
  const workflow = WORKFLOW_CASES[options.workflowIndex ?? 1];
  const source = createMember(options.sourceCardCode ?? workflow.sourceCardCode, 'wait-self-source', {
    name: workflow.sourceName,
    cost: workflow.sourceCost,
  });
  const center = createMember('PL!-center-muse', 'wait-self-center-muse', {
    name: '高坂穂乃果',
    cost: 7,
  });
  const nonMuseCenter = createMember('PL!S-center-non-muse', 'wait-self-center-non-muse', {
    name: '高海千歌',
    cost: 7,
    groupNames: ['Aqours'],
  });

  let game = createGameState('live-start-wait-self-center-muse-gain-blade', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, center, nonMuseCenter]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceInStage !== false) {
      memberSlots = placeCardInSlot(
        memberSlots,
        options.sourceAtCenter ? SlotPosition.CENTER : SlotPosition.LEFT,
        source.instanceId,
        {
          orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      );
    }
    if (!options.sourceAtCenter && options.centerKind !== 'empty') {
      const centerCard = options.centerKind === 'non-muse' ? nonMuseCenter : center;
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, centerCard.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: options.centerFace ?? FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });

  return { game, source, center, nonMuseCenter, workflow };
}

function startAbility(game: GameState, abilityId: string, sourceCardId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [createPending(abilityId, sourceCardId)],
  }).gameState;
}

function latestPayload(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .at(-1)?.payload;
}

function bladeModifiers(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === abilityId
  );
}

describe('live-start wait-self center Muse gain BLADE shared workflow', () => {
  it.each(WORKFLOW_CASES)(
    '$label uses 发动 / 不发动 without a fixed-card selection and grants the configured BLADE amount',
    (workflow) => {
      const workflowIndex = workflow.bladeAmount === 1 ? 0 : 1;
      const scenario = setupState({ workflowIndex });
      const started = startAbility(scenario.game, workflow.abilityId, scenario.source.instanceId);

      expect(started.activeEffect).toMatchObject({
        abilityId: workflow.abilityId,
        awaitingPlayerId: PLAYER1,
        selectableOptions: [{ id: 'activate', label: '发动' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      expect(started.activeEffect?.selectableCardIds).toBeUndefined();
      expect(started.activeEffect?.stepText?.match(/\[ブレード\]/g)).toHaveLength(
        workflow.bladeAmount
      );

      const state = activateWaitSelfCost(started);
      expect(
        state.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
      ).toBe(OrientationState.WAITING);
      expect(bladeModifiers(state, workflow.abilityId)).toEqual([
        expect.objectContaining({
          sourceCardId: scenario.center.instanceId,
          countDelta: workflow.bladeAmount,
        }),
      ]);
      expect(latestPayload(state, workflow.abilityId)).toMatchObject({
        step: workflow.successStep,
        sourceCardId: scenario.source.instanceId,
        targetMemberCardId: scenario.center.instanceId,
        bladeBonus: workflow.bladeAmount,
      });
    }
  );

  it('preserves the old PL!-bp4-017-N action payload and writes the standard member-state event before trigger enqueue', () => {
    const scenario = setupState({ workflowIndex: 0 });
    const state = activateWaitSelfCost(
      startAbility(scenario.game, scenario.workflow.abilityId, scenario.source.instanceId)
    );
    const stateChangedEvent = state.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        entry.event.cardInstanceId === scenario.source.instanceId
    )?.event;

    expect(stateChangedEvent).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: scenario.source.instanceId,
        abilityId: BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
      },
    });
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID
      )?.payload
    ).toMatchObject({
      waitedMemberCardId: scenario.source.instanceId,
      memberStateChangedEventIds: [stateChangedEvent?.eventId],
    });
  });

  it('enqueues a real ON_MEMBER_STATE_CHANGED ability from the cost event', () => {
    const scenario = setupState({
      sourceCardCode: 'PL!N-bp4-018-N',
      workflowIndex: 1,
    });
    const mainPhaseGame: GameState = {
      ...scenario.game,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.MAIN_FREE,
    };
    const state = activateWaitSelfCost(
      startAbility(
        mainPhaseGame,
        PL_BP4_011_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE_ABILITY_ID,
        scenario.source.instanceId
      )
    );

    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID &&
          action.payload.sourceCardId === scenario.source.instanceId
      )
    ).toBe(true);
    expect(
      state.activeEffect?.abilityId ===
        N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID ||
        state.pendingAbilities.some(
          (ability) =>
            ability.abilityId ===
            N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID
        )
    ).toBe(true);
  });

  it('declines without waiting the source or adding BLADE', () => {
    const scenario = setupState();
    const started = startAbility(scenario.game, scenario.workflow.abilityId, scenario.source.instanceId);
    const state = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);

    expect(
      state.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(bladeModifiers(state, scenario.workflow.abilityId)).toHaveLength(0);
    expect(latestPayload(state, scenario.workflow.abilityId)).toMatchObject({
      step: 'DECLINE_WAIT_SELF_COST',
    });
  });

  it('revalidates the fixed source when the player confirms activation', () => {
    const scenario = setupState();
    let state = startAbility(scenario.game, scenario.workflow.abilityId, scenario.source.instanceId);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(scenario.source.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));

    state = activateWaitSelfCost(state);
    expect(state.activeEffect).toBeNull();
    expect(bladeModifiers(state, scenario.workflow.abilityId)).toHaveLength(0);
    expect(latestPayload(state, scenario.workflow.abilityId)).toMatchObject({
      step: 'NO_OP_SOURCE_NOT_ACTIVE_STAGE_MEMBER_AFTER_SELECTION',
    });
  });

  it.each([
    { name: 'source already WAITING', options: { sourceOrientation: OrientationState.WAITING } },
    { name: 'source not on stage', options: { sourceInStage: false } },
  ])('consumes pending as no-op when $name', ({ options }) => {
    const scenario = setupState(options);
    const state = startAbility(scenario.game, scenario.workflow.abilityId, scenario.source.instanceId);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(latestPayload(state, scenario.workflow.abilityId)).toMatchObject({
      step: 'NO_OP_SOURCE_NOT_ACTIVE_STAGE_MEMBER',
    });
  });

  it.each([
    { name: 'no center member', centerKind: 'empty' as const, centerFace: FaceState.FACE_UP },
    {
      name: 'center member is not μ’s',
      centerKind: 'non-muse' as const,
      centerFace: FaceState.FACE_UP,
    },
    { name: 'center target is no longer face up', centerKind: 'muse' as const, centerFace: FaceState.FACE_DOWN },
  ])('keeps the paid cost but does not add BLADE when $name', ({ centerKind, centerFace }) => {
    const scenario = setupState({ centerKind, centerFace });
    const state = activateWaitSelfCost(
      startAbility(scenario.game, scenario.workflow.abilityId, scenario.source.instanceId)
    );
    expect(
      state.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(bladeModifiers(state, scenario.workflow.abilityId)).toHaveLength(0);
    expect(latestPayload(state, scenario.workflow.abilityId)).toMatchObject({
      step: 'NO_OP_NO_CENTER_MUSE_MEMBER_AFTER_COST',
      targetMemberCardId: null,
      bladeBonus: 0,
    });
  });

  it('allows the paid source itself to remain the center μ’s BLADE target after becoming WAITING', () => {
    const scenario = setupState({ sourceAtCenter: true });
    const state = activateWaitSelfCost(
      startAbility(scenario.game, scenario.workflow.abilityId, scenario.source.instanceId)
    );
    expect(bladeModifiers(state, scenario.workflow.abilityId)).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.source.instanceId,
        countDelta: 2,
      }),
    ]);
    expect(latestPayload(state, scenario.workflow.abilityId)).toMatchObject({
      sourceCardId: scenario.source.instanceId,
      targetMemberCardId: scenario.source.instanceId,
    });
  });

  it('continues two interactive pendings in the selected orderedResolution without skipping either window', () => {
    const first = createMember('PL!-bp4-011-N', 'ordered-eli-1', { name: '絢瀬絵里', cost: 4 });
    const second = createMember('PL!-bp4-011-N', 'ordered-eli-2', { name: '絢瀬絵里', cost: 4 });
    const center = createMember('PL!-center-muse', 'ordered-center', { name: '高坂穂乃果' });
    let game = registerCards(
      createGameState('wait-self-ordered', PLAYER1, 'P1', PLAYER2, 'P2'),
      [first, second, center]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
          SlotPosition.RIGHT,
          second.instanceId
        ),
        SlotPosition.CENTER,
        center.instanceId
      ),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPending(
          PL_BP4_011_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE_ABILITY_ID,
          first.instanceId,
          0,
          SlotPosition.LEFT
        ),
        createPending(
          PL_BP4_011_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE_ABILITY_ID,
          second.instanceId,
          1,
          SlotPosition.RIGHT
        ),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const firstWindow = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(firstWindow.activeEffect?.sourceCardId).toBe(first.instanceId);
    const secondWindow = activateWaitSelfCost(firstWindow);
    expect(secondWindow.activeEffect?.sourceCardId).toBe(second.instanceId);
    const done = activateWaitSelfCost(secondWindow);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(bladeModifiers(done, PL_BP4_011_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE_ABILITY_ID)).toHaveLength(2);
  });
});
