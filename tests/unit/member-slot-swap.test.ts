import { describe, it, expect } from 'vitest';
import { CardType, HeartColor, SlotPosition, ZoneType } from '../../src/shared/types/enums';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { placeCardInSlot, addEnergyBelowMember } from '../../src/domain/entities/zone';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';

describe('成员区拖拽交换', () => {
  it('成员卡拖到另一个已有成员槽位时应交换位置，并携带各自 energyBelow', () => {
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
    const energyA = createCardInstance(energyData, 'p1', 'energy-a');
    const energyB = createCardInstance({ ...energyData, cardCode: 'ENE-2' }, 'p1', 'energy-b');

    let game = createGameState('g1', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB, energyA, energyB]);

    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = player.memberSlots;
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, memberA.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, memberB.instanceId);
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.LEFT, energyA.instanceId);
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, energyB.instanceId);
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
    expect(player.waitingRoom.cardIds).not.toContain(memberB.instanceId);
  });
});
