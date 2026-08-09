import { describe, it, expect } from 'vitest';
import {
  CardType,
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  addEnergyBelowMember,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';

describe('成员区拖拽交换', () => {
  it('成员卡拖到已有成员槽位时应交换位置、携带 attachments，且不产生离场事件', () => {
    const memberDataA = {
      cardCode: 'MEM-A',
      name: '成员A',
      cardType: CardType.MEMBER as const,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    };
    const memberDataB = {
      cardCode: 'MEM-B',
      name: '成员B',
      cardType: CardType.MEMBER as const,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    };
    const energyData = {
      cardCode: 'ENE-1',
      name: '能量',
      cardType: CardType.ENERGY as const,
    };

    const memberA = createCardInstance(memberDataA, 'p1', 'member-a');
    const memberB = createCardInstance(memberDataB, 'p1', 'member-b');
    const memberBelowA = createCardInstance(
      { ...memberDataA, cardCode: 'MEM-BELOW-A' },
      'p1',
      'member-below-a'
    );
    const memberBelowB = createCardInstance(
      { ...memberDataB, cardCode: 'MEM-BELOW-B' },
      'p1',
      'member-below-b'
    );
    const energyA = createCardInstance(energyData, 'p1', 'energy-a');
    const energyB = createCardInstance({ ...energyData, cardCode: 'ENE-2' }, 'p1', 'energy-b');

    let game = createGameState('g1', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [
      memberA,
      memberB,
      memberBelowA,
      memberBelowB,
      energyA,
      energyB,
    ]);

    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = player.memberSlots;
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, memberA.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, memberB.instanceId);
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.LEFT, energyA.instanceId);
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, energyB.instanceId);
      memberSlots = addMemberBelowMember(
        memberSlots,
        SlotPosition.LEFT,
        memberBelowA.instanceId
      );
      memberSlots = addMemberBelowMember(
        memberSlots,
        SlotPosition.CENTER,
        memberBelowB.instanceId
      );
      return { ...player, memberSlots };
    });

    const moved = moveCardUniversal(
      game,
      'p1',
      memberA.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.MEMBER_SLOT,
      {
        sourceSlot: SlotPosition.LEFT,
        targetSlot: SlotPosition.CENTER,
      }
    );

    const player = moved.players[0];
    expect(player.memberSlots.slots[SlotPosition.LEFT]).toBe(memberB.instanceId);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(memberA.instanceId);
    expect(player.memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([energyB.instanceId]);
    expect(player.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([energyA.instanceId]);
    expect(player.memberSlots.memberBelow[SlotPosition.LEFT]).toEqual([memberBelowB.instanceId]);
    expect(player.memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([memberBelowA.instanceId]);
    expect(player.positionMovedThisTurn).toEqual([memberA.instanceId, memberB.instanceId]);
    expect(player.waitingRoom.cardIds).not.toContain(memberB.instanceId);
    expect(
      moved.eventLog
        .filter((record) => record.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED)
        .map((record) =>
          'cardInstanceId' in record.event ? record.event.cardInstanceId : undefined
        )
    ).toEqual([memberA.instanceId, memberB.instanceId]);
    expect(
      moved.eventLog.filter((record) => record.event.eventType === TriggerCondition.ON_LEAVE_STAGE)
    ).toHaveLength(0);
    expect(
      moved.eventLog.filter(
        (record) => record.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(0);

    const sameSlotMove = moveCardUniversal(
      moved,
      'p1',
      memberA.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.MEMBER_SLOT,
      { sourceSlot: SlotPosition.CENTER, targetSlot: SlotPosition.CENTER }
    );
    expect(sameSlotMove).toBe(moved);
    expect(sameSlotMove.players[0]?.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      energyA.instanceId,
    ]);
    expect(sameSlotMove.players[0]?.memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      memberBelowA.instanceId,
    ]);
  });
});
