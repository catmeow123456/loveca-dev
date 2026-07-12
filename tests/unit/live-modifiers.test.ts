import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updateLiveResolution,
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
  addPlayerScoreLiveModifierForTargetMember,
  addMemberCostLiveModifierForMember,
  addMemberCostSetLiveModifierForMember,
  addLiveModifier,
  collectLiveModifiers,
  createHeartLiveModifierForMember,
  getLiveCardRequirementModifiers,
  getLiveCardScoreModifier,
  getCheerCardEffectiveBladeHearts,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
  memberHasMoreEffectiveHeartsThanPrinted,
  getPlayerLiveBladeModifier,
  getPlayerLiveHeartModifiers,
  getPlayerLiveScoreModifier,
  projectLiveModifierCompatibility,
  replaceLiveModifier,
  removeTargetMemberBoundLiveModifiers,
} from '../../src/domain/rules/live-modifiers';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { costLte } from '../../src/application/effects/card-selectors';
import { fromTransport, toTransport } from '../../src/online/serde';
import {
  CardType,
  BladeHeartEffect,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

const HS_BP5_002_CONTINUOUS_ABILITY_ID =
  'PL!HS-bp5-002:continuous-three-different-stage-member-costs-blue-heart-blade';
const HS_BP5_004_CONTINUOUS_ABILITY_ID =
  'PL!HS-bp5-004:continuous-non-cerise-high-cost-stage-members-gain-blade';
const HS_BP2_002_CONTINUOUS_ABILITY_ID =
  'PL!HS-bp2-002:continuous-other-higher-cost-gain-three-blade';
const HS_BP5_007_CONTINUOUS_ABILITY_ID = 'PL!HS-bp5-007:continuous-other-edelnote-member-blade';
const HS_BP2_006_CONTINUOUS_ABILITY_ID =
  'PL!HS-bp2-006:continuous-other-miracra-stage-member-blade';
const HS_BP6_002_CONTINUOUS_ABILITY_ID = 'PL!HS-bp6-002:continuous-alone-gain-two-blade';
const HS_PB1_015_CONTINUOUS_ABILITY_ID =
  'PL!HS-pb1-015-R:continuous-alone-lose-three-blade';
const PL_N_PB1_011_CONTINUOUS_ABILITY_ID = 'PL!N-pb1-011:continuous-energy-below-gain-blade';
const PL_PB1_002_CONTINUOUS_ABILITY_ID =
  'PL!-pb1-002:continuous-opponent-waiting-gain-purple-heart';
const PL_BP3_002_CONTINUOUS_ABILITY_ID =
  'PL!-bp3-002:continuous-opponent-waiting-gain-blade';
const HS_BP5_016_CONTINUOUS_ABILITY_ID =
  'PL!HS-bp5-016-N:continuous-opponent-two-waiting-purple-heart';
const HS_PB1_007_CONTINUOUS_ABILITY_ID =
  'PL!HS-pb1-007:continuous-exact-two-own-opponent-three-purple-heart';
const HS_PB1_022_CONTINUOUS_RURINO_ABILITY_ID =
  'PL!HS-pb1-022:continuous-rurino-stage-gain-two-pink-heart';
const HS_PB1_022_CONTINUOUS_MEGU_ABILITY_ID =
  'PL!HS-pb1-022:continuous-megu-stage-gain-two-blade';
const HS_SD1_004_CONTINUOUS_ABILITY_ID =
  'PL!HS-sd1-004-SD:continuous-stage-kaho-kosuzu-hime-green-heart';
const HS_SD1_005_CONTINUOUS_ABILITY_ID =
  'PL!HS-sd1-005-SD:continuous-stage-sayaka-ginko-hime-blade';
const S_BP6_009_CONTINUOUS_ABILITY_ID =
  'PL!S-bp6-009:continuous-success-live-difference-gain-blade';
const PL_S_PB1_005_CONTINUOUS_ABILITY_ID =
  'PL!S-pb1-005:continuous-opponent-energy-more-gain-three-blade';
const PL_S_PB1_009_CONTINUOUS_ABILITY_ID =
  'PL!S-pb1-009:continuous-total-success-live-three-gain-three-blade';
const PL_N_PB1_007_CONTINUOUS_ABILITY_ID =
  'PL!N-pb1-007:continuous-live-requirement-six-colors-gain-all-heart';
const SP_PB2_023_CONTINUOUS_ABILITY_ID = 'PL!SP-pb2-023:continuous-energy-six-eight-gain-red-heart';
const SP_PB2_026_CONTINUOUS_ABILITY_ID =
  'PL!SP-pb2-026:continuous-active-energy-gain-two-red-heart';
const SP_PB2_027_CONTINUOUS_ABILITY_ID =
  'PL!SP-pb2-027:continuous-energy-six-eight-gain-yellow-heart';
const SP_PB2_032_CONTINUOUS_ABILITY_ID =
  'PL!SP-pb2-032:continuous-energy-six-eight-gain-purple-heart';
const SP_PB2_035_CONTINUOUS_ABILITY_ID = 'PL!SP-pb2-035:continuous-left-side-gain-two-blade';
const SP_PB2_041_CONTINUOUS_ABILITY_ID = 'PL!SP-pb2-041:continuous-right-side-gain-two-blade';
const SP_BP5_011_CONTINUOUS_ABILITY_ID = 'PL!SP-bp5-011:continuous-slot-hearts';
const SP_BP5_016_CONTINUOUS_ABILITY_ID =
  'PL!SP-bp5-016:continuous-energy-ten-gain-two-purple-heart';
const SP_BP5_111_CONTINUOUS_ABILITY_ID =
  'PL!SP-bp5-111:continuous-energy-exact-eight-live-score';
const SP_BP5_222_CONTINUOUS_ABILITY_ID =
  'PL!SP-bp5-222:continuous-energy-exact-eight-live-score';
const SP_PB1_002_CONTINUOUS_ABILITY_ID =
  'PL!SP-pb1-002:continuous-energy-twelve-live-score';
const SP_PR_022_CONTINUOUS_ABILITY_ID =
  'PL!SP-PR-022-PR:continuous-total-stage-six-gain-red-yellow-heart';
const SP_PR_025_CONTINUOUS_ABILITY_ID =
  'PL!SP-PR-025-PR:continuous-energy-exact-seven-gain-two-blade';
const SP_BP4_003_CONTINUOUS_ABILITY_ID = 'PL!SP-bp4-003:continuous-center-gain-two-blade';
const SP_BP4_009_CONTINUOUS_ABILITY_ID =
  'PL!SP-bp4-009:continuous-lower-stage-cost-gain-three-blade';
const SP_BP4_021_CONTINUOUS_ABILITY_ID =
  'PL!SP-bp4-021:continuous-more-energy-gain-purple-heart';
const SP_SD2_004_CONTINUOUS_ABILITY_ID =
  'PL!SP-sd2-004:continuous-center-gain-four-blade';
const SP_SD2_008_CONTINUOUS_ABILITY_ID =
  'PL!SP-sd2-008:continuous-high-cost-stage-member-gain-yellow-heart';
const BP6_012_CONTINUOUS_ABILITY_ID =
  'PL!-bp6-012:continuous-success-zone-printemps-card-yellow-heart';
const BP6_014_CONTINUOUS_ABILITY_ID =
  'PL!-bp6-014:continuous-success-zone-lilywhite-card-pink-heart';
const BP6_015_CONTINUOUS_ABILITY_ID = 'PL!-bp6-015:continuous-success-zone-bibi-card-purple-heart';
const BP6_009_CONTINUOUS_ABILITY_ID = 'PL!-bp6-009:continuous-center-side-printed-blade-two-score';
const BP4_005_CONTINUOUS_ABILITY_ID = 'PL!-bp4-005:continuous-center-score-plus-one';
const BP4_018_CONTINUOUS_ABILITY_ID = 'PL!-bp4-018:continuous-success-score-lead-gain-two-blade';
const N_PR_024_CONTINUOUS_ABILITY_ID =
  'PL!N-PR-024-PR:continuous-success-live-total-four-gain-two-blade';
const PL_N_BP1_012_CONTINUOUS_ABILITY_ID =
  'PL!N-bp1-012:continuous-live-zone-three-nijigasaki-live-gain-all-heart-blade';
const SP_BP2_010_CONTINUOUS_REQUIREMENT_ABILITY_ID =
  'PL!SP-bp2-010:continuous-opponent-live-requirement-plus-one';
const N_BP5_002_CONTINUOUS_ABILITY_ID =
  'PL!N-bp5-002:continuous-stage-most-hearts-live-score';
const S_BP5_008_CONTINUOUS_ABILITY_ID =
  'PL!S-bp5-008:continuous-opponent-remaining-heart-score';
const S_BP5_010_CONTINUOUS_REQUIREMENT_ABILITY_ID =
  'PL!S-bp5-010:continuous-red-heart-five-opponent-live-requirement-plus-one';
const S_BP5_011_CONTINUOUS_REQUIREMENT_ABILITY_ID =
  'PL!S-bp5-011:continuous-blue-heart-five-opponent-live-requirement-plus-one';

function createStageMember(
  cardCode: string,
  ownerId: string,
  instanceId: string,
  heartCount: number
) {
  return createCardInstance(
    {
      cardCode,
      name: cardCode,
      groupNames: ['虹ヶ咲'],
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, heartCount)],
    },
    ownerId,
    instanceId
  );
}

