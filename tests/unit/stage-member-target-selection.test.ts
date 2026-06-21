import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import type { PendingAbilityState } from '../../src/domain/entities/game';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { and, costLte, typeIs } from '../../src/application/effects/card-selectors';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../src/application/effects/stage-member-target-selection';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

function createMemberCard(cardCode: string, cost: number): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createPendingAbility(overrides: Partial<PendingAbilityState> = {}): PendingAbilityState {
  return {
    id: 'pending-stage-target',
    abilityId: 'test:stage-target',
    sourceCardId: 'source-card',
    controllerId: 'p1',
    mandatory: false,
    timingId: 'timing-1',
    eventIds: ['event-1'],
    sourceSlot: SlotPosition.CENTER,
    ...overrides,
  };
}

describe('stage member target selection helpers', () => {
  it('creates a stage member target active effect from selector matches', () => {
    const lowCostMember = createCardInstance(createMemberCard('LOW-COST', 9), 'p2', 'low-cost');
    const highCostMember = createCardInstance(createMemberCard('HIGH-COST', 10), 'p2', 'high-cost');
    let game = createGameState('stage-target-selection', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [lowCostMember, highCostMember]);
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, lowCostMember.instanceId),
        SlotPosition.RIGHT,
        highCostMember.instanceId
      ),
    }));

    const result = createStageMemberOrientationTargetSelection(game, {
      ability: createPendingAbility(),
      effectText: '选择目标成员。',
      stepId: 'SELECT_STAGE_MEMBER',
      stepText: '请选择目标成员。',
      awaitingPlayerId: 'p1',
      targetPlayerId: 'p2',
      selector: and(typeIs(CardType.MEMBER), costLte(9)),
      targetOrientation: OrientationState.WAITING,
      selectionLabel: '选择费用小于等于9的成员',
      orderedResolution: true,
    });

    expect(result.selectableCardIds).toEqual([lowCostMember.instanceId]);
    expect(result.activeEffect?.selectableCardIds).toEqual([lowCostMember.instanceId]);
    expect(result.activeEffect?.metadata?.stageMemberOrientationTarget).toBe(true);
    expect(result.activeEffect?.metadata?.targetPlayerId).toBe('p2');
    expect(result.activeEffect?.metadata?.targetOrientation).toBe(OrientationState.WAITING);
    expect(result.activeEffect?.metadata?.orderedResolution).toBe(true);
  });

  it('excludes matching stage members already in the target orientation', () => {
    const activeMember = createCardInstance(createMemberCard('ACTIVE-COST-4', 4), 'p2', 'active');
    const waitingMember = createCardInstance(
      createMemberCard('WAITING-COST-4', 4),
      'p2',
      'waiting'
    );
    let game = createGameState('stage-target-excludes-target-orientation', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [activeMember, waitingMember]);
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, activeMember.instanceId),
        SlotPosition.RIGHT,
        waitingMember.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      ),
    }));

    const result = createStageMemberOrientationTargetSelection(game, {
      ability: createPendingAbility(),
      effectText: '选择目标成员。',
      stepId: 'SELECT_STAGE_MEMBER',
      stepText: '请选择目标成员。',
      awaitingPlayerId: 'p1',
      targetPlayerId: 'p2',
      selector: and(typeIs(CardType.MEMBER), costLte(4)),
      targetOrientation: OrientationState.WAITING,
      selectionLabel: '选择费用小于等于4的成员',
      orderedResolution: false,
    });

    expect(result.selectableCardIds).toEqual([activeMember.instanceId]);
    expect(result.activeEffect?.selectableCardIds).toEqual([activeMember.instanceId]);
  });

  it('returns an empty start result when all matching stage members already have the target orientation', () => {
    const waitingMember = createCardInstance(
      createMemberCard('WAITING-COST-4', 4),
      'p2',
      'waiting'
    );
    let game = createGameState('stage-target-all-already-waiting', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [waitingMember]);
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        waitingMember.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      ),
    }));

    const result = createStageMemberOrientationTargetSelection(game, {
      ability: createPendingAbility(),
      effectText: '选择目标成员。',
      stepId: 'SELECT_STAGE_MEMBER',
      stepText: '请选择目标成员。',
      awaitingPlayerId: 'p1',
      targetPlayerId: 'p2',
      selector: and(typeIs(CardType.MEMBER), costLte(4)),
      targetOrientation: OrientationState.WAITING,
      selectionLabel: '选择费用小于等于4的成员',
      orderedResolution: false,
    });

    expect(result.selectableCardIds).toEqual([]);
    expect(result.activeEffect).toBeNull();
  });

  it('resolves the selected stage member orientation', () => {
    const member = createCardInstance(createMemberCard('TARGET', 8), 'p2', 'target');
    let game = createGameState('stage-target-resolve', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
    }));

    const result = createStageMemberOrientationTargetSelection(game, {
      ability: createPendingAbility(),
      effectText: '选择目标成员。',
      stepId: 'SELECT_STAGE_MEMBER',
      stepText: '请选择目标成员。',
      awaitingPlayerId: 'p1',
      targetPlayerId: 'p2',
      selector: typeIs(CardType.MEMBER),
      targetOrientation: OrientationState.WAITING,
      selectionLabel: '选择成员',
      orderedResolution: false,
    });
    const activeEffect = result.activeEffect;

    expect(activeEffect).not.toBeNull();
    expect(activeEffect ? getStageMemberOrientationTargetMetadata(activeEffect) : null).toEqual({
      targetPlayerId: 'p2',
      targetOrientation: OrientationState.WAITING,
    });

    const resolved = activeEffect
      ? resolveStageMemberOrientationTargetSelection(game, activeEffect, member.instanceId)
      : null;

    expect(resolved?.previousOrientation).toBe(OrientationState.ACTIVE);
    expect(resolved?.nextOrientation).toBe(OrientationState.WAITING);
    expect(
      resolved?.gameState.players[1].memberSlots.cardStates.get(member.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('returns an empty start result when no stage members match', () => {
    const member = createCardInstance(createMemberCard('HIGH-COST', 10), 'p2', 'high-cost');
    let game = createGameState('stage-target-no-match', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, member.instanceId),
    }));

    const result = createStageMemberOrientationTargetSelection(game, {
      ability: createPendingAbility(),
      effectText: '选择目标成员。',
      stepId: 'SELECT_STAGE_MEMBER',
      stepText: '请选择目标成员。',
      awaitingPlayerId: 'p1',
      targetPlayerId: 'p2',
      selector: and(typeIs(CardType.MEMBER), costLte(9)),
      targetOrientation: OrientationState.WAITING,
      selectionLabel: '选择费用小于等于9的成员',
      orderedResolution: false,
    });

    expect(result.selectableCardIds).toEqual([]);
    expect(result.activeEffect).toBeNull();
  });
});
