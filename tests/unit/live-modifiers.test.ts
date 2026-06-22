import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type LiveModifierState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  addHeartLiveModifierForMember,
  addMemberCostLiveModifierForMember,
  addLiveModifier,
  collectLiveModifiers,
  createHeartLiveModifierForMember,
  getLiveCardRequirementModifiers,
  getLiveCardScoreModifier,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
  getPlayerLiveHeartModifiers,
  getPlayerLiveScoreModifier,
  projectLiveModifierCompatibility,
  replaceLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { fromTransport, toTransport } from '../../src/online/serde';
import { CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';

const HS_BP5_002_CONTINUOUS_ABILITY_ID =
  'PL!HS-bp5-002:continuous-three-different-stage-member-costs-blue-heart-blade';
const HS_SD1_004_CONTINUOUS_ABILITY_ID =
  'PL!HS-sd1-004-SD:continuous-stage-kaho-kosuzu-hime-green-heart';
const HS_SD1_005_CONTINUOUS_ABILITY_ID =
  'PL!HS-sd1-005-SD:continuous-stage-sayaka-ginko-hime-blade';

describe('live modifier helpers', () => {
  it('creates source-member Heart modifiers when the member is the source card', () => {
    const source = createCardInstance(
      {
        cardCode: 'SOURCE-MEMBER',
        name: 'Source Member',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'source-member'
    );
    let game = createGameState('source-member-heart-helper', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source]);

    const modifier = createHeartLiveModifierForMember(game, {
      playerId: 'p1',
      memberCardId: source.instanceId,
      sourceCardId: source.instanceId,
      abilityId: 'source-heart',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    });

    expect(modifier).toEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: source.instanceId,
      abilityId: 'source-heart',
    });
  });

  it('creates target-member Heart modifiers when a different member gains Heart', () => {
    const source = createCardInstance(
      {
        cardCode: 'SOURCE-MEMBER',
        name: 'Source Member',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'source-member'
    );
    const target = createCardInstance(
      {
        cardCode: 'TARGET-MEMBER',
        name: 'Target Member',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p2',
      'target-member'
    );
    let game = createGameState('target-member-heart-helper', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, target]);

    const modifier = createHeartLiveModifierForMember(game, {
      playerId: 'p2',
      memberCardId: target.instanceId,
      sourceCardId: source.instanceId,
      abilityId: 'target-heart',
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    });

    expect(modifier).toEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: 'p2',
      targetMemberCardId: target.instanceId,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      sourceCardId: source.instanceId,
      abilityId: 'target-heart',
    });
  });

  it('adds member Heart modifiers without projecting them to player Heart bonuses', () => {
    const source = createCardInstance(
      {
        cardCode: 'SOURCE-MEMBER',
        name: 'Source Member',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'source-member'
    );
    let game = createGameState('add-member-heart-helper', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source]);

    const result = addHeartLiveModifierForMember(game, {
      playerId: 'p1',
      memberCardId: source.instanceId,
      sourceCardId: source.instanceId,
      abilityId: 'source-heart',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    });

    expect(result).not.toBeNull();
    expect(result?.heartBonus).toEqual([createHeartIcon(HeartColor.YELLOW, 1)]);
    expect(result?.gameState.liveResolution.playerHeartBonuses.has('p1')).toBe(false);
    expect(getPlayerLiveHeartModifiers(result!.gameState.liveResolution, 'p1')).toEqual([]);
  });

  it('rejects invalid member Heart helper inputs without modifying state', () => {
    const member = createCardInstance(
      {
        cardCode: 'VALID-MEMBER',
        name: 'Valid Member',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'valid-member'
    );
    const liveCard = createCardInstance(
      {
        cardCode: 'LIVE-CARD',
        name: 'Live Card',
        cardType: CardType.LIVE,
        score: 1,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'live-card'
    );
    let game = createGameState('invalid-member-heart-helper', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, liveCard]);

    const baseOptions = {
      playerId: 'p1',
      sourceCardId: member.instanceId,
      abilityId: 'invalid-heart',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    };

    expect(
      createHeartLiveModifierForMember(game, {
        ...baseOptions,
        memberCardId: 'missing-member',
      })
    ).toBeNull();
    expect(
      createHeartLiveModifierForMember(game, {
        ...baseOptions,
        memberCardId: liveCard.instanceId,
      })
    ).toBeNull();
    expect(
      createHeartLiveModifierForMember(game, {
        ...baseOptions,
        playerId: 'p2',
        memberCardId: member.instanceId,
      })
    ).toBeNull();
    expect(
      addHeartLiveModifierForMember(game, {
        ...baseOptions,
        memberCardId: member.instanceId,
        hearts: [createHeartIcon(HeartColor.YELLOW, 0)],
      })
    ).toBeNull();
    expect(game.liveResolution.liveModifiers).toEqual([]);
  });

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

  it('replaces a member printed original Heart colors before appending Heart bonuses', () => {
    const kasumi = createCardInstance(
      {
        cardCode: 'PL!N-bp3-014-N',
        name: '中須かすみ',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [
          createHeartIcon(HeartColor.PINK, 1),
          createHeartIcon(HeartColor.YELLOW, 1),
        ],
      },
      'p1',
      'kasumi'
    );
    let game = createGameState('original-heart-replacement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kasumi]);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: 'p1',
      memberCardId: kasumi.instanceId,
      color: HeartColor.GREEN,
      sourceCardId: kasumi.instanceId,
      abilityId: 'replace-original-heart',
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      sourceCardId: kasumi.instanceId,
      abilityId: 'bonus-heart',
    });

    expect(getMemberEffectiveHeartIcons(game, 'p1', kasumi.instanceId)).toEqual([
      createHeartIcon(HeartColor.GREEN, 2),
      createHeartIcon(HeartColor.BLUE, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1')).toEqual([]);
  });

  it('uses the latest original Heart replacement modifier for the same member', () => {
    const shioriko = createCardInstance(
      {
        cardCode: 'PL!N-pb1-034-N',
        name: '三船栞子',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      },
      'p1',
      'shioriko'
    );
    let game = createGameState('latest-original-heart-replacement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [shioriko]);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: 'p1',
      memberCardId: shioriko.instanceId,
      color: HeartColor.GREEN,
      sourceCardId: shioriko.instanceId,
      abilityId: 'first-replacement',
    });
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: 'p1',
      memberCardId: shioriko.instanceId,
      color: HeartColor.BLUE,
      sourceCardId: shioriko.instanceId,
      abilityId: 'second-replacement',
    });

    expect(getMemberEffectiveHeartIcons(game, 'p1', shioriko.instanceId)).toEqual([
      createHeartIcon(HeartColor.BLUE, 1),
    ]);
  });

  it('replaces existing original Heart replacement modifiers by source and ability', () => {
    let game = createGameState('replace-original-heart-modifier', 'p1', 'P1', 'p2', 'P2');
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: 'p1',
      memberCardId: 'kasumi',
      color: HeartColor.PINK,
      sourceCardId: 'kasumi',
      abilityId: 'replace-original-heart',
    });
    game = replaceLiveModifier(
      game,
      {
        kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
        playerId: 'p1',
        sourceCardId: 'kasumi',
        abilityId: 'replace-original-heart',
      },
      {
        kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
        playerId: 'p1',
        memberCardId: 'kasumi',
        color: HeartColor.YELLOW,
        sourceCardId: 'kasumi',
        abilityId: 'replace-original-heart',
      }
    );

    expect(game.liveResolution.liveModifiers).toEqual([
      {
        kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
        playerId: 'p1',
        memberCardId: 'kasumi',
        color: HeartColor.YELLOW,
        sourceCardId: 'kasumi',
        abilityId: 'replace-original-heart',
      },
    ]);
    expect(projectLiveModifierCompatibility(game.liveResolution.liveModifiers).playerHeartBonuses.size).toBe(0);
  });

  it('counts targeted member Heart modifiers without projecting them to player Heart bonuses', () => {
    const target = createCardInstance(
      {
        cardCode: 'TARGET-MEMBER',
        name: 'Target Member',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'target-member'
    );
    let game = createGameState('live-target-member-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [target]);
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: 'p1',
      targetMemberCardId: target.instanceId,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      sourceCardId: 'rurino',
      abilityId: 'rurino-target-heart',
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: 'p1',
      targetMemberCardId: 'other-member',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: 'other-source',
      abilityId: 'other-target-heart',
    });

    expect(game.liveResolution.playerHeartBonuses.has('p1')).toBe(false);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1')).toEqual([]);
    expect(getMemberEffectiveHeartIcons(game, 'p1', target.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.PINK, 1),
    ]);
  });

  it('collects PL!HS-sd1-004 source-member Green Heart while a named helper member is on the main stage', () => {
    const ginko = createCardInstance(
      {
        cardCode: 'PL!HS-sd1-004-SD',
        name: '百生吟子',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'ginko'
    );
    const kosuzu = createCardInstance(
      {
        cardCode: 'PL!HS-test-kosuzu',
        name: '徒町小铃',
        groupName: '蓮ノ空女学院スクールアイドルクラブ',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'kosuzu'
    );
    let game = createGameState('hs-sd1-004-continuous-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [ginko, kosuzu]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ginko.instanceId),
        SlotPosition.LEFT,
        kosuzu.instanceId
      ),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      sourceCardId: ginko.instanceId,
      abilityId: HS_SD1_004_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', ginko.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.GREEN, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('does not count memberBelow cards for PL!HS-sd1-004 continuous Heart', () => {
    const ginko = createCardInstance(
      {
        cardCode: 'PL!HS-sd1-004-SD',
        name: '百生吟子',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'ginko'
    );
    const kahoBelow = createCardInstance(
      {
        cardCode: 'PL!HS-test-kaho',
        name: '日野下花帆',
        groupName: '蓮ノ空女学院スクールアイドルクラブ',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'kaho-below'
    );
    let game = createGameState('hs-sd1-004-member-below-not-stage', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [ginko, kahoBelow]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ginko.instanceId),
        SlotPosition.CENTER,
        kahoBelow.instanceId
      ),
    }));

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'HEART' && modifier.abilityId === HS_SD1_004_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('collects PL!HS-sd1-005 source-member BLADE while a named helper member is on stage', () => {
    const kosuzu = createCardInstance(
      {
        cardCode: 'PL!HS-sd1-005-SD',
        name: '徒町小鈴',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'kosuzu'
    );
    const sayaka = createCardInstance(
      {
        cardCode: 'PL!HS-test-sayaka',
        name: '村野沙耶香',
        groupName: '蓮ノ空女学院スクールアイドルクラブ',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'sayaka'
    );
    let game = createGameState('hs-sd1-005-continuous-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kosuzu, sayaka]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kosuzu.instanceId),
        SlotPosition.RIGHT,
        sayaka.instanceId
      ),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: kosuzu.instanceId,
      abilityId: HS_SD1_005_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', kosuzu.instanceId, modifiers)).toBe(4);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('does not collect PL!HS-sd1-005 BLADE without the named stage members', () => {
    const kosuzu = createCardInstance(
      {
        cardCode: 'PL!HS-sd1-005-SD',
        name: '徒町小鈴',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'kosuzu'
    );
    const kaho = createCardInstance(
      {
        cardCode: 'PL!HS-test-kaho',
        name: '日野下花帆',
        groupName: '蓮ノ空女学院スクールアイドルクラブ',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'kaho'
    );
    let game = createGameState('hs-sd1-005-no-continuous-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kosuzu, kaho]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kosuzu.instanceId),
        SlotPosition.LEFT,
        kaho.instanceId
      ),
    }));

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'BLADE' && modifier.abilityId === HS_SD1_005_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('keeps legacy player Heart modifiers in player Heart compatibility projection', () => {
    const legacyModifier = {
      kind: 'HEART',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      sourceCardId: 'legacy-source',
      abilityId: 'legacy-player-heart',
    } as unknown as LiveModifierState;
    let game = createGameState('legacy-player-heart-compatibility', 'p1', 'P1', 'p2', 'P2');
    game = addLiveModifier(game, legacyModifier);

    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1')).toEqual([
      createHeartIcon(HeartColor.GREEN, 1),
    ]);
    expect(projectLiveModifierCompatibility(game.liveResolution.liveModifiers).playerHeartBonuses.get('p1')).toEqual([
      createHeartIcon(HeartColor.GREEN, 1),
    ]);
  });

  it('preserves Heart modifier semantics through online transport JSON round trip', () => {
    const source = createCardInstance(
      {
        cardCode: 'ROUND-TRIP-SOURCE',
        name: 'Round Trip Source',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'round-trip-source'
    );
    let game = createGameState('heart-modifier-json-round-trip', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source]);
    const modifiers: readonly LiveModifierState[] = [
      {
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        playerId: 'p1',
        hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
        sourceCardId: source.instanceId,
        abilityId: 'source-member-heart',
      },
      {
        kind: 'HEART',
        target: 'PLAYER',
        playerId: 'p1',
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
        sourceCardId: 'player-source',
        abilityId: 'player-heart',
      },
      {
        kind: 'HEART',
        playerId: 'p2',
        hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
        sourceCardId: 'legacy-source',
        abilityId: 'legacy-player-heart',
      } as unknown as LiveModifierState,
    ];

    const encoded = JSON.stringify(toTransport(modifiers));
    const decoded = fromTransport<readonly LiveModifierState[]>(JSON.parse(encoded));

    expect(decoded).toEqual(modifiers);
    expect(getMemberEffectiveHeartIcons(game, 'p1', source.instanceId, decoded)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.YELLOW, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', decoded)).toEqual([
      createHeartIcon(HeartColor.GREEN, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p2', decoded)).toEqual([
      createHeartIcon(HeartColor.PURPLE, 1),
    ]);
  });

  it('combines source-member and target-member Heart modifiers for the same member', () => {
    const target = createCardInstance(
      {
        cardCode: 'MIXED-HEART-TARGET',
        name: 'Mixed Heart Target',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'mixed-heart-target'
    );
    let game = createGameState('mixed-member-heart-modifiers', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [target]);
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: target.instanceId,
      abilityId: 'source-heart',
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: 'p1',
      targetMemberCardId: target.instanceId,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      sourceCardId: 'other-source',
      abilityId: 'target-heart',
    });

    expect(getMemberEffectiveHeartIcons(game, 'p1', target.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.YELLOW, 1),
      createHeartIcon(HeartColor.BLUE, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1')).toEqual([]);
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

  it('adds blue Heart and Blade to PL!HS-bp5-002 when three stage members have different effective costs', () => {
    const sayaka = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-002-P',
        name: '村野さやか',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'sayaka'
    );
    const hanayo = createCardInstance(
      {
        cardCode: 'PL!-bp4-008-R',
        name: '小泉花陽',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      },
      'p1',
      'hanayo'
    );
    const otherCostFour = createCardInstance(
      {
        cardCode: 'PL!HS-test-cost-four',
        name: 'Cost Four',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'other-cost-four'
    );
    const successLive = createCardInstance(
      {
        cardCode: 'PL!HS-test-success-live',
        name: 'Success Live',
        cardType: CardType.LIVE,
        score: 6,
        requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
      },
      'p1',
      'success-live'
    );
    let game = createGameState('hs-bp5-002-continuous-effective-cost', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [sayaka, hanayo, otherCostFour, successLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, successLive.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, sayaka.instanceId),
          SlotPosition.CENTER,
          hanayo.instanceId
        ),
        SlotPosition.RIGHT,
        otherCostFour.instanceId
      ),
    }));

    const liveModifiers = collectLiveModifiers(game);

    expect(liveModifiers).toEqual(
      expect.arrayContaining([
        {
          kind: 'HEART',
          target: 'SOURCE_MEMBER',
          playerId: 'p1',
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
          sourceCardId: sayaka.instanceId,
          abilityId: HS_BP5_002_CONTINUOUS_ABILITY_ID,
        },
        {
          kind: 'BLADE',
          playerId: 'p1',
          countDelta: 1,
          sourceCardId: sayaka.instanceId,
          abilityId: HS_BP5_002_CONTINUOUS_ABILITY_ID,
        },
      ])
    );
    expect(getMemberEffectiveHeartIcons(game, 'p1', sayaka.instanceId, liveModifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.BLUE, 1),
    ]);
    expect(getMemberEffectiveBladeCount(game, 'p1', sayaka.instanceId, liveModifiers)).toBe(2);
  });

  it('adds stackable member cost live modifiers to member effective cost', () => {
    const member = createCardInstance(
      {
        cardCode: 'PL!HS-pb1-002-R',
        name: '村野さやか',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'pb1-002-sayaka'
    );
    let game = createGameState('member-cost-live-modifier', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);

    const first = addMemberCostLiveModifierForMember(game, {
      playerId: 'p1',
      memberCardId: member.instanceId,
      sourceCardId: member.instanceId,
      abilityId: 'test-cost-plus-four',
      countDelta: 4,
    });
    expect(first).not.toBeNull();
    const second = addMemberCostLiveModifierForMember(first!.gameState, {
      playerId: 'p1',
      memberCardId: member.instanceId,
      sourceCardId: member.instanceId,
      abilityId: 'test-cost-plus-eight',
      countDelta: 8,
    });

    expect(second).not.toBeNull();
    expect(second?.gameState.liveResolution.liveModifiers).toEqual([
      first?.modifier,
      second?.modifier,
    ]);
    expect(getMemberEffectiveCost(second!.gameState, 'p1', member.instanceId)).toBe(14);
  });

  it('lets PL!HS-bp5-002 continuous different-effective-cost check read temporary member cost modifiers', () => {
    const sayaka = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-002-P',
        name: '村野さやか',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'bp5-sayaka'
    );
    const firstCostFour = createCardInstance(
      {
        cardCode: 'PL!HS-test-cost-four-a',
        name: 'Cost Four A',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'cost-four-a'
    );
    const secondCostFour = createCardInstance(
      {
        cardCode: 'PL!HS-test-cost-four-b',
        name: 'Cost Four B',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'cost-four-b'
    );
    let game = createGameState('bp5-002-temp-member-cost', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [sayaka, firstCostFour, secondCostFour]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, sayaka.instanceId),
          SlotPosition.CENTER,
          firstCostFour.instanceId
        ),
        SlotPosition.RIGHT,
        secondCostFour.instanceId
      ),
    }));
    expect(
      collectLiveModifiers(game).some(
        (modifier) => modifier.abilityId === HS_BP5_002_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);

    const costResult = addMemberCostLiveModifierForMember(game, {
      playerId: 'p1',
      memberCardId: firstCostFour.instanceId,
      sourceCardId: sayaka.instanceId,
      abilityId: 'test-temp-cost',
      countDelta: 4,
    });
    expect(costResult).not.toBeNull();

    expect(collectLiveModifiers(costResult!.gameState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'HEART',
          sourceCardId: sayaka.instanceId,
          abilityId: HS_BP5_002_CONTINUOUS_ABILITY_ID,
        }),
        expect.objectContaining({
          kind: 'BLADE',
          sourceCardId: sayaka.instanceId,
          abilityId: HS_BP5_002_CONTINUOUS_ABILITY_ID,
        }),
      ])
    );
  });

  it('does not add PL!HS-bp5-002 modifiers when costs repeat, fewer than three members are on stage, or source is not on stage', () => {
    const createSayaka = (id: string) =>
      createCardInstance(
        {
          cardCode: 'PL!HS-bp5-002-P',
          name: '村野さやか',
          cardType: CardType.MEMBER,
          cost: 15,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.PINK, 1)],
        },
        'p1',
        id
      );
    const createMember = (id: string, cost: number) =>
      createCardInstance(
        {
          cardCode: `PL!HS-test-${id}`,
          name: id,
          cardType: CardType.MEMBER,
          cost,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        'p1',
        id
      );

    let repeatCostGame = createGameState('hs-bp5-002-repeat-cost', 'p1', 'P1', 'p2', 'P2');
    const repeatSayaka = createSayaka('repeat-sayaka');
    const repeatOne = createMember('repeat-one', 4);
    const repeatTwo = createMember('repeat-two', 4);
    repeatCostGame = registerCards(repeatCostGame, [repeatSayaka, repeatOne, repeatTwo]);
    repeatCostGame = updatePlayer(repeatCostGame, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, repeatSayaka.instanceId),
          SlotPosition.CENTER,
          repeatOne.instanceId
        ),
        SlotPosition.RIGHT,
        repeatTwo.instanceId
      ),
    }));

    let twoMemberGame = createGameState('hs-bp5-002-two-members', 'p1', 'P1', 'p2', 'P2');
    const twoMemberSayaka = createSayaka('two-member-sayaka');
    const twoMemberOther = createMember('two-member-other', 4);
    twoMemberGame = registerCards(twoMemberGame, [twoMemberSayaka, twoMemberOther]);
    twoMemberGame = updatePlayer(twoMemberGame, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, twoMemberSayaka.instanceId),
        SlotPosition.CENTER,
        twoMemberOther.instanceId
      ),
    }));

    let notOnStageGame = createGameState('hs-bp5-002-source-off-stage', 'p1', 'P1', 'p2', 'P2');
    const offStageSayaka = createSayaka('off-stage-sayaka');
    const stageOne = createMember('stage-one', 1);
    const stageTwo = createMember('stage-two', 2);
    const stageThree = createMember('stage-three', 3);
    notOnStageGame = registerCards(notOnStageGame, [
      offStageSayaka,
      stageOne,
      stageTwo,
      stageThree,
    ]);
    notOnStageGame = updatePlayer(notOnStageGame, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, stageOne.instanceId),
          SlotPosition.CENTER,
          stageTwo.instanceId
        ),
        SlotPosition.RIGHT,
        stageThree.instanceId
      ),
    }));

    for (const game of [repeatCostGame, twoMemberGame, notOnStageGame]) {
      expect(
        collectLiveModifiers(game).some(
          (modifier) => modifier.abilityId === HS_BP5_002_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
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

  it('collects PL!HS-pb1-014 continuous SOURCE_MEMBER pink Heart only when front opponent cost is higher', () => {
    const hime = createCardInstance(
      {
        cardCode: 'PL!HS-pb1-014-R',
        name: '安養寺姫芽',
        groupName: '莲之空',
        unitName: 'みらくらぱーく！',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'hime-pb1-014'
    );
    const highCostOpponent = createCardInstance(
      {
        cardCode: 'OPP-HIGH',
        name: 'High Cost Opponent',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p2',
      'opponent-high'
    );
    const lowCostOpponent = createCardInstance(
      {
        cardCode: 'OPP-LOW',
        name: 'Low Cost Opponent',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p2',
      'opponent-low'
    );

    let game = createGameState('hs-pb1-014-front-high-cost', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hime, highCostOpponent, lowCostOpponent]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, hime.instanceId),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.RIGHT,
        highCostOpponent.instanceId
      ),
    }));

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      sourceCardId: hime.instanceId,
      abilityId: 'PL!HS-pb1-014-R:continuous-front-high-cost-pink-heart',
    });

    const lowCostGame = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.RIGHT,
        lowCostOpponent.instanceId
      ),
    }));
    expect(
      collectLiveModifiers(lowCostGame).some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.abilityId === 'PL!HS-pb1-014-R:continuous-front-high-cost-pink-heart'
      )
    ).toBe(false);
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

  it('collects PL!-bp5-003 as SOURCE_MEMBER yellow Heart +1 with three differently named stage members', () => {
    const kotori = createCardInstance(
      {
        cardCode: 'PL!-bp5-003-AR',
        name: '南ことり',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'kotori-bp5-003'
    );
    const umi = createCardInstance(
      {
        cardCode: 'PL!-TEST-UMI',
        name: '園田海未',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'umi-stage'
    );
    const rin = createCardInstance(
      {
        cardCode: 'PL!-TEST-RIN',
        name: '星空凛',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'rin-stage'
    );

    let game = createGameState('bp5-003-three-names-yellow-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kotori, umi, rin]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kotori.instanceId),
          SlotPosition.LEFT,
          umi.instanceId
        ),
        SlotPosition.RIGHT,
        rin.instanceId
      ),
    }));

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: kotori.instanceId,
      abilityId: 'PL!-bp5-003:continuous-three-different-names-yellow-heart',
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', kotori.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.YELLOW, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('collects PL!SP-bp5-012 as SOURCE_MEMBER yellow Heart when own Liella LIVE requirement total is exactly 8', () => {
    const kanon = createSpBp5012Kanon('sp-bp5-012-kanon');
    const liellaLive = createCardInstance(
      createLiellaLiveData('PL!SP-TEST-LIVE-8', 'Liella Requirement 8', {
        [HeartColor.RED]: 3,
        [HeartColor.YELLOW]: 5,
      }),
      'p1',
      'liella-live-8'
    );

    let game = createGameState('sp-bp5-012-requirement-eight', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kanon, liellaLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kanon.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, liellaLive.instanceId),
    }));

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: kanon.instanceId,
      abilityId: 'PL!SP-bp5-012:continuous-liella-live-requirement-eight-yellow-heart',
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', kanon.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.YELLOW, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
    expect(game.liveResolution.playerHeartBonuses.has('p1')).toBe(false);
  });

  it('does not collect PL!SP-bp5-012 yellow Heart when own Liella LIVE requirement total is 7', () => {
    const game = createSpBp5012ContinuousGame({
      live: createLiellaLiveData('PL!SP-TEST-LIVE-7', 'Liella Requirement 7', {
        [HeartColor.RED]: 3,
        [HeartColor.YELLOW]: 4,
      }),
    });

    expect(hasSpBp5012YellowHeartModifier(game)).toBe(false);
  });

  it('does not collect PL!SP-bp5-012 yellow Heart for non-Liella LIVE even when requirement total is at least 8', () => {
    const game = createSpBp5012ContinuousGame({
      live: {
        ...createLiellaLiveData('PL!S-TEST-LIVE-8', 'Aqours Requirement 8', {
          [HeartColor.RED]: 3,
          [HeartColor.YELLOW]: 5,
        }),
        groupName: 'Aqours',
      },
    });

    expect(hasSpBp5012YellowHeartModifier(game)).toBe(false);
  });

  it('does not collect PL!SP-bp5-012 yellow Heart when own LIVE zone is empty', () => {
    const kanon = createSpBp5012Kanon('sp-bp5-012-empty-live-zone');
    let game = createGameState('sp-bp5-012-empty-live-zone', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kanon]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kanon.instanceId),
    }));

    expect(hasSpBp5012YellowHeartModifier(game)).toBe(false);
    expect(getMemberEffectiveHeartIcons(game, 'p1', kanon.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
    ]);
  });

  it('does not collect PL!-bp5-003 yellow Heart with fewer than three stage member names', () => {
    const kotori = createBp5003Kotori('kotori-fewer-names');
    const umi = createCardInstance(
      {
        cardCode: 'PL!-TEST-UMI',
        name: '園田海未',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'umi-fewer-names'
    );
    let game = createGameState('bp5-003-fewer-names', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kotori, umi]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kotori.instanceId),
        SlotPosition.LEFT,
        umi.instanceId
      ),
    }));

    expect(hasBp5003YellowHeartModifier(game)).toBe(false);
  });

  it('does not collect PL!-bp5-003 yellow Heart when stage member names are not all different', () => {
    const kotori = createBp5003Kotori('kotori-duplicate-names');
    const umi = createCardInstance(
      {
        cardCode: 'PL!-TEST-UMI-A',
        name: '園田海未',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'umi-duplicate-a'
    );
    const anotherUmi = createCardInstance(
      {
        cardCode: 'PL!-TEST-UMI-B',
        name: '園田海未',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'umi-duplicate-b'
    );
    let game = createGameState('bp5-003-duplicate-names', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kotori, umi, anotherUmi]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kotori.instanceId),
          SlotPosition.LEFT,
          umi.instanceId
        ),
        SlotPosition.RIGHT,
        anotherUmi.instanceId
      ),
    }));

    expect(hasBp5003YellowHeartModifier(game)).toBe(false);
  });

  it('does not collect PL!-bp5-003 yellow Heart when the source member is not on stage', () => {
    const kotori = createBp5003Kotori('kotori-off-stage');
    const umi = createCardInstance(
      {
        cardCode: 'PL!-TEST-UMI',
        name: '園田海未',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'umi-off-stage'
    );
    const rin = createCardInstance(
      {
        cardCode: 'PL!-TEST-RIN',
        name: '星空凛',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'rin-off-stage'
    );
    let game = createGameState('bp5-003-off-stage', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kotori, umi, rin]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      hand: addCardToZone(player.hand, kotori.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, umi.instanceId),
        SlotPosition.RIGHT,
        rin.instanceId
      ),
    }));

    expect(hasBp5003YellowHeartModifier(game)).toBe(false);
  });

  it('collects PL!-bp4-002 as SOURCE_MEMBER purple Heart +2 when own LIVE includes a LIVE without LIVE start/success ability', () => {
    const eli = createCardInstance(
      {
        cardCode: 'PL!-bp4-002-R+',
        name: '绚濑绘里',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 4,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'eli-bp4-002'
    );
    const continuousOnlyLive = createCardInstance(
      {
        cardCode: 'PL!-NO-TIMING-LIVE',
        name: 'No Timing Live',
        cardType: CardType.LIVE,
        score: 5,
        requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
        cardText: '【常时】此卡的分数+1。',
      },
      'p1',
      'no-timing-live'
    );

    let game = createGameState('bp4-002-purple-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [eli, continuousOnlyLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, eli.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, continuousOnlyLive.instanceId),
    }));

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PURPLE, 2)],
      sourceCardId: eli.instanceId,
      abilityId: 'PL!-bp4-002:continuous-live-without-timing-purple-heart',
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', eli.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.PURPLE, 2),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('does not collect PL!-bp4-002 purple Heart when own LIVE only has LIVE start or LIVE success abilities', () => {
    const eli = createCardInstance(
      {
        cardCode: 'PL!-bp4-002-P+',
        name: '绚濑绘里',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 4,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'eli-bp4-002-timing'
    );
    const liveStartLive = createCardInstance(
      {
        cardCode: 'PL!-LIVE-START-LIVE',
        name: 'Live Start Live',
        cardType: CardType.LIVE,
        score: 5,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
        cardText: '【LIVE开始时】此卡的分数+1。',
      },
      'p1',
      'live-start-live'
    );
    const liveSuccessLive = createCardInstance(
      {
        cardCode: 'PL!-LIVE-SUCCESS-LIVE',
        name: 'Live Success Live',
        cardType: CardType.LIVE,
        score: 5,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
        cardText: '【LIVE成功時】抽1张卡。',
      },
      'p1',
      'live-success-live'
    );

    let game = createGameState('bp4-002-timing-live-only', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [eli, liveStartLive, liveSuccessLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, eli.instanceId),
      liveZone: addCardToStatefulZone(
        addCardToStatefulZone(player.liveZone, liveStartLive.instanceId),
        liveSuccessLive.instanceId
      ),
    }));

    expect(hasBp4002PurpleHeartModifier(game)).toBe(false);
  });

  it('does not collect PL!-bp4-002 purple Heart when the source member is not on stage', () => {
    const eli = createCardInstance(
      {
        cardCode: 'PL!-bp4-002-SEC',
        name: '绚濑绘里',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 4,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'eli-bp4-002-off-stage'
    );
    const noTimingLive = createCardInstance(
      {
        cardCode: 'PL!-NO-TIMING-LIVE',
        name: 'No Timing Live',
        cardType: CardType.LIVE,
        score: 5,
        requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
      },
      'p1',
      'no-timing-live-off-stage'
    );

    let game = createGameState('bp4-002-off-stage', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [eli, noTimingLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [eli.instanceId] },
      liveZone: addCardToStatefulZone(player.liveZone, noTimingLive.instanceId),
    }));

    expect(hasBp4002PurpleHeartModifier(game)).toBe(false);
  });

  it('collects PL!-bp6-022 success-zone continuous requirement reduction for original score >=5 μ’s LIVE', () => {
    const dreamin = createDreaminGoGo('dreamin-source');
    const targetLive = createCardInstance(
      createMuseLiveData('PL!-TEST-LIVE', 'μ’s High Score Live', 5),
      'p1',
      'target-live'
    );

    let game = createGameState('bp6-022-requirement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [dreamin, targetLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, dreamin.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, targetLive.instanceId),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: targetLive.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: dreamin.instanceId,
      abilityId: 'PL!-bp6-022:continuous-success-zone-muse-live-requirement',
    });
    expect(
      getLiveCardRequirementModifiers(game.liveResolution, targetLive.instanceId, modifiers)
    ).toEqual([{ color: HeartColor.RAINBOW, countDelta: -2 }]);
  });

  it('does not stack PL!-bp6-022 requirement reduction from multiple success-zone copies', () => {
    const firstDreamin = createDreaminGoGo('first-dreamin');
    const secondDreamin = createDreaminGoGo('second-dreamin');
    const targetLive = createCardInstance(
      createMuseLiveData('PL!-TEST-LIVE', 'μ’s High Score Live', 5),
      'p1',
      'target-live'
    );

    let game = createGameState('bp6-022-no-stack', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [firstDreamin, secondDreamin, targetLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: addCardToZone(
        addCardToZone(player.successZone, firstDreamin.instanceId),
        secondDreamin.instanceId
      ),
      liveZone: addCardToStatefulZone(player.liveZone, targetLive.instanceId),
    }));

    const modifiers = collectLiveModifiers(game).filter(
      (modifier) =>
        modifier.kind === 'REQUIREMENT' &&
        modifier.abilityId === 'PL!-bp6-022:continuous-success-zone-muse-live-requirement'
    );

    expect(modifiers).toHaveLength(1);
    expect(modifiers[0]).toMatchObject({
      liveCardId: targetLive.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: firstDreamin.instanceId,
    });
  });

  it('does not collect PL!-bp6-022 requirement reduction unless Dreamin is in success zone', () => {
    const dreamin = createDreaminGoGo('dreamin-not-success');
    const targetLive = createCardInstance(
      createMuseLiveData('PL!-TEST-LIVE', 'μ’s High Score Live', 5),
      'p1',
      'target-live'
    );

    let game = createGameState('bp6-022-not-success-zone', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [dreamin, targetLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(
        addCardToStatefulZone(player.liveZone, dreamin.instanceId),
        targetLive.instanceId
      ),
    }));

    expect(hasBp6022RequirementModifier(game)).toBe(false);
  });

  it('does not collect PL!-bp6-022 requirement reduction for low-score or non-μ’s LIVE targets', () => {
    const dreamin = createDreaminGoGo('dreamin-source');
    const lowScoreLive = createCardInstance(
      createMuseLiveData('PL!-LOW-SCORE-LIVE', 'μ’s Low Score Live', 4),
      'p1',
      'low-score-live'
    );
    const nonMuseLive = createCardInstance(
      createHasunosoraLiveData('PL!HS-HIGH-SCORE-LIVE', 'Hasunosora High Score Live', 5),
      'p1',
      'non-muse-live'
    );

    let game = createGameState('bp6-022-target-filter', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [dreamin, lowScoreLive, nonMuseLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, dreamin.instanceId),
      liveZone: addCardToStatefulZone(
        addCardToStatefulZone(player.liveZone, lowScoreLive.instanceId),
        nonMuseLive.instanceId
      ),
    }));

    expect(hasBp6022RequirementModifier(game)).toBe(false);
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