function placeMemberOnStage(
  game: ReturnType<typeof createGameState>,
  playerId: string,
  slot: SlotPosition,
  cardId: string
) {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function setRemainingHeartTotal(
  game: ReturnType<typeof createGameState>,
  playerId: string,
  count: number
) {
  return updateLiveResolution(game, (liveResolution) => {
    const playerRemainingHearts = new Map(liveResolution.playerRemainingHearts);
    playerRemainingHearts.set(
      playerId,
      count > 0 ? [createHeartIcon(HeartColor.GREEN, count)] : []
    );
    return {
      ...liveResolution,
      playerRemainingHearts,
    };
  });
}

describe('live modifier helpers', () => {
  it('replaces own cheer card Heart colors with purple without changing non-Heart cheer effects', () => {
    const ownCheer = createCardInstance(
      {
        cardCode: 'CHEER-OWN',
        name: 'Own Cheer',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 0,
        hearts: [],
        bladeHearts: [
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK },
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.RED },
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GREEN },
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE },
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW },
          { effect: BladeHeartEffect.DRAW },
          { effect: BladeHeartEffect.SCORE },
        ],
      },
      'p1',
      'own-cheer'
    );
    const opponentCheer = createCardInstance(
      {
        ...ownCheer.data,
        cardCode: 'CHEER-OPPONENT',
        name: 'Opponent Cheer',
      },
      'p2',
      'opponent-cheer'
    );
    let game = createGameState('cheer-heart-color-replacement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [ownCheer, opponentCheer]);
    game = addLiveModifier(game, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: 'p1',
      fromColors: [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.YELLOW,
        HeartColor.GREEN,
        HeartColor.BLUE,
        HeartColor.RAINBOW,
      ],
      toColor: HeartColor.PURPLE,
      sourceCardId: 'source-live',
      abilityId: 'test-cheer-heart-replacement',
    });

    expect(getCheerCardEffectiveBladeHearts(game, 'p1', ownCheer.instanceId)).toEqual([
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE },
      { effect: BladeHeartEffect.DRAW },
      { effect: BladeHeartEffect.SCORE },
    ]);
    expect(getCheerCardEffectiveBladeHearts(game, 'p2', opponentCheer.instanceId)).toEqual(
      opponentCheer.data.bladeHearts
    );
  });

  it('adds score when PL!N-bp5-002 has strictly more effective Hearts than every other stage member', () => {
    const source = createStageMember('PL!N-bp5-002-R', 'p1', 'n-bp5-002-source', 2);
    const ownOther = createStageMember('OTHER-OWN', 'p1', 'own-other', 1);
    const opponentOther = createStageMember('OTHER-OPPONENT', 'p2', 'opponent-other', 1);
    let game = createGameState('n-bp5-002-most-hearts', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, ownOther, opponentOther]);
    game = placeMemberOnStage(game, 'p1', SlotPosition.CENTER, source.instanceId);
    game = placeMemberOnStage(game, 'p1', SlotPosition.LEFT, ownOther.instanceId);
    game = placeMemberOnStage(game, 'p2', SlotPosition.RIGHT, opponentOther.instanceId);

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: source.instanceId,
      abilityId: N_BP5_002_CONTINUOUS_ABILITY_ID,
    });
  });

  it('does not add score when PL!N-bp5-002 ties another stage member Heart count', () => {
    const source = createStageMember('PL!N-bp5-002-R', 'p1', 'n-bp5-002-source', 2);
    const opponentOther = createStageMember('OTHER-OPPONENT', 'p2', 'opponent-other', 2);
    let game = createGameState('n-bp5-002-heart-tie', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, opponentOther]);
    game = placeMemberOnStage(game, 'p1', SlotPosition.CENTER, source.instanceId);
    game = placeMemberOnStage(game, 'p2', SlotPosition.RIGHT, opponentOther.instanceId);

    const modifiers = collectLiveModifiers(game);

    expect(
      modifiers.some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === N_BP5_002_CONTINUOUS_ABILITY_ID &&
          modifier.sourceCardId === source.instanceId
      )
    ).toBe(false);
  });

  it('uses existing live modifiers, without recursive collection, for PL!N-bp5-002 Heart comparison', () => {
    const source = createStageMember('PL!N-bp5-002-R', 'p1', 'n-bp5-002-source', 1);
    const opponentOther = createStageMember('OTHER-OPPONENT', 'p2', 'opponent-other', 2);
    let game = createGameState('n-bp5-002-effective-hearts', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, opponentOther]);
    game = placeMemberOnStage(game, 'p1', SlotPosition.CENTER, source.instanceId);
    game = placeMemberOnStage(game, 'p2', SlotPosition.RIGHT, opponentOther.instanceId);
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      sourceCardId: source.instanceId,
      abilityId: 'test-existing-heart',
      hearts: [createHeartIcon(HeartColor.YELLOW, 2)],
    });

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: source.instanceId,
      abilityId: N_BP5_002_CONTINUOUS_ABILITY_ID,
    });
  });

  it('adds SCORE +1 for PL!S-bp5-008 when opponent has at least two remaining Hearts', () => {
    const source = createStageMember('PL!S-bp5-008-R', 'p1', 's-bp5-008-source', 1);
    let game = createGameState('s-bp5-008-opponent-remaining-heart-score', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source]);
    game = placeMemberOnStage(game, 'p1', SlotPosition.CENTER, source.instanceId);
    game = setRemainingHeartTotal(game, 'p2', 2);

    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: source.instanceId,
      abilityId: S_BP5_008_CONTINUOUS_ABILITY_ID,
    });
    expect(
      modifiers.some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.playerId === 'p2' &&
          modifier.abilityId === S_BP5_008_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
    expect(game.liveResolution.playerRemainingHearts.get('p2')).toEqual([
      createHeartIcon(HeartColor.GREEN, 2),
    ]);
  });

  it('does not add PL!S-bp5-008 score when opponent has zero or one remaining Heart', () => {
    for (const remainingHeartCount of [0, 1]) {
      const source = createStageMember('PL!S-bp5-008-R', 'p1', 's-bp5-008-source', 1);
      let game = createGameState(
        `s-bp5-008-opponent-remaining-heart-${remainingHeartCount}`,
        'p1',
        'P1',
        'p2',
        'P2'
      );
      game = registerCards(game, [source]);
      game = placeMemberOnStage(game, 'p1', SlotPosition.CENTER, source.instanceId);
      game = setRemainingHeartTotal(game, 'p2', remainingHeartCount);

      const modifiers = collectLiveModifiers(game);

      expect(
        modifiers.some(
          (modifier) =>
            modifier.kind === 'SCORE' &&
            modifier.sourceCardId === source.instanceId &&
            modifier.abilityId === S_BP5_008_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
      expect(game.liveResolution.playerRemainingHearts.get('p2')).toEqual(
        remainingHeartCount > 0 ? [createHeartIcon(HeartColor.GREEN, remainingHeartCount)] : []
      );
    }
  });

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
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
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

  it('recognizes the Kosuzu identity on LL-bp6-001 for PL!HS-sd1-004', () => {
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
      'ginko-multi-name-check'
    );
    const llBp6001 = createCardInstance(
      {
        cardCode: 'LL-bp6-001-R＋',
        name: '南 ことり&黒澤ダイヤ&徒町小鈴',
        cardType: CardType.MEMBER,
        cost: 20,
        blade: 6,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'll-bp6-001'
    );
    let game = registerCards(
      createGameState('hs-sd1-004-multi-name', 'p1', 'P1', 'p2', 'P2'),
      [ginko, llBp6001]
    );
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ginko.instanceId),
        SlotPosition.LEFT,
        llBp6001.instanceId
      ),
    }));

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      sourceCardId: ginko.instanceId,
      abilityId: HS_SD1_004_CONTINUOUS_ABILITY_ID,
    });
  });

  it('collects PL!HS-bp5-004 BLADE +2 for each own high effective-cost non-Cerise stage member', () => {
    const ginko = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-004-R',
        name: '百生 吟子',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        unitName: 'スリーズブーケ',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'ginko-bp5-004'
    );
    const highCostDollchestra = createCardInstance(
      {
        cardCode: 'PL!HS-test-dollchestra',
        name: '村野さやか',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        unitName: 'DOLLCHESTRA',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'high-cost-dollchestra'
    );
    const lowCostMiracra = createCardInstance(
      {
        cardCode: 'PL!HS-test-miracra',
        name: '安養寺 姫芽',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        unitName: 'みらくらぱーく！',
        cardType: CardType.MEMBER,
        cost: 3,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'low-cost-miracra'
    );
    const highCostCerise = createCardInstance(
      {
        cardCode: 'PL!HS-test-cerise',
        name: '日野下花帆',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        unitName: 'スリーズブーケ',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      'p1',
      'high-cost-cerise'
    );
    const offStageHighCost = createCardInstance(
      {
        cardCode: 'PL!HS-test-offstage',
        name: '桂城 泉',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      },
      'p1',
      'off-stage-high-cost'
    );
    const opponentHighCost = createCardInstance(
      {
        cardCode: 'PL!HS-test-opponent-high',
        name: 'セラス 柳田 リリエンフェルト',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        unitName: 'EdelNote',
        cardType: CardType.MEMBER,
        cost: 13,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      },
      'p2',
      'opponent-high-cost'
    );
    let game = createGameState('hs-bp5-004-continuous-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [
      ginko,
      highCostDollchestra,
      lowCostMiracra,
      highCostCerise,
      offStageHighCost,
      opponentHighCost,
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [offStageHighCost.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ginko.instanceId),
          SlotPosition.LEFT,
          highCostDollchestra.instanceId
        ),
        SlotPosition.RIGHT,
        lowCostMiracra.instanceId
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponentHighCost.instanceId),
    }));

    let modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: ginko.instanceId,
      abilityId: HS_BP5_004_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', ginko.instanceId, modifiers)).toBe(3);

    game = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: 'p1',
      memberCardId: lowCostMiracra.instanceId,
      countDelta: 1,
      sourceCardId: ginko.instanceId,
      abilityId: 'test-effective-cost-plus-one',
    });
    modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 4,
      sourceCardId: ginko.instanceId,
      abilityId: HS_BP5_004_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveCost(game, 'p1', lowCostMiracra.instanceId)).toBe(4);
    expect(getMemberEffectiveBladeCount(game, 'p1', ginko.instanceId, modifiers)).toBe(5);

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...placeCardInSlot(player.memberSlots, SlotPosition.LEFT, highCostCerise.instanceId),
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.CENTER]: ginko.instanceId,
          [SlotPosition.LEFT]: highCostCerise.instanceId,
          [SlotPosition.RIGHT]: null,
        },
      },
    }));
    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_BP5_004_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('collects PL!S-bp6-009 BLADE equal to opponent success Live difference only when behind', () => {
    const ruby = createCardInstance(
      {
        cardCode: 'PL!S-bp6-009-P',
        name: '黒澤ルビィ',
        groupNames: ['Aqours'],
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
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
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
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
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
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
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

  it('collects PL!SP-PR-022 red and yellow SOURCE_MEMBER Hearts when total stage members is six', () => {
    const scenario = createSpPr022StageState({ totalStageMembers: 6 });
    const modifiers = collectLiveModifiers(scenario.game);

    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.RED, 1), createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: scenario.sourceId,
      abilityId: SP_PR_022_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(scenario.game, 'p1', scenario.sourceId, modifiers)).toEqual(
      [
        createHeartIcon(HeartColor.PINK, 1),
        createHeartIcon(HeartColor.RED, 1),
        createHeartIcon(HeartColor.YELLOW, 1),
      ]
    );
    expect(getPlayerLiveHeartModifiers(scenario.game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('does not collect PL!SP-PR-022 Hearts when total stage members is fewer than six', () => {
    const scenario = createSpPr022StageState({ totalStageMembers: 5 });

    expect(hasSpPr022HeartModifier(scenario.game)).toBe(false);
  });

  it('does not collect PL!SP-PR-022 Hearts when the source is off stage or memberBelow', () => {
    const offStage = createSpPr022StageState({
      totalStageMembers: 6,
      sourcePlacement: 'OFF_STAGE',
    });
    expect(hasSpPr022HeartModifier(offStage.game)).toBe(false);

    const memberBelow = createSpPr022StageState({
      totalStageMembers: 6,
      sourcePlacement: 'MEMBER_BELOW',
    });
    expect(hasSpPr022HeartModifier(memberBelow.game)).toBe(false);
  });

  it('collects PL!SP-PR-025 BLADE plus two only when own energy count is exactly seven', () => {
    const atSeven = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-PR-025-PR',
      energyOrientations: Array(7).fill(OrientationState.WAITING),
    });
    const modifiers = collectLiveModifiers(atSeven.game);

    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: atSeven.sourceId,
      abilityId: SP_PR_025_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(atSeven.game, 'p1', atSeven.sourceId, modifiers)).toBe(3);
    expect(getPlayerLiveBladeModifier(atSeven.game.liveResolution, 'p1', modifiers)).toBe(2);

    for (const energyCount of [6, 8] as const) {
      const state = createSpPb2EnergyHeartState({
        cardCode: 'PL!SP-PR-025-PR',
        energyOrientations: Array(energyCount).fill(OrientationState.ACTIVE),
      });
      expect(
        collectLiveModifiers(state.game).some(
          (modifier) => modifier.abilityId === SP_PR_025_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('does not collect PL!SP-PR-025 BLADE when the source is off-stage or memberBelow', () => {
    for (const sourcePlacement of ['OFF_STAGE', 'MEMBER_BELOW'] as const) {
      const state = createSpPb2EnergyHeartState({
        cardCode: 'PL!SP-PR-025-PR',
        energyOrientations: Array(7).fill(OrientationState.ACTIVE),
        sourcePlacement,
      });
      expect(
        collectLiveModifiers(state.game).some(
          (modifier) => modifier.abilityId === SP_PR_025_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('collects PL!SP-bp4-003 BLADE +2 only while the source is in CENTER', () => {
    const center = createSpBp4StageCostState({
      sourceCardCode: 'PL!SP-bp4-003-P',
      sourceSlot: SlotPosition.CENTER,
      ownOtherCosts: [],
      opponentCosts: [],
    });
    expect(collectLiveModifiers(center.game)).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: center.sourceId,
      abilityId: SP_BP4_003_CONTINUOUS_ABILITY_ID,
    });

    const left = createSpBp4StageCostState({
      sourceCardCode: 'PL!SP-bp4-003-R',
      sourceSlot: SlotPosition.LEFT,
      ownOtherCosts: [],
      opponentCosts: [],
    });
    expect(
      collectLiveModifiers(left.game).some(
        (modifier) => modifier.abilityId === SP_BP4_003_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('collects PL!SP-bp4-009 BLADE +3 only when own effective stage cost is lower', () => {
    const lower = createSpBp4StageCostState({
      sourceCardCode: 'PL!SP-bp4-009-P',
      sourceSlot: SlotPosition.CENTER,
      sourcePrintedCost: 9,
      ownOtherCosts: [4],
      opponentCosts: [10, 10],
      sourceCostDelta: -8,
    });
    expect(getMemberEffectiveCost(lower.game, 'p1', lower.sourceId)).toBe(1);
    expect(collectLiveModifiers(lower.game)).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 3,
      sourceCardId: lower.sourceId,
      abilityId: SP_BP4_009_CONTINUOUS_ABILITY_ID,
    });

    const notLower = createSpBp4StageCostState({
      sourceCardCode: 'PL!SP-bp4-009-R',
      sourceSlot: SlotPosition.CENTER,
      sourcePrintedCost: 9,
      ownOtherCosts: [4],
      opponentCosts: [10],
    });
    expect(
      collectLiveModifiers(notLower.game).some(
        (modifier) => modifier.abilityId === SP_BP4_009_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('collects PL!SP-bp4-021 purple Heart only when own energy is more than opponent', () => {
    const moreEnergy = createSpBp4021EnergyState({ ownEnergyCount: 3, opponentEnergyCount: 2 });
    expect(collectLiveModifiers(moreEnergy.game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      sourceCardId: moreEnergy.sourceId,
      abilityId: SP_BP4_021_CONTINUOUS_ABILITY_ID,
    });

    for (const [ownEnergyCount, opponentEnergyCount] of [
      [2, 2],
      [1, 2],
    ] as const) {
      const state = createSpBp4021EnergyState({ ownEnergyCount, opponentEnergyCount });
      expect(
        collectLiveModifiers(state.game).some(
          (modifier) => modifier.abilityId === SP_BP4_021_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('collects PL!SP-sd2-004 BLADE +4 only while the source is in CENTER', () => {
    const center = createSpSd2ContinuousStageState({
      sourceCardCode: 'PL!SP-sd2-004-SD2',
      sourcePlacement: 'CENTER',
    });
    const modifiers = collectLiveModifiers(center.game);

    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 4,
      sourceCardId: center.sourceId,
      abilityId: SP_SD2_004_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(center.game, 'p1', center.sourceId, modifiers)).toBe(5);

    for (const sourcePlacement of ['LEFT', 'OFF_STAGE', 'MEMBER_BELOW'] as const) {
      const state = createSpSd2ContinuousStageState({
        sourceCardCode: 'PL!SP-sd2-004-SD2',
        sourcePlacement,
      });
      expect(
        collectLiveModifiers(state.game).some(
          (modifier) => modifier.abilityId === SP_SD2_004_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('collects PL!SP-sd2-008 SOURCE_MEMBER yellow Heart using effective cost >= 13', () => {
    const state = createSpSd2ContinuousStageState({
      sourceCardCode: 'PL!SP-sd2-008-SD2',
      sourcePlacement: 'CENTER',
      otherPrintedCost: 12,
      otherCostDelta: 1,
    });
    const modifiers = collectLiveModifiers(state.game);

    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: state.sourceId,
      abilityId: SP_SD2_008_CONTINUOUS_ABILITY_ID,
    });
    expect(
      getMemberEffectiveHeartIcons(state.game, 'p1', state.sourceId, modifiers)
    ).toContainEqual(createHeartIcon(HeartColor.YELLOW, 1));
    expect(getMemberEffectiveCost(state.game, 'p1', state.otherId)).toBe(13);
  });

  it('does not collect PL!SP-sd2-008 Heart without a high-cost stage member or valid source stage', () => {
    const lowCostOnly = createSpSd2ContinuousStageState({
      sourceCardCode: 'PL!SP-sd2-008-SD2',
      sourcePlacement: 'CENTER',
      otherPrintedCost: 12,
    });
    expect(
      collectLiveModifiers(lowCostOnly.game).some(
        (modifier) => modifier.abilityId === SP_SD2_008_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);

    for (const sourcePlacement of ['OFF_STAGE', 'MEMBER_BELOW'] as const) {
      const state = createSpSd2ContinuousStageState({
        sourceCardCode: 'PL!SP-sd2-008-SD2',
        sourcePlacement,
        otherPrintedCost: 13,
      });
      expect(
        collectLiveModifiers(state.game).some(
          (modifier) => modifier.abilityId === SP_SD2_008_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('collects PL!SP-bp5-111 and PL!SP-bp5-222 SCORE only at exactly eight energy', () => {
    for (const [cardCode, abilityId] of [
      ['PL!SP-bp5-111-R', SP_BP5_111_CONTINUOUS_ABILITY_ID],
      ['PL!SP-bp5-222-P＋', SP_BP5_222_CONTINUOUS_ABILITY_ID],
    ] as const) {
      const atEight = createSpPb2EnergyHeartState({
        cardCode,
        energyOrientations: Array(8).fill(OrientationState.WAITING),
      });
      expect(collectLiveModifiers(atEight.game)).toContainEqual({
        kind: 'SCORE',
        playerId: 'p1',
        countDelta: 1,
        sourceCardId: atEight.sourceId,
        abilityId,
      });

      for (const energyCount of [7, 9] as const) {
        const state = createSpPb2EnergyHeartState({
          cardCode,
          energyOrientations: Array(energyCount).fill(OrientationState.ACTIVE),
        });
        expect(
          collectLiveModifiers(state.game).some((modifier) => modifier.abilityId === abilityId)
        ).toBe(false);
      }

      const offStage = createSpPb2EnergyHeartState({
        cardCode,
        energyOrientations: Array(8).fill(OrientationState.ACTIVE),
        sourcePlacement: 'OFF_STAGE',
      });
      expect(
        collectLiveModifiers(offStage.game).some((modifier) => modifier.abilityId === abilityId)
      ).toBe(false);
    }
  });

  it('collects stackable PL!SP-pb1-002 player SCORE at twelve or more energy only from main-stage sources', () => {
    for (const [energyCount, expectedCount] of [
      [11, 0],
      [12, 1],
      [13, 1],
    ] as const) {
      const state = createSpPb2EnergyHeartState({
        cardCode: energyCount === 13 ? 'PL!SP-pb1-002-P＋' : 'PL!SP-pb1-002-R',
        energyOrientations: Array(energyCount).fill(OrientationState.ACTIVE),
      });
      const modifiers = collectLiveModifiers(state.game).filter(
        (modifier) => modifier.abilityId === SP_PB1_002_CONTINUOUS_ABILITY_ID
      );
      expect(modifiers).toHaveLength(expectedCount);
      if (expectedCount === 1) {
        expect(modifiers[0]).toEqual({
          kind: 'SCORE',
          playerId: 'p1',
          countDelta: 1,
          sourceCardId: state.sourceId,
          abilityId: SP_PB1_002_CONTINUOUS_ABILITY_ID,
        });
        expect('liveCardId' in modifiers[0]).toBe(false);
      }
    }

    for (const sourcePlacement of ['OFF_STAGE', 'MEMBER_BELOW', 'HAND', 'WAITING_ROOM'] as const) {
      const state = createSpPb2EnergyHeartState({
        cardCode: 'PL!SP-pb1-002-R',
        energyOrientations: Array(12).fill(OrientationState.ACTIVE),
        sourcePlacement,
      });
      expect(
        collectLiveModifiers(state.game).some(
          (modifier) => modifier.abilityId === SP_PB1_002_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }

    const stacked = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb1-002-R',
      energyOrientations: Array(12).fill(OrientationState.ACTIVE),
    });
    const secondSource = createCardInstance(
      {
        cardCode: 'PL!SP-pb1-002-P＋',
        name: '唐 可可',
        groupNames: ['Liella!'],
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'sp-pb1-002-second-source'
    );
    let stackedGame = registerCards(stacked.game, [secondSource]);
    stackedGame = updatePlayer(stackedGame, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        secondSource.instanceId
      ),
    }));
    expect(
      collectLiveModifiers(stackedGame).filter(
        (modifier) => modifier.abilityId === SP_PB1_002_CONTINUOUS_ABILITY_ID
      )
    ).toHaveLength(2);
  });

  it('applies PL!SP-pb1-010 to effective cost while preserving printed selectors and modifier order', () => {
    for (const [energyCount, expectedCost] of [
      [9, 4],
      [10, 8],
      [11, 8],
    ] as const) {
      const state = createSpPb2EnergyHeartState({
        cardCode: energyCount === 11 ? 'PL!SP-pb1-010-P＋' : 'PL!SP-pb1-010-R',
        energyOrientations: Array(energyCount).fill(OrientationState.ACTIVE),
      });
      expect(getMemberEffectiveCost(state.game, 'p1', state.sourceId)).toBe(expectedCost);
      expect(costLte(4)(state.game.cardRegistry.get(state.sourceId)!)).toBe(true);
    }

    for (const sourcePlacement of ['OFF_STAGE', 'MEMBER_BELOW', 'HAND', 'WAITING_ROOM'] as const) {
      const state = createSpPb2EnergyHeartState({
        cardCode: 'PL!SP-pb1-010-R',
        energyOrientations: Array(10).fill(OrientationState.ACTIVE),
        sourcePlacement,
      });
      expect(getMemberEffectiveCost(state.game, 'p1', state.sourceId)).toBe(4);
    }

    const active = createSpPb2EnergyHeartState({
      cardCode: 'PL!SP-pb1-010-R',
      energyOrientations: Array(10).fill(OrientationState.ACTIVE),
    });
    const lowerCostComparisonSource = createCardInstance(
      {
        cardCode: 'PL!HS-bp2-002-R＋',
        name: '村野さやか',
        cardType: CardType.MEMBER,
        cost: 7,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'hs-bp2-002-cost-comparison-source'
    );
    let comparisonGame = registerCards(active.game, [lowerCostComparisonSource]);
    comparisonGame = updatePlayer(comparisonGame, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        lowerCostComparisonSource.instanceId
      ),
    }));
    expect(
      collectLiveModifiers(comparisonGame).some(
        (modifier) =>
          modifier.abilityId === HS_BP2_002_CONTINUOUS_ABILITY_ID &&
          modifier.sourceCardId === lowerCostComparisonSource.instanceId
      )
    ).toBe(true);

    const withDelta = addMemberCostLiveModifierForMember(active.game, {
      playerId: 'p1',
      memberCardId: active.sourceId,
      sourceCardId: 'temporary-cost-source',
      abilityId: 'test:member-cost-plus-three',
      countDelta: 3,
    });
    expect(withDelta).not.toBeNull();
    expect(getMemberEffectiveCost(withDelta!.gameState, 'p1', active.sourceId)).toBe(11);

    const withSet = addMemberCostSetLiveModifierForMember(withDelta!.gameState, {
      playerId: 'p1',
      memberCardId: active.sourceId,
      sourceCardId: 'temporary-cost-set-source',
      abilityId: 'test:member-cost-set-six',
      setTo: 6,
    });
    expect(withSet).not.toBeNull();
    expect(getMemberEffectiveCost(withSet!.gameState, 'p1', active.sourceId)).toBe(6);
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

  it('collects PL!SP-bp5-011 Heart color by current slot and stops off-stage', () => {
    const tomari = createCardInstance(
      {
        cardCode: 'PL!SP-bp5-011-R',
        name: '鬼塚冬毬',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 0,
        hearts: [],
      },
      'p1',
      'tomari'
    );
    let game = createGameState('sp-bp5-011-slot-hearts', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [tomari]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, tomari.instanceId),
    }));

    let modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.RED, 3)],
      sourceCardId: tomari.instanceId,
      abilityId: SP_BP5_011_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', tomari.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.RED, 3),
    ]);

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: tomari.instanceId,
        },
      },
    }));
    modifiers = collectLiveModifiers(game);
    expect(getMemberEffectiveHeartIcons(game, 'p1', tomari.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.YELLOW, 3),
    ]);

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: tomari.instanceId,
        },
      },
    }));
    modifiers = collectLiveModifiers(game);
    expect(getMemberEffectiveHeartIcons(game, 'p1', tomari.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.BLUE, 3),
    ]);

    const offStage = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.RIGHT]: null,
        },
      },
    }));
    expect(
      collectLiveModifiers(offStage).some(
        (modifier) => modifier.abilityId === SP_BP5_011_CONTINUOUS_ABILITY_ID
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

  it('lets member cost set modifiers override existing member cost deltas', () => {
    const member = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-005-R',
        name: '徒町 小鈴',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'bp5-005-kosuzu'
    );
    let game = createGameState('member-cost-set-live-modifier', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);

    const delta = addMemberCostLiveModifierForMember(game, {
      playerId: 'p1',
      memberCardId: member.instanceId,
      sourceCardId: member.instanceId,
      abilityId: 'test-cost-plus-six',
      countDelta: 6,
    });
    expect(delta).not.toBeNull();
    const setCost = addMemberCostSetLiveModifierForMember(delta!.gameState, {
      playerId: 'p1',
      memberCardId: member.instanceId,
      sourceCardId: member.instanceId,
      abilityId: 'test-cost-set',
      setTo: 11,
    });

    expect(setCost).not.toBeNull();
    expect(getMemberEffectiveCost(setCost!.gameState, 'p1', member.instanceId)).toBe(11);
    expect(setCost?.modifier).toMatchObject({
      kind: 'MEMBER_COST_SET',
      memberCardId: member.instanceId,
      setTo: 11,
    });
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

  it('adds PL!HS-bp2-002 BLADE +3 when another own stage member has higher effective cost', () => {
    const sayaka = createHsBp2002Sayaka('bp2-sayaka', 13);
    const higherCostMember = createTestMember('higher-cost', 14);
    let game = createGameState('hs-bp2-002-higher-cost', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [sayaka, higherCostMember]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sayaka.instanceId),
        SlotPosition.LEFT,
        higherCostMember.instanceId
      ),
    }));

    const liveModifiers = collectLiveModifiers(game);

    expect(liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 3,
      sourceCardId: sayaka.instanceId,
      abilityId: HS_BP2_002_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', sayaka.instanceId, liveModifiers)).toBe(4);
  });

  it.each([
    ['source alone', []],
    ['equal own cost', [createTestMember('equal-cost', 13)]],
    ['lower own cost', [createTestMember('lower-cost', 12)]],
  ])('does not add PL!HS-bp2-002 BLADE when %s', (_label, otherMembers) => {
    const sayaka = createHsBp2002Sayaka('bp2-sayaka-no-condition', 13);
    let game = createGameState('hs-bp2-002-no-condition', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [sayaka, ...otherMembers]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: otherMembers.reduce(
        (slots, member, index) =>
          placeCardInSlot(
            slots,
            index === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT,
            member.instanceId
          ),
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sayaka.instanceId)
      ),
    }));

    expect(hasHsBp2002BladeModifier(game)).toBe(false);
  });

  it('does not count opponent higher-cost members for PL!HS-bp2-002', () => {
    const sayaka = createHsBp2002Sayaka('bp2-sayaka-opponent', 13);
    const opponentHigherCostMember = createTestMember('opponent-higher-cost', 14, 'p2');
    let game = createGameState('hs-bp2-002-opponent-higher-cost', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [sayaka, opponentHigherCostMember]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sayaka.instanceId),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        opponentHigherCostMember.instanceId
      ),
    }));

    expect(hasHsBp2002BladeModifier(game)).toBe(false);
  });

  it('uses effective cost modifiers for PL!HS-bp2-002 higher-cost comparison', () => {
    const sayaka = createHsBp2002Sayaka('bp2-sayaka-effective-cost', 13);
    const lowerCostMember = createTestMember('modified-lower-cost', 12);
    let game = createGameState('hs-bp2-002-effective-cost', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [sayaka, lowerCostMember]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sayaka.instanceId),
        SlotPosition.LEFT,
        lowerCostMember.instanceId
      ),
    }));
    expect(hasHsBp2002BladeModifier(game)).toBe(false);

    const costResult = addMemberCostLiveModifierForMember(game, {
      playerId: 'p1',
      memberCardId: lowerCostMember.instanceId,
      sourceCardId: sayaka.instanceId,
      abilityId: 'test-higher-effective-cost',
      countDelta: 2,
    });
    expect(costResult).not.toBeNull();

    expect(hasHsBp2002BladeModifier(costResult!.gameState)).toBe(true);
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

  describe('PL!-pb1-002 continuous opponent WAITING purple Heart', () => {
    function createEli(id = 'pb1-002-eli') {
      return createCardInstance(
        {
          cardCode: 'PL!-pb1-002-R',
          name: '絢瀬絵里',
          unitName: 'BiBi',
          cardType: CardType.MEMBER,
          cost: 13,
          blade: 3,
          hearts: [
            createHeartIcon(HeartColor.PINK, 1),
            createHeartIcon(HeartColor.YELLOW, 2),
            createHeartIcon(HeartColor.PURPLE, 2),
          ],
        },
        'p1',
        id
      );
    }

    function createOpponent(index: number) {
      return createCardInstance(
        {
          cardCode: `PL!-test-opponent-${index}`,
          name: `Opponent ${index}`,
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        'p2',
        `opponent-${index}`
      );
    }

    function setupOpponentWaiting(count: 0 | 1 | 2 | 3) {
      const eli = createEli();
      const opponents = [0, 1, 2].map(createOpponent);
      let game = createGameState(`pl-pb1-002-opponent-waiting-${count}`, 'p1', 'P1', 'p2', 'P2');
      game = registerCards(game, [eli, ...opponents]);
      game = updatePlayer(game, 'p1', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, eli.instanceId),
      }));
      game = updatePlayer(game, 'p2', (player) => ({
        ...player,
        memberSlots: opponents.reduce((slots, opponent, index) => {
          const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!;
          return placeCardInSlot(slots, slot, opponent.instanceId, {
            orientation: index < count ? OrientationState.WAITING : OrientationState.ACTIVE,
          });
        }, player.memberSlots),
      }));
      return { game, eli };
    }

    for (const count of [0, 1, 2, 3] as const) {
      it(`adds ${count} purple Heart when opponent has ${count} WAITING stage members`, () => {
        const { game, eli } = setupOpponentWaiting(count);
        const modifiers = collectLiveModifiers(game);
        const modifier = modifiers.find(
          (candidate) => candidate.abilityId === PL_PB1_002_CONTINUOUS_ABILITY_ID
        );

        if (count === 0) {
          expect(modifier).toBeUndefined();
          return;
        }

        expect(modifier).toEqual({
          kind: 'HEART',
          target: 'SOURCE_MEMBER',
          playerId: 'p1',
          hearts: [createHeartIcon(HeartColor.PURPLE, count)],
          sourceCardId: eli.instanceId,
          abilityId: PL_PB1_002_CONTINUOUS_ABILITY_ID,
        });
        expect(getMemberEffectiveHeartIcons(game, 'p1', eli.instanceId, modifiers)).toContainEqual(
          createHeartIcon(HeartColor.PURPLE, count)
        );
      });
    }

    it('does not count own WAITING members and does not apply when source is off stage or memberBelow', () => {
      const eli = createEli();
      const ownWaiting = createCardInstance(
        {
          cardCode: 'PL!-test-own-waiting',
          name: 'Own Waiting',
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        'p1',
        'own-waiting-for-eli'
      );
      const host = createCardInstance(
        {
          cardCode: 'PL!-test-host',
          name: 'Host',
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        'p1',
        'host-for-eli'
      );
      let ownWaitingGame = createGameState(
        'pl-pb1-002-own-waiting-not-counted',
        'p1',
        'P1',
        'p2',
        'P2'
      );
      ownWaitingGame = registerCards(ownWaitingGame, [eli, ownWaiting]);
      ownWaitingGame = updatePlayer(ownWaitingGame, 'p1', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, eli.instanceId),
          SlotPosition.LEFT,
          ownWaiting.instanceId,
          { orientation: OrientationState.WAITING }
        ),
      }));
      expect(
        collectLiveModifiers(ownWaitingGame).some(
          (modifier) => modifier.abilityId === PL_PB1_002_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);

      let offStageGame = createGameState('pl-pb1-002-source-off-stage', 'p1', 'P1', 'p2', 'P2');
      const waitingOpponent = createOpponent(9);
      offStageGame = registerCards(offStageGame, [eli, waitingOpponent]);
      offStageGame = updatePlayer(offStageGame, 'p2', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          player.memberSlots,
          SlotPosition.CENTER,
          waitingOpponent.instanceId,
          { orientation: OrientationState.WAITING }
        ),
      }));
      expect(
        collectLiveModifiers(offStageGame).some(
          (modifier) => modifier.abilityId === PL_PB1_002_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);

      let belowGame = createGameState('pl-pb1-002-source-member-below', 'p1', 'P1', 'p2', 'P2');
      belowGame = registerCards(belowGame, [eli, host, waitingOpponent]);
      belowGame = updatePlayer(belowGame, 'p1', (player) => ({
        ...player,
        memberSlots: addMemberBelowMember(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, host.instanceId),
          SlotPosition.CENTER,
          eli.instanceId
        ),
      }));
      belowGame = updatePlayer(belowGame, 'p2', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          player.memberSlots,
          SlotPosition.CENTER,
          waitingOpponent.instanceId,
          { orientation: OrientationState.WAITING }
        ),
      }));
      expect(
        collectLiveModifiers(belowGame).some(
          (modifier) => modifier.abilityId === PL_PB1_002_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    });
  });

  describe('PL!-bp3-002 continuous opponent WAITING BLADE', () => {
    function createEli(id = 'bp3-002-eli') {
      return createCardInstance(
        {
          cardCode: 'PL!-bp3-002-R',
          name: '絢瀬絵里',
          cardType: CardType.MEMBER,
          cost: 9,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.PURPLE, 2)],
        },
        'p1',
        id
      );
    }

    function createOpponent(index: number) {
      return createCardInstance(
        {
          cardCode: `PL!-bp3-test-opponent-${index}`,
          name: `Opponent ${index}`,
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        'p2',
        `bp3-opponent-${index}`
      );
    }

    function setupOpponentWaiting(count: 0 | 1 | 2 | 3) {
      const eli = createEli();
      const opponents = [0, 1, 2].map(createOpponent);
      let game = createGameState(`pl-bp3-002-opponent-waiting-${count}`, 'p1', 'P1', 'p2', 'P2');
      game = registerCards(game, [eli, ...opponents]);
      game = updatePlayer(game, 'p1', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, eli.instanceId),
      }));
      game = updatePlayer(game, 'p2', (player) => ({
        ...player,
        memberSlots: opponents.reduce((slots, opponent, index) => {
          const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!;
          return placeCardInSlot(slots, slot, opponent.instanceId, {
            orientation: index < count ? OrientationState.WAITING : OrientationState.ACTIVE,
          });
        }, player.memberSlots),
      }));
      return { game, eli, opponents };
    }

    for (const count of [0, 1, 2, 3] as const) {
      it(`adds ${count} BLADE when opponent has ${count} WAITING stage members`, () => {
        const { game, eli } = setupOpponentWaiting(count);
        const modifiers = collectLiveModifiers(game);
        const modifier = modifiers.find(
          (candidate) => candidate.abilityId === PL_BP3_002_CONTINUOUS_ABILITY_ID
        );
        if (count === 0) {
          expect(modifier).toBeUndefined();
          expect(getMemberEffectiveBladeCount(game, 'p1', eli.instanceId, modifiers)).toBe(1);
          return;
        }
        expect(modifier).toEqual({
          kind: 'BLADE',
          playerId: 'p1',
          countDelta: count,
          sourceCardId: eli.instanceId,
          abilityId: PL_BP3_002_CONTINUOUS_ABILITY_ID,
        });
        expect(getMemberEffectiveBladeCount(game, 'p1', eli.instanceId, modifiers)).toBe(1 + count);
      });
    }

    it('recomputes immediately when an opponent member changes orientation', () => {
      const { game, eli, opponents } = setupOpponentWaiting(0);
      expect(
        collectLiveModifiers(game).some(
          (modifier) => modifier.abilityId === PL_BP3_002_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
      const waiting = updatePlayer(game, 'p2', (player) => ({
        ...player,
        memberSlots: {
          ...player.memberSlots,
          cardStates: new Map(player.memberSlots.cardStates).set(opponents[0]!.instanceId, {
            ...player.memberSlots.cardStates.get(opponents[0]!.instanceId)!,
            orientation: OrientationState.WAITING,
          }),
        },
      }));
      expect(getMemberEffectiveBladeCount(waiting, 'p1', eli.instanceId)).toBe(2);
      const activeAgain = updatePlayer(waiting, 'p2', (player) => ({
        ...player,
        memberSlots: {
          ...player.memberSlots,
          cardStates: new Map(player.memberSlots.cardStates).set(opponents[0]!.instanceId, {
            ...player.memberSlots.cardStates.get(opponents[0]!.instanceId)!,
            orientation: OrientationState.ACTIVE,
          }),
        },
      }));
      expect(getMemberEffectiveBladeCount(activeAgain, 'p1', eli.instanceId)).toBe(1);
    });

    it('ignores own WAITING members, waiting-room cards, and a source off stage or memberBelow', () => {
      const eli = createEli();
      const ownWaiting = createCardInstance(
        {
          cardCode: 'PL!-bp3-test-own-waiting',
          name: 'Own Waiting',
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        'p1',
        'bp3-own-waiting'
      );
      const opponentOutsideStage = createOpponent(8);
      const opponentBelow = createOpponent(10);
      const opponentHost = createCardInstance(
        {
          cardCode: 'PL!-bp3-test-opponent-host',
          name: 'Opponent Host',
          cardType: CardType.MEMBER,
          cost: 4,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        },
        'p2',
        'bp3-opponent-host'
      );
      const host = createCardInstance(
        {
          cardCode: 'PL!-bp3-test-host',
          name: 'Host',
          cardType: CardType.MEMBER,
          cost: 1,
          blade: 1,
          hearts: [createHeartIcon(HeartColor.PINK, 1)],
        },
        'p1',
        'bp3-host'
      );

      let irrelevantGame = createGameState('pl-bp3-002-irrelevant-zones', 'p1', 'P1', 'p2', 'P2');
      irrelevantGame = registerCards(irrelevantGame, [
        eli,
        ownWaiting,
        opponentOutsideStage,
        opponentBelow,
        opponentHost,
      ]);
      irrelevantGame = updatePlayer(irrelevantGame, 'p1', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, eli.instanceId),
          SlotPosition.LEFT,
          ownWaiting.instanceId,
          { orientation: OrientationState.WAITING }
        ),
      }));
      irrelevantGame = updatePlayer(irrelevantGame, 'p2', (player) => ({
        ...player,
        waitingRoom: addCardToZone(player.waitingRoom, opponentOutsideStage.instanceId),
        memberSlots: addMemberBelowMember(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponentHost.instanceId),
          SlotPosition.CENTER,
          opponentBelow.instanceId
        ),
      }));
      expect(
        collectLiveModifiers(irrelevantGame).some(
          (modifier) => modifier.abilityId === PL_BP3_002_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);

      const waitingOpponent = createOpponent(9);
      let offStageGame = createGameState('pl-bp3-002-off-stage', 'p1', 'P1', 'p2', 'P2');
      offStageGame = registerCards(offStageGame, [eli, waitingOpponent]);
      offStageGame = updatePlayer(offStageGame, 'p2', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          player.memberSlots,
          SlotPosition.CENTER,
          waitingOpponent.instanceId,
          { orientation: OrientationState.WAITING }
        ),
      }));
      expect(
        collectLiveModifiers(offStageGame).some(
          (modifier) => modifier.abilityId === PL_BP3_002_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);

      let belowGame = createGameState('pl-bp3-002-member-below', 'p1', 'P1', 'p2', 'P2');
      belowGame = registerCards(belowGame, [eli, host, waitingOpponent]);
      belowGame = updatePlayer(belowGame, 'p1', (player) => ({
        ...player,
        memberSlots: addMemberBelowMember(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, host.instanceId),
          SlotPosition.CENTER,
          eli.instanceId
        ),
      }));
      belowGame = updatePlayer(belowGame, 'p2', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          player.memberSlots,
          SlotPosition.CENTER,
          waitingOpponent.instanceId,
          { orientation: OrientationState.WAITING }
        ),
      }));
      expect(
        collectLiveModifiers(belowGame).some(
          (modifier) => modifier.abilityId === PL_BP3_002_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    });
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

  it('collects PL!-bp6-009 SCORE +1 when center Nico has left and right original BLADE 2 members', () => {
    const { game, sourceId } = setupBp6009ContinuousGame();

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: sourceId,
      abilityId: BP6_009_CONTINUOUS_ABILITY_ID,
    });
  });

  it('collects PL!HS-bp6-002 BLADE +2 when Sayaka is alone on stage', () => {
    const { game, sourceId } = setupHsBp6002ContinuousGame('PL!HS-bp6-002-R');

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: sourceId,
      abilityId: HS_BP6_002_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', sourceId, modifiers)).toBe(3);
  });

  it('does not collect PL!HS-bp6-002 BLADE when another own stage member exists', () => {
    const { game, sourceId } = setupHsBp6002ContinuousGame('PL!HS-bp6-002-R', {
      withOtherMember: true,
    });

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === sourceId &&
          modifier.abilityId === HS_BP6_002_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('uses PL!HS-bp6-002 baseCardCodes for both R and P rarities', () => {
    for (const cardCode of ['PL!HS-bp6-002-R', 'PL!HS-bp6-002-P']) {
      const { game, sourceId } = setupHsBp6002ContinuousGame(cardCode);
      expect(collectLiveModifiers(game)).toContainEqual({
        kind: 'BLADE',
        playerId: 'p1',
        countDelta: 2,
        sourceCardId: sourceId,
        abilityId: HS_BP6_002_CONTINUOUS_ABILITY_ID,
      });
    }
  });

  it('collects PL!HS-pb1-015 BLADE -3 only while alone, covers R/P+, and clamps effective BLADE at zero', () => {
    for (const cardCode of ['PL!HS-pb1-015-R', 'PL!HS-pb1-015-P+']) {
      const { game, sourceId } = setupHsBp6002ContinuousGame(cardCode);
      const modifiers = collectLiveModifiers(game);
      expect(modifiers).toContainEqual({
        kind: 'BLADE',
        playerId: 'p1',
        countDelta: -3,
        sourceCardId: sourceId,
        abilityId: HS_PB1_015_CONTINUOUS_ABILITY_ID,
      });
      expect(getMemberEffectiveBladeCount(game, 'p1', sourceId, modifiers)).toBe(0);
    }

    const { game, sourceId } = setupHsBp6002ContinuousGame('PL!HS-pb1-015-R', {
      withOtherMember: true,
    });
    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === sourceId &&
          modifier.abilityId === HS_PB1_015_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not collect PL!-bp6-009 SCORE when Nico is not center', () => {
    const { game, sourceId } = setupBp6009ContinuousGame({ nicoSlot: SlotPosition.LEFT });

    expect(hasBp6009ScoreModifier(game, sourceId)).toBe(false);
  });

  it('does not collect PL!-bp6-009 SCORE when either side member is missing or original BLADE is not two', () => {
    const missingSide = setupBp6009ContinuousGame({ rightBlade: null });
    const wrongBlade = setupBp6009ContinuousGame({ leftBlade: 2, rightBlade: 3 });

    expect(hasBp6009ScoreModifier(missingSide.game, missingSide.sourceId)).toBe(false);
    expect(hasBp6009ScoreModifier(wrongBlade.game, wrongBlade.sourceId)).toBe(false);
  });

  it('collects PL!-bp4-005 SCORE +1 only while Rin is in CENTER', () => {
    const center = setupBp4005ContinuousGame(SlotPosition.CENTER);
    const left = setupBp4005ContinuousGame(SlotPosition.LEFT);
    const right = setupBp4005ContinuousGame(SlotPosition.RIGHT);
    const offStage = setupBp4005ContinuousGame(null);

    expect(collectLiveModifiers(center.game)).toContainEqual({
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: center.sourceId,
      abilityId: BP4_005_CONTINUOUS_ABILITY_ID,
    });
    expect(hasBp4005ScoreModifier(left.game, left.sourceId)).toBe(false);
    expect(hasBp4005ScoreModifier(right.game, right.sourceId)).toBe(false);
    expect(hasBp4005ScoreModifier(offStage.game, offStage.sourceId)).toBe(false);
  });

  it('does not let ordinary BLADE modifiers satisfy PL!-bp6-009 original BLADE condition', () => {
    const { game, sourceId, rightId } = setupBp6009ContinuousGame({ leftBlade: 2, rightBlade: 1 });
    const modifiedGame = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: rightId,
      abilityId: 'test:ordinary-blade-bonus',
    });

    expect(hasBp6009ScoreModifier(modifiedGame, sourceId)).toBe(false);
  });

  it('uses original BLADE replacement, not effective BLADE, for PL!-bp6-009 side checks', () => {
    const { game, sourceId, leftId, rightId } = setupBp6009ContinuousGame({
      leftBlade: 5,
      rightBlade: 1,
    });
    let modifiedGame = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: 'p1',
      memberCardId: leftId,
      count: 2,
      sourceCardId: 'test:left-original-blade',
      abilityId: 'test:left-original-blade',
    });
    modifiedGame = addLiveModifier(modifiedGame, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: 'p1',
      memberCardId: rightId,
      count: 2,
      sourceCardId: 'test:right-original-blade',
      abilityId: 'test:right-original-blade',
    });
    modifiedGame = addLiveModifier(modifiedGame, {
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 3,
      sourceCardId: rightId,
      abilityId: 'test:ordinary-blade-bonus',
    });

    expect(collectLiveModifiers(modifiedGame)).toContainEqual({
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: sourceId,
      abilityId: BP6_009_CONTINUOUS_ABILITY_ID,
    });
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
        groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
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
          groupNames: [groupName],
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

  function getTestLiveCardCodePrefix(groupNames: string): string {
    if (groupNames.includes('虹')) {
      return 'PL!N';
    }
    if (groupNames.includes('Aqours')) {
      return 'PL!S';
    }
    if (groupNames.includes('Liella')) {
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
        groupNames: ['莲之空'],
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

  it('counts LL-bp1-001 as one available different name for PL!-bp5-003', () => {
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
    const llBp1001 = createCardInstance(createLlBp1001MemberData(), 'p1', 'll-bp1-001');
    const kaho = createCardInstance(
      createHasunosoraMemberData('PL!HS-test-kaho', '日野下花帆', 4),
      'p1',
      'kaho-stage'
    );

    let game = createGameState('bp5-003-ll-bp1-001-kaho', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kotori, llBp1001, kaho]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kotori.instanceId),
          SlotPosition.LEFT,
          llBp1001.instanceId
        ),
        SlotPosition.RIGHT,
        kaho.instanceId
      ),
    }));

    expect(hasBp5003YellowHeartModifier(game)).toBe(true);
  });

  it('can use two LL-bp1-001 copies as unoccupied names beside an Ayumu source', () => {
    const ayumuSource = createCardInstance(
      {
        cardCode: 'PL!-bp5-003-AR',
        name: '上原歩夢',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'ayumu-source'
    );
    const firstLlBp1001 = createCardInstance(createLlBp1001MemberData(), 'p1', 'll-bp1-001-a');
    const secondLlBp1001 = createCardInstance(createLlBp1001MemberData(), 'p1', 'll-bp1-001-b');

    let game = createGameState('bp5-003-two-ll-bp1-001-ayumu', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [ayumuSource, firstLlBp1001, secondLlBp1001]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ayumuSource.instanceId),
          SlotPosition.LEFT,
          firstLlBp1001.instanceId
        ),
        SlotPosition.RIGHT,
        secondLlBp1001.instanceId
      ),
    }));

    expect(hasBp5003YellowHeartModifier(game)).toBe(true);
  });

  it('does not count LL-bp1-001 plus two Kaho members as three names for PL!-bp5-003', () => {
    const kahoSource = createCardInstance(
      {
        cardCode: 'PL!-bp5-003-AR',
        name: '日野下花帆',
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 3,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'kaho-source'
    );
    const llBp1001 = createCardInstance(createLlBp1001MemberData(), 'p1', 'll-bp1-001');
    const secondKaho = createCardInstance(
      createHasunosoraMemberData('PL!HS-test-kaho-2', '日野 下花帆', 5),
      'p1',
      'second-kaho-stage'
    );

    let game = createGameState('bp5-003-ll-bp1-001-two-kaho', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kahoSource, llBp1001, secondKaho]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, llBp1001.instanceId),
          SlotPosition.CENTER,
          kahoSource.instanceId
        ),
        SlotPosition.RIGHT,
        secondKaho.instanceId
      ),
    }));

    expect(hasBp5003YellowHeartModifier(game)).toBe(false);
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
        groupNames: ['Aqours'],
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

  it('collects PL!SP-bp5-016 as SOURCE_MEMBER purple Heart x2 when own energy is at least ten', () => {
    const { game, sourceId } = createSpBp5016EnergyState({ energyCount: 10 });

    const modifiers = collectLiveModifiers(game);
    expect(modifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PURPLE, 2)],
      sourceCardId: sourceId,
      abilityId: SP_BP5_016_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', sourceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.PURPLE, 2),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('does not collect PL!SP-bp5-016 purple Heart when own energy is nine', () => {
    const { game, sourceId } = createSpBp5016EnergyState({ energyCount: 9 });

    expect(
      collectLiveModifiers(game).some(
        (modifier) => modifier.abilityId === SP_BP5_016_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
    expect(getMemberEffectiveHeartIcons(game, 'p1', sourceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
    ]);
  });

  it('does not collect PL!SP-bp5-016 purple Heart when the source is not on stage', () => {
    const { game } = createSpBp5016EnergyState({ energyCount: 10, sourceOnStage: false });

    expect(
      collectLiveModifiers(game).some(
        (modifier) => modifier.abilityId === SP_BP5_016_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
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

  it('recognizes Hasunosora members through structured groupNames only', () => {
    const left = createHasunosoraMemberData('OTHER-HS-CN', '日野下花帆', 4, {
      groupNames: ['莲之空'],
    });
    const center = createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13, {
      groupNames: ['蓮ノ空'],
    });
    const right = createHasunosoraMemberData('OTHER-HS-JP', '村野沙耶香', 11, {
      groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    });
    const leftCard = createCardInstance(left, 'p1', 'group-aliases-left');
    const centerCard = createCardInstance(center, 'p1', 'group-aliases-center');
    const rightCard = createCardInstance(right, 'p1', 'group-aliases-right');

    let game = createGameState('hs-bp1-003-group-aliases', 'p1', 'P1', 'p2', 'P2');
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
  });

  it('uses LL-bp1-001 as Hinoshita Kaho for PL!HS-bp1-003 Q81 Hasunosora names', () => {
    const llBp1001 = createCardInstance(createLlBp1001MemberData(), 'p1', 'll-bp1-001');
    const kozue = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13, {
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      }),
      'p1',
      'kozue'
    );
    const sayaka = createCardInstance(
      createHasunosoraMemberData('PL!HS-test-sayaka', '村野さやか', 5, {
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      }),
      'p1',
      'sayaka'
    );

    let game = createGameState('hs-bp1-003-q81-positive', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [llBp1001, kozue, sayaka]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, llBp1001.instanceId),
          SlotPosition.CENTER,
          kozue.instanceId
        ),
        SlotPosition.RIGHT,
        sayaka.instanceId
      ),
    }));

    expect(hasHsBp1ContinuousScore(game)).toBe(true);
  });

  it('does not use LL-bp1-001 as another name under Hasunosora when Kaho is occupied', () => {
    const llBp1001 = createCardInstance(createLlBp1001MemberData(), 'p1', 'll-bp1-001');
    const kahoSource = createCardInstance(
      createHasunosoraMemberData('PL!HS-bp1-003-SEC', '日野下花帆', 13, {
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      }),
      'p1',
      'kaho-source'
    );
    const sayaka = createCardInstance(
      createHasunosoraMemberData('PL!HS-test-sayaka', '村野さやか', 5, {
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      }),
      'p1',
      'sayaka'
    );

    let game = createGameState('hs-bp1-003-q81-negative', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [llBp1001, kahoSource, sayaka]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, llBp1001.instanceId),
          SlotPosition.CENTER,
          kahoSource.instanceId
        ),
        SlotPosition.RIGHT,
        sayaka.instanceId
      ),
    }));

    expect(hasHsBp1ContinuousScore(game)).toBe(false);
  });

  it('does not recognize Hasunosora members from text or PL!HS card-code prefix', () => {
    const legacyIdentityCases = [
      {
        label: 'card-text',
        left: createHasunosoraMemberData('OTHER-HS-TEXT-1', '日野下花帆', 4, {
          groupNames: [],
          cardText: 'Hasunosora のメンバー。',
        }),
        center: createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13, {
          groupNames: [],
          cardText: 'Hasunosora のメンバー。',
        }),
        right: createHasunosoraMemberData('OTHER-HS-TEXT-2', '村野沙耶香', 11, {
          groupNames: [],
          cardText: 'Hasunosora のメンバー。',
        }),
      },
      {
        label: 'card-code-prefix',
        left: createHasunosoraMemberData('PL!HS-test-left', '日野下花帆', 4, {
          groupNames: [],
        }),
        center: createHasunosoraMemberData('PL!HS-bp1-003-SEC', '乙宗梢', 13, {
          groupNames: [],
        }),
        right: createHasunosoraMemberData('PL!HS-test-right', '村野沙耶香', 11, {
          groupNames: [],
        }),
      },
    ] as const;

    for (const { label, left, center, right } of legacyIdentityCases) {
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

      expect(hasHsBp1ContinuousScore(game)).toBe(false);
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

describe('PL!SP-bp2-004 continuous center-highest-cost yellow Heart', () => {
  const abilityId = 'PL!SP-bp2-004:continuous-center-highest-stage-cost-gain-yellow-heart';

  function createScenario(options: {
    readonly sourceSlot: SlotPosition.LEFT | SlotPosition.CENTER | SlotPosition.RIGHT;
    readonly leftCost: number;
    readonly centerCost: number;
    readonly rightCost: number;
    readonly opponentCost?: number;
    readonly belowCost?: number;
  }) {
    const costs = {
      [SlotPosition.LEFT]: options.leftCost,
      [SlotPosition.CENTER]: options.centerCost,
      [SlotPosition.RIGHT]: options.rightCost,
    };
    const stageCards = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].map(
      (slot) =>
        createCardInstance(
          {
            cardCode:
              slot === options.sourceSlot ? 'PL!SP-bp2-004-P' : `TEST-SP-BP2-004-${slot}`,
            name: slot === options.sourceSlot ? '平安名すみれ' : `Stage ${slot}`,
            groupNames: ['Liella!'],
            cardType: CardType.MEMBER,
            cost: costs[slot],
            blade: 1,
            hearts: [createHeartIcon(HeartColor.PINK, 1)],
          },
          'p1',
          `sp-bp2-004-${slot}`
        )
    );
    const source = stageCards.find((_, index) =>
      [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index] === options.sourceSlot
    )!;
    const opponent = createCardInstance(
      {
        cardCode: 'TEST-SP-BP2-004-OPPONENT',
        name: 'Opponent',
        cardType: CardType.MEMBER,
        cost: options.opponentCost ?? 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p2',
      'sp-bp2-004-opponent'
    );
    const below = createCardInstance(
      {
        cardCode: 'TEST-SP-BP2-004-BELOW',
        name: 'Below',
        cardType: CardType.MEMBER,
        cost: options.belowCost ?? 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'sp-bp2-004-below'
    );
    let game = registerCards(
      createGameState('sp-bp2-004-continuous', 'p1', 'P1', 'p2', 'P2'),
      [...stageCards, opponent, below]
    );
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = player.memberSlots;
      for (const [index, slot] of [
        SlotPosition.LEFT,
        SlotPosition.CENTER,
        SlotPosition.RIGHT,
      ].entries()) {
        memberSlots = placeCardInSlot(memberSlots, slot, stageCards[index].instanceId);
      }
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, below.instanceId);
      return { ...player, memberSlots };
    });
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        opponent.instanceId
      ),
    }));
    return {
      game,
      sourceId: source.instanceId,
      centerId: stageCards[1].instanceId,
      leftId: stageCards[0].instanceId,
      rightId: stageCards[2].instanceId,
    };
  }

  function findModifiers(game: ReturnType<typeof createGameState>) {
    return collectLiveModifiers(game).filter(
      (modifier) => modifier.kind === 'HEART' && modifier.abilityId === abilityId
    );
  }

  it.each([
    [SlotPosition.LEFT, 4, 9, 7],
    [SlotPosition.RIGHT, 7, 9, 4],
    [SlotPosition.CENTER, 4, 9, 7],
  ])('grants the source in %s one SOURCE_MEMBER yellow Heart when center is highest', (sourceSlot, leftCost, centerCost, rightCost) => {
    const { game, sourceId } = createScenario({ sourceSlot, leftCost, centerCost, rightCost });

    expect(findModifiers(game)).toEqual([
      {
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        playerId: 'p1',
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
        sourceCardId: sourceId,
        abilityId,
      },
    ]);
    expect(game.liveResolution.playerHeartBonuses.has('p1')).toBe(false);
  });

  it('accepts a highest-cost tie and ignores higher-cost opponent and memberBelow cards', () => {
    const { game } = createScenario({
      sourceSlot: SlotPosition.LEFT,
      leftCost: 9,
      centerCost: 9,
      rightCost: 5,
      opponentCost: 30,
      belowCost: 40,
    });
    expect(findModifiers(game)).toHaveLength(1);
  });

  it.each([
    [10, 9, 5],
    [5, 9, 10],
  ])('does not grant when center cost is strictly below a side member (%s/%s/%s)', (leftCost, centerCost, rightCost) => {
    const { game } = createScenario({
      sourceSlot: SlotPosition.LEFT,
      leftCost,
      centerCost,
      rightCost,
    });
    expect(findModifiers(game)).toEqual([]);
  });

  it('does not grant with an empty center or after the source leaves the main stage', () => {
    const scenario = createScenario({
      sourceSlot: SlotPosition.LEFT,
      leftCost: 4,
      centerCost: 9,
      rightCost: 7,
    });
    const emptyCenter = updatePlayer(scenario.game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    const sourceOffStage = updatePlayer(scenario.game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: null },
      },
    }));
    expect(findModifiers(emptyCenter)).toEqual([]);
    expect(findModifiers(sourceOffStage)).toEqual([]);
  });

  it('uses effective-cost modifiers for center and side members', () => {
    const scenario = createScenario({
      sourceSlot: SlotPosition.LEFT,
      leftCost: 4,
      centerCost: 7,
      rightCost: 9,
    });
    const centerRaised = addLiveModifier(scenario.game, {
      kind: 'MEMBER_COST',
      playerId: 'p1',
      memberCardId: scenario.centerId,
      sourceCardId: 'test-center-cost-source',
      abilityId: 'test:center-cost-plus-two',
      countDelta: 2,
    });
    expect(findModifiers(centerRaised)).toHaveLength(1);

    const sideRaised = addLiveModifier(centerRaised, {
      kind: 'MEMBER_COST',
      playerId: 'p1',
      memberCardId: scenario.rightId,
      sourceCardId: 'test-side-cost-source',
      abilityId: 'test:side-cost-plus-one',
      countDelta: 1,
    });
    expect(findModifiers(sideRaised)).toEqual([]);
  });

  it('disappears and naturally recovers across fresh continuous collections', () => {
    const scenario = createScenario({
      sourceSlot: SlotPosition.LEFT,
      leftCost: 4,
      centerCost: 9,
      rightCost: 8,
    });
    expect(findModifiers(scenario.game)).toHaveLength(1);
    const sideRaised = addLiveModifier(scenario.game, {
      kind: 'MEMBER_COST',
      playerId: 'p1',
      memberCardId: scenario.rightId,
      sourceCardId: 'test-temporary-side-cost-source',
      abilityId: 'test:temporary-side-cost-plus-two',
      countDelta: 2,
    });
    expect(findModifiers(sideRaised)).toEqual([]);
    expect(findModifiers(scenario.game)).toHaveLength(1);
  });

  it('collects once per legal source instance without duplicating either source', () => {
    const first = createScenario({
      sourceSlot: SlotPosition.LEFT,
      leftCost: 4,
      centerCost: 9,
      rightCost: 4,
    });
    const secondSource = createCardInstance(
      {
        cardCode: 'PL!SP-bp2-004-R',
        name: '平安名すみれ',
        groupNames: ['Liella!'],
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'sp-bp2-004-second-source'
    );
    let game = registerCards(first.game, [secondSource]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.RIGHT,
        secondSource.instanceId
      ),
    }));
    const modifiers = findModifiers(game);
    expect(modifiers).toHaveLength(2);
    expect(new Set(modifiers.map((modifier) => modifier.sourceCardId))).toEqual(
      new Set([first.sourceId, secondSource.instanceId])
    );
  });
});

