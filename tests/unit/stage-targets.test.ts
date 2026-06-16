import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { getStageMemberCardIdsByOrientation } from '../../src/application/effects/stage-targets';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
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

describe('stage target query helpers', () => {
  it('returns stage member card ids with the requested orientation', () => {
    const waitingMember = createCardInstance(createMemberCard('WAITING'), 'p1', 'waiting-member');
    const activeMember = createCardInstance(createMemberCard('ACTIVE'), 'p1', 'active-member');

    let game = createGameState('stage-targets-orientation', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [waitingMember, activeMember]);
    game = updatePlayer(game, 'p1', (player) => {
      const memberSlots = placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, waitingMember.instanceId),
        SlotPosition.RIGHT,
        activeMember.instanceId
      );
      const cardStates = new Map(memberSlots.cardStates);
      cardStates.set(waitingMember.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
      cardStates.set(activeMember.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
      return {
        ...player,
        memberSlots: {
          ...memberSlots,
          cardStates,
        },
      };
    });

    expect(getStageMemberCardIdsByOrientation(game, 'p1', OrientationState.WAITING)).toEqual([
      waitingMember.instanceId,
    ]);
    expect(getStageMemberCardIdsByOrientation(game, 'p1', OrientationState.ACTIVE)).toEqual([
      activeMember.instanceId,
    ]);
  });

  it('does not match empty slots, missing players, or members without card state', () => {
    const member = createCardInstance(createMemberCard('NO-STATE'), 'p1', 'no-state-member');

    let game = createGameState('stage-targets-missing-state', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
        cardStates: new Map(),
      },
    }));

    expect(getStageMemberCardIdsByOrientation(game, 'p1', OrientationState.ACTIVE)).toEqual([]);
    expect(getStageMemberCardIdsByOrientation(game, 'p1', OrientationState.WAITING)).toEqual([]);
    expect(getStageMemberCardIdsByOrientation(game, 'missing-player', OrientationState.ACTIVE)).toEqual([]);
  });
});
