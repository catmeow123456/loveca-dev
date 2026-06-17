import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  collectLiveModifiers,
  getLiveCardScoreModifier,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
  getPlayerLiveHeartModifiers,
  getPlayerLiveScoreModifier,
  replaceLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import { CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';

describe('live modifier helpers', () => {
  it('uses liveModifiers as the source for score projection without projecting source-member hearts', () => {
    let game = createGameState('live-modifier-projection', 'p1', 'P1', 'p2', 'P2');

    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: 'nico',
      abilityId: 'nico-score',
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      sourceCardId: 'kotori',
      abilityId: 'kotori-heart',
    });

    expect(game.liveResolution.liveModifiers).toEqual([
      {
        kind: 'SCORE',
        playerId: 'p1',
        countDelta: 1,
        sourceCardId: 'nico',
        abilityId: 'nico-score',
      },
      {
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        playerId: 'p1',
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
        sourceCardId: 'kotori',
        abilityId: 'kotori-heart',
      },
    ]);
    expect(game.liveResolution.playerScoreBonuses.get('p1')).toBe(1);
    expect(game.liveResolution.playerHeartBonuses.has('p1')).toBe(false);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1')).toEqual([]);
  });

  it('counts printed hearts plus source-member heart modifiers for the same source member', () => {
    const kotori = createCardInstance(
      {
        cardCode: 'PL!-sd1-003-SD',
        name: '南ことり',
        cardType: CardType.MEMBER,
        cost: 7,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'kotori'
    );
    let game = createGameState('live-member-effective-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kotori]);
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: 'kotori',
      abilityId: 'kotori-heart',
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      sourceCardId: 'other-source',
      abilityId: 'other-heart',
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p2',
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      sourceCardId: 'kotori',
      abilityId: 'opponent-heart',
    });

    expect(getMemberEffectiveHeartIcons(game, 'p1', 'kotori')).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.YELLOW, 1),
    ]);
  });

  it('separates total score modifiers from this-live-card score modifiers', () => {
    let game = createGameState('live-score-targets', 'p1', 'P1', 'p2', 'P2');

    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: 'nico',
      abilityId: 'nico-total-score',
    });
    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: 'p1',
      liveCardId: 'aokuharuka',
      countDelta: 1,
      sourceCardId: 'aokuharuka',
      abilityId: 'aokuharuka-this-card-score',
    });

    expect(getPlayerLiveScoreModifier(game.liveResolution, 'p1')).toBe(1);
    expect(getLiveCardScoreModifier(game.liveResolution, 'aokuharuka')).toBe(1);
  });

  it('replaces requirement modifiers and derives legacy requirement fields', () => {
    let game = createGameState('live-requirement-projection', 'p1', 'P1', 'p2', 'P2');
    const match = {
      kind: 'REQUIREMENT' as const,
      liveCardId: 'live-1',
      sourceCardId: 'live-1',
      abilityId: 'bokuima-requirement',
    };

    game = replaceLiveModifier(game, match, {
      ...match,
      kind: 'REQUIREMENT',
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -4 }],
    });

    expect(game.liveResolution.liveRequirementReductions.get('live-1')).toBe(4);
    expect(game.liveResolution.liveRequirementModifiers.get('live-1')).toEqual([
      { color: HeartColor.RAINBOW, countDelta: -4 },
    ]);

    game = replaceLiveModifier(game, match, null);

    expect(game.liveResolution.liveModifiers).toEqual([]);
    expect(game.liveResolution.liveRequirementReductions.has('live-1')).toBe(false);
    expect(game.liveResolution.liveRequirementModifiers.has('live-1')).toBe(false);
  });

  it('counts printed blade plus blade modifiers for the same source member', () => {
    const kaho = createCardInstance(
      {
        cardCode: 'PL!HS-pb1-009-R',
        name: '日野下花帆',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 4,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'kaho'
    );
    let game = createGameState('live-member-effective-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kaho]);
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: 'kaho',
      abilityId: 'kaho-auto',
    });
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 3,
      sourceCardId: 'other-source',
      abilityId: 'other-auto',
    });
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: 'p2',
      countDelta: 4,
      sourceCardId: 'kaho',
      abilityId: 'opponent-auto',
    });

    expect(getMemberEffectiveBladeCount(game, 'p1', 'kaho')).toBe(6);
  });

  it('collects PL!N-pb1-004 continuous blade when Karin has not position-moved this turn', () => {
    const karin = createCardInstance(
      {
        cardCode: 'PL!N-pb1-004-P+',
        name: '朝香 果林',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'karin'
    );
    let game = createGameState('live-karin-not-position-moved-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [karin]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      movedToStageThisTurn: ['karin'],
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'karin'),
    }));

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: 'karin',
      abilityId: 'PL!N-pb1-004:continuous-not-position-moved-gain-two-blade',
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', 'karin')).toBe(3);

    const movedGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      positionMovedThisTurn: ['karin'],
    }));

    expect(
      collectLiveModifiers(movedGame).some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === 'PL!N-pb1-004:continuous-not-position-moved-gain-two-blade'
      )
    ).toBe(false);
    expect(getMemberEffectiveBladeCount(movedGame, 'p1', 'karin')).toBe(1);
  });

  it('does not collect PL!-bp5-008 source-member Heart when successful LIVE score is less than 6', () => {
    const hanayo = createCardInstance(
      {
        cardCode: 'PL!-bp5-008-AR',
        name: '小泉花阳',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 0,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'hanayo'
    );
    const lowScoreLive = createCardInstance(
      {
        cardCode: 'LOW-SCORE-LIVE',
        name: 'Low Score Live',
        cardType: CardType.LIVE,
        score: 5,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'low-score-live'
    );

    let game = createGameState('bp5-008-low-score', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hanayo, lowScoreLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanayo.instanceId),
      successZone: addCardToZone(player.successZone, lowScoreLive.instanceId),
    }));

    expect(hasBp5008YellowHeartModifier(game)).toBe(false);
    expect(getMemberEffectiveHeartIcons(game, 'p1', hanayo.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
    ]);
  });

  it('collects PL!-bp5-008 as SOURCE_MEMBER yellow Heart +2 at successful LIVE score 6', () => {
    const hanayo = createCardInstance(
      {
        cardCode: 'PL!-bp5-008-P',
        name: '小泉花阳',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 0,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'hanayo'
    );
    const successLive = createCardInstance(
      {
        cardCode: 'SCORE-SIX-LIVE',
        name: 'Score Six Live',
        cardType: CardType.LIVE,
        score: 6,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'score-six-live'
    );

    let game = createGameState('bp5-008-score-six', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hanayo, successLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanayo.instanceId),
      successZone: addCardToZone(player.successZone, successLive.instanceId),
    }));

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.YELLOW, 2)],
      sourceCardId: hanayo.instanceId,
      abilityId: 'PL!-bp5-008:continuous-success-score-yellow-heart',
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', hanayo.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.YELLOW, 2),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('recomputes PL!-bp5-008 continuous Heart without leaving stale modifiers', () => {
    const hanayo = createCardInstance(
      {
        cardCode: 'PL!-bp5-008-R',
        name: '小泉花阳',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 0,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'hanayo'
    );
    const successLive = createCardInstance(
      {
        cardCode: 'SCORE-SIX-LIVE',
        name: 'Score Six Live',
        cardType: CardType.LIVE,
        score: 6,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'score-six-live'
    );

    let game = createGameState('bp5-008-dynamic', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hanayo, successLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanayo.instanceId),
      successZone: addCardToZone(player.successZone, successLive.instanceId),
    }));

    expect(hasBp5008YellowHeartModifier(game)).toBe(true);

    const belowThresholdGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [] },
    }));

    expect(hasBp5008YellowHeartModifier(belowThresholdGame)).toBe(false);
    expect(getMemberEffectiveHeartIcons(belowThresholdGame, 'p1', hanayo.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
    ]);
  });

  it('collects PL!HS-bp1-003 continuous score only for three different Hasunosora members', () => {
    const kozue = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13),
      'p1',
      'kozue'
    );
    const kaho = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp6-001-R＋', '日野下花帆', 4),
      'p1',
      'kaho'
    );
    const sayaka = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp1-002-RM', '村野沙耶香', 11),
      'p1',
      'sayaka'
    );
    const secondKaho = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp5-001-SEC', '日野下花帆', 11),
      'p1',
      'second-kaho'
    );

    let game = createGameState('hs-bp1-003-continuous-score', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kozue, kaho, sayaka, secondKaho]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, kaho.instanceId),
          SlotPosition.CENTER,
          kozue.instanceId
        ),
        SlotPosition.RIGHT,
        sayaka.instanceId
      ),
    }));

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: kozue.instanceId,
      abilityId: 'PL!HS-bp1-003-SEC:continuous-three-different-hasunosora-score',
    });

    const duplicateNameGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, kaho.instanceId),
          SlotPosition.CENTER,
          kozue.instanceId
        ),
        SlotPosition.RIGHT,
        secondKaho.instanceId
      ),
    }));

    expect(
      collectLiveModifiers(duplicateNameGame).some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === 'PL!HS-bp1-003-SEC:continuous-three-different-hasunosora-score'
      )
    ).toBe(false);
  });

  it('recognizes Hasunosora members by group aliases, text alias, and PL!HS fallback', () => {
    const identityCases = [
      {
        label: 'group-aliases',
        left: createHasunosoraMemberData('OTHER-HS-CN', '日野下花帆', 4, {
          groupName: '莲之空',
        }),
        center: createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13, {
          groupName: '蓮ノ空',
        }),
        right: createHasunosoraMemberData('OTHER-HS-JP', '村野沙耶香', 11, {
          groupName: '蓮ノ空女学院スクールアイドルクラブ',
        }),
      },
      {
        label: 'card-text',
        left: createHasunosoraMemberData('OTHER-HS-TEXT-1', '日野下花帆', 4, {
          groupName: undefined,
          cardText: 'Hasunosora のメンバー。',
        }),
        center: createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13, {
          groupName: undefined,
          cardText: 'Hasunosora のメンバー。',
        }),
        right: createHasunosoraMemberData('OTHER-HS-TEXT-2', '村野沙耶香', 11, {
          groupName: undefined,
          cardText: 'Hasunosora のメンバー。',
        }),
      },
      {
        label: 'card-code-fallback',
        left: createHasunosoraMemberData('PL!HS-test-left', '日野下花帆', 4, {
          groupName: undefined,
        }),
        center: createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13, {
          groupName: undefined,
        }),
        right: createHasunosoraMemberData('PL!HS-test-right', '村野沙耶香', 11, {
          groupName: undefined,
        }),
      },
    ] as const;

    for (const { label, left, center, right } of identityCases) {
      const leftCard = createCardInstance(left, 'p1', `${label}-left`);
      const centerCard = createCardInstance(center, 'p1', `${label}-center`);
      const rightCard = createCardInstance(right, 'p1', `${label}-right`);

      let game = createGameState(`hs-bp1-003-${label}`, 'p1', 'P1', 'p2', 'P2');
      game = registerCards(game, [leftCard, centerCard, rightCard]);
      game = updatePlayer(game, 'p1', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          placeCardInSlot(
            placeCardInSlot(player.memberSlots, SlotPosition.LEFT, leftCard.instanceId),
            SlotPosition.CENTER,
            centerCard.instanceId
          ),
          SlotPosition.RIGHT,
          rightCard.instanceId
        ),
      }));

      expect(hasHsBp1ContinuousScore(game)).toBe(true);
    }
  });

  it('does not collect PL!HS-bp1-003 score from non-member Hasunosora cards', () => {
    const kozue = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13),
      'p1',
      'kozue'
    );
    const kaho = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp6-001-R＋', '日野下花帆', 4),
      'p1',
      'kaho'
    );
    const live = createCardInstance(
      createHasunosoraLiveData('PL!HS-test-live', 'Hasunosora Live'),
      'p1',
      'hasunosora-live'
    );

    let game = createGameState('hs-bp1-003-non-member', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kozue, kaho, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, kaho.instanceId),
          SlotPosition.CENTER,
          kozue.instanceId
        ),
        SlotPosition.RIGHT,
        live.instanceId
      ),
    }));

    expect(hasHsBp1ContinuousScore(game)).toBe(false);
  });

  it('does not collect PL!HS-bp1-003 score unless all three member slots are filled', () => {
    const kozue = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13),
      'p1',
      'kozue'
    );
    const kaho = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp6-001-R＋', '日野下花帆', 4),
      'p1',
      'kaho'
    );

    let game = createGameState('hs-bp1-003-missing-slot', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kozue, kaho]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, kaho.instanceId),
        SlotPosition.CENTER,
        kozue.instanceId
      ),
    }));

    expect(hasHsBp1ContinuousScore(game)).toBe(false);
  });
});

function hasHsBp1ContinuousScore(game: ReturnType<typeof createGameState>): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === 'PL!HS-bp1-003-SEC:continuous-three-different-hasunosora-score'
  );
}

function hasBp5008YellowHeartModifier(game: ReturnType<typeof createGameState>): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.target === 'SOURCE_MEMBER' &&
      modifier.abilityId === 'PL!-bp5-008:continuous-success-score-yellow-heart'
  );
}

function createHasunosoraMemberData(
  cardCode: string,
  name: string,
  cost: number,
  options: {
    readonly groupName?: string;
    readonly cardText?: string;
  } = {}
) {
  const groupName = 'groupName' in options ? options.groupName : '莲之空';
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
    groupName,
    cardText: options.cardText,
  };
}

function createHasunosoraLiveData(cardCode: string, name: string) {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
    cardText: 'Hasunosora のLIVE。',
  };
}