describe('memberHasMoreEffectiveHeartsThanPrinted', () => {
  it('compares summed effective Heart counts for the exact own stage member', () => {
    const member = createStageMember('QUERY-MEMBER', 'p1', 'query-member', 2);
    const other = createStageMember('QUERY-OTHER', 'p1', 'query-other', 1);
    const opponent = createStageMember('QUERY-OPPONENT', 'p2', 'query-opponent', 1);
    let game = createGameState('heart-query', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, other, opponent]);
    game = placeMemberOnStage(game, 'p1', SlotPosition.CENTER, member.instanceId);
    game = placeMemberOnStage(game, 'p1', SlotPosition.LEFT, other.instanceId);
    game = placeMemberOnStage(game, 'p2', SlotPosition.CENTER, opponent.instanceId);

    expect(memberHasMoreEffectiveHeartsThanPrinted(game, 'p1', member.instanceId)).toBe(false);
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      sourceCardId: member.instanceId,
      abilityId: 'source-heart',
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
    });
    expect(memberHasMoreEffectiveHeartsThanPrinted(game, 'p1', member.instanceId)).toBe(true);

    const onlyOtherModifiers = addLiveModifier(
      { ...game, liveResolution: { ...game.liveResolution, liveModifiers: [] } },
      {
        kind: 'HEART',
        target: 'TARGET_MEMBER',
        playerId: 'p1',
        targetMemberCardId: other.instanceId,
        sourceCardId: 'other-source',
        abilityId: 'other-heart',
        hearts: [createHeartIcon(HeartColor.BLUE, 3)],
      }
    );
    expect(memberHasMoreEffectiveHeartsThanPrinted(onlyOtherModifiers, 'p1', member.instanceId)).toBe(false);
    expect(memberHasMoreEffectiveHeartsThanPrinted(game, 'p2', member.instanceId)).toBe(false);
    expect(memberHasMoreEffectiveHeartsThanPrinted(game, 'p1', 'missing')).toBe(false);
  });

  it('counts HeartIcon.count and ignores original-color replacement without a count increase', () => {
    const member = createCardInstance(
      {
        cardCode: 'QUERY-MULTI',
        name: 'query multi',
        groupNames: ['蓮ノ空'],
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.BLUE, 2)],
      },
      'p1',
      'query-multi'
    );
    let game = createGameState('heart-query-multi', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member]);
    game = placeMemberOnStage(game, 'p1', SlotPosition.CENTER, member.instanceId);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: 'p1',
      memberCardId: member.instanceId,
      color: HeartColor.GREEN,
      sourceCardId: 'replacement-source',
      abilityId: 'replacement',
    });
    expect(memberHasMoreEffectiveHeartsThanPrinted(game, 'p1', member.instanceId)).toBe(false);
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: 'p1',
      targetMemberCardId: member.instanceId,
      sourceCardId: 'target-source',
      abilityId: 'target-heart',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    });
    expect(memberHasMoreEffectiveHeartsThanPrinted(game, 'p1', member.instanceId)).toBe(true);
  });
});

