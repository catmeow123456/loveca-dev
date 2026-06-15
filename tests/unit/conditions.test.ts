import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { cardNameAliasIs, typeIs, unitAliasIs } from '../../src/application/effects/card-selectors';
import {
  countCardsInZone,
  countCardsMatchingSelector,
  countOtherLiveZoneCardsMatching,
  countStageMembers,
  countSuccessfulLiveCards,
  getCardIdsInZone,
  getCardIdsMatchingSelector,
  getSourceEffectiveBladeCount,
  hasAtLeastCardsMatchingSelector,
  hasOtherStageMember,
  hasStageMemberMatching,
  sourceHasBladeAtLeast,
} from '../../src/application/effects/conditions';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { CardType, HeartColor, SlotPosition, ZoneType } from '../../src/shared/types/enums';

function memberCard(instanceId: string, overrides: Partial<MemberCardData> = {}) {
  return createCardInstance(
    {
      cardCode: instanceId,
      name: instanceId,
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      ...overrides,
    },
    'p1',
    instanceId
  );
}

function liveCard(instanceId: string, overrides: Partial<LiveCardData> = {}) {
  return createCardInstance(
    {
      cardCode: instanceId,
      name: instanceId,
      cardType: CardType.LIVE,
      score: 3,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      ...overrides,
    },
    'p1',
    instanceId
  );
}

describe('effect conditions', () => {
  it('counts and filters card id lists through selectors', () => {
    const museMember = memberCard('muse-member', { groupName: "μ's" });
    const hasunosoraMember = memberCard('hasunosora-member', {
      groupName: '蓮ノ空女学院スクールアイドルクラブ',
    });
    const live = liveCard('live-card');
    const missingCardId = 'missing-card';

    let game = createGameState('conditions-selector', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [museMember, hasunosoraMember, live]);

    const cardIds = [
      museMember.instanceId,
      hasunosoraMember.instanceId,
      live.instanceId,
      missingCardId,
    ];

    expect(getCardIdsMatchingSelector(game, cardIds, typeIs(CardType.MEMBER))).toEqual([
      museMember.instanceId,
      hasunosoraMember.instanceId,
    ]);
    expect(countCardsMatchingSelector(game, cardIds, typeIs(CardType.MEMBER))).toBe(2);
    expect(hasAtLeastCardsMatchingSelector(game, cardIds, typeIs(CardType.MEMBER), 2)).toBe(true);
    expect(hasAtLeastCardsMatchingSelector(game, cardIds, typeIs(CardType.MEMBER), 3)).toBe(false);
  });

  it('counts cards in player zones and successful Live cards', () => {
    const waitingMember = memberCard('waiting-member');
    const waitingLive = liveCard('waiting-live');
    const successLive = liveCard('success-live');

    let game = createGameState('conditions-zones', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [waitingMember, waitingLive, successLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [waitingMember.instanceId, waitingLive.instanceId],
      },
      successZone: {
        ...player.successZone,
        cardIds: [successLive.instanceId],
      },
    }));

    expect(getCardIdsInZone(game, 'p1', ZoneType.WAITING_ROOM)).toEqual([
      waitingMember.instanceId,
      waitingLive.instanceId,
    ]);
    expect(countCardsInZone(game, 'p1', ZoneType.WAITING_ROOM)).toBe(2);
    expect(countSuccessfulLiveCards(game, 'p1')).toBe(1);
    expect(countCardsInZone(game, 'unknown-player', ZoneType.WAITING_ROOM)).toBe(0);
  });

  it('checks stage member count, matching, and other-member presence', () => {
    const source = memberCard('source', { name: '百生 吟子' });
    const other = memberCard('other', { name: '日野下花帆' });

    let game = createGameState('conditions-stage', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, other]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
        SlotPosition.LEFT,
        other.instanceId
      ),
    }));

    expect(countStageMembers(game, 'p1')).toBe(2);
    expect(hasStageMemberMatching(game, 'p1', cardNameAliasIs('百生吟子'))).toBe(true);
    expect(
      hasStageMemberMatching(game, 'p1', cardNameAliasIs('百生吟子'), {
        excludeCardId: source.instanceId,
      })
    ).toBe(false);
    expect(hasOtherStageMember(game, 'p1', source.instanceId)).toBe(true);

    const sourceOnlyGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));

    expect(hasOtherStageMember(sourceOnlyGame, 'p1', source.instanceId)).toBe(false);
  });

  it('counts matching Live zone cards while excluding the source card', () => {
    const sourceLive = liveCard('source-live', { unitName: 'みらくらぱーく！' });
    const otherMiraCraLive = liveCard('other-miracra-live', { unitName: 'Mira-Cra Park!' });
    const ceriseLive = liveCard('cerise-live', { unitName: 'スリーズブーケ' });

    let game = createGameState('conditions-live-zone', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [sourceLive, otherMiraCraLive, ceriseLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: [sourceLive.instanceId, otherMiraCraLive.instanceId, ceriseLive.instanceId],
      },
    }));

    expect(
      countOtherLiveZoneCardsMatching(
        game,
        'p1',
        sourceLive.instanceId,
        unitAliasIs('Mira-Cra Park!')
      )
    ).toBe(1);
  });

  it('reads source effective BLADE including matching live modifiers', () => {
    const kaho = memberCard('kaho', {
      name: '日野下花帆',
      cost: 15,
      blade: 4,
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
    });

    let game = createGameState('conditions-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kaho]);
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: kaho.instanceId,
      abilityId: 'kaho-auto',
    });
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 3,
      sourceCardId: 'other-source',
      abilityId: 'other-auto',
    });

    expect(getSourceEffectiveBladeCount(game, 'p1', kaho.instanceId)).toBe(6);
    expect(sourceHasBladeAtLeast(game, 'p1', kaho.instanceId, 6)).toBe(true);
    expect(sourceHasBladeAtLeast(game, 'p1', kaho.instanceId, 7)).toBe(false);
  });
});
