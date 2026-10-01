import { describe, expect, it } from 'vitest';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createEnterStageEvent,
  createLiveStartEvent,
  type MemberStateChangeCause,
} from '../../src/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  getMemberEffectiveBladeCount,
} from '../../src/domain/rules/live-modifiers';
import { addMemberEffectActivationProhibitionUntilTurnEnd } from '../../src/domain/rules/member-effect-activation-prohibitions';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_PB2_021_AUTO_SELF_WAITED_ACTIVATE_GAIN_BLADE_ABILITY_ID as KOTORI,
  PL_PB2_029_ON_ENTER_ONLY_MUSE_WAIT_LOW_ORIGINAL_BLADE_ABILITY_ID as ELI_ENTER,
  PL_PB2_029_LIVE_START_ONLY_MUSE_WAIT_LOW_ORIGINAL_BLADE_ABILITY_ID as ELI_LIVE,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { payImmediateEffectCosts } from '../../src/application/effects/effect-costs';
import { setMemberOrientation } from '../../src/application/effects/member-state';
import { enqueueMemberStateChangedTriggersFromOrientationResult } from '../../src/application/card-effects/runtime/member-state-changed-triggers';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1',
  P2 = 'p2';
const KOTORI_TEXT =
  '【自动】【1回合1次】此成员，因自己的卡片的费用，或因自己的卡片的能力变为待机状态时，将此成员变为活跃状态，LIVE结束时为止，获得[ブレード]。';
const ELI_TEXT =
  "【登场】/【LIVE开始时】自己的舞台上仅存在『μ's』的成员的场合，将存在于对方的舞台的1名原本持有的[ブレード]的数量小于等于2的成员变为待机状态。（待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。）";
function data(code: string, blade: number, groups = ["μ's"]): MemberCardData {
  return {
    cardCode: code,
    cardType: CardType.MEMBER,
    name: code,
    cost: code.includes('021') ? 4 : 9,
    blade,
    hearts: [],
    groupNames: groups,
  };
}
function stage(game: GameState, player: string, id: string, slot: SlotPosition) {
  return updatePlayer(game, player, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, slot, id, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}
function setup(code = 'PL!-pb2-021-N') {
  const source = createCardInstance(data(code, code.includes('021') ? 2 : 3), P1, 'source');
  const other = createCardInstance(data('other', 1), P1, 'other');
  const target = createCardInstance(data('target', 2, ['Aqours']), P2, 'target');
  let game = registerCards(createGameState('pb2-members', P1, 'P1', P2, 'P2'), [
    source,
    other,
    target,
  ]);
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE };
  game = stage(
    stage(stage(game, P1, 'source', SlotPosition.CENTER), P1, 'other', SlotPosition.LEFT),
    P2,
    'target',
    SlotPosition.CENTER
  );
  return { game, source, other, target };
}
function wait(game: GameState, cause: MemberStateChangeCause, card = 'source') {
  const result = setMemberOrientation(game, P1, card, OrientationState.WAITING, cause)!;
  return enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    result,
    enqueueTriggeredCardEffects
  ).gameState;
}
const ownCause: MemberStateChangeCause = {
  kind: 'CARD_EFFECT',
  playerId: P1,
  sourceCardId: 'other',
};
function finish(game: GameState) {
  let state = resolvePendingCardEffects(game).gameState;
  if (state.activeEffect?.stepId === 'CONFIRM_ONLY_EFFECT')
    state = confirmActiveEffectStep(state, P1, state.activeEffect.id);
  return state;
}
function eli(game: GameState, abilityId = ELI_ENTER) {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      {
        id: 'eli-pending',
        abilityId,
        sourceCardId: 'source',
        controllerId: P1,
        mandatory: true,
        timingId:
          abilityId === ELI_ENTER
            ? TriggerCondition.ON_ENTER_STAGE
            : TriggerCondition.ON_LIVE_START,
        sourceSlot: SlotPosition.CENTER,
        eventIds: [],
      },
    ],
  }).gameState;
}
function orientation(game: GameState, player: string, id: string) {
  return game.players.find((p) => p.id === player)!.memberSlots.cardStates.get(id)?.orientation;
}