describe('PL!S-pb1-005 continuous opponent energy lead BLADE', () => {
  function setupYouEnergyLeadScenario(
    options: {
      readonly ownEnergyCount?: number;
      readonly opponentEnergyCount?: number;
      readonly sourcePlacement?: 'STAGE' | 'MEMBER_BELOW' | 'OFF_STAGE';
    } = {}
  ) {
    const you = createCardInstance(
      {
        cardCode: 'PL!S-pb1-005-R',
        name: '渡辺 曜',
        groupNames: ['Aqours'],
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      },
      'p1',
      'you'
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
    const ownEnergy = Array.from({ length: options.ownEnergyCount ?? 0 }, (_, index) =>
      createCardInstance(
        { cardCode: `OWN-ENE-${index}`, name: `Own Energy ${index}`, cardType: CardType.ENERGY },
        'p1',
        `own-energy-${index}`
      )
    );
    const opponentEnergy = Array.from({ length: options.opponentEnergyCount ?? 0 }, (_, index) =>
      createCardInstance(
        { cardCode: `OPP-ENE-${index}`, name: `Opponent Energy ${index}`, cardType: CardType.ENERGY },
        'p2',
        `opponent-energy-${index}`
      )
    );
    let game = createGameState('s-pb1-005-energy-lead', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [you, host, ...ownEnergy, ...opponentEnergy]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = player.memberSlots;
      if (options.sourcePlacement === 'MEMBER_BELOW') {
        memberSlots = addMemberBelowMember(
          placeCardInSlot(memberSlots, SlotPosition.CENTER, host.instanceId),
          SlotPosition.CENTER,
          you.instanceId
        );
      } else if (options.sourcePlacement !== 'OFF_STAGE') {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, you.instanceId);
      }
      return {
        ...player,
        memberSlots,
        energyZone: ownEnergy.reduce(
          (zone, energy) => addCardToStatefulZone(zone, energy.instanceId),
          player.energyZone
        ),
      };
    });
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      energyZone: opponentEnergy.reduce(
        (zone, energy) => addCardToStatefulZone(zone, energy.instanceId),
        player.energyZone
      ),
    }));
    return { game, you };
  }

  it('grants BLADE +3 when the opponent has more energy cards', () => {
    const { game, you } = setupYouEnergyLeadScenario({
      ownEnergyCount: 2,
      opponentEnergyCount: 3,
    });

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 3,
      sourceCardId: you.instanceId,
      abilityId: PL_S_PB1_005_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', you.instanceId)).toBe(4);
  });

  it('does not grant BLADE when energy counts are equal or own energy is greater', () => {
    for (const scenario of [
      setupYouEnergyLeadScenario({ ownEnergyCount: 2, opponentEnergyCount: 2 }),
      setupYouEnergyLeadScenario({ ownEnergyCount: 3, opponentEnergyCount: 2 }),
    ]) {
      expect(
        collectLiveModifiers(scenario.game).some(
          (modifier) =>
            modifier.kind === 'BLADE' && modifier.abilityId === PL_S_PB1_005_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
      expect(getMemberEffectiveBladeCount(scenario.game, 'p1', scenario.you.instanceId)).toBe(1);
    }
  });

  it('does not grant BLADE when the source is off stage or below another member', () => {
    for (const scenario of [
      setupYouEnergyLeadScenario({
        ownEnergyCount: 2,
        opponentEnergyCount: 3,
        sourcePlacement: 'OFF_STAGE',
      }),
      setupYouEnergyLeadScenario({
        ownEnergyCount: 2,
        opponentEnergyCount: 3,
        sourcePlacement: 'MEMBER_BELOW',
      }),
    ]) {
      expect(
        collectLiveModifiers(scenario.game).some(
          (modifier) =>
            modifier.kind === 'BLADE' && modifier.abilityId === PL_S_PB1_005_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });
});

describe('PL!S-pb1-009 continuous total success LIVE BLADE', () => {
  function setupRubyTotalSuccessScenario(
    options: {
      readonly ownSuccessCount?: number;
      readonly opponentSuccessCount?: number;
      readonly sourcePlacement?: 'STAGE' | 'MEMBER_BELOW' | 'OFF_STAGE';
    } = {}
  ) {
    const ruby = createCardInstance(
      {
        cardCode: 'PL!S-pb1-009-R',
        name: '黒澤ルビィ',
        groupNames: ['Aqours'],
        cardType: CardType.MEMBER,
        cost: 11,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.RED, 1)],
      },
      'p1',
      's-pb1-009-ruby'
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
      's-pb1-009-host'
    );
    const ownSuccessCards = Array.from({ length: options.ownSuccessCount ?? 0 }, (_, index) =>
      createCardInstance(
        createAqoursLiveData(`PL!S-pb1-009-own-success-${index}`, `Own Success ${index}`),
        'p1',
        `s-pb1-009-own-success-${index}`
      )
    );
    const opponentSuccessCards = Array.from(
      { length: options.opponentSuccessCount ?? 0 },
      (_, index) =>
        createCardInstance(
          createAqoursLiveData(
            `PL!S-pb1-009-opponent-success-${index}`,
            `Opponent Success ${index}`
          ),
          'p2',
          `s-pb1-009-opponent-success-${index}`
        )
    );
    let game = createGameState('s-pb1-009-total-success', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [ruby, host, ...ownSuccessCards, ...opponentSuccessCards]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = player.memberSlots;
      if (options.sourcePlacement === 'MEMBER_BELOW') {
        memberSlots = addMemberBelowMember(
          placeCardInSlot(memberSlots, SlotPosition.CENTER, host.instanceId),
          SlotPosition.CENTER,
          ruby.instanceId
        );
      } else if (options.sourcePlacement !== 'OFF_STAGE') {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, ruby.instanceId);
      }
      return {
        ...player,
        memberSlots,
        successZone: ownSuccessCards.reduce(
          (zone, card) => addCardToZone(zone, card.instanceId),
          player.successZone
        ),
      };
    });
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      successZone: opponentSuccessCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.successZone
      ),
    }));
    return { game, ruby };
  }

  it('grants BLADE +3 when both success LIVE zones contain at least three cards total', () => {
    const { game, ruby } = setupRubyTotalSuccessScenario({
      ownSuccessCount: 1,
      opponentSuccessCount: 2,
    });

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 3,
      sourceCardId: ruby.instanceId,
      abilityId: PL_S_PB1_009_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', ruby.instanceId)).toBe(4);
  });

  it('does not grant BLADE when the total success LIVE count is below three', () => {
    const { game, ruby } = setupRubyTotalSuccessScenario({
      ownSuccessCount: 1,
      opponentSuccessCount: 1,
    });

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'BLADE' && modifier.abilityId === PL_S_PB1_009_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
    expect(getMemberEffectiveBladeCount(game, 'p1', ruby.instanceId)).toBe(1);
  });

  it('does not grant BLADE when the source is off stage or below another member', () => {
    for (const scenario of [
      setupRubyTotalSuccessScenario({
        ownSuccessCount: 1,
        opponentSuccessCount: 2,
        sourcePlacement: 'OFF_STAGE',
      }),
      setupRubyTotalSuccessScenario({
        ownSuccessCount: 1,
        opponentSuccessCount: 2,
        sourcePlacement: 'MEMBER_BELOW',
      }),
    ]) {
      expect(
        collectLiveModifiers(scenario.game).some(
          (modifier) =>
            modifier.kind === 'BLADE' && modifier.abilityId === PL_S_PB1_009_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('counts either player successZone cards toward the total', () => {
    for (const scenario of [
      setupRubyTotalSuccessScenario({ ownSuccessCount: 3, opponentSuccessCount: 0 }),
      setupRubyTotalSuccessScenario({ ownSuccessCount: 0, opponentSuccessCount: 3 }),
    ]) {
      expect(
        collectLiveModifiers(scenario.game).some(
          (modifier) =>
            modifier.kind === 'BLADE' && modifier.abilityId === PL_S_PB1_009_CONTINUOUS_ABILITY_ID
        )
      ).toBe(true);
    }
  });
});

describe('PL!S-bp2-001 continuous own-empty opponent-success BLADE', () => {
  function setupChikaSuccessScenario(options: {
    readonly cardCode: 'PL!S-bp2-001-P' | 'PL!S-bp2-001-R';
    readonly ownSuccessCount: number;
    readonly opponentSuccessCount: number;
    readonly sourceOnStage?: boolean;
  }) {
    const chika = createCardInstance(
      {
        cardCode: options.cardCode,
        name: '高海千歌',
        cardType: CardType.MEMBER,
        cost: 9,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      `bp2-001-${options.cardCode.endsWith('-P') ? 'p' : 'r'}`
    );
    const ownSuccess = Array.from({ length: options.ownSuccessCount }, (_, index) =>
      createCardInstance(
        createMuseLiveData(`PL!-bp2-001-own-${index}`, `Own ${index}`, 1),
        'p1',
        `bp2-001-own-${index}`
      )
    );
    const opponentSuccess = Array.from({ length: options.opponentSuccessCount }, (_, index) =>
      createCardInstance(
        createMuseLiveData(`PL!-bp2-001-opponent-${index}`, `Opponent ${index}`, 1),
        'p2',
        `bp2-001-opponent-${index}`
      )
    );
    let game = createGameState('s-bp2-001-continuous', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [chika, ...ownSuccess, ...opponentSuccess]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots:
        options.sourceOnStage === false
          ? player.memberSlots
          : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, chika.instanceId),
      successZone: ownSuccess.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.successZone
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      successZone: opponentSuccess.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.successZone
      ),
    }));
    return { game, chika };
  }

  function hasChikaBladeModifier(game: ReturnType<typeof setupChikaSuccessScenario>['game']) {
    return collectLiveModifiers(game).find(
      (modifier) =>
        modifier.kind === 'BLADE' &&
        modifier.abilityId ===
          'PL!S-bp2-001:continuous-own-no-success-opponent-has-success-gain-three-blade'
    );
  }

  it('grants fixed BLADE +3 to both P and R when own success zone is empty and opponent has one', () => {
    for (const cardCode of ['PL!S-bp2-001-P', 'PL!S-bp2-001-R'] as const) {
      const scenario = setupChikaSuccessScenario({
        cardCode,
        ownSuccessCount: 0,
        opponentSuccessCount: 1,
      });
      expect(hasChikaBladeModifier(scenario.game)).toMatchObject({
        playerId: 'p1',
        countDelta: 3,
        sourceCardId: scenario.chika.instanceId,
      });
      expect(getMemberEffectiveBladeCount(scenario.game, 'p1', scenario.chika.instanceId)).toBe(4);
    }
  });

  it('remains fixed at BLADE +3 when the opponent has more than one success LIVE', () => {
    const scenario = setupChikaSuccessScenario({
      cardCode: 'PL!S-bp2-001-P',
      ownSuccessCount: 0,
      opponentSuccessCount: 3,
    });
    expect(hasChikaBladeModifier(scenario.game)).toMatchObject({ countDelta: 3 });
  });

  it('does not grant BLADE when both success zones are empty or own success zone has a card', () => {
    for (const scenario of [
      setupChikaSuccessScenario({
        cardCode: 'PL!S-bp2-001-P',
        ownSuccessCount: 0,
        opponentSuccessCount: 0,
      }),
      setupChikaSuccessScenario({
        cardCode: 'PL!S-bp2-001-R',
        ownSuccessCount: 1,
        opponentSuccessCount: 2,
      }),
    ]) {
      expect(hasChikaBladeModifier(scenario.game)).toBeUndefined();
    }
  });

  it('does not grant BLADE while the source member is not on its owner\'s main stage', () => {
    const scenario = setupChikaSuccessScenario({
      cardCode: 'PL!S-bp2-001-R',
      ownSuccessCount: 0,
      opponentSuccessCount: 1,
      sourceOnStage: false,
    });
    expect(hasChikaBladeModifier(scenario.game)).toBeUndefined();
  });
});

