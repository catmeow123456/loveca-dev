import { describe, expect, it } from 'vitest';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import { updatePlayer, registerCards, type GameState } from '../../src/domain/entities/game';
import { removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  resolvePendingCardEffects,
  enqueueTriggeredCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_BP8_015_ON_ENTER_WAIT_LOOK_TOP_TWO_ARRANGE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { resolvePendingAbilityStarterWithRegistry } from '../../src/application/card-effects/runtime/starter-registry';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { replayExactWaitingRoomMemberToOriginalSlotAndEnqueueTriggers } from '../../src/application/card-effects/runtime/replay-exact-stage-member';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import {
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { projectPlayerViewState, createPublicObjectId } from '../../src/online/projector';
import { createOctober29DraftCard } from '../helpers/october-29-draft-effects';
import { sourceCardFixture } from '../helpers/card-effect-zone-fixture';
import {
  P1,
  P2,
  syntheticMember,
  gameWith,
  stage,
  start,
  choose,
  pending,
} from '../helpers/edelnote-effect-fixture';

function setup() {
  const source = createOctober29DraftCard('PL!HS-bp8-015', P1, 'source');
  let game = stage(
    gameWith([source, syntheticMember('a'), syntheticMember('b'), syntheticMember('rest')]),
    'source'
  );
  return updatePlayer(game, P1, (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: ['a', 'b', 'rest'] },
  }));
}

