import { describe, expect, it, vi } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../src/application/card-effects/runtime/member-slot-moved-triggers';
import {
  CardType,
  HeartColor,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

function createMemberCard(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

describe('member-slot-moved trigger wrapper', () => {
  it('moves a member and enqueues only this move delta after caller-owned action logging', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-B'), 'p1', 'member-b');
    let game = createGameState('member-slot-moved-wrapper', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId),
        SlotPosition.CENTER,
        memberB.instanceId
      ),
    }));

    const enqueueTriggeredCardEffects = vi.fn((state: GameState) =>
      addAction(state, 'TRIGGER_ABILITY', 'p1', { step: 'ENQUEUE_MEMBER_SLOT_MOVED' })
    );

    const result = moveMemberBetweenSlotsAndEnqueueTriggers(
      game,
      'p1',
      memberA.instanceId,
      SlotPosition.CENTER,
      enqueueTriggeredCardEffects,
      {
        prepareGameStateBeforeEnqueue: (state, moveResult) =>
          addAction(state, 'RESOLVE_ABILITY', 'p1', {
            step: 'POSITION_CHANGE',
            fromSlot: moveResult.fromSlot,
            toSlot: moveResult.toSlot,
            swappedCardId: moveResult.swappedCardId,
          }),
      }
    );

    expect(result).not.toBeNull();
    expect(result?.fromSlot).toBe(SlotPosition.LEFT);
    expect(result?.toSlot).toBe(SlotPosition.CENTER);
    expect(result?.swappedCardId).toBe(memberB.instanceId);
    expect(result?.memberSlotMovedEvents).toHaveLength(2);
    expect(result?.memberSlotMovedEvents.map((event) => event.cardInstanceId)).toEqual([
      memberA.instanceId,
      memberB.instanceId,
    ]);

    expect(enqueueTriggeredCardEffects).toHaveBeenCalledTimes(1);
    const [stateBeforeEnqueue, triggerConditions, options] =
      enqueueTriggeredCardEffects.mock.calls[0];
    expect(stateBeforeEnqueue.actionHistory.map((action) => action.type)).toEqual([
      'RESOLVE_ABILITY',
    ]);
    expect(triggerConditions).toEqual([TriggerCondition.ON_MEMBER_SLOT_MOVED]);
    expect(options?.memberSlotMovedEvents).toEqual(result?.memberSlotMovedEvents);
    expect(result?.gameState.actionHistory.map((action) => action.type)).toEqual([
      'RESOLVE_ABILITY',
      'TRIGGER_ABILITY',
    ]);
  });

  it('does not enqueue when the raw member move is invalid', () => {
    const member = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    let game = createGameState('member-slot-moved-wrapper-invalid', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, member.instanceId),
    }));
    const enqueueTriggeredCardEffects = vi.fn((state: GameState) => state);

    const result = moveMemberBetweenSlotsAndEnqueueTriggers(
      game,
      'p1',
      member.instanceId,
      SlotPosition.LEFT,
      enqueueTriggeredCardEffects
    );

    expect(result).toBeNull();
    expect(enqueueTriggeredCardEffects).not.toHaveBeenCalled();
  });
});
