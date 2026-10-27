import { describe, expect, it } from 'vitest';
import {
  HS_BP8_014_ON_ENTER_OTHER_HASUNOSORA_DRAW_ONE_ABILITY_ID as HIME_ENTER,
  HS_BP8_014_LEAVE_STAGE_DISCARD_TWO_ABILITY_ID as HIME_LEAVE,
} from '../../src/application/card-effects/ability-ids';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { createCardInstance } from '../../src/domain/entities/card';
import { emitGameEvent, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createLeaveStageEvent } from '../../src/domain/events/game-events';
import {
  FaceState,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { getOctober26CardData } from '../helpers/october-26-card-effects';
import {
  P1,
  P2,
  member,
  setup,
  enter,
  choose,
  latest,
} from '../helpers/october-26-member-workflow';

describe('PL!HS-bp8-014 费用2「安养寺姬芽」two independent segments', () => {
  it.each([OrientationState.ACTIVE, OrientationState.WAITING])(
    'draws for another same-name Hasunosora stage instance in %s',
    (orientation) => {
      const other = createCardInstance(getOctober26CardData('PL!HS-bp8-014-N'), P1, 'other-hime');
      let game = registerCards(setup('PL!HS-bp8-014-N', 0), [other]);
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, other.instanceId, {
          orientation,
          face: FaceState.FACE_UP,
        }),
      }));
      const done = enter(game);
      expect(done.players[0].hand.cardIds).toEqual(['deck-0']);
      expect(latest(done, HIME_ENTER)).toMatchObject({
        hasRequiredOtherStageGroupMember: true,
        drawnCardIds: ['deck-0'],
      });
    }
  );
  it('excludes itself, opponent members, hand and below-stage members', () => {
    const other = member('other', '蓮ノ空', P2);
    const below = member('below');
    let game = registerCards(setup('PL!HS-bp8-014-N', 1), [other, below]);
    game = updatePlayer(game, P2, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, other.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        memberBelow: { ...p.memberSlots.memberBelow, [SlotPosition.CENTER]: ['below'] },
      },
    }));
    const done = enter(game);
    expect(done.players[0].hand.cardIds).toEqual(['hand-0']);
    expect(latest(done, HIME_ENTER)?.step).toBe('OTHER_STAGE_GROUP_MEMBER_CONDITION_NOT_MET');
    expect(done.pendingAbilities).toEqual([]);
  });
  it.each([0, 1, 2, 3])(
    'leaves to waiting room, draws zero and forcibly discards min(2,%s) cards',
    (handCount) => {
      const initial = setup('PL!HS-bp8-014-N', handCount);
      const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
        initial,
        P1,
        'source',
        enqueueTriggeredCardEffects
      )!;
      let game = resolvePendingCardEffects(moved.gameState).gameState;
      expect(game.activeEffect?.abilityId).toBe(HIME_LEAVE);
      expect(game.players[0].mainDeck.cardIds).toEqual(initial.players[0].mainDeck.cardIds);
      expect(game.activeEffect?.canSkipSelection).toBe(handCount === 0);
      const ids = Array.from({ length: Math.min(2, handCount) }, (_, i) => `hand-${i}`);
      if (handCount > 0) expect(choose(game)).toBe(game);
      if (handCount >= 2) {
        expect(choose(game, undefined, ['hand-0', 'hand-0'])).toBe(game);
        expect(choose(game, undefined, ['hand-0', 'not-hand'])).toBe(game);
        const stale = updatePlayer(game, P1, (p) => ({
          ...p,
          hand: { ...p.hand, cardIds: p.hand.cardIds.filter((id) => id !== 'hand-0') },
        }));
        expect(choose(stale, undefined, ids)).toBe(stale);
      }
      game = choose(game, undefined, ids.length ? ids : undefined);
      expect(game.players[0].hand.cardIds).toEqual(handCount > 2 ? ['hand-2'] : []);
      expect(game.players[0].waitingRoom.cardIds).toEqual(['source', ...ids]);
      expect(game.actionHistory.filter((a) => a.type === 'PAY_COST')).toEqual([]);
      expect(
        game.eventLog.filter(
          ({ event }) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.fromZone === ZoneType.HAND
        )
      ).toHaveLength(ids.length ? 1 : 0);
      expect(game.activeEffect).toBeNull();
      expect(game.pendingAbilities).toEqual([]);
    }
  );
  it('does not trigger from a stage-to-hand leave event', () => {
    const game = setup('PL!HS-bp8-014-N');
    const event = createLeaveStageEvent('source', SlotPosition.CENTER, ZoneType.HAND, P1, P1);
    const queued = enqueueTriggeredCardEffects(
      emitGameEvent(game, event),
      [TriggerCondition.ON_LEAVE_STAGE],
      { leaveStageEvents: [event] }
    );
    expect(queued.pendingAbilities).toEqual([]);
  });
  it('keeps a triggered discard after the source has left the waiting room', () => {
    const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      setup('PL!HS-bp8-014-N'),
      P1,
      'source',
      enqueueTriggeredCardEffects
    )!;
    const changed = updatePlayer(moved.gameState, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
      hand: { ...p.hand, cardIds: [...p.hand.cardIds, 'source'] },
    }));
    const done = choose(resolvePendingCardEffects(changed).gameState, undefined, [
      'hand-0',
      'source',
    ]);
    expect(done.players[0].hand.cardIds).toEqual(['hand-1']);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['hand-0', 'source']);
  });
});