describe('PL!HS-pb1-022 continuous Rurino/Megu stage bonuses', () => {
  function setupHimeStageScenario(options: {
    readonly includeRurino?: boolean;
    readonly includeMegu?: boolean;
    readonly sourcePlacement?: 'STAGE' | 'OFF_STAGE' | 'MEMBER_BELOW';
    readonly rurinoCardCode?: string;
    readonly rurinoName?: string;
  }) {
    const hime = createCardInstance(
      {
        cardCode: 'PL!HS-pb1-022-N',
        name: '安養寺姫芽',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        unitName: 'みらくらぱーく！',
        cardType: CardType.MEMBER,
        cost: 5,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'hs-pb1-022-hime'
    );
    const host = createCardInstance(
      {
        cardCode: 'PL!HS-test-host',
        name: 'Host',
        cardType: CardType.MEMBER,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'hs-pb1-022-host'
    );
    const rurino = createCardInstance(
      {
        cardCode: options.rurinoCardCode ?? 'PL!HS-test-rurino',
        name: options.rurinoName ?? '大沢瑠璃乃',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        unitName: 'みらくらぱーく！',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'hs-pb1-022-rurino'
    );
    const megu = createCardInstance(
      {
        cardCode: 'PL!HS-test-megu',
        name: '藤島慈',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
        unitName: 'みらくらぱーく！',
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'hs-pb1-022-megu'
    );

    let game = createGameState('hs-pb1-022-continuous', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hime, host, rurino, megu]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = player.memberSlots;
      if (options.sourcePlacement === 'MEMBER_BELOW') {
        memberSlots = addMemberBelowMember(
          placeCardInSlot(memberSlots, SlotPosition.CENTER, host.instanceId),
          SlotPosition.CENTER,
          hime.instanceId
        );
      } else if (options.sourcePlacement !== 'OFF_STAGE') {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, hime.instanceId);
      }
      if (options.includeRurino) {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, rurino.instanceId);
      }
      if (options.includeMegu) {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, megu.instanceId);
      }
      return { ...player, memberSlots };
    });
    return { game, hime };
  }

  it('grants pink Heart x2 while Rurino is on stage', () => {
    const { game, hime } = setupHimeStageScenario({ includeRurino: true });

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      sourceCardId: hime.instanceId,
      abilityId: HS_PB1_022_CONTINUOUS_RURINO_ABILITY_ID,
      hearts: [{ color: HeartColor.PINK, count: 2 }],
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', hime.instanceId)).toContainEqual({
      color: HeartColor.PINK,
      count: 2,
    });
  });

  it('grants pink Heart x2 when LL-bp2-001 contributes its Rurino identity', () => {
    const { game, hime } = setupHimeStageScenario({
      includeRurino: true,
      rurinoCardCode: 'LL-bp2-001-R＋',
      rurinoName: '渡辺 曜&鬼塚夏美&大沢瑠璃乃',
    });

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      sourceCardId: hime.instanceId,
      abilityId: HS_PB1_022_CONTINUOUS_RURINO_ABILITY_ID,
      hearts: [{ color: HeartColor.PINK, count: 2 }],
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', hime.instanceId)).toContainEqual({
      color: HeartColor.PINK,
      count: 2,
    });
  });

  it('grants BLADE +2 while Megu is on stage and stacks with the Rurino bonus', () => {
    const { game, hime } = setupHimeStageScenario({ includeRurino: true, includeMegu: true });

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      sourceCardId: hime.instanceId,
      abilityId: HS_PB1_022_CONTINUOUS_MEGU_ABILITY_ID,
      countDelta: 2,
    });
    expect(getMemberEffectiveBladeCount(game, 'p1', hime.instanceId)).toBe(3);
  });

  it('does not apply either bonus when the source is not a main stage member', () => {
    for (const sourcePlacement of ['OFF_STAGE', 'MEMBER_BELOW'] as const) {
      const { game } = setupHimeStageScenario({
        includeRurino: true,
        includeMegu: true,
        sourcePlacement,
      });
      expect(
        collectLiveModifiers(game).some(
          (modifier) =>
            modifier.abilityId === HS_PB1_022_CONTINUOUS_RURINO_ABILITY_ID ||
            modifier.abilityId === HS_PB1_022_CONTINUOUS_MEGU_ABILITY_ID
        )
      ).toBe(false);
    }
  });
});

