import { describe, expect, it } from 'vitest';
import type { MemberCardData, EnergyCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addEnergyBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  moveMemberBetweenSlots,
  setMemberOrientation,
} from '../../src/application/effects/member-state';
import { CardType, HeartColor, OrientationState, SlotPosition } from '../../src/shared/types/enums';

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

describe('member state effect helpers', () => {
  it('sets a stage member orientation without toggling unrelated members', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-B'), 'p1', 'member-b');
    let game = createGameState('member-state-orientation', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId),
        SlotPosition.CENTER,
        memberB.instanceId
      ),
    }));

    const result = setMemberOrientation(game, 'p1', memberA.instanceId, OrientationState.WAITING);

    expect(result).not.toBeNull();
    expect(result?.previousOrientation).toBe(OrientationState.ACTIVE);
    expect(result?.nextOrientation).toBe(OrientationState.WAITING);
    expect(
      result?.gameState.players[0].memberSlots.cardStates.get(memberA.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      result?.gameState.players[0].memberSlots.cardStates.get(memberB.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(setMemberOrientation(game, 'p1', 'missing-card', OrientationState.WAITING)).toBeNull();
  });

  it('moves a member to an empty slot with attached cards', () => {
    const member = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const energy = createCardInstance(createEnergyCard('ENE-A'), 'p1', 'energy-a');
    const belowMember = createCardInstance(createMemberCard('MEM-BELOW'), 'p1', 'member-below');
    let game = createGameState('member-state-move-empty', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, energy, belowMember]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, member.instanceId);
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.LEFT, energy.instanceId);
      memberSlots = {
        ...memberSlots,
        memberBelow: {
          ...memberSlots.memberBelow,
          [SlotPosition.LEFT]: [belowMember.instanceId],
        },
      };
      return { ...player, memberSlots };
    });

    const result = moveMemberBetweenSlots(game, 'p1', member.instanceId, SlotPosition.RIGHT);

    expect(result).not.toBeNull();
    expect(result?.swappedCardId).toBeNull();
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      member.instanceId
    );
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual([
      energy.instanceId,
    ]);
    expect(result?.gameState.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual([
      belowMember.instanceId,
    ]);
  });

  it('swaps occupied member slots with their attached cards', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-B'), 'p1', 'member-b');
    const energyA = createCardInstance(createEnergyCard('ENE-A'), 'p1', 'energy-a');
    const energyB = createCardInstance(createEnergyCard('ENE-B'), 'p1', 'energy-b');
    let game = createGameState('member-state-swap', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB, energyA, energyB]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, memberB.instanceId);
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.LEFT, energyA.instanceId);
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, energyB.instanceId);
      return { ...player, memberSlots };
    });

    const result = moveMemberBetweenSlots(game, 'p1', memberA.instanceId, SlotPosition.CENTER);

    expect(result).not.toBeNull();
    expect(result?.fromSlot).toBe(SlotPosition.LEFT);
    expect(result?.toSlot).toBe(SlotPosition.CENTER);
    expect(result?.swappedCardId).toBe(memberB.instanceId);
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      memberB.instanceId
    );
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      memberA.instanceId
    );
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([
      energyB.instanceId,
    ]);
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      energyA.instanceId,
    ]);
    expect(moveMemberBetweenSlots(game, 'p1', memberA.instanceId, SlotPosition.LEFT)).toBeNull();
  });
});
