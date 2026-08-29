import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { and, costLte, typeIs } from '../../src/application/effects/card-selectors';
import {
  getStageMemberCardIdsByOrientation,
  getStageMemberCardIdsMatching,
  memberOriginalHeartLte,
} from '../../src/application/effects/stage-targets';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

function createMemberCard(
  cardCode: string,
  options: { readonly cost?: number; readonly heartCount?: number } = {}
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: 1,
    hearts:
      (options.heartCount ?? 1) > 0
        ? [createHeartIcon(HeartColor.PINK, options.heartCount ?? 1)]
        : [],
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
    expect(
      getStageMemberCardIdsByOrientation(game, 'missing-player', OrientationState.ACTIVE)
    ).toEqual([]);
  });

  it('combines static selectors with replacement-aware original HEART predicates', () => {
    const replacedAboveThreshold = createCardInstance(
      createMemberCard('PRINTED-ZERO-REPLACED-FOUR', { heartCount: 0 }),
      'p1',
      'printed-zero-replaced-four'
    );
    const replacedWithinThreshold = createCardInstance(
      createMemberCard('PRINTED-FOUR-REPLACED-TWO', { heartCount: 4 }),
      'p1',
      'printed-four-replaced-two'
    );
    const staticSelectorMismatch = createCardInstance(
      createMemberCard('HIGH-COST-PRINTED-ONE', { cost: 9, heartCount: 1 }),
      'p1',
      'high-cost-printed-one'
    );

    let game = createGameState('stage-targets-original-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [
      replacedAboveThreshold,
      replacedWithinThreshold,
      staticSelectorMismatch,
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, replacedAboveThreshold.instanceId),
          SlotPosition.CENTER,
          replacedWithinThreshold.instanceId
        ),
        SlotPosition.RIGHT,
        staticSelectorMismatch.instanceId
      ),
    }));
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: 'p1',
      memberCardId: replacedAboveThreshold.instanceId,
      hearts: [createHeartIcon(HeartColor.BLUE, 4)],
      sourceCardId: replacedAboveThreshold.instanceId,
      abilityId: 'test:replace-printed-zero-with-four',
    });
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: 'p1',
      memberCardId: replacedWithinThreshold.instanceId,
      hearts: [createHeartIcon(HeartColor.BLUE, 2)],
      sourceCardId: replacedWithinThreshold.instanceId,
      abilityId: 'test:replace-printed-four-with-two',
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PURPLE, 5)],
      sourceCardId: replacedWithinThreshold.instanceId,
      abilityId: 'test:ordinary-heart-bonus',
    });

    const memberSelector = typeIs(CardType.MEMBER);
    const lowCostMemberSelector = and(memberSelector, costLte(2));
    const originalHeartAtMostThree = memberOriginalHeartLte(3);

    expect(getStageMemberCardIdsMatching(game, 'p1', lowCostMemberSelector)).toEqual([
      replacedAboveThreshold.instanceId,
      replacedWithinThreshold.instanceId,
    ]);
    expect(
      getStageMemberCardIdsMatching(game, 'p1', memberSelector, originalHeartAtMostThree)
    ).toEqual([replacedWithinThreshold.instanceId, staticSelectorMismatch.instanceId]);
    expect(
      getStageMemberCardIdsMatching(game, 'p1', lowCostMemberSelector, originalHeartAtMostThree)
    ).toEqual([replacedWithinThreshold.instanceId]);
  });
});