describe('PL!N-pb1-007 continuous six-color LIVE requirement ALL Heart', () => {
  function createSetsunaPb1007() {
    return createCardInstance(
      {
        cardCode: 'PL!N-pb1-007-R',
        name: '優木せつ菜',
        groupNames: ['虹ヶ咲'],
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.RED, 1)],
      },
      'p1',
      'setsuna'
    );
  }

  function createSixColorRequirementLive(
    colorRequirements: Partial<Record<HeartColor, number>>,
    instanceId = 'six-color-live'
  ) {
    return createCardInstance(
      {
        cardCode: `LIVE-${instanceId}`,
        name: `Live ${instanceId}`,
        cardType: CardType.LIVE,
        score: 4,
        requirements: createHeartRequirement(colorRequirements),
      },
      'p1',
      instanceId
    );
  }

  function setupSetsunaSixColorScenario(
    options: {
      readonly colorRequirements?: Partial<Record<HeartColor, number>>;
      readonly sourcePlacement?: 'STAGE' | 'MEMBER_BELOW' | 'OFF_STAGE';
      readonly requirementModifier?: LiveModifierState;
    } = {}
  ) {
    const setsuna = createSetsunaPb1007();
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
      'setsuna-host'
    );
    const live = createSixColorRequirementLive(
      options.colorRequirements ?? {
        [HeartColor.PINK]: 1,
        [HeartColor.RED]: 1,
        [HeartColor.YELLOW]: 1,
        [HeartColor.GREEN]: 1,
        [HeartColor.BLUE]: 1,
        [HeartColor.PURPLE]: 1,
      }
    );
    let game = createGameState('n-pb1-007-six-color-requirement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [setsuna, host, live]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = player.memberSlots;
      if (options.sourcePlacement === 'MEMBER_BELOW') {
        memberSlots = addMemberBelowMember(
          placeCardInSlot(memberSlots, SlotPosition.CENTER, host.instanceId),
          SlotPosition.CENTER,
          setsuna.instanceId
        );
      } else if (options.sourcePlacement !== 'OFF_STAGE') {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, setsuna.instanceId);
      }
      return {
        ...player,
        memberSlots,
        liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      };
    });
    if (options.requirementModifier) {
      game = addLiveModifier(game, options.requirementModifier);
    }
    return { game, setsuna, live };
  }

  it('grants ALL Heart when the current LIVE requirement contains all six ordinary colors', () => {
    const { game, setsuna } = setupSetsunaSixColorScenario();

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.RAINBOW, 1)],
      sourceCardId: setsuna.instanceId,
      abilityId: PL_N_PB1_007_CONTINUOUS_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', setsuna.instanceId)).toEqual([
      createHeartIcon(HeartColor.RED, 1),
      createHeartIcon(HeartColor.RAINBOW, 1),
    ]);
  });

  it('does not grant ALL Heart when any ordinary color is missing', () => {
    const { game, setsuna } = setupSetsunaSixColorScenario({
      colorRequirements: {
        [HeartColor.PINK]: 1,
        [HeartColor.RED]: 1,
        [HeartColor.YELLOW]: 1,
        [HeartColor.GREEN]: 1,
        [HeartColor.BLUE]: 1,
      },
    });

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'HEART' && modifier.abilityId === PL_N_PB1_007_CONTINUOUS_ABILITY_ID
      )
    ).toBe(false);
    expect(getMemberEffectiveHeartIcons(game, 'p1', setsuna.instanceId)).toEqual([
      createHeartIcon(HeartColor.RED, 1),
    ]);
  });

  it('does not grant ALL Heart when the source is off stage or below another member', () => {
    for (const scenario of [
      setupSetsunaSixColorScenario({ sourcePlacement: 'OFF_STAGE' }),
      setupSetsunaSixColorScenario({ sourcePlacement: 'MEMBER_BELOW' }),
    ]) {
      expect(
        collectLiveModifiers(scenario.game).some(
          (modifier) =>
            modifier.kind === 'HEART' && modifier.abilityId === PL_N_PB1_007_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('uses current effective LIVE requirements after requirement modifiers', () => {
    const colorRequirements = {
      [HeartColor.PINK]: 1,
      [HeartColor.RED]: 1,
      [HeartColor.YELLOW]: 1,
      [HeartColor.GREEN]: 1,
      [HeartColor.BLUE]: 1,
    };
    const { live } = setupSetsunaSixColorScenario({ colorRequirements });
    const scenario = setupSetsunaSixColorScenario({
      colorRequirements,
      requirementModifier: {
        kind: 'REQUIREMENT',
        liveCardId: live.instanceId,
        modifiers: [{ color: HeartColor.PURPLE, countDelta: 1 }],
        sourceCardId: 'requirement-modifier-source',
        abilityId: 'test-add-purple-requirement',
      },
    });

    expect(collectLiveModifiers(scenario.game)).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.RAINBOW, 1)],
      sourceCardId: scenario.setsuna.instanceId,
      abilityId: PL_N_PB1_007_CONTINUOUS_ABILITY_ID,
    });
  });
});

