import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import type { MemberStateChangedEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { waitStageMembersAndEnqueueTriggers } from '../../src/application/card-effects/runtime/wait-stage-members';
import type { EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../src/application/card-effects/runtime/member-state-changed-triggers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const CAUSE = {
  kind: 'CARD_EFFECT' as const,
  playerId: P1,
  sourceCardId: 'source',
  abilityId: 'test:wait-stage-members',
  pendingAbilityId: 'pending',
};

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setup() {
  const left = createCardInstance(member('LEFT'), P1, 'left');
  const center = createCardInstance(member('CENTER'), P1, 'center');
  const right = createCardInstance(member('RIGHT'), P1, 'right');
  const stale = createCardInstance(member('STALE'), P1, 'stale');
  let game = registerCards(createGameState('wait-stage-members', P1, 'P1', P2, 'P2'), [
    left,
    center,
    right,
    stale,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, left.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.CENTER,
        center.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
      SlotPosition.RIGHT,
      right.instanceId,
      {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  return { game, left, center, right, stale };
}

describe('waitStageMembersAndEnqueueTriggers', () => {
  it('applies every legal wait first, then enqueues the ordered standard events once as one batch', () => {
    const scenario = setup();
    const enqueueCalls: {
      readonly game: GameState;
      readonly triggerConditions: readonly TriggerCondition[];
      readonly events: readonly MemberStateChangedEvent[];
    }[] = [];
    const enqueue: EnqueueTriggeredCardEffectsForMemberStateChanged = (
      game,
      triggerConditions,
      options
    ) => {
      enqueueCalls.push({
        game,
        triggerConditions,
        events: options?.memberStateChangedEvents ?? [],
      });
      return game;
    };

    const result = waitStageMembersAndEnqueueTriggers(scenario.game, {
      playerId: P1,
      memberCardIds: [
        scenario.left.instanceId,
        scenario.right.instanceId,
        scenario.stale.instanceId,
        scenario.left.instanceId,
        scenario.center.instanceId,
      ],
      cause: CAUSE,
      enqueueTriggeredCardEffects: enqueue,
    });

    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]!.triggerConditions).toEqual([TriggerCondition.ON_MEMBER_STATE_CHANGED]);
    expect(
      enqueueCalls[0]!.game.players[0].memberSlots.cardStates.get(scenario.left.instanceId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      enqueueCalls[0]!.game.players[0].memberSlots.cardStates.get(scenario.center.instanceId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(enqueueCalls[0]!.events).toMatchObject([
      {
        eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
        cardInstanceId: scenario.left.instanceId,
        controllerId: P1,
        slot: SlotPosition.LEFT,
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
        cause: CAUSE,
      },
      {
        eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
        cardInstanceId: scenario.center.instanceId,
        controllerId: P1,
        slot: SlotPosition.CENTER,
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
        cause: CAUSE,
      },
    ]);
    expect(result.actuallyWaitedMemberCardIds).toEqual([
      scenario.left.instanceId,
      scenario.center.instanceId,
    ]);
    expect(result.memberStateChangedEventIds).toEqual(
      enqueueCalls[0]!.events.map((event) => event.eventId)
    );
    expect(
      result.gameState.eventLog
        .filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
        .map((entry) => entry.event.cardInstanceId)
    ).toEqual([scenario.left.instanceId, scenario.center.instanceId]);
  });

  it('does not enqueue or emit events when every requested target is already waiting or stale', () => {
    const scenario = setup();
    let enqueueCallCount = 0;
    const enqueue: EnqueueTriggeredCardEffectsForMemberStateChanged = (game) => {
      enqueueCallCount += 1;
      return game;
    };

    const result = waitStageMembersAndEnqueueTriggers(scenario.game, {
      playerId: P1,
      memberCardIds: [scenario.right.instanceId, scenario.stale.instanceId],
      cause: CAUSE,
      enqueueTriggeredCardEffects: enqueue,
    });

    expect(enqueueCallCount).toBe(0);
    expect(result.gameState).toBe(scenario.game);
    expect(result.actuallyWaitedMemberCardIds).toEqual([]);
    expect(result.memberStateChangedEventIds).toEqual([]);
    expect(result.gameState.eventLog).toEqual(scenario.game.eventLog);
  });
});
