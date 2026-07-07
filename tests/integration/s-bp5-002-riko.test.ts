import { describe, expect, it } from 'vitest';
import type { AnyCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_S_BP5_002_LIVE_START_CENTER_EQUAL_SIDE_COSTS_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly blade?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 11,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    bladeHearts: [],
  };
}

function instance<TData extends AnyCardData>(
  data: TData,
  id: string,
  ownerId = PLAYER1
): CardInstance<TData> {
  return createCardInstance(data, ownerId, id);
}

function pending(sourceCardId: string, id = 's-bp5-002-pending'): PendingAbilityState {
  return {
    id,
    abilityId:
      PL_S_BP5_002_LIVE_START_CENTER_EQUAL_SIDE_COSTS_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event:${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: {
  readonly sourceSlot?: SlotPosition;
  readonly leftMember?: CardInstance<MemberCardData> | null;
  readonly rightMember?: CardInstance<MemberCardData> | null;
  readonly opponentMembers?: readonly {
    readonly card: CardInstance<MemberCardData>;
    readonly slot: SlotPosition;
    readonly orientation?: OrientationState;
  }[];
  readonly extraPending?: readonly PendingAbilityState[];
} = {}) {
  const source = instance(
    member('PL!S-bp5-002-R＋', { name: '桜内梨子', cost: 11, blade: 1 }),
    'riko-source'
  );
  const left =
    options.leftMember === undefined
      ? instance(member('PL!S-test-left', { cost: 9 }), 'left-member')
      : options.leftMember;
  const right =
    options.rightMember === undefined
      ? instance(member('PL!S-test-right', { cost: 9 }), 'right-member')
      : options.rightMember;
  const opponentMembers =
    options.opponentMembers ??
    [
      {
        card: instance(member('PL!S-test-opponent-low-blade', { blade: 3 }), 'opponent-low', PLAYER2),
        slot: SlotPosition.CENTER,
      },
      {
        card: instance(member('PL!S-test-opponent-high-blade', { blade: 4 }), 'opponent-high', PLAYER2),
        slot: SlotPosition.LEFT,
      },
      {
        card: instance(member('PL!S-test-opponent-waiting-low-blade', { blade: 2 }), 'opponent-waiting', PLAYER2),
        slot: SlotPosition.RIGHT,
        orientation: OrientationState.WAITING,
      },
    ];
  const cards = [
    source,
    ...(left ? [left] : []),
    ...(right ? [right] : []),
    ...opponentMembers.map((entry) => entry.card),
  ];
  let game = registerCards(createGameState('s-bp5-002-riko', PLAYER1, 'P1', PLAYER2, 'P2'), cards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      options.sourceSlot ?? SlotPosition.CENTER,
      source.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    if (left && (options.sourceSlot ?? SlotPosition.CENTER) !== SlotPosition.LEFT) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, left.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (right && (options.sourceSlot ?? SlotPosition.CENTER) !== SlotPosition.RIGHT) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, right.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of opponentMembers) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: entry.orientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
  return {
    game: {
      ...game,
      pendingAbilities: [pending(source.instanceId), ...(options.extraPending ?? [])],
    },
    source,
    left,
    right,
    opponentMembers,
  };
}

function resolveSingle(game: GameState): GameState {
  const confirmation = resolvePendingCardEffects(game).gameState;
  expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(
    confirmation,
    PLAYER1,
    confirmation.activeEffect!.id
  );
}

function latestPayload(game: GameState): Record<string, unknown> | undefined {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          PL_S_BP5_002_LIVE_START_CENTER_EQUAL_SIDE_COSTS_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!S-bp5-002 桜内梨子', () => {
  it('waits all opponent members with original BLADE <=3 when source is CENTER and side effective costs match', () => {
    const { game, opponentMembers } = setup();
    const resolved = resolveSingle(game);
    const opponent = resolved.players.find((player) => player.id === PLAYER2)!;

    expect(opponent.memberSlots.cardStates.get(opponentMembers[0]!.card.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(opponent.memberSlots.cardStates.get(opponentMembers[1]!.card.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(opponent.memberSlots.cardStates.get(opponentMembers[2]!.card.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestPayload(resolved)).toMatchObject({
      step: 'WAIT_OPPONENT_LOW_ORIGINAL_BLADE_MEMBERS',
      leftCost: 9,
      rightCost: 9,
      sideCostsEqual: true,
      opponentTargetCardIds: [opponentMembers[0]!.card.instanceId, opponentMembers[2]!.card.instanceId],
      actualWaitingTargetCardIds: [opponentMembers[0]!.card.instanceId],
    });
  });

  it('uses effective side costs and ignores effective BLADE reductions on opponent members', () => {
    const left = instance(member('PL!S-test-left-printed-nine', { cost: 9 }), 'left-effective');
    const right = instance(member('PL!S-test-right-printed-seven', { cost: 7 }), 'right-effective');
    const highBlade = instance(
      member('PL!S-test-high-printed-blade', { blade: 4 }),
      'high-blade-effective',
      PLAYER2
    );
    let { game } = setup({
      leftMember: left,
      rightMember: right,
      opponentMembers: [{ card: highBlade, slot: SlotPosition.CENTER }],
    });
    game = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: right.instanceId,
      countDelta: 2,
      sourceCardId: right.instanceId,
      abilityId: 'test:right-cost-plus-two',
    });
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: PLAYER2,
      memberCardId: highBlade.instanceId,
      count: 1,
      sourceCardId: highBlade.instanceId,
      abilityId: 'test:effective-blade-low',
    });

    const resolved = resolveSingle(game);
    const opponent = resolved.players.find((player) => player.id === PLAYER2)!;

    expect(opponent.memberSlots.cardStates.get(highBlade.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(latestPayload(resolved)).toMatchObject({
      leftCost: 9,
      rightCost: 9,
      opponentTargetCardIds: [],
      actualWaitingTargetCardIds: [],
    });
  });

  it('consumes as no-op when side costs differ or a side member is missing', () => {
    const different = resolveSingle(
      setup({
        rightMember: instance(member('PL!S-test-right-different', { cost: 10 }), 'right-different'),
      }).game
    );
    expect(latestPayload(different)).toMatchObject({
      step: 'SIDE_COSTS_NOT_EQUAL',
      leftCost: 9,
      rightCost: 10,
      sideCostsEqual: false,
    });

    const missing = resolveSingle(setup({ rightMember: null }).game);
    expect(latestPayload(missing)).toMatchObject({
      step: 'MISSING_SIDE_MEMBER',
      rightCost: null,
    });
  });

  it('consumes as no-op when source is not CENTER or leaves CENTER before confirmation', () => {
    const notCenter = resolveSingle(setup({ sourceSlot: SlotPosition.LEFT }).game);
    expect(latestPayload(notCenter)).toMatchObject({
      step: 'SOURCE_NOT_CENTER',
      sourceSlot: SlotPosition.LEFT,
    });

    const started = resolvePendingCardEffects(setup().game).gameState;
    const movedBeforeConfirm = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        SlotPosition.LEFT,
        started.activeEffect!.sourceCardId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    const confirmed = confirmActiveEffectStep(
      movedBeforeConfirm,
      PLAYER1,
      movedBeforeConfirm.activeEffect!.id
    );
    expect(latestPayload(confirmed)).toMatchObject({
      step: 'SOURCE_NOT_CENTER',
      sourceSlot: SlotPosition.LEFT,
    });
  });

  it('does not emit fake member-state-changed events for targets that were already WAITING', () => {
    const waitingOnly = instance(
      member('PL!S-test-already-waiting-low-blade', { blade: 1 }),
      'already-waiting-only',
      PLAYER2
    );
    const resolved = resolveSingle(
      setup({
        opponentMembers: [
          {
            card: waitingOnly,
            slot: SlotPosition.CENTER,
            orientation: OrientationState.WAITING,
          },
        ],
      }).game
    );

    expect(
      resolved.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(0);
    expect(latestPayload(resolved)).toMatchObject({
      opponentTargetCardIds: [waitingOnly.instanceId],
      actualWaitingTargetCardIds: [],
      memberStateChangedEventIds: [],
    });
  });

  it('continues pending abilities correctly during ordered resolution', () => {
    const { game, source } = setup({
      extraPending: [pending('riko-source', 's-bp5-002-pending-2')],
    });
    expect(source.instanceId).toBe('riko-source');

    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_S_BP5_002_LIVE_START_CENTER_EQUAL_SIDE_COSTS_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID
      )
    ).toHaveLength(2);
  });

  it('confirm-only text includes current side costs, target count, and actual waiting count', () => {
    const started = resolvePendingCardEffects(setup().game).gameState;

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('左侧费用 9，右侧费用 9');
    expect(started.activeEffect?.effectText).toContain('费用相同');
    expect(started.activeEffect?.effectText).toContain('合法目标 2名');
    expect(started.activeEffect?.effectText).toContain('实际会变为WAITING 1名');
  });
});
