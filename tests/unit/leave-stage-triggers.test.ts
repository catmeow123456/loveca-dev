import { describe, expect, it, vi } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
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

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

describe('leave-stage trigger wrapper', () => {
  it('pays source member to waiting room and enqueues only this leave-stage delta', () => {
    const source = createCardInstance(createMemberCard('SOURCE'), 'p1', 'source-member');
    let game = createGameState('leave-stage-wrapper', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
    }));

    const enqueueTriggeredCardEffects = vi.fn((state: GameState) =>
      addAction(state, 'TRIGGER_ABILITY', 'p1', { step: 'ENQUEUE_LEAVE_STAGE' })
    );

    const result = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      'p1',
      source.instanceId,
      enqueueTriggeredCardEffects
    );

    expect(result).not.toBeNull();
    expect(result?.sourceSlot).toBe(SlotPosition.CENTER);
    expect(result?.movedToWaitingRoomCardIds).toEqual([source.instanceId]);
    expect(result?.leaveStageEvents).toHaveLength(1);
    expect(result?.leaveStageEvents[0]).toMatchObject({
      eventType: TriggerCondition.ON_LEAVE_STAGE,
      cardInstanceId: source.instanceId,
      fromSlot: SlotPosition.CENTER,
      toZone: ZoneType.WAITING_ROOM,
      controllerId: 'p1',
    });
    expect(enqueueTriggeredCardEffects).toHaveBeenCalledTimes(1);
    const [stateBeforeEnqueue, triggerConditions, options] =
      enqueueTriggeredCardEffects.mock.calls[0];
    expect(stateBeforeEnqueue.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(triggerConditions).toEqual([TriggerCondition.ON_LEAVE_STAGE]);
    expect(options?.leaveStageEvents).toEqual(result?.leaveStageEvents);
    expect(result?.gameState.actionHistory.map((action) => action.type)).toEqual([
      'TRIGGER_ABILITY',
    ]);
  });

  it('preserves energy costs paid before the source member self-send', () => {
    const source = createCardInstance(createMemberCard('SOURCE'), 'p1', 'source-member');
    const energy = createCardInstance(createEnergyCard('ENERGY'), 'p1', 'energy-card');
    let game = createGameState('leave-stage-wrapper-energy', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, energy]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId),
      energyZone: {
        ...player.energyZone,
        cardIds: [energy.instanceId],
        cardStates: new Map([
          [energy.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));

    const enqueueTriggeredCardEffects = vi.fn((state: GameState) => state);

    const result = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      'p1',
      source.instanceId,
      enqueueTriggeredCardEffects,
      {
        additionalCostsBeforeSourceMemberToWaitingRoom: [
          { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
        ],
      }
    );

    expect(result).not.toBeNull();
    expect(result?.paidEnergyCardIds).toEqual([energy.instanceId]);
    expect(
      result?.gameState.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(result?.movedToWaitingRoomCardIds).toEqual([source.instanceId]);
    expect(result?.leaveStageEvents).toHaveLength(1);
    expect(enqueueTriggeredCardEffects).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue when the source member self-send cost cannot be paid', () => {
    const source = createCardInstance(createMemberCard('SOURCE'), 'p1', 'source-member');
    let game = createGameState('leave-stage-wrapper-invalid', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source]);
    const enqueueTriggeredCardEffects = vi.fn((state: GameState) => state);

    const result = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      'p1',
      source.instanceId,
      enqueueTriggeredCardEffects
    );

    expect(result).toBeNull();
    expect(enqueueTriggeredCardEffects).not.toHaveBeenCalled();
  });
});