function hasHsBp1ContinuousScore(game: ReturnType<typeof createGameState>): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === 'PL!HS-bp1-003-SEC:continuous-three-different-hasunosora-score'
  );
}

function createHsBp2002Sayaka(instanceId: string, cost: number) {
  return createCardInstance(
    {
      cardCode: 'PL!HS-bp2-002-R＋',
      name: '村野さやか',
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    },
    'p1',
    instanceId
  );
}

function createTestMember(instanceId: string, cost: number, ownerId = 'p1') {
  return createCardInstance(
    {
      cardCode: `PL!HS-test-${instanceId}`,
      name: instanceId,
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    ownerId,
    instanceId
  );
}

function hasHsBp2002BladeModifier(game: ReturnType<typeof createGameState>): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'BLADE' && modifier.abilityId === HS_BP2_002_CONTINUOUS_ABILITY_ID
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

function hasSpPr022HeartModifier(game: ReturnType<typeof createGameState>): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.target === 'SOURCE_MEMBER' &&
      modifier.abilityId === SP_PR_022_CONTINUOUS_ABILITY_ID
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
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 2,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    instanceId
  );
}

function createSpBp5016Ren(instanceId: string) {
  return createCardInstance(
    {
      cardCode: 'PL!SP-bp5-016-N',
      name: '葉月 恋',
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 9,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    instanceId
  );
}

function createSpBp5016EnergyState(options: {
  readonly energyCount: number;
  readonly sourceOnStage?: boolean;
}) {
  const ren = createSpBp5016Ren('sp-bp5-016-ren');
  const energyCards = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(
      {
        cardCode: `PL!SP-bp5-016-energy-${index + 1}`,
        name: `Energy ${index + 1}`,
        cardType: CardType.ENERGY,
      },
      'p1',
      `sp-bp5-016-energy-${index + 1}`
    )
  );

  let game = createGameState('sp-bp5-016-energy-ten', 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, [ren, ...energyCards]);
  game = updatePlayer(game, 'p1', (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ren.instanceId),
    energyZone: energyCards.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));

  return { game, sourceId: ren.instanceId };
}

function createSpPb2EnergyHeartState(options: {
  readonly cardCode: string;
  readonly energyOrientations: readonly OrientationState[];
  readonly sourcePlacement?:
    | 'MAIN_STAGE'
    | 'OFF_STAGE'
    | 'MEMBER_BELOW'
    | 'HAND'
    | 'WAITING_ROOM';
}) {
  const source = createCardInstance(
    {
      cardCode: options.cardCode,
      name: options.cardCode,
      groupNames: ['Liella!'],
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
      groupNames: ['Liella!'],
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
    } else if (
      options.sourcePlacement === undefined ||
      options.sourcePlacement === 'MAIN_STAGE'
    ) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId);
    }

    return {
      ...player,
      memberSlots,
      hand:
        options.sourcePlacement === 'HAND'
          ? addCardToZone(player.hand, source.instanceId)
          : player.hand,
      waitingRoom:
        options.sourcePlacement === 'WAITING_ROOM'
          ? addCardToZone(player.waitingRoom, source.instanceId)
          : player.waitingRoom,
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

function createSpBp4StageCostState(options: {
  readonly sourceCardCode: string;
  readonly sourceSlot: SlotPosition;
  readonly ownOtherCosts: readonly number[];
  readonly opponentCosts: readonly number[];
  readonly sourcePrintedCost?: number;
  readonly sourceCostDelta?: number;
}) {
  const source = createCardInstance(
    {
      cardCode: options.sourceCardCode,
      name: options.sourceCardCode,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: options.sourcePrintedCost ?? 7,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    `${options.sourceCardCode}-source`
  );
  const ownMembers = options.ownOtherCosts.map((cost, index) =>
    createCardInstance(
      {
        cardCode: `PL!SP-bp4-own-${index}`,
        name: `Own ${index}`,
        groupNames: ['Liella!'],
        cardType: CardType.MEMBER,
        cost,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      `sp-bp4-own-${index}`
    )
  );
  const opponentMembers = options.opponentCosts.map((cost, index) =>
    createCardInstance(
      {
        cardCode: `PL!SP-bp4-opponent-${index}`,
        name: `Opponent ${index}`,
        groupNames: ['Liella!'],
        cardType: CardType.MEMBER,
        cost,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p2',
      `sp-bp4-opponent-${index}`
    )
  );

  let game = createGameState('sp-bp4-stage-cost-continuous', 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, [source, ...ownMembers, ...opponentMembers]);
  game = updatePlayer(game, 'p1', (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, options.sourceSlot, source.instanceId);
    const openSlots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].filter(
      (slot) => slot !== options.sourceSlot
    );
    for (const [index, member] of ownMembers.entries()) {
      memberSlots = placeCardInSlot(memberSlots, openSlots[index], member.instanceId);
    }
    return { ...player, memberSlots };
  });
  game = updatePlayer(game, 'p2', (player) => {
    let memberSlots = player.memberSlots;
    for (const [index, member] of opponentMembers.entries()) {
      memberSlots = placeCardInSlot(
        memberSlots,
        [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index],
        member.instanceId
      );
    }
    return { ...player, memberSlots };
  });

  return {
    game:
      options.sourceCostDelta !== undefined
        ? addLiveModifier(game, {
            kind: 'MEMBER_COST',
            playerId: 'p1',
            memberCardId: source.instanceId,
            sourceCardId: source.instanceId,
            abilityId: 'test:sp-bp4-source-cost-delta',
            countDelta: options.sourceCostDelta,
          })
        : game,
    sourceId: source.instanceId,
  };
}

function createSpBp4021EnergyState(options: {
  readonly ownEnergyCount: number;
  readonly opponentEnergyCount: number;
}) {
  const source = createCardInstance(
    {
      cardCode: 'PL!SP-bp4-021-N',
      name: 'ウィーン・マルガレーテ',
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 11,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    'sp-bp4-021-source'
  );
  const ownEnergy = Array.from({ length: options.ownEnergyCount }, (_, index) =>
    createCardInstance(
      { cardCode: `PL!SP-bp4-021-own-energy-${index}`, name: 'Energy', cardType: CardType.ENERGY },
      'p1',
      `sp-bp4-021-own-energy-${index}`
    )
  );
  const opponentEnergy = Array.from({ length: options.opponentEnergyCount }, (_, index) =>
    createCardInstance(
      {
        cardCode: `PL!SP-bp4-021-opponent-energy-${index}`,
        name: 'Energy',
        cardType: CardType.ENERGY,
      },
      'p2',
      `sp-bp4-021-opponent-energy-${index}`
    )
  );

  let game = createGameState('sp-bp4-021-energy-continuous', 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, [source, ...ownEnergy, ...opponentEnergy]);
  game = updatePlayer(game, 'p1', (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
    energyZone: ownEnergy.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.energyZone
    ),
  }));
  game = updatePlayer(game, 'p2', (player) => ({
    ...player,
    energyZone: opponentEnergy.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.energyZone
    ),
  }));

  return { game, sourceId: source.instanceId };
}

function createSpSd2ContinuousStageState(options: {
  readonly sourceCardCode: string;
  readonly sourcePlacement: 'CENTER' | 'LEFT' | 'OFF_STAGE' | 'MEMBER_BELOW';
  readonly otherPrintedCost?: number;
  readonly otherCostDelta?: number;
}) {
  const source = createCardInstance(
    {
      cardCode: options.sourceCardCode,
      name: options.sourceCardCode,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 5,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    `${options.sourceCardCode}-source`
  );
  const other = createCardInstance(
    {
      cardCode: 'PL!SP-test-high-cost',
      name: 'High Cost',
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: options.otherPrintedCost ?? 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.RED, 1)],
    },
    'p1',
    `${options.sourceCardCode}-other`
  );
  const host = createCardInstance(
    {
      cardCode: 'PL!SP-test-host',
      name: 'Host',
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    `${options.sourceCardCode}-host`
  );

  let game = createGameState(`${options.sourceCardCode}-continuous-stage`, 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, [source, other, host]);
  game = updatePlayer(game, 'p1', (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, other.instanceId);
    if (options.sourcePlacement === 'CENTER') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId);
    } else if (options.sourcePlacement === 'LEFT') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, source.instanceId);
    } else if (options.sourcePlacement === 'MEMBER_BELOW') {
      memberSlots = addMemberBelowMember(
        placeCardInSlot(memberSlots, SlotPosition.CENTER, host.instanceId),
        SlotPosition.CENTER,
        source.instanceId
      );
    }
    return {
      ...player,
      memberSlots,
    };
  });

  if (options.otherCostDelta) {
    game =
      addMemberCostLiveModifierForMember(game, {
        playerId: 'p1',
        memberCardId: other.instanceId,
        sourceCardId: source.instanceId,
        abilityId: 'test:other-cost-delta',
        countDelta: options.otherCostDelta,
      })?.gameState ?? game;
  }

  return { game, sourceId: source.instanceId, otherId: other.instanceId };
}

function createSpPr022StageState(options: {
  readonly totalStageMembers: 5 | 6;
  readonly sourcePlacement?: 'MAIN_STAGE' | 'OFF_STAGE' | 'MEMBER_BELOW';
}) {
  const source = createCardInstance(
    {
      cardCode: 'PL!SP-PR-022-PR',
      name: '若菜四季',
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    'p1',
    'sp-pr-022-source'
  );
  const p1Left = createStageFillerMember('p1-left-member', 'p1');
  const p1Center = createStageFillerMember('p1-center-member', 'p1');
  const p1Right = createStageFillerMember('p1-right-member', 'p1');
  const p2Left = createStageFillerMember('p2-left-member', 'p2');
  const p2Center = createStageFillerMember('p2-center-member', 'p2');
  const p2Right = createStageFillerMember('p2-right-member', 'p2');
  const allCards = [source, p1Left, p1Center, p1Right, p2Left, p2Center, p2Right];

  let game = createGameState('sp-pr-022-stage-six', 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, allCards);
  game = updatePlayer(game, 'p1', (player) => {
    const sourcePlacement = options.sourcePlacement ?? 'MAIN_STAGE';
    let memberSlots = player.memberSlots;
    if (sourcePlacement === 'MAIN_STAGE') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, p1Left.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, p1Right.instanceId);
    } else if (sourcePlacement === 'MEMBER_BELOW') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, p1Center.instanceId);
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, source.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, p1Left.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, p1Right.instanceId);
    } else {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, p1Center.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, p1Left.instanceId);
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, p1Right.instanceId);
    }
    return { ...player, memberSlots };
  });
  game = updatePlayer(game, 'p2', (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        options.totalStageMembers === 6
          ? placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, p2Right.instanceId)
          : player.memberSlots,
        SlotPosition.LEFT,
        p2Left.instanceId
      ),
      SlotPosition.CENTER,
      p2Center.instanceId
    ),
  }));

  return { game, sourceId: source.instanceId };
}

function createStageFillerMember(instanceId: string, ownerId: string) {
  return createCardInstance(
    {
      cardCode: `PL!SP-test-${instanceId}`,
      name: instanceId,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 2,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    ownerId,
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
    groupNames: ['Liella!'],
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
      groupNames: ["μ's"],
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
    groupNames: ["μ's"],
  };
}

function setupHsBp6002ContinuousGame(
  cardCode: string,
  options: { readonly withOtherMember?: boolean } = {}
) {
  const source = createCardInstance(
    {
      cardCode,
      name: '村野さやか',
      cardType: CardType.MEMBER,
      cost: 9,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      groupNames: ['蓮ノ空'],
    },
    'p1',
    `hs-bp6-002-${cardCode.endsWith('-P') ? 'p' : 'r'}`
  );
  const other = createCardInstance(
    {
      cardCode: 'PL!HS-bp6-002-other',
      name: 'Other Hasunosora Member',
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      groupNames: ['蓮ノ空'],
    },
    'p1',
    'hs-bp6-002-other'
  );

  let game = createGameState('hs-bp6-002-continuous', 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, [source, ...(options.withOtherMember ? [other] : [])]);
  game = updatePlayer(game, 'p1', (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId);
    if (options.withOtherMember) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, other.instanceId);
    }
    return { ...player, memberSlots };
  });

  return { game, sourceId: source.instanceId };
}

function createMuseMemberData(cardCode: string, name: string, blade: number) {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 4,
    blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    groupNames: ["μ's"],
  };
}

function setupBp6009ContinuousGame(
  options: {
    readonly nicoSlot?: SlotPosition;
    readonly leftBlade?: number | null;
    readonly rightBlade?: number | null;
  } = {}
) {
  const nico = createCardInstance(
    createMuseMemberData('PL!-bp6-009-R', '矢澤にこ', 5),
    'p1',
    'bp6-009-nico'
  );
  const left =
    options.leftBlade === null
      ? null
      : createCardInstance(
          createMuseMemberData('PL!-bp6-009-left', 'Left Member', options.leftBlade ?? 2),
          'p1',
          'bp6-009-left'
        );
  const right =
    options.rightBlade === null
      ? null
      : createCardInstance(
          createMuseMemberData('PL!-bp6-009-right', 'Right Member', options.rightBlade ?? 2),
          'p1',
          'bp6-009-right'
        );

  let game = createGameState('bp6-009-continuous', 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, [nico, ...(left ? [left] : []), ...(right ? [right] : [])]);
  game = updatePlayer(game, 'p1', (player) => {
    let memberSlots = player.memberSlots;
    if (left) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, left.instanceId);
    }
    memberSlots = placeCardInSlot(
      memberSlots,
      options.nicoSlot ?? SlotPosition.CENTER,
      nico.instanceId
    );
    if (right) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, right.instanceId);
    }
    return { ...player, memberSlots };
  });

  return {
    game,
    sourceId: nico.instanceId,
    leftId: left?.instanceId ?? '',
    rightId: right?.instanceId ?? '',
  };
}

function hasBp6009ScoreModifier(
  game: ReturnType<typeof createGameState>,
  sourceId: string
): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.sourceCardId === sourceId &&
      modifier.abilityId === BP6_009_CONTINUOUS_ABILITY_ID
  );
}

function setupBp4005ContinuousGame(sourceSlot: SlotPosition | null) {
  const rin = createCardInstance(
    createMuseMemberData('PL!-bp4-005-R＋', '星空 凛', 1),
    'p1',
    'bp4-005-rin'
  );
  let game = createGameState('bp4-005-continuous', 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, [rin]);
  if (sourceSlot !== null) {
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, sourceSlot, rin.instanceId),
    }));
  }
  return { game, sourceId: rin.instanceId };
}

function hasBp4005ScoreModifier(
  game: ReturnType<typeof createGameState>,
  sourceId: string
): boolean {
  return collectLiveModifiers(game).some(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.sourceCardId === sourceId &&
      modifier.abilityId === BP4_005_CONTINUOUS_ABILITY_ID
  );
}

function createAqoursLiveData(cardCode: string, name: string, score = 1) {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    groupNames: ['Aqours'],
  };
}

function createHasunosoraMemberData(
  cardCode: string,
  name: string,
  cost: number,
  options: {
    readonly groupNames?: readonly string[];
    readonly cardText?: string;
  } = {}
) {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
    groupNames: options.groupNames ?? ['莲之空'],
    cardText: options.cardText,
  };
}

