import { describe, expect, it } from 'vitest';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  activateCardAbility,
  enqueueTriggeredCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_BP8_008_ACTIVATED_DISCARD_REPLAY_OTHER_EDELNOTE_MEMBER_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { updatePlayer, registerCards } from '../../src/domain/entities/game';
import { addMemberBelowMember, removeCardFromSlot } from '../../src/domain/entities/zone';
import { setMemberOrientation } from '../../src/application/effects/member-state';
import { createStageMemberOrientationTargetSelection } from '../../src/application/effects/stage-member-target-selection';
import {
  addHeartLiveModifierForTargetMember,
  addMemberCostLiveModifierForMember,
} from '../../src/domain/rules/live-modifiers';
import { getActivatedAbilityLimitStatus } from '../../src/application/card-effects/runtime/ability-turn-limit';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { replayExactWaitingRoomMemberToOriginalSlotAndEnqueueTriggers } from '../../src/application/card-effects/runtime/replay-exact-stage-member';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import {
  CardType,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { createOctober29DraftCard } from '../helpers/october-29-draft-effects';
import {
  P1,
  P2,
  syntheticMember,
  gameWith,
  stage,
  choose,
  pending,
} from '../helpers/edelnote-effect-fixture';

function setup(withTarget = true) {
  const source = createOctober29DraftCard('PL!HS-bp8-008', P1, 'source');
  const target = createOctober29DraftCard('PL!HS-bp8-008', P1, 'target');
  const same = createOctober29DraftCard('PL!HS-bp8-008', P1, 'same');
  const hand = syntheticMember('hand');
  let game = stage(gameWith([source, target, same, hand]), 'source');
  if (withTarget) game = stage(game, 'target', SlotPosition.LEFT, P1, OrientationState.WAITING);
  return updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['hand'] },
    waitingRoom: { ...p.waitingRoom, cardIds: ['same'] },
  }));
}