describe('PL!-pb2-021 南琴梨 and PL!-pb2-029 绚濑绘里', () => {
  it.each(['N', 'P', 'SEC'])('registers complete text and all rarities %s', (rare) => {
    expect(
      getCardAbilityDefinitionsForCardCode(`PL!-pb2-021-${rare}`).find(
        (d) => d.abilityId === KOTORI
      )?.effectText
    ).toBe(KOTORI_TEXT);
    for (const id of [ELI_ENTER, ELI_LIVE])
      expect(
        getCardAbilityDefinitionsForCardCode(`PL!-pb2-029-${rare}`).find((d) => d.abilityId === id)
          ?.effectText
      ).toBe(ELI_TEXT);
  });
  it('queues once, activates self and grants a Blade; second use is unavailable', () => {
    const { game } = setup();
    const queued = wait(game, ownCause);
    expect(queued.pendingAbilities.filter((a) => a.abilityId === KOTORI)).toHaveLength(1);
    const sameEvent = queued.eventLog.at(-1)!.event;
    if (sameEvent.eventType !== TriggerCondition.ON_MEMBER_STATE_CHANGED)
      throw Error('missing event');
    const duplicate = enqueueTriggeredCardEffects(
      queued,
      [TriggerCondition.ON_MEMBER_STATE_CHANGED],
      { memberStateChangedEvents: [sameEvent] }
    );
    expect(duplicate.pendingAbilities.filter((a) => a.abilityId === KOTORI)).toHaveLength(1);
    const resolved = finish(duplicate);
    expect(orientation(resolved, P1, 'source')).toBe(OrientationState.ACTIVE);
    expect(getMemberEffectiveBladeCount(resolved, P1, 'source')).toBe(3);
    expect(
      wait(resolved, ownCause).pendingAbilities.filter((a) => a.abilityId === KOTORI)
    ).toHaveLength(0);
    expect(
      resolved.eventLog.filter(
        (e) => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(2);
  });
  it.each<MemberStateChangeCause>([
    { kind: 'PLAYER_ACTION', playerId: P1 },
    { kind: 'RULE_ACTION', playerId: P1 },
    { kind: 'CARD_EFFECT', playerId: P2, sourceCardId: 'target', selectionPlayerId: P1 },
  ])('ignores non-own-card cause %j', (cause) => {
    expect(wait(setup().game, cause).pendingAbilities).toHaveLength(0);
  });
  it('ignores other members waiting', () => {
    expect(wait(setup().game, ownCause, 'other').pendingAbilities).toHaveLength(0);
  });
  it('recognizes actual source orientation cost without interrupting the paying effect', () => {
    const { game } = setup();
    const paying = {
      ...game,
      activeEffect: {
        id: 'paying',
        abilityId: 'outer',
        sourceCardId: 'source',
        controllerId: P1,
        effectText: '费用',
        stepId: 'PAY',
        awaitingPlayerId: P1,
      },
    };
    const result = payImmediateEffectCosts(paying, P1, 'source', [
      { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
    ])!;
    const queued = enqueueMemberStateChangedTriggersFromOrientationResult(
      paying,
      result,
      enqueueTriggeredCardEffects
    ).gameState;
    expect(queued.pendingAbilities.map((a) => a.abilityId)).toContain(KOTORI);
    expect(resolvePendingCardEffects(queued).gameState.activeEffect?.id).toBe('paying');
    expect(orientation(queued, P1, 'source')).toBe(OrientationState.WAITING);
    expect(orientation(finish({ ...queued, activeEffect: null }), P1, 'source')).toBe(
      OrientationState.ACTIVE
    );
  });
  it('still grants Blade when card-effect activation is prohibited', () => {
    const game = addMemberEffectActivationProhibitionUntilTurnEnd(setup().game, {
      affectedPlayerIds: [P1],
      sourceCardId: 'target',
      abilityId: 'prohibit',
    });
    const resolved = finish(wait(game, ownCause));
    expect(orientation(resolved, P1, 'source')).toBe(OrientationState.WAITING);
    expect(getMemberEffectiveBladeCount(resolved, P1, 'source')).toBe(3);
  });
  it('does not apply an old pending to a reentered source and permits the new lifecycle', () => {
    const queued = wait(setup().game, ownCause);
    const reentered = emitGameEvent(
      stage(queued, P1, 'source', SlotPosition.CENTER),
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    const resolved = finish(reentered);
    expect(getMemberEffectiveBladeCount(resolved, P1, 'source')).toBe(2);
    const second = finish(wait(resolved, ownCause));
    expect(getMemberEffectiveBladeCount(second, P1, 'source')).toBe(3);
  });
  it('ignores an old waiting event first delivered after reentry', () => {
    const original = setup().game;
    const waiting = setMemberOrientation(
      original,
      P1,
      'source',
      OrientationState.WAITING,
      ownCause
    )!.gameState;
    const event = waiting.eventLog.at(-1)!.event;
    if (event.eventType !== TriggerCondition.ON_MEMBER_STATE_CHANGED) throw Error('missing wait');
    const reentered = emitGameEvent(
      stage(waiting, P1, 'source', SlotPosition.CENTER),
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    const delivered = enqueueTriggeredCardEffects(
      reentered,
      [TriggerCondition.ON_MEMBER_STATE_CHANGED],
      { memberStateChangedEvents: [event] }
    );
    expect(delivered.pendingAbilities).toHaveLength(0);
    expect(getMemberEffectiveBladeCount(delivered, P1, 'source')).toBe(2);
  });
  it('explains failed group condition and consumes it on confirmation', () => {
    let game = setup('PL!-pb2-029-N').game;
    const registry = new Map(game.cardRegistry);
    registry.set('other', createCardInstance(data('other', 1, ['Liella!']), P1, 'other'));
    game = { ...game, cardRegistry: registry };
    const queued = {
      ...game,
      pendingAbilities: ['source', 'other'].map((sourceCardId) => ({
        id: `manual-${sourceCardId}`,
        abilityId: ELI_ENTER,
        sourceCardId,
        controllerId: P1,
        mandatory: true,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        eventIds: [],
      })),
    };
    const order = resolvePendingCardEffects(queued).gameState;
    const started = confirmActiveEffectStep(order, P1, order.activeEffect!.id, 'source');
    expect(started.activeEffect?.effectText).toContain('条件未满足');
    const resolved = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(resolved.pendingAbilities.some((a) => a.id === 'manual-source')).toBe(false);
    expect(resolved.eventLog).toHaveLength(0);
  });
  it('consumes a pending safely if the source left the stage', () => {
    const queued = wait(setup().game, ownCause);
    const removed = updatePlayer(queued, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }));
    const resolved = finish(removed);
    expect(resolved.pendingAbilities).toHaveLength(0);
    expect(resolved.liveResolution.liveModifiers).toHaveLength(0);
  });
  it.each([ELI_ENTER, ELI_LIVE])(
    'waits an opponent through %s and dispatches one event',
    (abilityId) => {
      const started = eli(setup('PL!-pb2-029-P').game, abilityId);
      expect(started.activeEffect?.selectableCardIds).toEqual(['target']);
      expect(confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'source')).toBe(
        started
      );
      const resolved = confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'target');
      expect(orientation(resolved, P2, 'target')).toBe(OrientationState.WAITING);
      expect(
        resolved.eventLog.filter(
          (e) => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
        )
      ).toHaveLength(1);
    }
  );
  it.each(['enter', 'live'] as const)(
    'enqueues the correct ability from a real %s event',
    (timing) => {
      const game = setup('PL!-pb2-029-P').game;
      const event =
        timing === 'enter'
          ? createEnterStageEvent('source', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
          : createLiveStartEvent(P1, []);
      const logged = emitGameEvent(game, event);
      const queued =
        event.eventType === TriggerCondition.ON_ENTER_STAGE
          ? enqueueTriggeredCardEffects(logged, [TriggerCondition.ON_ENTER_STAGE], {
              enterStageEvents: [event],
            })
          : enqueueTriggeredCardEffects(logged, [TriggerCondition.ON_LIVE_START], {
              liveStartEvents: [event],
            });
      const expected = timing === 'enter' ? ELI_ENTER : ELI_LIVE;
      expect(queued.pendingAbilities.map((a) => a.abilityId)).toEqual([expected]);
      expect(queued.pendingAbilities[0]?.eventIds).toContain(event.eventId);
      const started = resolvePendingCardEffects(queued).gameState;
      const resolved = confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'target');
      expect(orientation(resolved, P2, 'target')).toBe(OrientationState.WAITING);
      expect(resolved.pendingAbilities).toHaveLength(0);
    }
  );
  it('uses original Blade replacement rather than printed Blade or effective bonuses', () => {
    let game = setup('PL!-pb2-029-N').game;
    game = addLiveModifier(game, {
      kind: 'BLADE',
      target: 'TARGET_MEMBER',
      playerId: P2,
      targetMemberCardId: 'target',
      countDelta: 9,
      sourceCardId: 'source',
    });
    expect(eli(game).activeEffect?.selectableCardIds).toEqual(['target']);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P2,
      memberCardId: 'target',
      count: 3,
    });
    expect(eli(game).activeEffect?.selectableCardIds ?? []).toEqual([]);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P2,
      memberCardId: 'target',
      count: 1,
    });
    expect(eli(game).activeEffect?.selectableCardIds).toEqual(['target']);
  });
  it.each(['group', 'lifecycle', 'protected', 'originalBlade', 'waiting'])(
    'finishes stale selection without waiting a target: %s',
    (kind) => {
      let started = eli(setup('PL!-pb2-029-N').game);
      if (kind === 'group') {
        const registry = new Map(started.cardRegistry);
        registry.set('other', createCardInstance(data('other', 1, ['Liella!']), P1, 'other'));
        started = { ...started, cardRegistry: registry };
      }
      if (kind === 'lifecycle')
        started = emitGameEvent(
          started,
          createEnterStageEvent('target', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P2, P2)
        );
      if (kind === 'protected')
        started = addMemberWaitProtectionUntilLiveEnd(started, {
          affectedPlayerId: P2,
          sourceCardId: 'target',
          abilityId: 'protect',
        });
      if (kind === 'originalBlade')
        started = addLiveModifier(started, {
          kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
          playerId: P2,
          memberCardId: 'target',
          count: 3,
        });
      if (kind === 'waiting')
        started = setMemberOrientation(started, P2, 'target', OrientationState.WAITING, {
          kind: 'RULE_ACTION',
          playerId: P2,
        })!.gameState;
      const countBefore = started.eventLog.length;
      const resolved = confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'target');
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toHaveLength(0);
      expect(resolved.eventLog).toHaveLength(countBefore);
    }
  );
});