function createLlBp1001MemberData() {
  return {
    cardCode: 'LL-bp1-001-R＋',
    name: '上原歩夢&澁谷かのん&日野下花帆',
    cardType: CardType.MEMBER,
    cost: 20,
    blade: 5,
    hearts: [
      createHeartIcon(HeartColor.PINK, 3),
      createHeartIcon(HeartColor.GREEN, 3),
      createHeartIcon(HeartColor.PURPLE, 3),
    ],
    groupNames: [
      'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
      'ラブライブ！スーパースター!!',
      '蓮ノ空女学院スクールアイドルクラブ',
    ],
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
  function setupMiaEnergyBelowScenario(
    options: {
      readonly energyBelowCount?: number;
      readonly sourcePlacement?: 'STAGE' | 'MEMBER_BELOW' | 'OFF_STAGE';
      readonly addEnergyBelowOtherSlot?: boolean;
      readonly sourceOwner?: 'p1' | 'p2';
    } = {}
  ) {
    const sourceOwner = options.sourceOwner ?? 'p1';
    const mia = createCardInstance(
      {
        cardCode: 'PL!N-pb1-011-R',
        name: 'ミア・テイラー',
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 5,
        hearts: [createHeartIcon(HeartColor.BLUE, 2)],
        groupNames: ['虹ヶ咲'],
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
          modifier.kind === 'BLADE' && modifier.abilityId === PL_N_PB1_011_CONTINUOUS_ABILITY_ID
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
            modifier.kind === 'BLADE' && modifier.abilityId === PL_N_PB1_011_CONTINUOUS_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  function createSpBp2010Margarete(instanceId: string, ownerId = 'p1') {
    return createCardInstance(
      {
        cardCode: 'PL!SP-bp2-010-R＋',
        name: 'ウィーン・マルガレーテ',
        groupNames: ['Liella!'],
        cardType: CardType.MEMBER,
        cost: 15,
        blade: 7,
        hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      },
      ownerId,
      instanceId
    );
  }

  function createRequirementLive(instanceId: string, ownerId: string) {
    return createCardInstance(
      {
        cardCode: `LIVE-${instanceId}`,
        name: `Live ${instanceId}`,
        cardType: CardType.LIVE,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 2 }),
      },
      ownerId,
      instanceId
    );
  }

  function createSbp5RequirementSource(
    cardCode: 'PL!S-bp5-010-N' | 'PL!S-bp5-011-N',
    instanceId: string,
    heartColor: HeartColor,
    heartCount: number,
    ownerId = 'p1'
  ) {
    return createCardInstance(
      {
        cardCode,
        name: cardCode === 'PL!S-bp5-010-N' ? '高海千歌' : '桜内梨子',
        groupNames: ['Aqours'],
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(heartColor, heartCount)],
      },
      ownerId,
      instanceId
    );
  }

  function setupSbp5RequirementScenario(options: {
    readonly sourceCardCode: 'PL!S-bp5-010-N' | 'PL!S-bp5-011-N';
    readonly sourceHeartColor: HeartColor;
    readonly sourceHeartCount: number;
    readonly sourcePlacement?: 'STAGE' | 'WAITING_ROOM' | 'MEMBER_BELOW';
    readonly secondSource?: boolean;
    readonly includeOwnLive?: boolean;
    readonly opponentLiveCount?: 1 | 2;
  }) {
    const source = createSbp5RequirementSource(
      options.sourceCardCode,
      's-bp5-requirement-source',
      options.sourceHeartColor,
      options.sourceHeartCount
    );
    const secondSource = options.secondSource
      ? createSbp5RequirementSource(
          options.sourceCardCode,
          's-bp5-requirement-second-source',
          options.sourceHeartColor,
          options.sourceHeartCount
        )
      : null;
    const host = createStageMember('HOST-MEMBER', 'p1', 's-bp5-member-below-host', 0);
    const ownLive = createRequirementLive('own-live', 'p1');
    const opponentLive = createRequirementLive('opponent-live', 'p2');
    const secondOpponentLive = createRequirementLive('second-opponent-live', 'p2');
    let game = createGameState('s-bp5-requirement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [
      source,
      ...(secondSource ? [secondSource] : []),
      host,
      ownLive,
      opponentLive,
      secondOpponentLive,
    ]);
    game = updatePlayer(game, 'p1', (player) => {
      let memberSlots = player.memberSlots;
      let waitingRoom = player.waitingRoom;
      if (options.sourcePlacement === 'WAITING_ROOM') {
        waitingRoom = addCardToZone(waitingRoom, source.instanceId);
      } else if (options.sourcePlacement === 'MEMBER_BELOW') {
        memberSlots = addMemberBelowMember(
          placeCardInSlot(memberSlots, SlotPosition.CENTER, host.instanceId),
          SlotPosition.CENTER,
          source.instanceId
        );
      } else {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId);
      }
      if (secondSource) {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, secondSource.instanceId);
      }
      return {
        ...player,
        memberSlots,
        waitingRoom,
        liveZone:
          options.includeOwnLive === true
            ? addCardToStatefulZone(player.liveZone, ownLive.instanceId)
            : player.liveZone,
      };
    });
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      liveZone:
        options.opponentLiveCount === 2
          ? addCardToStatefulZone(
              addCardToStatefulZone(player.liveZone, opponentLive.instanceId),
              secondOpponentLive.instanceId
            )
          : addCardToStatefulZone(player.liveZone, opponentLive.instanceId),
    }));
    return { game, source, secondSource, ownLive, opponentLive, secondOpponentLive };
  }

  it('adds necessary 無 Heart +1 to one opponent LIVE when PL!S-bp5-010 sees five red Hearts', () => {
    const { game, source, opponentLive } = setupSbp5RequirementScenario({
      sourceCardCode: 'PL!S-bp5-010-N',
      sourceHeartColor: HeartColor.RED,
      sourceHeartCount: 5,
    });
    const modifiers = collectLiveModifiers(game);

    expect(modifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: opponentLive.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: 1 }],
      sourceCardId: source.instanceId,
      abilityId: S_BP5_010_CONTINUOUS_REQUIREMENT_ABILITY_ID,
    });
    expect(
      applyHeartRequirementModifiers(
        opponentLive.data.requirements,
        getLiveCardRequirementModifiers(game.liveResolution, opponentLive.instanceId, modifiers)
      ).totalRequired
    ).toBe(3);
  });

  it('adds necessary 無 Heart +1 to one opponent LIVE when PL!S-bp5-011 sees five blue Hearts', () => {
    const { game, source, opponentLive } = setupSbp5RequirementScenario({
      sourceCardCode: 'PL!S-bp5-011-N',
      sourceHeartColor: HeartColor.BLUE,
      sourceHeartCount: 5,
    });

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: opponentLive.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: 1 }],
      sourceCardId: source.instanceId,
      abilityId: S_BP5_011_CONTINUOUS_REQUIREMENT_ABILITY_ID,
    });
  });

  it('does not add PL!S-bp5-010 requirement when the matching Heart total is below five', () => {
    const { game } = setupSbp5RequirementScenario({
      sourceCardCode: 'PL!S-bp5-010-N',
      sourceHeartColor: HeartColor.RED,
      sourceHeartCount: 4,
    });

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId === S_BP5_010_CONTINUOUS_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not add PL!S-bp5-010 requirement when the source is off stage or memberBelow', () => {
    for (const scenario of [
      setupSbp5RequirementScenario({
        sourceCardCode: 'PL!S-bp5-010-N',
        sourceHeartColor: HeartColor.RED,
        sourceHeartCount: 5,
        sourcePlacement: 'WAITING_ROOM',
      }),
      setupSbp5RequirementScenario({
        sourceCardCode: 'PL!S-bp5-010-N',
        sourceHeartColor: HeartColor.RED,
        sourceHeartCount: 5,
        sourcePlacement: 'MEMBER_BELOW',
      }),
    ]) {
      expect(
        collectLiveModifiers(scenario.game).some(
          (modifier) =>
            modifier.kind === 'REQUIREMENT' &&
            modifier.abilityId === S_BP5_010_CONTINUOUS_REQUIREMENT_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('does not count memberBelow Hearts toward the PL!S-bp5-010 threshold', () => {
    const source = createSbp5RequirementSource('PL!S-bp5-010-N', 'source', HeartColor.RED, 1);
    const host = createStageMember('HOST-MEMBER', 'p1', 'host', 0);
    const below = createSbp5RequirementSource('PL!S-bp5-010-N', 'below', HeartColor.RED, 4);
    const opponentLive = createRequirementLive('opponent-live', 'p2');
    let game = createGameState('s-bp5-member-below-hearts', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, host, below, opponentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
          SlotPosition.LEFT,
          host.instanceId
        ),
        SlotPosition.LEFT,
        below.instanceId
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, opponentLive.instanceId),
    }));

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId === S_BP5_010_CONTINUOUS_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not affect own live zone for PL!S-bp5-010', () => {
    const { game, ownLive } = setupSbp5RequirementScenario({
      sourceCardCode: 'PL!S-bp5-010-N',
      sourceHeartColor: HeartColor.RED,
      sourceHeartCount: 5,
      includeOwnLive: true,
    });

    expect(
      collectLiveModifiers(game).filter(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.liveCardId === ownLive.instanceId &&
          modifier.abilityId === S_BP5_010_CONTINUOUS_REQUIREMENT_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('stacks multiple legal PL!S-bp5-010 sources on the same opponent LIVE', () => {
    const { game, opponentLive } = setupSbp5RequirementScenario({
      sourceCardCode: 'PL!S-bp5-010-N',
      sourceHeartColor: HeartColor.RED,
      sourceHeartCount: 5,
      secondSource: true,
    });

    const modifiers = collectLiveModifiers(game).filter(
      (modifier) =>
        modifier.kind === 'REQUIREMENT' &&
        modifier.liveCardId === opponentLive.instanceId &&
        modifier.abilityId === S_BP5_010_CONTINUOUS_REQUIREMENT_ABILITY_ID
    );

    expect(modifiers).toHaveLength(2);
  });

  it('uses existing liveResolution.liveModifiers for PL!S-bp5-010 effective Hearts without recursive collection', () => {
    const { game, source, opponentLive } = setupSbp5RequirementScenario({
      sourceCardCode: 'PL!S-bp5-010-N',
      sourceHeartColor: HeartColor.RED,
      sourceHeartCount: 4,
    });
    const stateWithExistingHeart = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.RED, 1)],
      sourceCardId: source.instanceId,
      abilityId: 'test-existing-red-heart',
    });

    expect(collectLiveModifiers(stateWithExistingHeart)).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: opponentLive.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: 1 }],
      sourceCardId: source.instanceId,
      abilityId: S_BP5_010_CONTINUOUS_REQUIREMENT_ABILITY_ID,
    });
  });

  it('targets only one opponent LIVE card for PL!S-bp5-010 even when multiple opponent LIVE cards exist', () => {
    const { game } = setupSbp5RequirementScenario({
      sourceCardCode: 'PL!S-bp5-010-N',
      sourceHeartColor: HeartColor.RED,
      sourceHeartCount: 5,
      opponentLiveCount: 2,
    });

    const modifiers = collectLiveModifiers(game).filter(
      (modifier) =>
        modifier.kind === 'REQUIREMENT' &&
        modifier.abilityId === S_BP5_010_CONTINUOUS_REQUIREMENT_ABILITY_ID
    );

    expect(modifiers).toHaveLength(1);
  });

  function setupSpBp2010RequirementScenario(options: {
    readonly sourceOnStage: boolean;
    readonly includeOwnLive?: boolean;
    readonly includeOpponentLive?: boolean;
  }) {
    const source = createSpBp2010Margarete('sp-bp2-010-source');
    const ownLive = createRequirementLive('own-live', 'p1');
    const opponentLive = createRequirementLive('opponent-live', 'p2');
    let game = createGameState('sp-bp2-010-requirement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [source, ownLive, opponentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: options.sourceOnStage
        ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId)
        : player.memberSlots,
      waitingRoom: options.sourceOnStage
        ? player.waitingRoom
        : addCardToZone(player.waitingRoom, source.instanceId),
      liveZone:
        options.includeOwnLive === false
          ? player.liveZone
          : addCardToStatefulZone(player.liveZone, ownLive.instanceId),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      liveZone:
        options.includeOpponentLive === false
          ? player.liveZone
          : addCardToStatefulZone(player.liveZone, opponentLive.instanceId),
    }));
    return { game, source, ownLive, opponentLive };
  }

  it('collects PL!SP-bp2-010 continuous requirement +1 for every opponent live card', () => {
    const { game, source, opponentLive } = setupSpBp2010RequirementScenario({
      sourceOnStage: true,
    });

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: opponentLive.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: 1 }],
      sourceCardId: source.instanceId,
      abilityId: SP_BP2_010_CONTINUOUS_REQUIREMENT_ABILITY_ID,
    });
  });

  it('does not affect own live zone requirement', () => {
    const { game, ownLive } = setupSpBp2010RequirementScenario({ sourceOnStage: true });

    const ownModifiers = collectLiveModifiers(game).filter(
      (modifier) =>
        modifier.kind === 'REQUIREMENT' &&
        modifier.liveCardId === ownLive.instanceId &&
        modifier.abilityId === SP_BP2_010_CONTINUOUS_REQUIREMENT_ABILITY_ID
    );

    expect(ownModifiers).toEqual([]);
  });

  it('does not collect PL!SP-bp2-010 requirement modifier when the source leaves stage', () => {
    const { game } = setupSpBp2010RequirementScenario({ sourceOnStage: false });

    expect(
      collectLiveModifiers(game).some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId === SP_BP2_010_CONTINUOUS_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });

  it('stacks with existing requirement modifiers through applyHeartRequirementModifiers', () => {
    const { game, opponentLive } = setupSpBp2010RequirementScenario({ sourceOnStage: true });
    const stateWithExistingModifier = addLiveModifier(game, {
      kind: 'REQUIREMENT',
      liveCardId: opponentLive.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
      sourceCardId: 'existing-source',
      abilityId: 'existing-requirement-minus-one',
    });
    const modifiers = collectLiveModifiers(stateWithExistingModifier);
    const requirementModifiers = getLiveCardRequirementModifiers(
      stateWithExistingModifier.liveResolution,
      opponentLive.instanceId,
      modifiers
    );

    expect(requirementModifiers).toEqual(
      expect.arrayContaining([
        { color: HeartColor.RAINBOW, countDelta: -1 },
        { color: HeartColor.RAINBOW, countDelta: 1 },
      ])
    );
    expect(
      applyHeartRequirementModifiers(opponentLive.data.requirements, requirementModifiers)
        .totalRequired
    ).toBe(2);
  });

  it('keeps player SCORE granted to a target member separate from its source and removes every binding by target', () => {
    const source = createCardInstance({ cardCode: 'source', name: 'source', cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [] }, 'p1', 'source');
    const target = createCardInstance({ cardCode: 'target', name: 'target', cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [] }, 'p1', 'target');
    const otherTarget = createCardInstance({ cardCode: 'other-target', name: 'other-target', cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [] }, 'p1', 'other-target');
    let game = registerCards(createGameState('target-score', 'p1', 'P1', 'p2', 'P2'), [source, target, otherTarget]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }),
        SlotPosition.RIGHT,
        otherTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    const first = addPlayerScoreLiveModifierForTargetMember(game, { playerId: 'p1', targetMemberCardId: target.instanceId, sourceCardId: source.instanceId, abilityId: 'one', countDelta: 1 });
    const second = addPlayerScoreLiveModifierForTargetMember(first!.gameState, { playerId: 'p1', targetMemberCardId: target.instanceId, sourceCardId: 'other-source', abilityId: 'two', countDelta: 1 });
    const third = addPlayerScoreLiveModifierForTargetMember(second!.gameState, { playerId: 'p1', targetMemberCardId: otherTarget.instanceId, sourceCardId: 'third-source', abilityId: 'three', countDelta: 1 });
    expect(third!.gameState.liveResolution.playerScoreBonuses.get('p1')).toBe(3);
    const afterTargetLeaves = removeTargetMemberBoundLiveModifiers(third!.gameState, [target.instanceId]);
    expect(afterTargetLeaves.liveResolution.liveModifiers).toEqual([
      expect.objectContaining({ targetMemberCardId: otherTarget.instanceId, abilityId: 'three' }),
    ]);
    expect(afterTargetLeaves.liveResolution.playerScoreBonuses.get('p1')).toBe(1);
    const afterOtherTargetLeaves = removeTargetMemberBoundLiveModifiers(afterTargetLeaves, [otherTarget.instanceId]);
    expect(afterOtherTargetLeaves.liveResolution.liveModifiers).toEqual([]);
    expect(afterOtherTargetLeaves.liveResolution.playerScoreBonuses.has('p1')).toBe(false);
  });
});