describe('PL!HS-bp8-015 费用4「赛拉丝·柳田·利林费尔德」', () => {
  it('retains the complete authorized CN paragraph with only the missing optional word added', () => {
    expect(findCardAbilityDefinitionById(ABILITY)?.effectText).toBe(
      '【登场】可以将此成员变为待机状态：检视自己的卡组顶的２张卡片。可以将其中的任意张数的卡片按任意顺序放置于卡组顶，其余的放置入休息室。（待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。）'
    );
  });
  it.each([false, true])(
    'preserves the real optional cost under manual/ordered=%s without an extra confirmation',
    (ordered) => {
      let game = setup();
      const ability = pending(game, ABILITY);
      game = { ...game, pendingAbilities: [ability] };
      const started = resolvePendingAbilityStarterWithRegistry(
        game,
        ability,
        { manualConfirmation: !ordered, orderedResolution: ordered },
        {
          continuePendingCardEffects: (state) => resolvePendingCardEffects(state).gameState,
          delegatePendingAbility: (state) => state,
        }
      )!;
      expect(started.activeEffect?.stepId).toBe('HS_BP8_015_ON_ENTER_OPTION');
      expect(started.activeEffect?.selectableCardIds).toBeUndefined();
      expect(started.activeEffect?.selectableOptions).toEqual([{ id: 'activate', label: '发动' }]);
      expect(started.activeEffect?.skipSelectionLabel).toBe('不发动');
      expect(choose(started, undefined, 'forged')).toBe(started);
      const done = choose(started, null);
      expect(done.activeEffect).toBeNull();
      expect(done.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
        OrientationState.ACTIVE
      );
      expect(done.inspectionZone.cardIds).toEqual([]);
      expect(done.eventLog).toEqual([]);
    }
  );
  it.each([{ selected: [] }, { selected: ['b'] }, { selected: ['b', 'a'] }])(
    'privately orders $selected onto the top after paying once, with one grouped remainder event',
    ({ selected }) => {
      const started = start(setup(), ABILITY);
      const inspected = choose(started, undefined, 'activate');
      expect(inspected.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(inspected.activeEffect?.stepId).toBe('HS_BP8_015_ON_ENTER_ARRANGE_TOP_TWO');
      expect(inspected.activeEffect?.autoSubmitSingleSelection).toBeUndefined();
      expect(inspected.activeEffect?.confirmSelectionLabel).toBe('按此顺序放置于卡组顶');
      expect(inspected.activeEffect?.minSelectableCards).toBe(0);
      expect(inspected.activeEffect?.maxSelectableCards).toBe(2);
      for (const id of ['a', 'b']) {
        expect(
          projectPlayerViewState(inspected, P1).objects[createPublicObjectId(id)].surface
        ).toBe('FRONT');
        expect(
          projectPlayerViewState(inspected, P2).objects[createPublicObjectId(id)].surface
        ).toBe('BACK');
      }
      expect(choose(inspected, undefined, undefined, ['a', 'a'])).toBe(inspected);
      expect(choose(inspected, undefined, undefined, ['rest'])).toBe(inspected);
      const done = choose(inspected, undefined, undefined, selected);
      expect(done.activeEffect).toBeNull();
      expect(done.players[0].mainDeck.cardIds).toEqual([...selected, 'rest']);
      const remainder = ['a', 'b'].filter((id) => !selected.includes(id));
      expect(done.players[0].waitingRoom.cardIds).toEqual(remainder);
      const events = done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      );
      expect(events).toHaveLength(remainder.length ? 1 : 0);
      if (remainder.length)
        expect(events[0].event).toMatchObject({
          cardInstanceIds: remainder,
          fromZone: ZoneType.MAIN_DECK,
        });
      expect(
        done.eventLog.filter(
          ({ event }) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
        )
      ).toHaveLength(1);
      expect(
        done.actionHistory.filter(
          (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY
        )
      ).toHaveLength(1);
    }
  );
  it('does not offer a cost already WAITING, and does not wait a re-entered source object', () => {
    let game = stage(setup(), 'source', SlotPosition.CENTER, P1, OrientationState.WAITING);
    const unavailable = start(game, ABILITY);
    expect(unavailable.activeEffect?.selectableOptions).toEqual([]);
    expect(choose(unavailable, undefined, 'activate')).toBe(unavailable);
    expect(choose(unavailable, null).activeEffect).toBeNull();
    const opened = start(setup(), ABILITY);
    const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      opened,
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!;
    // No enqueue callback here: exercise the stale original invocation before the new ON_ENTER is scheduled.
    game = replayExactWaitingRoomMemberToOriginalSlotAndEnqueueTriggers(
      moved.gameState,
      P1,
      'source',
      SlotPosition.CENTER,
      (state) => state
    )!;
    const done = choose(game, undefined, 'activate');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.inspectionZone.cardIds).toEqual([]);
  });
  it.each([0, 1])(
    'handles a short deck of %s cards after committing the optional cost',
    (count) => {
      let game = updatePlayer(setup(), P1, (p) => ({
        ...p,
        mainDeck: { ...p.mainDeck, cardIds: ['a'].slice(0, count) },
      }));
      game = choose(start(game, ABILITY), undefined, 'activate');
      if (count) {
        expect(game.activeEffect?.maxSelectableCards).toBe(1);
        expect(game.activeEffect?.autoSubmitSingleSelection).toBeUndefined();
        game = choose(game, undefined, undefined, ['a']);
      }
      expect(game.activeEffect).toBeNull();
      expect(game.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
        OrientationState.WAITING
      );
    }
  );
  it('completes inspection after the paid source leaves, preserving the cost', () => {
    const inspected = choose(start(setup(), ABILITY), undefined, 'activate');
    const absent = updatePlayer(inspected, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }));
    const done = choose(absent, undefined, undefined, ['b']);
    expect(done.players[0].mainDeck.cardIds).toEqual(['b', 'rest']);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['a']);
  });
  it.each([true, false])('uses the actual Ginko host with activation-cost waiver=%s', (waived) => {
    let game = registerCards(setup(), [
      createCardInstance(sourceCardFixture('PL!HS-bp8-004-SEC') as MemberCardData, P1, 'ginko'),
    ]);
    game = stage(game, 'ginko', SlotPosition.LEFT);
    const ability = {
      ...pending(game, ABILITY, 'ginko'),
      onEnterInvocation: {
        definitionSourceCardCode: 'PL!HS-bp8-015-N',
        waiveActivationCosts: waived,
        grantId: 'grant',
      },
    };
    game = resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState;
    if (!waived) game = choose(game, undefined, 'activate');
    expect(game.activeEffect?.stepId).toBe('HS_BP8_015_ON_ENTER_ARRANGE_TOP_TWO');
    expect(game.activeEffect?.sourceCardId).toBe('ginko');
    const done = choose(game, undefined, undefined, ['b']);
    expect(done.players[0].mainDeck.cardIds).toEqual(['b', 'rest']);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['a']);
    expect(done.players[0].memberSlots.cardStates.get('ginko')?.orientation).toBe(
      waived ? OrientationState.ACTIVE : OrientationState.WAITING
    );
    expect(done.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      done.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY
      )
    ).toHaveLength(waived ? 0 : 1);
  });
});
