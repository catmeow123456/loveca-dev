import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updateLiveResolution,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep as confirmActiveEffectStepImmediate,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';
import { S_BP3_024_LIVE_START_CENTER_HIGH_COST_AQOURS_CHOOSE_BLADE_OR_WAIT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { ABILITY_ORDER_SELECTION_ID } from '../../src/application/card-effect-runner';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const live = (): LiveCardData => ({
  cardCode: 'PL!S-bp3-024-L',
  name: 'Deep Resonance',
  cardType: CardType.LIVE,
  score: 2,
  requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
});
const member = (
  code: string,
  cost: number,
  groups: readonly string[] = ['Aqours']
): MemberCardData => ({
  cardCode: code,
  name: code,
  groupNames: groups,
  cardType: CardType.MEMBER,
  cost,
  blade: 1,
  hearts: [],
});
const pending = (sourceCardId: string): PendingAbilityState => ({
  id: 'pending-024',
  abilityId: S_BP3_024_LIVE_START_CENTER_HIGH_COST_AQOURS_CHOOSE_BLADE_OR_WAIT_ABILITY_ID,
  sourceCardId,
  controllerId: P1,
  mandatory: true,
  timingId: TriggerCondition.ON_LIVE_START,
  eventIds: ['live-start'],
});

function confirmActiveEffectStep(
  ...args: Parameters<typeof confirmActiveEffectStepImmediate>
): GameState {
  return continuePublicEffectChoiceForTest(
    confirmActiveEffectStepImmediate(...args),
    args[1]
  );
}

function setup(
  options: {
    centerCost?: number;
    centerGroups?: readonly string[];
    effectiveDelta?: number;
    opponentCost?: number;
    opponentWaiting?: boolean;
    sourceLive?: boolean;
    centerPresent?: boolean;
    centerCardCode?: string;
    successCount?: number;
    sideCost?: number;
    memberBelow?: boolean;
    opponentEffectiveDelta?: number;
  } = {}
) {
  const source = createCardInstance(live(), P1, 'source-024');
  const center = createCardInstance(
    member(
      options.centerCardCode ?? 'center',
      options.centerCost ?? 9,
      options.centerGroups ?? ['Aqours']
    ),
    P1,
    'center'
  );
  const own = createCardInstance(member('own-left', options.sideCost ?? 3), P1, 'own-left');
  const opponent = createCardInstance(
    member('opponent', options.opponentCost ?? 4, ['A-RISE']),
    P2,
    'opponent'
  );
  const below = createCardInstance(member('below', 3), P1, 'below');
  const successLives = Array.from({ length: options.successCount ?? 0 }, (_, index) =>
    createCardInstance({ ...live(), cardCode: `success-${index}` }, P1, `success-${index}`)
  );
  let game = registerCards(createGameState('024', P1, 'P1', P2, 'P2'), [
    source,
    center,
    own,
    opponent,
    below,
    ...successLives,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone:
      options.sourceLive === false
        ? player.liveZone
        : addCardToStatefulZone(player.liveZone, source.instanceId),
    successZone: successLives.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.successZone
    ),
    memberSlots: {
      ...placeCardInSlot(
        options.centerPresent === false
          ? player.memberSlots
          : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, center.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
        SlotPosition.LEFT,
        own.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      ),
      memberBelow: options.memberBelow
        ? { ...player.memberSlots.memberBelow, [SlotPosition.LEFT]: [below.instanceId] }
        : player.memberSlots.memberBelow,
    },
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, opponent.instanceId, {
      orientation: options.opponentWaiting ? OrientationState.WAITING : OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  if (options.effectiveDelta)
    game = updateLiveResolution(game, (resolution) => ({
      ...resolution,
      liveModifiers: [
        ...resolution.liveModifiers,
        {
          kind: 'MEMBER_COST',
          playerId: P1,
          memberCardId: center.instanceId,
          countDelta: options.effectiveDelta!,
          sourceCardId: center.instanceId,
          abilityId: 'test:effective-cost',
        },
      ],
    }));
  if (options.opponentEffectiveDelta)
    game = updateLiveResolution(game, (resolution) => ({
      ...resolution,
      liveModifiers: [
        ...resolution.liveModifiers,
        {
          kind: 'MEMBER_COST',
          playerId: P2,
          memberCardId: opponent.instanceId,
          countDelta: options.opponentEffectiveDelta!,
          sourceCardId: opponent.instanceId,
          abilityId: 'test:opponent-effective-cost',
        },
      ],
    }));
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    source,
    center,
    own,
    opponent,
    below,
  };
}

describe('PL!S-bp3-024-L Deep Resonance', () => {
  it('uses center Aqours effective cost and shows both positive branches when both targets exist', () => {
    const { game } = setup({ centerCost: 8, effectiveDelta: 1 });
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect?.effectChoice?.options).toEqual([
      {
        id: 'gain-two-blade',
        text: 'LIVE结束时为止，存在于自己的舞台上的1名成员，获得[BLADE][BLADE]。',
        selectable: true,
      },
      {
        id: 'wait-opponent-low-cost-member',
        text: '将存在于对方的舞台的1名费用小于等于4的成员变为待机状态。',
        selectable: true,
      },
    ]);
    expect(started.activeEffect?.canSkipSelection).toBe(false);
  });

  it('uses the real PL!S-bp3-016-N continuous success-LIVE cost rule to reach effective cost 9', () => {
    const { game, center } = setup({
      centerCardCode: 'PL!S-bp3-016-N',
      centerCost: 4,
      successCount: 5,
    });
    const started = resolvePendingCardEffects(game).gameState;
    expect(center.data.cardCode).toBe('PL!S-bp3-016-N');
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(started.activeEffect?.effectChoice?.options).toHaveLength(2);
  });

  it('opens realtime confirm-only for a failed condition and does not do so during ordered resolution', () => {
    const { game } = setup({ centerCost: 8 });
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('当前有效费用8');
    expect(started.activeEffect?.stepText).toContain('实际不会处理任何目标');
    const confirmed = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(confirmed.activeEffect).toBeNull();
  });

  it('grants BLADE +2 to the selected own member without changing orientation or producing a state-change event', () => {
    const { game, own } = setup();
    const branch = resolvePendingCardEffects(game).gameState;
    const target = confirmActiveEffectStep(
      branch,
      P1,
      branch.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'gain-two-blade'
    );
    const resolved = confirmActiveEffectStep(target, P1, target.activeEffect!.id, own.instanceId);
    expect(resolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({ kind: 'BLADE', sourceCardId: own.instanceId, countDelta: 2 })
    );
    expect(resolved.players[0]!.memberSlots.cardStates.get(own.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      resolved.eventLog.filter((entry) => entry.event.type === 'ON_MEMBER_STATE_CHANGED')
    ).toHaveLength(0);
  });

  it('uses opponent printed cost <=4, excludes WAITING targets, and emits exactly one state-change event', () => {
    const { game, opponent } = setup({ opponentCost: 4 });
    const branch = resolvePendingCardEffects(game).gameState;
    const target = confirmActiveEffectStep(
      branch,
      P1,
      branch.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'wait-opponent-low-cost-member'
    );
    const resolved = confirmActiveEffectStep(
      target,
      P1,
      target.activeEffect!.id,
      opponent.instanceId
    );
    expect(resolved.players[1]!.memberSlots.cardStates.get(opponent.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      resolved.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(1);
    const printedFive = resolvePendingCardEffects(setup({ opponentCost: 5 }).game).gameState;
    expect(printedFive.activeEffect?.effectChoice?.options).toEqual([
      expect.objectContaining({ id: 'gain-two-blade', selectable: true }),
      expect.objectContaining({ id: 'wait-opponent-low-cost-member', selectable: false }),
    ]);
    const alreadyWaiting = resolvePendingCardEffects(
      setup({ opponentWaiting: true }).game
    ).gameState;
    expect(alreadyWaiting.activeEffect?.effectChoice?.options).toEqual([
      expect.objectContaining({ id: 'gain-two-blade', selectable: true }),
      expect.objectContaining({ id: 'wait-opponent-low-cost-member', selectable: false }),
    ]);
  });

  it.each([
    { name: 'empty CENTER', options: { centerPresent: false, sideCost: 12 } },
    { name: 'non-Aqours CENTER', options: { centerGroups: ['Liella!'], sideCost: 12 } },
    {
      name: 'low-cost CENTER with a high-cost side member',
      options: { centerCost: 8, sideCost: 12 },
    },
  ])('rejects $name and shows realtime no-op with no branch options', ({ options }) => {
    const started = resolvePendingCardEffects(setup(options).game).gameState;
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.selectableOptions).toBeUndefined();
    expect(started.activeEffect?.stepText).toContain('实际不会处理任何目标');
  });

  it('continues a real ordered multi-pending batch without per-card confirm-only when this condition fails', () => {
    const first = setup({ centerCost: 8 });
    const secondSource = createCardInstance(live(), P1, 'source-024-second');
    let game = registerCards(first.game, [secondSource]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, secondSource.instanceId),
    }));
    game = {
      ...game,
      pendingAbilities: [
        first.game.pendingAbilities[0]!,
        { ...pending(secondSource.instanceId), id: 'pending-024-second' },
      ],
    };
    const order = resolvePendingCardEffects(game).gameState;
    expect(order.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const resolved = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      null,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    const payloads = resolved.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          S_BP3_024_LIVE_START_CENTER_HIGH_COST_AQOURS_CHOOSE_BLADE_OR_WAIT_ABILITY_ID
    );
    expect(payloads).toHaveLength(2);
    expect(payloads.every((action) => action.payload.step === 'DEEP_RESONANCE_NOOP')).toBe(true);
  });

  it('excludes memberBelow and keeps printed cost 5 illegal even when effective cost is reduced', () => {
    const { game, below, opponent } = setup({
      memberBelow: true,
      opponentCost: 5,
      opponentEffectiveDelta: -2,
    });
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect?.effectChoice?.options).toEqual([
      expect.objectContaining({ id: 'gain-two-blade', selectable: true }),
      expect.objectContaining({ id: 'wait-opponent-low-cost-member', selectable: false }),
    ]);
    const bladeTargets = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'gain-two-blade'
    );
    expect(bladeTargets.activeEffect?.selectableCardIds).not.toContain(below.instanceId);
    expect(
      started.activeEffect?.effectChoice?.options.find((option) => option.id.includes('wait'))
        ?.selectable
    ).toBe(false);
    expect(opponent.data.cost).toBe(5);
  });

  it('safely no-ops when source, condition, BLADE target, or WAITING target becomes stale', () => {
    const sourceScenario = setup();
    let branch = resolvePendingCardEffects(sourceScenario.game).gameState;
    branch = updatePlayer(branch, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, sourceScenario.source.instanceId),
    }));
    let resolved = confirmActiveEffectStep(
      branch,
      P1,
      branch.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'gain-two-blade'
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toEqual([]);

    const conditionScenario = setup();
    branch = resolvePendingCardEffects(conditionScenario.game).gameState;
    let target = confirmActiveEffectStep(
      branch,
      P1,
      branch.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'gain-two-blade'
    );
    target = updatePlayer(target, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    resolved = confirmActiveEffectStep(
      target,
      P1,
      target.activeEffect!.id,
      conditionScenario.own.instanceId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toEqual([]);

    const bladeScenario = setup();
    branch = resolvePendingCardEffects(bladeScenario.game).gameState;
    target = confirmActiveEffectStep(
      branch,
      P1,
      branch.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'gain-two-blade'
    );
    target = updatePlayer(target, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    resolved = confirmActiveEffectStep(
      target,
      P1,
      target.activeEffect!.id,
      bladeScenario.own.instanceId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toEqual([]);

    const waitScenario = setup();
    branch = resolvePendingCardEffects(waitScenario.game).gameState;
    target = confirmActiveEffectStep(
      branch,
      P1,
      branch.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'wait-opponent-low-cost-member'
    );
    target = updatePlayer(target, P2, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
    }));
    resolved = confirmActiveEffectStep(
      target,
      P1,
      target.activeEffect!.id,
      waitScenario.opponent.instanceId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(0);
  });
});