describe('PL!HS-bp8-008 费用9「桂城泉」', () => {
  it('pays only the hand cost and replays the exact other same-name EdelNote member to its original slot', () => {
    const started = activateCardAbility(setup(), P1, 'source', ABILITY);
    expect(choose(started, 'source')).toBe(started);
    const paid = choose(started, 'hand');
    expect(paid.activeEffect?.selectableCardIds).toEqual(['target']);
    expect(paid.activeEffect?.canSkipSelection).toBe(false);
    expect(paid.activeEffect?.skipSelectionLabel).toBeUndefined();
    expect(choose(paid, null)).toBe(paid);
    const done = choose(paid, 'target');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe('target');
    expect(done.players[0].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.players[0].waitingRoom.cardIds).toEqual(['same', 'hand']);
    const pay = done.actionHistory.filter(
      (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY
    );
    expect(pay).toHaveLength(1);
    expect(pay[0].payload.discardedCardIds).toEqual(['hand']);
    expect(pay[0].payload.targetCardId).toBeUndefined();
    const events = done.eventLog.map(({ event }) => event);
    expect(
      events.filter((event) => event.eventType === TriggerCondition.ON_LEAVE_STAGE)
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.eventType === TriggerCondition.ON_ENTER_STAGE)
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)
    ).toHaveLength(2);
    expect(getActivatedAbilityLimitStatus(done, P1, ABILITY, 'source')?.used).toBe(1);
    expect(activateCardAbility(done, P1, 'source', ABILITY)).toBe(done);
  });

  it('declines before payment, rejects non-hand input, and still pays when no other EdelNote exists', () => {
    const initial = setup(false);
    const started = activateCardAbility(initial, P1, 'source', ABILITY);
    const skipped = choose(started, null);
    expect(skipped.players[0].hand.cardIds).toEqual(['hand']);
    expect(getActivatedAbilityLimitStatus(skipped, P1, ABILITY, 'source')?.used).toBe(0);
    const paid = choose(activateCardAbility(initial, P1, 'source', ABILITY), 'hand');
    expect(paid.activeEffect).toBeNull();
    expect(paid.players[0].waitingRoom.cardIds).toEqual(['same', 'hand']);
    expect(getActivatedAbilityLimitStatus(paid, P1, ABILITY, 'source')?.used).toBe(1);
  });

  it('keeps the used history but allows one new activation after this source leaves and re-enters', () => {
    const done = choose(
      choose(activateCardAbility(setup(), P1, 'source', ABILITY), 'hand'),
      'target'
    );
    const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      done,
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!;
    let returned = replayExactWaitingRoomMemberToOriginalSlotAndEnqueueTriggers(
      moved.gameState,
      P1,
      'source',
      SlotPosition.CENTER,
      enqueueTriggeredCardEffects
    )!;
    returned = registerCards(returned, [syntheticMember('hand2')]);
    returned = updatePlayer(returned, P1, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['hand2'] },
    }));
    expect(getActivatedAbilityLimitStatus(returned, P1, ABILITY, 'source')?.used).toBe(0);
    const paidAgain = choose(activateCardAbility(returned, P1, 'source', ABILITY), 'hand2');
    const final = choose(paidAgain, 'target');
    expect(getActivatedAbilityLimitStatus(final, P1, ABILITY, 'source')?.used).toBe(1);
    expect(
      final.actionHistory.filter(
        (a) => a.payload.abilityId === ABILITY && a.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(2);
  });

  it('does not charge an old source lifecycle, but source removal after paying does not cancel the independent target', () => {
    let started = activateCardAbility(setup(), P1, 'source', ABILITY);
    const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      started,
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!;
    const reentered = replayExactWaitingRoomMemberToOriginalSlotAndEnqueueTriggers(
      moved.gameState,
      P1,
      'source',
      SlotPosition.CENTER,
      enqueueTriggeredCardEffects
    )!;
    const rejected = choose(reentered, 'hand');
    expect(rejected.activeEffect).toBeNull();
    expect(rejected.players[0].hand.cardIds).toEqual(['hand']);
    started = choose(activateCardAbility(setup(), P1, 'source', ABILITY), 'hand');
    const withoutSource = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      started,
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!.gameState;
    const done = choose(withoutSource, 'target');
    expect(done.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe('target');
  });

  it('finishes a stale target without refunding the discard or turn use', () => {
    const paid = choose(activateCardAbility(setup(), P1, 'source', ABILITY), 'hand');
    const stale = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      paid,
      P1,
      'target',
      enqueueTriggeredCardEffects
    )!.gameState;
    const done = choose(stale, 'target');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(getActivatedAbilityLimitStatus(done, P1, ABILITY, 'source')?.used).toBe(1);
  });

  it('returns attached energy, sends below members away, clears old target modifiers, and creates a new lifecycle', () => {
    const energy = createCardInstance(
      { cardCode: 'SYNTHETIC-energy', name: 'energy', cardType: CardType.ENERGY },
      P1,
      'energy-below'
    );
    let game = registerCards(setup(), [syntheticMember('below'), energy]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: {
        ...addMemberBelowMember(p.memberSlots, SlotPosition.LEFT, 'below'),
        energyBelow: { ...p.memberSlots.energyBelow, [SlotPosition.LEFT]: ['energy-below'] },
      },
    }));
    const lifecycle = getStageMemberLifecycleId(game, 'target');
    game = addHeartLiveModifierForTargetMember(game, {
      playerId: P1,
      sourceCardId: 'source',
      targetMemberCardId: 'target',
      abilityId: 'old-heart',
      hearts: [{ color: HeartColor.PURPLE, count: 2 }],
    })!.gameState;
    game = addMemberCostLiveModifierForMember(game, {
      playerId: P1,
      sourceCardId: 'source',
      memberCardId: 'target',
      abilityId: 'old-cost',
      countDelta: -1,
    })!.gameState;
    const done = choose(choose(activateCardAbility(game, P1, 'source', ABILITY), 'hand'), 'target');
    expect(done.players[0].waitingRoom.cardIds).toContain('below');
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.LEFT]).toEqual([]);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
    expect(done.players[0].energyDeck.cardIds).toContain('energy-below');
    expect(done.liveResolution.liveModifiers).toEqual([]);
    expect(getStageMemberLifecycleId(done, 'target')).not.toBe(lifecycle);
    expect(
      done.eventLog.find(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MEMBER_SLOT
      )?.event
    ).toMatchObject({ cardInstanceIds: ['target', 'below'] });
  });

  it('queues the replayed member on-enter only after the complete replay action', () => {
    let game = registerCards(setup(), [
      createOctober29DraftCard('PL!HS-bp8-015', P1, 'seras'),
      syntheticMember('deck'),
    ]);
    game = stage(game, 'seras', SlotPosition.LEFT);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
    }));
    const done = choose(choose(activateCardAbility(game, P1, 'source', ABILITY), 'hand'), 'seras');
    expect(done.activeEffect?.sourceCardId).toBe('seras');
    expect(done.activeEffect?.stepId).toBe('HS_BP8_015_ON_ENTER_OPTION');
    const parentIndex = done.actionHistory.findIndex(
      (a) => a.payload.abilityId === ABILITY && a.payload.step === 'REPLAY_EXACT_MEMBER'
    );
    const childIndex = done.actionHistory.findIndex(
      (a) =>
        a.payload.sourceCardId === 'seras' && a.payload.step === 'START_SOURCE_ORIENTATION_OPTION'
    );
    expect(parentIndex).toBeGreaterThan(-1);
    expect(childIndex).toBeGreaterThan(parentIndex);
  });

  it('protects this member dynamically from opponent effects, including opponent effects chosen by this player', () => {
    let game = registerCards(setup(false), [
      createOctober29DraftCard('PL!HS-bp8-015', P1, 'partner'),
    ]);
    const cause = {
      kind: 'CARD_EFFECT' as const,
      playerId: P2,
      sourceCardId: 'opponent',
      abilityId: 'wait-opponent',
    };
    expect(setMemberOrientation(game, P1, 'source', OrientationState.WAITING, cause)?.changed).toBe(
      true
    );
    game = stage(game, 'partner', SlotPosition.LEFT, P1, OrientationState.WAITING);
    expect(
      setMemberOrientation(game, P1, 'source', OrientationState.WAITING, cause)
        ?.blockedByWaitingProtection
    ).toBe(true);
    expect(
      setMemberOrientation(game, P1, 'source', OrientationState.WAITING, { ...cause, playerId: P1 })
        ?.changed
    ).toBe(true);
    expect(setMemberOrientation(game, P1, 'source', OrientationState.WAITING)?.changed).toBe(true);
    const selection = createStageMemberOrientationTargetSelection(game, {
      ability: { ...pending(game, 'wait-opponent', 'opponent'), controllerId: P2 },
      effectText: 'wait',
      stepId: 'wait',
      stepText: 'wait',
      awaitingPlayerId: P1,
      targetPlayerId: P1,
      selector: () => true,
      targetOrientation: OrientationState.WAITING,
      selectionLabel: '选择成员',
      orderedResolution: false,
    });
    expect(selection.selectableCardIds).not.toContain('source');
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT),
    }));
    expect(setMemberOrientation(game, P1, 'source', OrientationState.WAITING, cause)?.changed).toBe(
      true
    );
  });
});