function hasBp5003YellowHeartModifier(game: ReturnType<typeof createGameState>): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.target === 'SOURCE_MEMBER' &&
      modifier.abilityId === 'PL!-bp5-003:continuous-three-different-names-yellow-heart'
  );
}

function hasSpBp5012YellowHeartModifier(game: ReturnType<typeof createGameState>): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.target === 'SOURCE_MEMBER' &&
      modifier.abilityId ===
        'PL!SP-bp5-012:continuous-liella-live-requirement-eight-yellow-heart'
  );
}

function hasBp4002PurpleHeartModifier(game: ReturnType<typeof createGameState>): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.target === 'SOURCE_MEMBER' &&
      modifier.abilityId === 'PL!-bp4-002:continuous-live-without-timing-purple-heart'
  );
}

function hasBp6022RequirementModifier(game: ReturnType<typeof createGameState>): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'REQUIREMENT' &&
      modifier.abilityId === 'PL!-bp6-022:continuous-success-zone-muse-live-requirement'
  );
}

function createBp5003Kotori(instanceId: string) {
  return createCardInstance(
    {
      cardCode: 'PL!-bp5-003-AR',
      name: '南ことり',
      cardType: CardType.MEMBER,
      cost: 11,
      blade: 3,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    instanceId
  );
}

function createSpBp5012Kanon(instanceId: string) {
  return createCardInstance(
    {
      cardCode: 'PL!SP-bp5-012-N',
      name: '澁谷かのん',
      groupName: 'Liella!',
      cardType: CardType.MEMBER,
      cost: 2,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    instanceId
  );
}

function createLiellaLiveData(
  cardCode: string,
  name: string,
  requirements: Record<string, number>
) {
  return {
    cardCode,
    name,
    groupName: 'Liella!',
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement(requirements),
  };
}

function createSpBp5012ContinuousGame(options: {
  readonly live: ReturnType<typeof createLiellaLiveData>;
}) {
  const kanon = createSpBp5012Kanon('sp-bp5-012-kanon-negative');
  const live = createCardInstance(options.live, 'p1', 'sp-bp5-012-live-negative');
  let game = createGameState('sp-bp5-012-negative', 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, [kanon, live]);
  game = updatePlayer(game, 'p1', (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kanon.instanceId),
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
  }));
  return game;
}

function createDreaminGoGo(instanceId: string) {
  return createCardInstance(
    {
      cardCode: 'PL!-bp6-022-L',
      name: "Dreamin' Go! Go!!",
      cardType: CardType.LIVE,
      score: 9,
      requirements: createHeartRequirement({
        [HeartColor.PINK]: 5,
        [HeartColor.YELLOW]: 5,
        [HeartColor.PURPLE]: 5,
        [HeartColor.RAINBOW]: 5,
      }),
      groupName: "μ's",
    },
    'p1',
    instanceId
  );
}

function createMuseLiveData(cardCode: string, name: string, score: number) {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 3 }),
    groupName: "μ's",
  };
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

function createHasunosoraLiveData(cardCode: string, name: string, score = 1) {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
    cardText: 'Hasunosora のLIVE。',
  };
}
