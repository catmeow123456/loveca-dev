import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type LiveModifierState,
} from '../../src/domain/entities/game';
import {
  addEnergyBelowMember,
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
  getPlayerLiveBladeModifier,
  getPlayerLiveHeartModifiers,
  getPlayerLiveScoreModifier,
  projectLiveModifierCompatibility,
  replaceLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { fromTransport, toTransport } from '../../src/online/serde';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

const HS_BP5_002_CONTINUOUS_ABILITY_ID =
  'PL!HS-bp5-002:continuous-three-different-stage-member-costs-blue-heart-blade';
const HS_BP5_007_CONTINUOUS_ABILITY_ID = 'PL!HS-bp5-007:continuous-other-edelnote-member-blade';
const HS_BP2_006_CONTINUOUS_ABILITY_ID =
  'PL!HS-bp2-006:continuous-other-miracra-stage-member-blade';
const PL_N_PB1_011_CONTINUOUS_ABILITY_ID =
  'PL!N-pb1-011:continuous-energy-below-gain-blade';
const HS_BP5_016_CONTINUOUS_ABILITY_ID =
  'PL!HS-bp5-016-N:continuous-opponent-two-waiting-purple-heart';
const HS_PB1_007_CONTINUOUS_ABILITY_ID =
  'PL!HS-pb1-007:continuous-exact-two-own-opponent-three-purple-heart';
const HS_SD1_004_CONTINUOUS_ABILITY_ID =
  'PL!HS-sd1-004-SD:continuous-stage-kaho-kosuzu-hime-green-heart';
const HS_SD1_005_CONTINUOUS_ABILITY_ID =
  'PL!HS-sd1-005-SD:continuous-stage-sayaka-ginko-hime-blade';
const S_BP6_009_CONTINUOUS_ABILITY_ID =
  'PL!S-bp6-009:continuous-success-live-difference-gain-blade';
const SP_PB2_023_CONTINUOUS_ABILITY_ID = 'PL!SP-pb2-023:continuous-energy-six-eight-gain-red-heart';
const SP_PB2_026_CONTINUOUS_ABILITY_ID =
  'PL!SP-pb2-026:continuous-active-energy-gain-two-red-heart';
const SP_PB2_027_CONTINUOUS_ABILITY_ID =
  'PL!SP-pb2-027:continuous-energy-six-eight-gain-yellow-heart';
const SP_PB2_032_CONTINUOUS_ABILITY_ID =
  'PL!SP-pb2-032:continuous-energy-six-eight-gain-purple-heart';
const SP_PB2_035_CONTINUOUS_ABILITY_ID = 'PL!SP-pb2-035:continuous-left-side-gain-two-blade';
const SP_PB2_041_CONTINUOUS_ABILITY_ID = 'PL!SP-pb2-041:continuous-right-side-gain-two-blade';
const BP6_012_CONTINUOUS_ABILITY_ID =
  'PL!-bp6-012:continuous-success-zone-printemps-card-yellow-heart';
const BP6_014_CONTINUOUS_ABILITY_ID =
  'PL!-bp6-014:continuous-success-zone-lilywhite-card-pink-heart';
const BP6_015_CONTINUOUS_ABILITY_ID = 'PL!-bp6-015:continuous-success-zone-bibi-card-purple-heart';
const BP4_018_CONTINUOUS_ABILITY_ID = 'PL!-bp4-018:continuous-success-score-lead-gain-two-blade';
const N_PR_024_CONTINUOUS_ABILITY_ID =
  'PL!N-PR-024-PR:continuous-success-live-total-four-gain-two-blade';
const PL_N_BP1_012_CONTINUOUS_ABILITY_ID =
  'PL!N-bp1-012:continuous-live-zone-three-nijigasaki-live-gain-all-heart-blade';

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
        hearts: [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.YELLOW, 1)],
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

  it('replaces a member printed original BLADE count before appending BLADE modifiers', () => {
    const kanon = createCardInstance(
      {
        cardCode: 'PL!SP-bp4-025-test-member',
        name: '澁谷かのん',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 5,
        hearts: [createHeartIcon(HeartColor.RED, 1)],
      },
      'p1',
      'kanon'
    );
    let game = createGameState('original-blade-replacement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kanon]);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: 'p1',
      memberCardId: kanon.instanceId,
      count: 3,
      sourceCardId: 'special-color',
      abilityId: 'replace-original-blade',
    });
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: kanon.instanceId,
      abilityId: 'bonus-blade',
    });

    expect(getMemberEffectiveBladeCount(game, 'p1', kanon.instanceId)).toBe(5);
    expect(getPlayerLiveBladeModifier(game.liveResolution, 'p1')).toBe(2);
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
    expect(
      projectLiveModifierCompatibility(game.liveResolution.liveModifiers).playerHeartBonuses.size
    ).toBe(0);
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

  it('collects PL!S-bp6-009 BLADE equal to opponent success Live difference only when behind', () => {
    const ruby = createCardInstance(
      {
        cardCode: 'PL!S-bp6-009-P',
        name: '黒澤ルビィ',
        groupName: 'Aqours',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 2,
        hearts: [createHeartIcon(HeartColor.RED, 1)],
      },
      'p1',
      'ruby'
    );
    const ownSuccess = createCardInstance(
      createAqoursLiveData('PL!S-own-success', 'Own Success'),
      'p1',
      'own-success'
    );
    const opponentSuccessCards = [1, 2, 3].map((index) =>
      createCardInstance(
        createAqoursLiveData(`PL!S-opponent-success-${index}`, `Opponent Success ${index}`),
        'p2',
        `opponent-success-${index}`
      )
    );
    let game = createGameState('s-bp6-009-continuous', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [ruby, ownSuccess, ...opponentSuccessCards]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ruby.instanceId),
      successZone: addCardToZone(player.successZone, ownSuccess.instanceId),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      successZone: opponentSuccessCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.successZone
      ),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: ruby.instanceId,
      abilityId: S_BP6_009_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', ruby.instanceId, modifiers)).toBe(4);

    const tiedGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: opponentSuccessCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.successZone
      ),
    }));
    expect(
      collectLiveModifiers(tiedGame).some(
        (modifier) => modifier.abilityId === S_BP6_009_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
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

  it('collects PL!SP-pb2-023 red Heart by total energy thresholds', () => {
    const atFive = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-023-N',
      energyOrientations: Array(5).fill(OrientationState.ACTIVE),
    });
    expect(
      collectLiveModifiers(atFive.game).some(
        (modifier) => modifier.abilityId === SP_PB2_023_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);

    const atSix = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-023-N',
      energyOrientations: Array(6).fill(OrientationState.WAITING),
    });
    expect(collectLiveModifiers(atSix.game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.RED, 1)],
      sourceCardId: atSix.sourceId,
      abilityId: SP_PB2_023_CONTINUOUS_ABILITY_ID,
    });

    const atEight = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-023-N',
      energyOrientations: Array(8).fill(OrientationState.WAITING),
    });
    const modifiers = collectLiveModifiers(atEight.game);
    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.RED, 2)],
      sourceCardId: atEight.sourceId,
      abilityId: SP_PB2_023_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(atEight.game, 'p1', atEight.sourceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.RED, 2),
    ]);
    expect(getPlayerLiveHeartModifiers(atEight.game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('collects PL!SP-pb2-027 yellow Heart by total energy thresholds', () => {
    const atSix = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-027-N',
      energyOrientations: Array(6).fill(OrientationState.ACTIVE),
    });
    expect(collectLiveModifiers(atSix.game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: atSix.sourceId,
      abilityId: SP_PB2_027_CONTINUOUS_ABILITY_ID,
    });

    const atEight = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-027-N',
      energyOrientations: Array(8).fill(OrientationState.ACTIVE),
    });
    expect(collectLiveModifiers(atEight.game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.YELLOW, 2)],
      sourceCardId: atEight.sourceId,
      abilityId: SP_PB2_027_CONTINUOUS_ABILITY_ID,
    });
  });

  it('collects PL!SP-pb2-032 purple Heart by total energy thresholds', () => {
    const atSix = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-032-N',
      energyOrientations: Array(6).fill(OrientationState.WAITING),
    });
    expect(collectLiveModifiers(atSix.game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      sourceCardId: atSix.sourceId,
      abilityId: SP_PB2_032_CONTINUOUS_ABILITY_ID,
    });

    const atEight = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-032-N',
      energyOrientations: Array(8).fill(OrientationState.WAITING),
    });
    expect(collectLiveModifiers(atEight.game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PURPLE, 2)],
      sourceCardId: atEight.sourceId,
      abilityId: SP_PB2_032_CONTINUOUS_ABILITY_ID,
    });
  });

  it('collects PL!SP-pb2-026 red Heart only with non-waiting energy', () => {
    const activeEnergy = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-026-N',
      energyOrientations: [OrientationState.WAITING, OrientationState.ACTIVE],
    });
    expect(collectLiveModifiers(activeEnergy.game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.RED, 2)],
      sourceCardId: activeEnergy.sourceId,
      abilityId: SP_PB2_026_CONTINUOUS_ABILITY_ID,
    });

    const waitingOnly = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-026-N',
      energyOrientations: [OrientationState.WAITING, OrientationState.WAITING],
    });
    expect(
      collectLiveModifiers(waitingOnly.game).some(
        (modifier) => modifier.abilityId === SP_PB2_026_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);

    const noEnergy = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-026-N',
      energyOrientations: [],
    });
    expect(
      collectLiveModifiers(noEnergy.game).some(
        (modifier) => modifier.abilityId === SP_PB2_026_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not collect SP-pb2 energy Heart modifiers when the source is not a main stage member', () => {
    const offStage = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-023-N',
      energyOrientations: Array(8).fill(OrientationState.ACTIVE),
      sourcePlacement: 'OFF_STAGE',
    });
    expect(
      collectLiveModifiers(offStage.game).some(
        (modifier) => modifier.abilityId === SP_PB2_023_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);

    const memberBelow = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb2-026-N',
      energyOrientations: [OrientationState.ACTIVE],
      sourcePlacement: 'MEMBER_BELOW',
    });
    expect(
      collectLiveModifiers(memberBelow.game).some(
        (modifier) => modifier.abilityId === SP_PB2_026_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('collects PL!SP-pb2-035 BLADE +2 only while the source is on the left side', () => {
    const keke = createCardInstance(
      {
        cardCode: 'PL!SP-pb2-035-N',
        name: '唐 可可',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 2,
        hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      },
      'p1',
      'keke'
    );
    let game = createGameState('sp-pb2-035-left-side-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [keke]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, keke.instanceId),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: keke.instanceId,
      abilityId: SP_PB2_035_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', keke.instanceId, modifiers)).toBe(4);

    const movedGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: keke.instanceId,
        },
      },
    }));
    expect(
      collectLiveModifiers(movedGame).some(
        (modifier) => modifier.abilityId === SP_PB2_035_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('collects PL!SP-pb2-041 BLADE +2 only while the source is on the right side', () => {
    const shiki = createCardInstance(
      {
        cardCode: 'PL!SP-pb2-041-N',
        name: '若菜四季',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 2,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'shiki'
    );
    let game = createGameState('sp-pb2-041-right-side-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [shiki]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, shiki.instanceId),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: shiki.instanceId,
      abilityId: SP_PB2_041_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', shiki.instanceId, modifiers)).toBe(4);

    const movedGame = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: shiki.instanceId,
          [SlotPosition.RIGHT]: null,
        },
      },
    }));
    expect(
      collectLiveModifiers(movedGame).some(
        (modifier) => modifier.abilityId === SP_PB2_041_CONTINUOUS_ABILITY_ID
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
    expect(
      projectLiveModifierCompatibility(game.liveResolution.liveModifiers).playerHeartBonuses.get(
        'p1'
      )
    ).toEqual([createHeartIcon(HeartColor.GREEN, 1)]);
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

  it('adds BLADE +2 to PL!HS-bp5-007 when another own EdelNote member is on stage', () => {
    const seras = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-007-R',
        name: 'セラス 柳田 リリエンフェルト',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'seras'
    );
    const otherEdelNote = createCardInstance(
      {
        cardCode: 'PL!HS-test-edelnote',
        name: 'Other EdelNote',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'other-edelnote'
    );
    let game = createGameState('hs-bp5-007-continuous-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [seras, otherEdelNote]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, seras.instanceId),
        SlotPosition.LEFT,
        otherEdelNote.instanceId
      ),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: seras.instanceId,
      abilityId: HS_BP5_007_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', seras.instanceId, modifiers)).toBe(5);
  });

  it('does not add PL!HS-bp5-007 BLADE when only itself is on stage', () => {
    const seras = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-007-P',
        name: 'セラス 柳田 リリエンフェルト',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'seras-self-only'
    );
    let game = createGameState('hs-bp5-007-self-only', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [seras]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, seras.instanceId),
    }));

    expect(
      collectLiveModifiers(game).some(
        (modifier) => modifier.abilityId === HS_BP5_007_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
    expect(getMemberEffectiveBladeCount(game, 'p1', seras.instanceId)).toBe(3);
  });

  it('does not satisfy PL!HS-bp5-007 with opponent EdelNote, EdelNote LIVE, or non-EdelNote member', () => {
    const seras = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-007-AR',
        name: 'セラス 柳田 リリエンフェルト',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'seras-negative'
    );
    const nonEdelNote = createCardInstance(
      {
        cardCode: 'PL!HS-test-non-edelnote',
        name: 'Non EdelNote',
        unitName: 'スリーズブーケ',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'non-edelnote'
    );
    const ownEdelNoteLive = createCardInstance(
      {
        cardCode: 'PL!HS-test-edelnote-live',
        name: 'EdelNote Live',
        unitName: 'EdelNote',
        cardType: CardType.LIVE,
        score: 1,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'own-edelnote-live'
    );
    const opponentEdelNote = createCardInstance(
      {
        cardCode: 'PL!HS-test-opponent-edelnote',
        name: 'Opponent EdelNote',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p2',
      'opponent-edelnote'
    );
    let game = createGameState('hs-bp5-007-negative-sources', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [seras, nonEdelNote, ownEdelNoteLive, opponentEdelNote]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToZone(player.liveZone, ownEdelNoteLive.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, seras.instanceId),
        SlotPosition.RIGHT,
        nonEdelNote.instanceId
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        opponentEdelNote.instanceId
      ),
    }));

    expect(
      collectLiveModifiers(game).some(
        (modifier) => modifier.abilityId === HS_BP5_007_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('adds BLADE to PL!HS-bp2-006 for each other own Miracra Park stage member', () => {
    const megu = createCardInstance(
      {
        cardCode: 'PL!HS-bp2-006-R',
        name: '藤島 慈',
        unitName: 'みらくらぱーく!',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 4,
        hearts: [createHeartIcon(HeartColor.PINK, 4)],
      },
      'p1',
      'megu'
    );
    const rurino = createCardInstance(
      {
        cardCode: 'PL!HS-test-rurino',
        name: '大沢瑠璃乃',
        unitName: 'みらくらぱーく！',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'rurino'
    );
    const hime = createCardInstance(
      {
        cardCode: 'PL!HS-test-hime',
        name: '安養寺姫芽',
        unitName: 'Mira-Cra Park!',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'hime'
    );
    let game = createGameState('hs-bp2-006-continuous-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [megu, rurino, hime]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, megu.instanceId),
          SlotPosition.LEFT,
          rurino.instanceId
        ),
        SlotPosition.RIGHT,
        hime.instanceId
      ),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: megu.instanceId,
      abilityId: HS_BP2_006_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', megu.instanceId, modifiers)).toBe(6);
  });

  it('does not count PL!HS-bp2-006 itself, non-Miracra members, or opponent Miracra members', () => {
    const megu = createCardInstance(
      {
        cardCode: 'PL!HS-bp2-006-P',
        name: '藤島 慈',
        unitName: 'みらくらぱーく!',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 4,
        hearts: [createHeartIcon(HeartColor.PINK, 4)],
      },
      'p1',
      'megu-negative'
    );
    const nonMiracra = createCardInstance(
      {
        cardCode: 'PL!HS-test-cerise',
        name: '日野下花帆',
        unitName: 'スリーズブーケ',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'non-miracra'
    );
    const opponentMiracra = createCardInstance(
      {
        cardCode: 'PL!HS-test-opponent-miracra',
        name: '大沢瑠璃乃',
        unitName: 'みらくらぱーく！',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p2',
      'opponent-miracra'
    );
    let game = createGameState('hs-bp2-006-continuous-negative', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [megu, nonMiracra, opponentMiracra]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, megu.instanceId),
        SlotPosition.LEFT,
        nonMiracra.instanceId
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.RIGHT,
        opponentMiracra.instanceId
      ),
    }));

    expect(
      collectLiveModifiers(game).some(
        (modifier) => modifier.abilityId === HS_BP2_006_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
    expect(getMemberEffectiveBladeCount(game, 'p1', megu.instanceId)).toBe(4);
  });

  it('adds purple Heart to PL!HS-pb1-007 when own stage has exactly two members and opponent has three', () => {
    const seras = createCardInstance(
      {
        cardCode: 'PL!HS-pb1-007-R',
        name: 'セラス 柳田 リリエンフェルト',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 4,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'pb1-007-seras'
    );
    const ownOther = createCardInstance(
      {
        cardCode: 'PL!HS-test-own-other',
        name: 'Own Other',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'own-other'
    );
    const opponentMembers = [0, 1, 2].map((index) =>
      createCardInstance(
        {
          cardCode: `PL!HS-test-opponent-${index}`,
          name: `Opponent ${index}`,
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        'p2',
        `opponent-${index}`
      )
    );
    let game = createGameState('hs-pb1-007-continuous-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [seras, ownOther, ...opponentMembers]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, seras.instanceId),
        SlotPosition.LEFT,
        ownOther.instanceId
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, opponentMembers[0]!.instanceId),
          SlotPosition.CENTER,
          opponentMembers[1]!.instanceId
        ),
        SlotPosition.RIGHT,
        opponentMembers[2]!.instanceId
      ),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      sourceCardId: seras.instanceId,
      abilityId: HS_PB1_007_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', seras.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.PURPLE, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('does not add PL!HS-pb1-007 purple Heart when own stage has one or three members', () => {
    const createSeras = (id: string) =>
      createCardInstance(
        {
          cardCode: 'PL!HS-pb1-007-P＋',
          name: 'セラス 柳田 リリエンフェルト',
          unitName: 'EdelNote',
          cardType: CardType.MEMBER,
          cost: 11,
          blade: 4,
          hearts: [createHeartIcon(HeartColor.PINK, 1)],
        },
        'p1',
        id
      );
    const createMember = (id: string, ownerId: string) =>
      createCardInstance(
        {
          cardCode: `PL!HS-test-${id}`,
          name: id,
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        ownerId,
        id
      );
    const buildOpponentThree = (game: ReturnType<typeof createGameState>) =>
      updatePlayer(game, 'p2', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          placeCardInSlot(
            placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'opp-a'),
            SlotPosition.CENTER,
            'opp-b'
          ),
          SlotPosition.RIGHT,
          'opp-c'
        ),
      }));

    const oneSeras = createSeras('one-seras');
    const threeSeras = createSeras('three-seras');
    const ownA = createMember('own-a', 'p1');
    const ownB = createMember('own-b', 'p1');
    const opponents = ['opp-a', 'opp-b', 'opp-c'].map((id) => createMember(id, 'p2'));

    let oneMemberGame = createGameState('hs-pb1-007-own-one', 'p1', 'P1', 'p2', 'P2');
    oneMemberGame = registerCards(oneMemberGame, [oneSeras, ...opponents]);
    oneMemberGame = updatePlayer(oneMemberGame, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, oneSeras.instanceId),
    }));
    oneMemberGame = buildOpponentThree(oneMemberGame);

    let threeMemberGame = createGameState('hs-pb1-007-own-three', 'p1', 'P1', 'p2', 'P2');
    threeMemberGame = registerCards(threeMemberGame, [threeSeras, ownA, ownB, ...opponents]);
    threeMemberGame = updatePlayer(threeMemberGame, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, ownA.instanceId),
          SlotPosition.CENTER,
          threeSeras.instanceId
        ),
        SlotPosition.RIGHT,
        ownB.instanceId
      ),
    }));
    threeMemberGame = buildOpponentThree(threeMemberGame);

    for (const game of [oneMemberGame, threeMemberGame]) {
      expect(
        collectLiveModifiers(game).some(
          (modifier) => modifier.abilityId === HS_PB1_007_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('does not add PL!HS-pb1-007 purple Heart when opponent has fewer than three members', () => {
    const seras = createCardInstance(
      {
        cardCode: 'PL!HS-pb1-007-R',
        name: 'セラス 柳田 リリエンフェルト',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 4,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'pb1-007-low-opponent-seras'
    );
    const ownOther = createCardInstance(
      {
        cardCode: 'PL!HS-test-own-other-low-opponent',
        name: 'Own Other',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'own-other-low-opponent'
    );
    const opponent = createCardInstance(
      {
        cardCode: 'PL!HS-test-low-opponent',
        name: 'Low Opponent',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p2',
      'low-opponent'
    );
    let game = createGameState('hs-pb1-007-opponent-low', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [seras, ownOther, opponent]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, seras.instanceId),
        SlotPosition.LEFT,
        ownOther.instanceId
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId),
    }));

    expect(
      collectLiveModifiers(game).some(
        (modifier) => modifier.abilityId === HS_PB1_007_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('adds purple Heart to PL!HS-bp5-016 when opponent has at least two WAITING members', () => {
    const izumi = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-016-N',
        name: '桂城 泉',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 2,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'bp5-016-izumi'
    );
    const opponentMembers = [0, 1].map((index) =>
      createCardInstance(
        {
          cardCode: `PL!HS-test-waiting-opponent-${index}`,
          name: `Waiting Opponent ${index}`,
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        'p2',
        `waiting-opponent-${index}`
      )
    );
    let game = createGameState('hs-bp5-016-continuous-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [izumi, ...opponentMembers]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, izumi.instanceId),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, opponentMembers[0]!.instanceId, {
          orientation: OrientationState.WAITING,
        }),
        SlotPosition.CENTER,
        opponentMembers[1]!.instanceId,
        { orientation: OrientationState.WAITING }
      ),
    }));

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      sourceCardId: izumi.instanceId,
      abilityId: HS_BP5_016_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', izumi.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.GREEN, 1),
      createHeartIcon(HeartColor.PURPLE, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('does not add PL!HS-bp5-016 purple Heart with fewer than two opponent WAITING members', () => {
    const izumi = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-016-N',
        name: '桂城 泉',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 2,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'bp5-016-one-waiting'
    );
    const waitingOpponent = createCardInstance(
      {
        cardCode: 'PL!HS-test-one-waiting-opponent',
        name: 'One Waiting Opponent',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p2',
      'one-waiting-opponent'
    );
    const activeOpponent = createCardInstance(
      {
        cardCode: 'PL!HS-test-active-opponent',
        name: 'Active Opponent',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p2',
      'active-opponent'
    );
    let game = createGameState('hs-bp5-016-opponent-one-waiting', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [izumi, waitingOpponent, activeOpponent]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, izumi.instanceId),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, waitingOpponent.instanceId, {
          orientation: OrientationState.WAITING,
        }),
        SlotPosition.CENTER,
        activeOpponent.instanceId
      ),
    }));

    expect(
      collectLiveModifiers(game).some(
        (modifier) => modifier.abilityId === HS_BP5_016_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not count own WAITING members for PL!HS-bp5-016', () => {
    const izumi = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-016-N',
        name: '桂城 泉',
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 2,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'bp5-016-own-waiting'
    );
    const ownWaiting = createCardInstance(
      {
        cardCode: 'PL!HS-test-own-waiting',
        name: 'Own Waiting',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'own-waiting'
    );
    const opponentWaiting = createCardInstance(
      {
        cardCode: 'PL!HS-test-single-opponent-waiting',
        name: 'Single Opponent Waiting',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p2',
      'single-opponent-waiting'
    );
    let game = createGameState('hs-bp5-016-own-waiting-does-not-count', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [izumi, ownWaiting, opponentWaiting]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, izumi.instanceId),
        SlotPosition.LEFT,
        ownWaiting.instanceId,
        { orientation: OrientationState.WAITING }
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        opponentWaiting.instanceId,
        {
          orientation: OrientationState.WAITING,
        }
      ),
    }));

    expect(
      collectLiveModifiers(game).some(
        (modifier) => modifier.abilityId === HS_BP5_016_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
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

  it('collects PL!-bp4-018 as BLADE +2 when own successful LIVE score is higher', () => {
    const nico = createCardInstance(
      {
        cardCode: 'PL!-bp4-018-N',
        name: '矢澤にこ',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'bp4-018-nico'
    );
    const ownLive = createCardInstance(
      {
        cardCode: 'OWN-SCORE-SIX-LIVE',
        name: 'Own Score Six',
        cardType: CardType.LIVE,
        score: 6,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'own-score-six-live'
    );
    const opponentLive = createCardInstance(
      {
        cardCode: 'OPPONENT-SCORE-FOUR-LIVE',
        name: 'Opponent Score Four',
        cardType: CardType.LIVE,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p2',
      'opponent-score-four-live'
    );

    let game = createGameState('bp4-018-score-lead', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [nico, ownLive, opponentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, nico.instanceId),
      successZone: addCardToZone(player.successZone, ownLive.instanceId),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, opponentLive.instanceId),
    }));

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: nico.instanceId,
      abilityId: BP4_018_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', nico.instanceId, modifiers)).toBe(3);
  });

  it('does not collect PL!-bp4-018 BLADE when successful LIVE score is tied or behind', () => {
    const nico = createCardInstance(
      {
        cardCode: 'PL!-bp4-018-N',
        name: '矢澤にこ',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'bp4-018-nico-no-lead'
    );
    const ownLive = createCardInstance(
      {
        cardCode: 'OWN-SCORE-FOUR-LIVE',
        name: 'Own Score Four',
        cardType: CardType.LIVE,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'own-score-four-live'
    );
    const opponentLive = createCardInstance(
      {
        cardCode: 'OPPONENT-SCORE-FOUR-LIVE',
        name: 'Opponent Score Four',
        cardType: CardType.LIVE,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p2',
      'opponent-score-four-live-tied'
    );
    const opponentHigherLive = createCardInstance(
      {
        cardCode: 'OPPONENT-SCORE-SIX-LIVE',
        name: 'Opponent Score Six',
        cardType: CardType.LIVE,
        score: 6,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p2',
      'opponent-score-six-live'
    );

    let game = createGameState('bp4-018-score-no-lead', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [nico, ownLive, opponentLive, opponentHigherLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, nico.instanceId),
      successZone: addCardToZone(player.successZone, ownLive.instanceId),
    }));
    const tiedGame = updatePlayer(game, 'p2', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, opponentLive.instanceId),
    }));
    const behindGame = updatePlayer(game, 'p2', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, opponentHigherLive.instanceId),
    }));

    for (const state of [tiedGame, behindGame]) {
      const modifiers = collectLiveModifiers(state);
      expect(
        modifiers.some(
          (modifier) =>
            modifier.kind === 'BLADE' && modifier.abilityId === BP4_018_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
      expect(getMemberEffectiveBladeCount(state, 'p1', nico.instanceId, modifiers)).toBe(1);
    }
  });

  it('ignores non-LIVE cards in success zones for PL!-bp4-018 score comparison', () => {
    const nico = createCardInstance(
      {
        cardCode: 'PL!-bp4-018-N',
        name: '矢澤にこ',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'bp4-018-nico-ignore-non-live'
    );
    const ownLive = createCardInstance(
      {
        cardCode: 'OWN-SCORE-TWO-LIVE',
        name: 'Own Score Two',
        cardType: CardType.LIVE,
        score: 2,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'own-score-two-live'
    );
    const nonLiveSuccessCard = createCardInstance(
      {
        cardCode: 'NON-LIVE-SUCCESS-CARD',
        name: 'Non Live Success Card',
        cardType: CardType.MEMBER,
        cost: 99,
        blade: 1,
        hearts: [],
      },
      'p1',
      'non-live-success-card'
    );
    const opponentLive = createCardInstance(
      {
        cardCode: 'OPPONENT-SCORE-THREE-LIVE',
        name: 'Opponent Score Three',
        cardType: CardType.LIVE,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p2',
      'opponent-score-three-live'
    );

    let game = createGameState('bp4-018-ignore-non-live-success', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [nico, ownLive, nonLiveSuccessCard, opponentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, nico.instanceId),
      successZone: addCardToZone(
        addCardToZone(player.successZone, ownLive.instanceId),
        nonLiveSuccessCard.instanceId
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, opponentLive.instanceId),
    }));

    const modifiers = collectLiveModifiers(game);
    expect(
      modifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' && modifier.abilityId === BP4_018_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
    expect(getMemberEffectiveBladeCount(game, 'p1', nico.instanceId, modifiers)).toBe(1);
  });

  function setupNPr024ContinuousGame(
    ownSuccessCount: number,
    opponentSuccessCount: number,
    sourceOnStage = true,
    sourceCardCode = 'PL!N-PR-024-PR',
    sourceName = '桜坂しずく',
    sourceId = 'n-pr-024-shizuku'
  ): {
    readonly game: ReturnType<typeof createGameState>;
    readonly sourceId: string;
  } {
    const source = createCardInstance(
      {
        cardCode: sourceCardCode,
        name: sourceName,
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      sourceId
    );
    const ownLives = Array.from({ length: ownSuccessCount }, (_, index) =>
      createCardInstance(
        {
          cardCode: `PL!N-success-live-${index}`,
          name: `Own Success Live ${index}`,
          cardType: CardType.LIVE,
          score: 1,
          requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
        },
        'p1',
        `own-success-live-${index}`
      )
    );
    const opponentLives = Array.from({ length: opponentSuccessCount }, (_, index) =>
      createCardInstance(
        {
          cardCode: `PL!N-opponent-success-live-${index}`,
          name: `Opponent Success Live ${index}`,
          cardType: CardType.LIVE,
          score: 1,
          requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
        },
        'p2',
        `opponent-success-live-${index}`
      )
    );
    let game = createGameState('n-pr-024-continuous', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, ...ownLives, ...opponentLives]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: sourceOnStage
        ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId)
        : player.memberSlots,
      successZone: ownLives.reduce(
        (zone, live) => addCardToZone(zone, live.instanceId),
        player.successZone
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      successZone: opponentLives.reduce(
        (zone, live) => addCardToZone(zone, live.instanceId),
        player.successZone
      ),
    }));
    return { game, sourceId: source.instanceId };
  }

  it('collects PL!N-PR-024 BLADE +2 when both success LIVE zones total four cards', () => {
    const { game, sourceId } = setupNPr024ContinuousGame(2, 2);

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: sourceId,
      abilityId: N_PR_024_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', sourceId, modifiers)).toBe(3);
  });

  it('does not collect PL!N-PR-024 BLADE when both success LIVE zones total three cards', () => {
    const { game, sourceId } = setupNPr024ContinuousGame(2, 1);

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === sourceId &&
          modifier.abilityId === N_PR_024_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('collects PL!N-PR-024 BLADE +2 when the total four success LIVE cards are all own cards', () => {
    const { game, sourceId } = setupNPr024ContinuousGame(4, 0);

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: sourceId,
      abilityId: N_PR_024_CONTINUOUS_ABILITY_ID,
    });
  });

  it('does not collect PL!N-PR-024 BLADE when the source is not on stage', () => {
    const { game, sourceId } = setupNPr024ContinuousGame(2, 2, false);

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === sourceId &&
          modifier.abilityId === N_PR_024_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('collects PL!S-PR-039 BLADE +2 when both success LIVE zones total four cards', () => {
    const { game, sourceId } = setupNPr024ContinuousGame(
      1,
      3,
      true,
      'PL!S-PR-039-PR',
      '渡辺 曜',
      's-pr-039-you'
    );

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: sourceId,
      abilityId: N_PR_024_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', sourceId, modifiers)).toBe(3);
  });

  it('does not collect PL!S-PR-039 BLADE when both success LIVE zones total three cards', () => {
    const { game, sourceId } = setupNPr024ContinuousGame(
      1,
      2,
      true,
      'PL!S-PR-039-PR',
      '渡辺 曜',
      's-pr-039-you-three'
    );

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === sourceId &&
          modifier.abilityId === N_PR_024_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not collect PL!S-PR-039 BLADE when the source is not on stage', () => {
    const { game, sourceId } = setupNPr024ContinuousGame(
      2,
      2,
      false,
      'PL!S-PR-039-PR',
      '渡辺 曜',
      's-pr-039-you-offstage'
    );

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === sourceId &&
          modifier.abilityId === N_PR_024_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  function setupLanzhuBp1012ContinuousGame(options: {
    readonly liveGroups: readonly string[];
    readonly sourceOnStage?: boolean;
  }): {
    readonly game: ReturnType<typeof createGameState>;
    readonly sourceId: string;
  } {
    const source = createCardInstance(
      {
        cardCode: 'PL!N-bp1-012-SEC',
        name: '鐘 嵐珠',
        groupName: '虹ヶ咲学園スクールアイドル同好会',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'n-bp1-012-lanzhu'
    );
    const liveCards = options.liveGroups.map((groupName, index) =>
      createCardInstance(
        {
          cardCode: `${getTestLiveCardCodePrefix(groupName)}-bp1-012-test-live-${index}`,
          name: `Live ${index}`,
          groupName,
          cardType: CardType.LIVE,
          score: 1,
          requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
        },
        'p1',
        `n-bp1-012-test-live-${index}`
      )
    );

    let game = createGameState('n-bp1-012-continuous', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, ...liveCards]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots:
        options.sourceOnStage === false
          ? player.memberSlots
          : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
      liveZone: liveCards.reduce(
        (zone, live) => addCardToStatefulZone(zone, live.instanceId),
        player.liveZone
      ),
    }));

    return { game, sourceId: source.instanceId };
  }

  it('collects PL!N-bp1-012 ALL Heart x2 and BLADE +2 with three live cards including Nijigasaki LIVE', () => {
    const { game, sourceId } = setupLanzhuBp1012ContinuousGame({
      liveGroups: ['虹ヶ咲学園スクールアイドル同好会', 'Aqours', 'Liella!'],
    });

    const modifiers = collectLiveModifiers(game);
    const visibilityDependency = {
      kind: 'PLAYER_LIVE_ZONE_CONTENTS',
      playerId: 'p1',
    };

    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.RAINBOW, 2)],
      sourceCardId: sourceId,
      abilityId: PL_N_BP1_012_CONTINUOUS_ABILITY_ID,
      visibilityDependency,
    });
    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: sourceId,
      abilityId: PL_N_BP1_012_CONTINUOUS_ABILITY_ID,
      visibilityDependency,
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', sourceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.RAINBOW, 2),
    ]);
    expect(getMemberEffectiveBladeCount(game, 'p1', sourceId, modifiers)).toBe(3);
  });

  it('does not collect PL!N-bp1-012 modifiers with fewer than three live cards', () => {
    const { game, sourceId } = setupLanzhuBp1012ContinuousGame({
      liveGroups: ['虹ヶ咲学園スクールアイドル同好会', 'Aqours'],
    });

    expect(collectLiveModifiers(game).some((modifier) => modifier.sourceCardId === sourceId)).toBe(
      false
    );
  });

  it('does not collect PL!N-bp1-012 modifiers when three live cards include no Nijigasaki LIVE', () => {
    const { game, sourceId } = setupLanzhuBp1012ContinuousGame({
      liveGroups: ['Aqours', 'Liella!', '蓮ノ空'],
    });

    expect(collectLiveModifiers(game).some((modifier) => modifier.sourceCardId === sourceId)).toBe(
      false
    );
  });

  it('does not collect PL!N-bp1-012 modifiers when source is not on stage', () => {
    const { game, sourceId } = setupLanzhuBp1012ContinuousGame({
      liveGroups: ['虹ヶ咲学園スクールアイドル同好会', 'Aqours', 'Liella!'],
      sourceOnStage: false,
    });

    expect(collectLiveModifiers(game).some((modifier) => modifier.sourceCardId === sourceId)).toBe(
      false
    );
  });

  function getTestLiveCardCodePrefix(groupName: string): string {
    if (groupName.includes('虹')) {
      return 'PL!N';
    }
    if (groupName.includes('Aqours')) {
      return 'PL!S';
    }
    if (groupName.includes('Liella')) {
      return 'PL!SP';
    }
    return 'PL!HS';
  }

  it('collects bp6 success-zone unit continuous Hearts as SOURCE_MEMBER Hearts', () => {
    const cases = [
      {
        sourceCardCode: 'PL!-bp6-012-N',
        sourceName: '南ことり',
        sourceId: 'bp6-012-kotori',
        successCardData: {
          cardCode: 'PL!-success-printemps-live',
          name: 'Printemps Live',
          unitName: 'Printemps',
          cardType: CardType.LIVE,
          score: 4,
          requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
        },
        successId: 'printemps-success',
        heartColor: HeartColor.YELLOW,
        abilityId: BP6_012_CONTINUOUS_ABILITY_ID,
      },
      {
        sourceCardCode: 'PL!-bp6-014-N',
        sourceName: '星空 凛',
        sourceId: 'bp6-014-rin',
        successCardData: {
          cardCode: 'PL!-success-lilywhite-card',
          name: 'lilywhite Card',
          unitName: 'lilywhite',
          cardType: CardType.MEMBER,
          cost: 1,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.PINK, 1)],
        },
        successId: 'lilywhite-success',
        heartColor: HeartColor.PINK,
        abilityId: BP6_014_CONTINUOUS_ABILITY_ID,
      },
      {
        sourceCardCode: 'PL!-bp6-015-N',
        sourceName: '西木野真姫',
        sourceId: 'bp6-015-maki',
        successCardData: {
          cardCode: 'PL!-success-bibi-live',
          name: 'BiBi Live',
          cardText: '成功区の『BiBi』のカード',
          cardType: CardType.LIVE,
          score: 4,
          requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
        },
        successId: 'bibi-success',
        heartColor: HeartColor.PURPLE,
        abilityId: BP6_015_CONTINUOUS_ABILITY_ID,
      },
    ] as const;

    for (const testCase of cases) {
      const source = createCardInstance(
        {
          cardCode: testCase.sourceCardCode,
          name: testCase.sourceName,
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.PINK, 1)],
        },
        'p1',
        testCase.sourceId
      );
      const successCard = createCardInstance(testCase.successCardData, 'p1', testCase.successId);
      let game = createGameState(
        `${testCase.sourceCardCode}-success-zone-heart`,
        'p1',
        'P1',
        'p2',
        'P2'
      );
      game = registerCards(game, [source, successCard]);
      game = updatePlayer(game, 'p1', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
        successZone: addCardToZone(player.successZone, successCard.instanceId),
      }));

      const modifiers = collectLiveModifiers(game);

      expect(modifiers).toContainEqual({
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        playerId: 'p1',
        hearts: [createHeartIcon(testCase.heartColor, 1)],
        sourceCardId: source.instanceId,
        abilityId: testCase.abilityId,
      });
      expect(getMemberEffectiveHeartIcons(game, 'p1', source.instanceId, modifiers)).toEqual([
        createHeartIcon(HeartColor.PINK, 1),
        createHeartIcon(testCase.heartColor, 1),
      ]);
      expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
      expect(game.liveResolution.playerHeartBonuses.has('p1')).toBe(false);
    }
  });

  it('does not collect bp6 success-zone unit Heart from empty, other-unit, or opponent success zones', () => {
    const kotori = createCardInstance(
      {
        cardCode: 'PL!-bp6-012-N',
        name: '南ことり',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      },
      'p1',
      'bp6-012-kotori-negative'
    );
    const lilywhiteLive = createCardInstance(
      {
        cardCode: 'PL!-success-lilywhite-live-negative',
        name: 'lilywhite Live',
        unitName: 'lilywhite',
        cardType: CardType.LIVE,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'lilywhite-success-negative'
    );
    const opponentPrintempsLive = createCardInstance(
      {
        cardCode: 'PL!-opponent-printemps-live',
        name: 'Opponent Printemps Live',
        unitName: 'Printemps',
        cardType: CardType.LIVE,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
      },
      'p2',
      'opponent-printemps-success'
    );

    let emptySuccessGame = createGameState('bp6-012-empty-success-zone', 'p1', 'P1', 'p2', 'P2');
    emptySuccessGame = registerCards(emptySuccessGame, [kotori]);
    emptySuccessGame = updatePlayer(emptySuccessGame, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kotori.instanceId),
    }));
    expect(
      collectLiveModifiers(emptySuccessGame).some(
        (modifier) => modifier.abilityId === BP6_012_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);

    let otherUnitGame = registerCards(emptySuccessGame, [lilywhiteLive]);
    otherUnitGame = updatePlayer(otherUnitGame, 'p1', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, lilywhiteLive.instanceId),
    }));
    expect(
      collectLiveModifiers(otherUnitGame).some(
        (modifier) => modifier.abilityId === BP6_012_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);

    let opponentSuccessGame = registerCards(emptySuccessGame, [opponentPrintempsLive]);
    opponentSuccessGame = updatePlayer(opponentSuccessGame, 'p2', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, opponentPrintempsLive.instanceId),
    }));
    expect(
      collectLiveModifiers(opponentSuccessGame).some(
        (modifier) => modifier.abilityId === BP6_012_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
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
      modifier.abilityId === 'PL!SP-bp5-012:continuous-liella-live-requirement-eight-yellow-heart'
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

function createSpPb2EnergyHeartState(options: {
  readonly cardCode: string;
  readonly energyOrientations: readonly OrientationState[];
  readonly sourcePlacement?: 'MAIN_STAGE' | 'OFF_STAGE' | 'MEMBER_BELOW';
}) {
  const source = createCardInstance(
    {
      cardCode: options.cardCode,
      name: options.cardCode,
      groupName: 'Liella!',
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    `${options.cardCode}-source`
  );
  const host = createCardInstance(
    {
      cardCode: 'PL!SP-test-host',
      name: 'Host',
      groupName: 'Liella!',
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    `${options.cardCode}-host`
  );
  const energyCards = options.energyOrientations.map((_, index) =>
    createCardInstance(
      {
        cardCode: `PL!SP-test-energy-${index + 1}`,
        name: `Energy ${index + 1}`,
        cardType: CardType.ENERGY,
      },
      'p1',
      `${options.cardCode}-energy-${index + 1}`
    )
  );
  let game = createGameState(`${options.cardCode}-continuous-heart`, 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, [source, host, ...energyCards]);
  game = updatePlayer(game, 'p1', (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourcePlacement === 'MEMBER_BELOW') {
      memberSlots = addMemberBelowMember(
        placeCardInSlot(memberSlots, SlotPosition.CENTER, host.instanceId),
        SlotPosition.CENTER,
        source.instanceId
      );
    } else if (options.sourcePlacement !== 'OFF_STAGE') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId);
    }

    return {
      ...player,
      memberSlots,
      energyZone: energyCards.reduce(
        (zone, card, index) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: options.energyOrientations[index],
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    };
  });

  return {
    game,
    sourceId: source.instanceId,
  };
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

function createAqoursLiveData(cardCode: string, name: string, score = 1) {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    groupName: 'Aqours',
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

describe('PL!N-pb1-011 continuous energyBelow BLADE', () => {
  function setupMiaEnergyBelowScenario(options: {
    readonly energyBelowCount?: number;
    readonly sourcePlacement?: 'STAGE' | 'MEMBER_BELOW' | 'OFF_STAGE';
    readonly addEnergyBelowOtherSlot?: boolean;
    readonly sourceOwner?: 'p1' | 'p2';
  } = {}) {
    const sourceOwner = options.sourceOwner ?? 'p1';
    const mia = createCardInstance(
      {
        cardCode: 'PL!N-pb1-011-R',
        name: 'ミア・テイラー',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 5,
        hearts: [createHeartIcon(HeartColor.BLUE, 2)],
        groupName: '虹ヶ咲',
      },
      sourceOwner,
      'mia'
    );
    const host = createCardInstance(
      {
        cardCode: 'HOST-MEMBER',
        name: 'Host',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'host'
    );
    const energies = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(
        {
          cardCode: `ENE-${index}`,
          name: `Energy ${index}`,
          cardType: CardType.ENERGY,
        },
        'p1',
        `energy-${index}`
      )
    );
    let game = createGameState('n-pb1-011-continuous', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [mia, host, ...energies]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = player.memberSlots;
      if (options.sourcePlacement === 'MEMBER_BELOW') {
        memberSlots = addMemberBelowMember(
          placeCardInSlot(memberSlots, SlotPosition.CENTER, host.instanceId),
          SlotPosition.CENTER,
          mia.instanceId
        );
      } else if (options.sourcePlacement !== 'OFF_STAGE') {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, mia.instanceId);
      }
      for (const energy of energies.slice(0, options.energyBelowCount ?? 0)) {
        memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, energy.instanceId);
      }
      if (options.addEnergyBelowOtherSlot === true) {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, host.instanceId);
        memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.LEFT, energies[2]!.instanceId);
      }
      return { ...player, memberSlots };
    });
    return { game, mia };
  }

  it('grants BLADE equal to the number of energy cards below this member', () => {
    for (const [energyBelowCount, expectedDelta] of [
      [0, 0],
      [1, 1],
      [2, 2],
    ] as const) {
      const { game, mia } = setupMiaEnergyBelowScenario({ energyBelowCount });
      const modifiers = collectLiveModifiers(game).filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === PL_N_PB1_011_CONTINUOUS_ABILITY_ID
      );
      if (expectedDelta === 0) {
        expect(modifiers).toEqual([]);
      } else {
        expect(modifiers).toContainEqual({
          kind: 'BLADE',
          playerId: 'p1',
          countDelta: expectedDelta,
          sourceCardId: mia.instanceId,
          abilityId: PL_N_PB1_011_CONTINUOUS_ABILITY_ID,
        });
      }
      expect(getMemberEffectiveBladeCount(game, 'p1', mia.instanceId)).toBe(5 + expectedDelta);
    }
  });

  it('does not count energy below other slots, off-stage sources, memberBelow sources, or opponent-owned cards', () => {
    for (const scenario of [
      setupMiaEnergyBelowScenario({ energyBelowCount: 0, addEnergyBelowOtherSlot: true }),
      setupMiaEnergyBelowScenario({ energyBelowCount: 2, sourcePlacement: 'OFF_STAGE' }),
      setupMiaEnergyBelowScenario({ energyBelowCount: 2, sourcePlacement: 'MEMBER_BELOW' }),
      setupMiaEnergyBelowScenario({ energyBelowCount: 2, sourceOwner: 'p2' }),
    ]) {
      expect(
        collectLiveModifiers(scenario.game).some(
          (modifier) =>
            modifier.kind === 'BLADE' &&
            modifier.abilityId === PL_N_PB1_011_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });
});
