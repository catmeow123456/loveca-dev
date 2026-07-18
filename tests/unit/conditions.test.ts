import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  addMemberCostLiveModifierForMember,
  addMemberCostSetLiveModifierForMember,
} from '../../src/domain/rules/live-modifiers';
import {
  cardNameAliasIs,
  costGte,
  costLte,
  groupAliasIs,
  typeIs,
  unitAliasIs,
} from '../../src/application/effects/card-selectors';
import {
  allCardIdsMatchingSelector,
  countCardIdsMatchingSelectors,
  countCardsInZoneMatching,
  countCardsInZone,
  countCardsMatchingSelector,
  countOtherLiveZoneCardsMatching,
  countStageMembers,
  countSuccessfulLiveCards,
  getCardIdsInZone,
  getCardIdsInZoneMatching,
  getCardIdsMatchingSelector,
  getMemberEffectiveCost,
  getSourceEffectiveBladeCount,
  hasAtLeastCardsMatchingSelector,
  hasCardIdsMatchingSelector,
  hasCardInZoneMatching,
  hasOtherStageMember,
  hasStageMemberMatching,
  sourceHasBladeAtLeast,
  sumStageMemberEffectiveCostMatching,
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
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
    const museMember = memberCard('muse-member', { groupNames: ["μ's"] });
    const hasunosoraMember = memberCard('hasunosora-member', {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
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

  it('counts a selected card id list against multiple selectors', () => {
    const member = memberCard('group-count-member');
    const live = liveCard('group-count-live');
    const missingCardId = 'missing-card';

    let game = createGameState('conditions-selector-groups', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);

    expect(
      countCardIdsMatchingSelectors(
        game,
        [member.instanceId, live.instanceId, missingCardId],
        [typeIs(CardType.MEMBER), typeIs(CardType.LIVE)]
      )
    ).toEqual([1, 1]);
    expect(countCardIdsMatchingSelectors(game, [missingCardId], [typeIs(CardType.MEMBER)])).toEqual(
      [0]
    );
    expect(countCardIdsMatchingSelectors(game, [member.instanceId], [])).toEqual([]);
  });

  it('checks any and all card id matches without treating empty or missing cards as all-matched', () => {
    const member = memberCard('selector-member');
    const live = liveCard('selector-live');
    const missingCardId = 'missing-card';

    let game = createGameState('conditions-card-id-any-all', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);

    expect(
      hasCardIdsMatchingSelector(game, [member.instanceId, live.instanceId], typeIs(CardType.LIVE))
    ).toBe(true);
    expect(hasCardIdsMatchingSelector(game, [member.instanceId], typeIs(CardType.LIVE))).toBe(
      false
    );
    expect(hasCardIdsMatchingSelector(game, [missingCardId], typeIs(CardType.LIVE))).toBe(false);
    expect(allCardIdsMatchingSelector(game, [member.instanceId], typeIs(CardType.MEMBER))).toBe(
      true
    );
    expect(
      allCardIdsMatchingSelector(
        game,
        [member.instanceId, live.instanceId],
        typeIs(CardType.MEMBER)
      )
    ).toBe(false);
    expect(allCardIdsMatchingSelector(game, [missingCardId], typeIs(CardType.MEMBER))).toBe(false);
    expect(allCardIdsMatchingSelector(game, [], typeIs(CardType.MEMBER))).toBe(false);
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

  it('sums successful Live scores and ignores missing or non-Live cards', () => {
    const scoreSixLive = liveCard('score-six-live', { score: 6 });
    const scoreThreeLive = liveCard('score-three-live', { score: 3 });
    const nonLiveCard = memberCard('success-zone-member', { cost: 9 });

    let game = createGameState('conditions-success-live-score', 'p1', 'P1', 'p2', 'P2');

    expect(sumSuccessfulLiveScore(game, 'p1')).toBe(0);
    expect(successLiveScoreAtLeast(game, 'p1', 6)).toBe(false);

    game = registerCards(game, [scoreSixLive, scoreThreeLive, nonLiveCard]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: {
        ...player.successZone,
        cardIds: [
          scoreSixLive.instanceId,
          'missing-success-live',
          nonLiveCard.instanceId,
          scoreThreeLive.instanceId,
        ],
      },
    }));

    expect(sumSuccessfulLiveScore(game, 'p1')).toBe(9);
    expect(successLiveScoreAtLeast(game, 'p1', 6)).toBe(true);
    expect(successLiveScoreAtLeast(game, 'p1', 9)).toBe(true);
    expect(successLiveScoreAtLeast(game, 'p1', 10)).toBe(false);
  });

  it('filters, counts, and checks cards in zones through selectors', () => {
    const waitingMember = memberCard('zone-waiting-member');
    const waitingLive = liveCard('zone-waiting-live');
    const handLive = liveCard('zone-hand-live');

    let game = createGameState('conditions-zone-selector', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [waitingMember, waitingLive, handLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [waitingMember.instanceId, waitingLive.instanceId, 'missing-zone-card'],
      },
      hand: {
        ...player.hand,
        cardIds: [handLive.instanceId],
      },
    }));

    expect(
      getCardIdsInZoneMatching(game, 'p1', ZoneType.WAITING_ROOM, typeIs(CardType.LIVE))
    ).toEqual([waitingLive.instanceId]);
    expect(
      countCardsInZoneMatching(game, 'p1', ZoneType.WAITING_ROOM, typeIs(CardType.MEMBER))
    ).toBe(1);
    expect(hasCardInZoneMatching(game, 'p1', ZoneType.WAITING_ROOM, typeIs(CardType.LIVE))).toBe(
      true
    );
    expect(
      hasCardInZoneMatching(game, 'p1', ZoneType.WAITING_ROOM, cardNameAliasIs('百生吟子'))
    ).toBe(false);
    expect(
      hasCardInZoneMatching(game, 'unknown-player', ZoneType.WAITING_ROOM, typeIs(CardType.LIVE))
    ).toBe(false);
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

  it('reads PL!-bp4-008 effective cost only while the source member is on stage and success Live score is at least 6', () => {
    const hanayo = memberCard('bp4-008-hanayo', {
      cardCode: 'PL!-bp4-008-P',
      name: '小泉花阳',
      cost: 4,
    });
    const otherMember = memberCard('other-cost-member', {
      cardCode: 'PL!-bp4-009-P',
      name: '其他成员',
      cost: 4,
    });
    const scoreSixLive = liveCard('bp4-008-score-six-live', { score: 6 });

    let game = createGameState('conditions-effective-cost', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hanayo, otherMember, scoreSixLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanayo.instanceId),
      successZone: {
        ...player.successZone,
        cardIds: [scoreSixLive.instanceId],
      },
    }));

    expect(getMemberEffectiveCost(game, 'p1', hanayo.instanceId)).toBe(7);
    expect(costLte(4)(hanayo)).toBe(true);
    expect(costGte(7)(hanayo)).toBe(false);

    const scoreShortGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: {
        ...player.successZone,
        cardIds: [],
      },
    }));
    expect(getMemberEffectiveCost(scoreShortGame, 'p1', hanayo.instanceId)).toBe(4);

    const waitingRoomGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [hanayo.instanceId],
      },
    }));
    expect(getMemberEffectiveCost(waitingRoomGame, 'p1', hanayo.instanceId)).toBe(4);

    const otherMemberGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, otherMember.instanceId),
    }));
    expect(getMemberEffectiveCost(otherMemberGame, 'p1', otherMember.instanceId)).toBe(4);
  });

  it('applies PL!-bp4-008 effective cost to synced rarities by base card code', () => {
    const hanayoR = memberCard('bp4-008-hanayo-r', {
      cardCode: 'PL!-bp4-008-R',
      name: '小泉花阳',
      cost: 4,
    });
    const scoreSixLive = liveCard('bp4-008-r-score-six-live', { score: 6 });

    let game = createGameState('conditions-effective-cost-rarity', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hanayoR, scoreSixLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanayoR.instanceId),
      successZone: {
        ...player.successZone,
        cardIds: [scoreSixLive.instanceId],
      },
    }));

    expect(getMemberEffectiveCost(game, 'p1', hanayoR.instanceId)).toBe(7);
  });

  it('applies PL!S-bp3-016-N success Live count only while it is the controller stage member', () => {
    const hanamaru = memberCard('s-bp3-016-hanamaru', {
      cardCode: 'PL!S-bp3-016-N', name: '国木田花丸', cost: 4,
    });
    const otherMember = memberCard('s-bp3-016-other', { cost: 4 });
    const successLives = [liveCard('success-a'), liveCard('success-b'), liveCard('success-c')];
    let game = createGameState('s-bp3-016-effective-cost', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hanamaru, otherMember, ...successLives]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanamaru.instanceId),
    }));

    expect(getMemberEffectiveCost(game, 'p1', hanamaru.instanceId)).toBe(4);
    const oneSuccess = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [successLives[0].instanceId] },
    }));
    expect(getMemberEffectiveCost(oneSuccess, 'p1', hanamaru.instanceId)).toBe(5);
    const threeSuccess = updatePlayer(oneSuccess, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: successLives.map((card) => card.instanceId) },
    }));
    expect(getMemberEffectiveCost(threeSuccess, 'p1', hanamaru.instanceId)).toBe(7);
    expect(getMemberEffectiveCost(threeSuccess, 'p2', hanamaru.instanceId)).toBe(4);
    expect(getMemberEffectiveCost(threeSuccess, 'p1', otherMember.instanceId)).toBe(4);

    const opponentSuccessOnly = updatePlayer(game, 'p2', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: successLives.map((card) => card.instanceId) },
    }));
    expect(getMemberEffectiveCost(opponentSuccessOnly, 'p1', hanamaru.instanceId)).toBe(4);
    const removedSuccess = updatePlayer(threeSuccess, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [successLives[0].instanceId] },
    }));
    expect(getMemberEffectiveCost(removedSuccess, 'p1', hanamaru.instanceId)).toBe(5);

    for (const zone of ['hand', 'waitingRoom'] as const) {
      const offStage = updatePlayer(threeSuccess, 'p1', (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        [zone]: { ...player[zone], cardIds: [hanamaru.instanceId] },
      }));
      expect(getMemberEffectiveCost(offStage, 'p1', hanamaru.instanceId)).toBe(4);
    }
    const belowStage = updatePlayer(threeSuccess, 'p1', (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(
        placeCardInSlot(
          removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
          SlotPosition.CENTER,
          otherMember.instanceId
        ),
        SlotPosition.CENTER,
        hanamaru.instanceId
      ),
    }));
    expect(getMemberEffectiveCost(belowStage, 'p1', hanamaru.instanceId)).toBe(4);

    const deltaResult = addMemberCostLiveModifierForMember(threeSuccess, {
      playerId: 'p1', memberCardId: hanamaru.instanceId, sourceCardId: hanamaru.instanceId,
      abilityId: 'test-s-bp3-016-delta', countDelta: 2,
    });
    expect(getMemberEffectiveCost(deltaResult!.gameState, 'p1', hanamaru.instanceId)).toBe(9);
    const setResult = addMemberCostSetLiveModifierForMember(deltaResult!.gameState, {
      playerId: 'p1', memberCardId: hanamaru.instanceId, sourceCardId: hanamaru.instanceId,
      abilityId: 'test-s-bp3-016-set', setTo: 6,
    });
    expect(getMemberEffectiveCost(setResult!.gameState, 'p1', hanamaru.instanceId)).toBe(6);
  });

  it('adds PL!SP-pb2-006 cost by same-slot memberBelow Liella members only while on stage', () => {
    const kinako = memberCard('sp-pb2-006-kinako', {
      cardCode: 'PL!SP-pb2-006-R',
      name: '桜小路きな子',
      cost: 2,
      groupNames: ['Liella!'],
    });
    const liellaA = memberCard('sp-pb2-006-liella-a', {
      cardCode: 'PL!SP-pb2-006-liella-a',
      groupNames: ['Liella!'],
    });
    const liellaB = memberCard('sp-pb2-006-liella-b', {
      cardCode: 'PL!SP-pb2-006-liella-b',
      groupNames: ['ラブライブ！スーパースター!!'],
    });
    const nonLiella = memberCard('sp-pb2-006-non-liella', {
      cardCode: 'PL!N-pb2-006-non-liella',
      groupNames: ['虹咲学園スクールアイドル同好会'],
    });
    const liveBelow = liveCard('sp-pb2-006-live-below', { groupNames: ['Liella!'] });
    const otherSlotLiella = memberCard('sp-pb2-006-other-slot-liella', {
      cardCode: 'PL!SP-pb2-006-other-slot-liella',
      groupNames: ['Liella!'],
    });

    let game = createGameState('conditions-sp-pb2-006-cost', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kinako, liellaA, liellaB, nonLiella, liveBelow, otherSlotLiella]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kinako.instanceId);
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, liellaA.instanceId);
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, liellaB.instanceId);
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, nonLiella.instanceId);
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, liveBelow.instanceId);
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.RIGHT, otherSlotLiella.instanceId);
      return { ...player, memberSlots };
    });

    expect(getMemberEffectiveCost(game, 'p1', kinako.instanceId)).toBe(4);

    const offStage = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [kinako.instanceId],
      },
    }));
    expect(getMemberEffectiveCost(offStage, 'p1', kinako.instanceId)).toBe(2);
  });

  it('reads temporary member cost live modifiers through the application condition helper', () => {
    const sayaka = memberCard('pb1-002-sayaka-cost-modifier', {
      cardCode: 'PL!HS-pb1-002-R',
      name: '村野さやか',
      cost: 2,
    });
    let game = createGameState('conditions-member-cost-live-modifier', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [sayaka]);
    const result = addMemberCostLiveModifierForMember(game, {
      playerId: 'p1',
      memberCardId: sayaka.instanceId,
      sourceCardId: sayaka.instanceId,
      abilityId: 'test-member-cost',
      countDelta: 12,
    });

    expect(result).not.toBeNull();
    expect(getMemberEffectiveCost(result!.gameState, 'p1', sayaka.instanceId)).toBe(14);
  });

  it('sums effective cost for stage members that match a selector', () => {
    const hasunosora = memberCard('stage-hasunosora-cost', {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      cost: 10,
    });
    const hasunosoraWithModifier = memberCard('stage-hasunosora-modified-cost', {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      cost: 8,
    });
    const liella = memberCard('stage-liella-cost', {
      groupNames: ['ラブライブ！スーパースター!!'],
      cost: 7,
    });

    let game = createGameState('conditions-stage-effective-cost-sum', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hasunosora, hasunosoraWithModifier, liella]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, hasunosora.instanceId),
          SlotPosition.CENTER,
          hasunosoraWithModifier.instanceId
        ),
        SlotPosition.RIGHT,
        liella.instanceId
      ),
    }));
    const result = addMemberCostLiveModifierForMember(game, {
      playerId: 'p1',
      memberCardId: hasunosoraWithModifier.instanceId,
      sourceCardId: hasunosoraWithModifier.instanceId,
      abilityId: 'test-member-cost-sum',
      countDelta: 6,
    });

    expect(result).not.toBeNull();
    expect(sumStageMemberEffectiveCostMatching(result!.gameState, 'p1')).toBe(31);
    expect(
      sumStageMemberEffectiveCostMatching(result!.gameState, 'p1', groupAliasIs('蓮ノ空'))
    ).toBe(24);
    expect(sumStageMemberEffectiveCostMatching(result!.gameState, 'unknown-player')).toBe(0);
  });
});
