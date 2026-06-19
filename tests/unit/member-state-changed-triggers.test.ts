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
import { setMemberOrientation } from '../../src/application/effects/member-state';
import { enqueueMemberStateChangedTriggersFromOrientationResult } from '../../src/application/card-effects/runtime/member-state-changed-triggers';
import {
  CardType,
  HeartColor,
  OrientationState,
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

describe('member-state-changed trigger wrapper', () => {
  it('enqueues only this orientation-change delta after caller-owned action logging', () => {
    const member = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    let game = createGameState('member-state-changed-wrapper', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, member.instanceId),
    }));

    const orientationResult = setMemberOrientation(
      game,
      'p1',
      member.instanceId,
      OrientationState.WAITING,
      {
        kind: 'CARD_EFFECT',
        playerId: 'p1',
        sourceCardId: 'source-card',
        abilityId: 'ability-1',
        pendingAbilityId: 'pending-1',
      }
    );
    expect(orientationResult).not.toBeNull();

    const enqueueTriggeredCardEffects = vi.fn((state: GameState) =>
      addAction(state, 'TRIGGER_ABILITY', 'p1', { step: 'ENQUEUE_MEMBER_STATE_CHANGED' })
    );

    const result = enqueueMemberStateChangedTriggersFromOrientationResult(
      game,
      orientationResult!,
      enqueueTriggeredCardEffects,
      {
        prepareGameStateBeforeEnqueue: (state, changeResult) =>
          addAction(state, 'RESOLVE_ABILITY', 'p1', {
            step: 'WAIT_MEMBER',
            previousOrientation: changeResult.previousOrientation,
            nextOrientation: changeResult.nextOrientation,
          }),
      }
    );

    expect(result.memberStateChangedEvents).toHaveLength(1);
    expect(result.memberStateChangedEvents[0]).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
      cardInstanceId: member.instanceId,
      controllerId: 'p1',
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });
    expect(enqueueTriggeredCardEffects).toHaveBeenCalledTimes(1);
    const [stateBeforeEnqueue, triggerConditions, options] =
      enqueueTriggeredCardEffects.mock.calls[0];
    expect(stateBeforeEnqueue.actionHistory.map((action) => action.type)).toEqual([
      'RESOLVE_ABILITY',
    ]);
    expect(triggerConditions).toEqual([TriggerCondition.ON_MEMBER_STATE_CHANGED]);
    expect(options?.memberStateChangedEvents).toEqual(result.memberStateChangedEvents);
    expect(result.gameState.actionHistory.map((action) => action.type)).toEqual([
      'RESOLVE_ABILITY',
      'TRIGGER_ABILITY',
    ]);
  });

  it('does not enqueue when the orientation result emitted no state-change event', () => {
    const member = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    let game = createGameState('member-state-changed-wrapper-no-event', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, member.instanceId),
    }));

    const orientationResult = setMemberOrientation(
      game,
      'p1',
      member.instanceId,
      OrientationState.ACTIVE
    );
    expect(orientationResult).not.toBeNull();
    const enqueueTriggeredCardEffects = vi.fn((state: GameState) => state);

    const result = enqueueMemberStateChangedTriggersFromOrientationResult(
      game,
      orientationResult!,
      enqueueTriggeredCardEffects,
      {
        prepareGameStateBeforeEnqueue: (state) =>
          addAction(state, 'RESOLVE_ABILITY', 'p1', { step: 'UNCHANGED_MEMBER' }),
      }
    );

    expect(result.memberStateChangedEvents).toEqual([]);
    expect(enqueueTriggeredCardEffects).not.toHaveBeenCalled();
    expect(result.gameState.actionHistory.map((action) => action.type)).toEqual([
      'RESOLVE_ABILITY',
    ]);
  });
});
