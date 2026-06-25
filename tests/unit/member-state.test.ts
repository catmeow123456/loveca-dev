import { describe, expect, it } from 'vitest';
import type { MemberCardData, EnergyCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { recordMoveToStage, recordPositionMove } from '../../src/domain/entities/player';
import {
  addEnergyBelowMember,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  getPositionMovedStageMemberIdsMatching,
  hasMemberPositionMovedThisTurn,
} from '../../src/domain/rules/member-turn-state';
import {
  moveMemberBetweenSlots,
  playMembersFromWaitingRoomToEmptySlots,
  rearrangeStageMembers,
  rearrangeStageMembersByMoveHistory,
  setMemberOrientation,
  setMembersOrientation,
} from '../../src/application/effects/member-state';
import { removeCardFromPlayerZone } from '../../src/application/action-handlers/zone-operations';
import {
  CardType,
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
    expect(result?.gameState.eventLog).toHaveLength(1);
    expect(result?.gameState.eventLog[0].event).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
      cardInstanceId: memberA.instanceId,
      controllerId: 'p1',
      slot: SlotPosition.LEFT,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });
    expect(setMemberOrientation(game, 'p1', 'missing-card', OrientationState.WAITING)).toBeNull();
  });

  it('sets multiple stage member orientations at once', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-B'), 'p1', 'member-b');
    let game = createGameState('member-state-multi-orientation', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId),
        SlotPosition.RIGHT,
        memberB.instanceId
      ),
    }));

    const result = setMembersOrientation(
      game,
      'p1',
      [memberA.instanceId, memberB.instanceId],
      OrientationState.WAITING
    );

    expect(result).not.toBeNull();
    expect(result?.updatedMemberCardIds).toEqual([memberA.instanceId, memberB.instanceId]);
    expect(
      result?.gameState.players[0].memberSlots.cardStates.get(memberA.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      result?.gameState.players[0].memberSlots.cardStates.get(memberB.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(result?.gameState.eventLog.map((entry) => entry.event.eventType)).toEqual([
      TriggerCondition.ON_MEMBER_STATE_CHANGED,
      TriggerCondition.ON_MEMBER_STATE_CHANGED,
    ]);
    expect(result?.gameState.eventLog.map((entry) => entry.event)).toMatchObject([
      {
        cardInstanceId: memberA.instanceId,
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
      },
      {
        cardInstanceId: memberB.instanceId,
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
      },
    ]);
  });

  it('does not emit state changed events for unchanged member orientations', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-B'), 'p1', 'member-b');
    let game = createGameState('member-state-noop-orientation', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId),
        SlotPosition.RIGHT,
        memberB.instanceId
      ),
    }));

    const singleResult = setMemberOrientation(
      game,
      'p1',
      memberA.instanceId,
      OrientationState.ACTIVE
    );
    expect(singleResult?.gameState.eventLog).toEqual([]);

    const batchResult = setMembersOrientation(
      game,
      'p1',
      [memberA.instanceId, memberB.instanceId],
      OrientationState.ACTIVE
    );
    expect(batchResult?.gameState.eventLog).toEqual([]);
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
    expect(result?.gameState.players[0].positionMovedThisTurn).toEqual([member.instanceId]);
    expect(result?.gameState.eventLog).toHaveLength(1);
    expect(result?.gameState.eventLog[0].event).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      cardInstanceId: member.instanceId,
      controllerId: 'p1',
      fromSlot: SlotPosition.LEFT,
      toSlot: SlotPosition.RIGHT,
    });
  });

  it('defensively clears memberBelow when a main member is removed through the bare zone helper', () => {
    const member = createCardInstance(createMemberCard('MEM-HOST'), 'p1', 'member-host');
    const belowMember = createCardInstance(createMemberCard('MEM-BELOW'), 'p1', 'member-below');
    let game = createGameState('member-state-bare-remove', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, belowMember]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, member.instanceId);
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.LEFT, belowMember.instanceId);
      return { ...player, memberSlots };
    });

    const result = removeCardFromPlayerZone(
      game,
      'p1',
      member.instanceId,
      ZoneType.MEMBER_SLOT
    );

    expect(result.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(result.players[0].memberSlots.memberBelow[SlotPosition.LEFT]).toEqual([]);
    expect(result.players[0].waitingRoom.cardIds).toContain(belowMember.instanceId);
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
    expect(result?.gameState.players[0].positionMovedThisTurn).toEqual([
      memberA.instanceId,
      memberB.instanceId,
    ]);
    expect(getPositionMovedStageMemberIdsMatching(result!.gameState, 'p1', () => true)).toEqual([
      memberB.instanceId,
      memberA.instanceId,
    ]);
    expect(result?.gameState.eventLog).toHaveLength(2);
    expect(result?.gameState.eventLog.map((entry) => entry.event)).toMatchObject([
      {
        eventType: TriggerCondition.ON_MEMBER_SLOT_MOVED,
        cardInstanceId: memberA.instanceId,
        controllerId: 'p1',
        fromSlot: SlotPosition.LEFT,
        toSlot: SlotPosition.CENTER,
        swappedCardInstanceId: memberB.instanceId,
      },
      {
        eventType: TriggerCondition.ON_MEMBER_SLOT_MOVED,
        cardInstanceId: memberB.instanceId,
        controllerId: 'p1',
        fromSlot: SlotPosition.CENTER,
        toSlot: SlotPosition.LEFT,
        swappedCardInstanceId: memberA.instanceId,
      },
    ]);
    expect(moveMemberBetweenSlots(game, 'p1', memberA.instanceId, SlotPosition.LEFT)).toBeNull();
  });

  it('rearranges all stage members atomically without swap metadata', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-B'), 'p1', 'member-b');
    const memberC = createCardInstance(createMemberCard('MEM-C'), 'p1', 'member-c');
    let game = createGameState('member-state-formation-cycle', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB, memberC]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId),
          SlotPosition.CENTER,
          memberB.instanceId
        ),
        SlotPosition.RIGHT,
        memberC.instanceId
      ),
    }));

    const result = rearrangeStageMembers(
      game,
      'p1',
      [
        { cardId: memberA.instanceId, toSlot: SlotPosition.CENTER },
        { cardId: memberB.instanceId, toSlot: SlotPosition.RIGHT },
        { cardId: memberC.instanceId, toSlot: SlotPosition.LEFT },
      ],
      {
        cause: {
          kind: 'CARD_EFFECT',
          playerId: 'p1',
          sourceCardId: 'source-card',
          abilityId: 'formation-ability',
          pendingAbilityId: 'pending-formation',
        },
      }
    );

    expect(result).not.toBeNull();
    expect(result?.gameState.players[0].memberSlots.slots).toMatchObject({
      [SlotPosition.LEFT]: memberC.instanceId,
      [SlotPosition.CENTER]: memberA.instanceId,
      [SlotPosition.RIGHT]: memberB.instanceId,
    });
    expect(result?.rearrangedMembers).toEqual([
      { cardId: memberA.instanceId, fromSlot: SlotPosition.LEFT, toSlot: SlotPosition.CENTER },
      { cardId: memberB.instanceId, fromSlot: SlotPosition.CENTER, toSlot: SlotPosition.RIGHT },
      { cardId: memberC.instanceId, fromSlot: SlotPosition.RIGHT, toSlot: SlotPosition.LEFT },
    ]);
    expect(result?.gameState.eventLog.map((entry) => entry.event)).toMatchObject([
      {
        cardInstanceId: memberA.instanceId,
        fromSlot: SlotPosition.LEFT,
        toSlot: SlotPosition.CENTER,
        swappedCardInstanceId: undefined,
      },
      {
        cardInstanceId: memberB.instanceId,
        fromSlot: SlotPosition.CENTER,
        toSlot: SlotPosition.RIGHT,
        swappedCardInstanceId: undefined,
      },
      {
        cardInstanceId: memberC.instanceId,
        fromSlot: SlotPosition.RIGHT,
        toSlot: SlotPosition.LEFT,
        swappedCardInstanceId: undefined,
      },
    ]);
    expect(result?.gameState.eventLog.map((entry) => entry.event.cause)).toEqual([
      {
        kind: 'CARD_EFFECT',
        playerId: 'p1',
        sourceCardId: 'source-card',
        abilityId: 'formation-ability',
        pendingAbilityId: 'pending-formation',
      },
      {
        kind: 'CARD_EFFECT',
        playerId: 'p1',
        sourceCardId: 'source-card',
        abilityId: 'formation-ability',
        pendingAbilityId: 'pending-formation',
      },
      {
        kind: 'CARD_EFFECT',
        playerId: 'p1',
        sourceCardId: 'source-card',
        abilityId: 'formation-ability',
        pendingAbilityId: 'pending-formation',
      },
    ]);
  });

  it('replays formation move history but only final slot changes count as moved', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-B'), 'p1', 'member-b');
    const memberC = createCardInstance(createMemberCard('MEM-C'), 'p1', 'member-c');
    let game = createGameState('member-state-formation-history', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB, memberC]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId),
          SlotPosition.CENTER,
          memberB.instanceId
        ),
        SlotPosition.RIGHT,
        memberC.instanceId
      ),
    }));

    const result = rearrangeStageMembersByMoveHistory(game, 'p1', [
      { cardId: memberB.instanceId, toSlot: SlotPosition.LEFT },
      { cardId: memberC.instanceId, toSlot: SlotPosition.LEFT },
      { cardId: memberB.instanceId, toSlot: SlotPosition.CENTER },
    ]);

    expect(result).not.toBeNull();
    expect(result?.gameState.players[0].memberSlots.slots).toMatchObject({
      [SlotPosition.LEFT]: memberC.instanceId,
      [SlotPosition.CENTER]: memberB.instanceId,
      [SlotPosition.RIGHT]: memberA.instanceId,
    });
    expect(result?.rearrangedMembers.map((member) => member.cardId)).toEqual([
      memberA.instanceId,
      memberC.instanceId,
    ]);
    expect(result?.rearrangedMembers).not.toContainEqual(
      expect.objectContaining({ cardId: memberB.instanceId })
    );
    expect(result?.gameState.players[0].positionMovedThisTurn).toEqual([
      memberA.instanceId,
      memberC.instanceId,
    ]);
    expect(result?.gameState.eventLog.map((entry) => entry.event.cardInstanceId)).toEqual([
      memberA.instanceId,
      memberC.instanceId,
    ]);
  });

  it('ignores same-slot formation move history entries', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    let game = createGameState('member-state-formation-same-slot', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId),
    }));

    const result = rearrangeStageMembersByMoveHistory(game, 'p1', [
      { cardId: memberA.instanceId, toSlot: SlotPosition.LEFT },
    ]);

    expect(result).not.toBeNull();
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      memberA.instanceId
    );
    expect(result?.rearrangedMembers).toEqual([]);
    expect(result?.gameState.players[0].positionMovedThisTurn).toEqual([]);
    expect(result?.gameState.eventLog).toEqual([]);
  });

  it('replays formation move history by exact cardId even when member names match', () => {
    const memberA = createCardInstance(createMemberCard('MEM-SAME'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-SAME'), 'p1', 'member-b');
    let game = createGameState('member-state-formation-same-name', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId),
        SlotPosition.CENTER,
        memberB.instanceId
      ),
    }));

    const result = rearrangeStageMembersByMoveHistory(game, 'p1', [
      { cardId: memberB.instanceId, toSlot: SlotPosition.RIGHT },
    ]);

    expect(result).not.toBeNull();
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      memberA.instanceId
    );
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      memberB.instanceId
    );
    expect(result?.rearrangedMembers).toEqual([
      {
        cardId: memberB.instanceId,
        fromSlot: SlotPosition.CENTER,
        toSlot: SlotPosition.RIGHT,
      },
    ]);
  });

  it('rearranges stage members to a layout with an empty slot and keeps attached cards with hosts', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-B'), 'p1', 'member-b');
    const energyA = createCardInstance(createEnergyCard('ENE-A'), 'p1', 'energy-a');
    const belowMemberB = createCardInstance(createMemberCard('MEM-BELOW'), 'p1', 'member-below');
    let game = createGameState('member-state-formation-empty-slot', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB, energyA, belowMemberB]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, memberA.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, memberB.instanceId);
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.LEFT, energyA.instanceId);
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, belowMemberB.instanceId);
      return { ...player, memberSlots };
    });

    const result = rearrangeStageMembers(game, 'p1', [
      { cardId: memberA.instanceId, toSlot: SlotPosition.RIGHT },
      { cardId: memberB.instanceId, toSlot: SlotPosition.LEFT },
    ]);

    expect(result).not.toBeNull();
    expect(result?.gameState.players[0].memberSlots.slots).toMatchObject({
      [SlotPosition.LEFT]: memberB.instanceId,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: memberA.instanceId,
    });
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual([
      energyA.instanceId,
    ]);
    expect(result?.gameState.players[0].memberSlots.memberBelow[SlotPosition.LEFT]).toEqual([
      belowMemberB.instanceId,
    ]);
    expect(result?.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(result?.gameState.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
  });

  it('rejects invalid atomic stage rearrangements', () => {
    const ownMember = createCardInstance(createMemberCard('MEM-A'), 'p1', 'own-member');
    const ownWaitingMember = createCardInstance(createMemberCard('MEM-B'), 'p1', 'waiting-member');
    const opponentMember = createCardInstance(createMemberCard('MEM-C'), 'p2', 'opponent-member');
    let game = createGameState('member-state-formation-invalid', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [ownMember, ownWaitingMember, opponentMember]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, ownMember.instanceId),
      waitingRoom: { ...player.waitingRoom, cardIds: [ownWaitingMember.instanceId] },
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, opponentMember.instanceId),
    }));

    expect(
      rearrangeStageMembers(game, 'p1', [
        { cardId: ownMember.instanceId, toSlot: SlotPosition.CENTER },
        { cardId: ownMember.instanceId, toSlot: SlotPosition.RIGHT },
      ])
    ).toBeNull();
    expect(
      rearrangeStageMembers(game, 'p1', [
        { cardId: ownMember.instanceId, toSlot: SlotPosition.CENTER },
        { cardId: ownWaitingMember.instanceId, toSlot: SlotPosition.RIGHT },
      ])
    ).toBeNull();
    expect(
      rearrangeStageMembers(game, 'p1', [
        { cardId: ownMember.instanceId, toSlot: SlotPosition.CENTER },
        { cardId: opponentMember.instanceId, toSlot: SlotPosition.RIGHT },
      ])
    ).toBeNull();
    expect(
      rearrangeStageMembersByMoveHistory(game, 'p1', [
        { cardId: ownWaitingMember.instanceId, toSlot: SlotPosition.CENTER },
      ])
    ).toBeNull();
    expect(
      rearrangeStageMembersByMoveHistory(game, 'p1', [
        { cardId: opponentMember.instanceId, toSlot: SlotPosition.CENTER },
      ])
    ).toBeNull();
    expect(
      rearrangeStageMembersByMoveHistory(game, 'p1', [
        { cardId: ownMember.instanceId, toSlot: 'INVALID_SLOT' as SlotPosition },
      ])
    ).toBeNull();
    expect(
      rearrangeStageMembersByMoveHistory(
        game,
        'p1',
        [{ cardId: ownMember.instanceId, toSlot: SlotPosition.CENTER }],
        {
          expectedPlacements: [{ cardId: ownMember.instanceId, toSlot: SlotPosition.RIGHT }],
        }
      )
    ).toBeNull();
    expect(game.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(ownMember.instanceId);
  });

  it('plays members from waiting room to empty slots without using normal entry payment', () => {
    const memberA = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    const memberB = createCardInstance(createMemberCard('MEM-B'), 'p1', 'member-b');
    let game = createGameState('member-state-play-from-waiting', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [memberA, memberB]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [memberA.instanceId, memberB.instanceId],
      },
    }));

    const result = playMembersFromWaitingRoomToEmptySlots(game, 'p1', [
      { cardId: memberA.instanceId, toSlot: SlotPosition.LEFT },
      { cardId: memberB.instanceId, toSlot: SlotPosition.CENTER },
    ]);

    expect(result).not.toBeNull();
    expect(result?.playedMembers.map((member) => member.cardId)).toEqual([
      memberA.instanceId,
      memberB.instanceId,
    ]);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([]);
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      memberA.instanceId
    );
    expect(result?.gameState.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      memberB.instanceId
    );
    expect(
      result?.gameState.players[0].memberSlots.cardStates.get(memberA.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('does not emit member events when helper validation fails', () => {
    const member = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    let game = createGameState('member-state-failed-event', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);

    expect(setMemberOrientation(game, 'p1', member.instanceId, OrientationState.WAITING)).toBeNull();
    expect(moveMemberBetweenSlots(game, 'p1', member.instanceId, SlotPosition.RIGHT)).toBeNull();
    expect(game.eventLog).toEqual([]);
  });

  it('queries whether a member position-moved this turn from the turn record only', () => {
    const member = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    let game = createGameState('member-turn-position-moved-query', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);

    expect(hasMemberPositionMovedThisTurn(game, 'p1', member.instanceId)).toBe(false);
    expect(hasMemberPositionMovedThisTurn(game, 'missing-player', member.instanceId)).toBe(false);

    game = updatePlayer(game, 'p1', (player) => recordPositionMove(player, member.instanceId));

    expect(hasMemberPositionMovedThisTurn(game, 'p1', member.instanceId)).toBe(true);
  });

  it('does not treat moved-to-stage records as member position moves', () => {
    const member = createCardInstance(createMemberCard('MEM-A'), 'p1', 'member-a');
    let game = createGameState('member-turn-enter-stage-not-position-moved', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...recordMoveToStage(player, member.instanceId),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
    }));

    expect(hasMemberPositionMovedThisTurn(game, 'p1', member.instanceId)).toBe(false);
    expect(getPositionMovedStageMemberIdsMatching(game, 'p1', () => true)).toEqual([]);
  });

  it('queries current stage members that position-moved this turn and match the selector', () => {
    const liellaMoved = createCardInstance(
      { ...createMemberCard('MEM-A'), groupName: 'Liella!' },
      'p1',
      'liella-moved'
    );
    const museMoved = createCardInstance(
      { ...createMemberCard('MEM-B'), groupName: "μ's" },
      'p1',
      'muse-moved'
    );
    const liellaNotMoved = createCardInstance(
      { ...createMemberCard('MEM-C'), groupName: 'Liella!' },
      'p1',
      'liella-not-moved'
    );
    const liellaLeftStage = createCardInstance(
      { ...createMemberCard('MEM-D'), groupName: 'Liella!' },
      'p1',
      'liella-left-stage'
    );
    let game = createGameState('member-turn-position-moved-stage-targets', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [liellaMoved, museMoved, liellaNotMoved, liellaLeftStage]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        liellaMoved.instanceId
      );
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, museMoved.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, liellaNotMoved.instanceId);
      let nextPlayer = recordPositionMove(player, liellaMoved.instanceId);
      nextPlayer = recordPositionMove(nextPlayer, museMoved.instanceId);
      nextPlayer = recordPositionMove(nextPlayer, liellaLeftStage.instanceId);
      return { ...nextPlayer, memberSlots };
    });

    expect(
      getPositionMovedStageMemberIdsMatching(game, 'p1', (card) => card.data.groupName === 'Liella!')
    ).toEqual([liellaMoved.instanceId]);
    expect(getPositionMovedStageMemberIdsMatching(game, 'p1', () => true)).toEqual([
      liellaMoved.instanceId,
      museMoved.instanceId,
    ]);

    const leftStageGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));

    expect(getPositionMovedStageMemberIdsMatching(leftStageGame, 'p1', () => true)).toEqual([
      museMoved.instanceId,
    ]);
  });
});
