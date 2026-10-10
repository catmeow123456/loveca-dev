import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  getSuccessfulLiveEffectiveScore,
  successLiveScoreAtLeast,
  successLiveScoreForCardEffectAtLeast,
  sumSuccessfulLiveScore,
  sumSuccessfulLiveScoreForCardEffect,
} from '../../src/domain/rules/success-live-score';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import { PL_BP8_013_CONTINUOUS_CARD_EFFECT_SUCCESS_LIVE_SCORE_PLUS_TWO_ABILITY_ID as UMI_ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { CardType, HeartColor, OrientationState, SlotPosition } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const UMI_TEXT =
  '【常时】因自己的卡片的效果参照存在于成功LIVE卡区的LIVE的卡的分数的合计值时，只要自己的成功LIVE卡区存在卡片，该合计值+２。';

function member(cardCode: string, id: string, owner = P1): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode,
      name: cardCode,
      cardType: CardType.MEMBER,
      cost: cardCode.startsWith('PL!-bp8-013-') ? 2 : 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      groupNames: ["μ's"],
    },
    owner,
    id
  );
}

function live(
  score: number,
  id: string,
  owner = P1,
  cardCode = `LIVE-${id}`
): CardInstance<LiveCardData> {
  return createCardInstance(
    {
      cardCode,
      name: id,
      cardType: CardType.LIVE,
      score,
      requirements: createHeartRequirement({}),
    },
    owner,
    id
  );
}

function setup(
  options: {
    ownScores?: readonly number[];
    opponentScores?: readonly number[];
    sourceCode?: string;
    umiCodes?: readonly string[];
    orientation?: OrientationState;
  } = {}
) {
  const source = member(options.sourceCode ?? 'TEST-SOURCE', 'source');
  const opponentSource = member('TEST-OPPONENT-SOURCE', 'opponent-source', P2);
  const umis = (options.umiCodes ?? ['PL!-bp8-013-N']).map((code, i) => member(code, `umi-${i}`));
  const ownLives = (options.ownScores ?? [4]).map((score, i) => live(score, `own-${i}`));
  const opponentLives = (options.opponentScores ?? []).map((score, i) =>
    live(score, `opponent-${i}`, P2)
  );
  let game = registerCards(createGameState('bp8-013', P1, 'P1', P2, 'P2'), [
    source,
    opponentSource,
    ...umis,
    ...ownLives,
    ...opponentLives,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let slots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId);
    for (const [i, umi] of umis.entries()) {
      slots = placeCardInSlot(
        slots,
        i === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT,
        umi.instanceId,
        {
          orientation: options.orientation ?? OrientationState.ACTIVE,
        }
      );
    }
    return {
      ...player,
      memberSlots: slots,
      successZone: { ...player.successZone, cardIds: ownLives.map((card) => card.instanceId) },
    };
  });
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      opponentSource.instanceId
    ),
    successZone: { ...player.successZone, cardIds: opponentLives.map((card) => card.instanceId) },
  }));
  return { game, source, opponentSource, umis, ownLives, opponentLives };
}

function effectScore(game: GameState, referenced = [P1], controller = P1, source = 'source') {
  return sumSuccessfulLiveScoreForCardEffect(game, controller, source, referenced);
}

function hasModifier(game: GameState, abilityId: string) {
  return collectLiveModifiers(game).some((modifier) => modifier.abilityId === abilityId);
}

describe('PL!-bp8-013 cost 2 Umi successful-LIVE score references', () => {
  it.each(['N', 'R', 'P', 'SEC', 'UNSEEN'])(
    'registers full Chinese text and continuous source for rarity %s',
    (rarity) => {
      const definitions = getCardAbilityDefinitionsForCardCode(`PL!-bp8-013-${rarity}`);
      expect(definitions).toEqual([
        expect.objectContaining({
          abilityId: UMI_ABILITY,
          baseCardCodes: ['PL!-bp8-013'],
          category: CardAbilityCategory.CONTINUOUS,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          queued: false,
          implemented: true,
          effectText: UMI_TEXT,
        }),
      ]);
      expect(definitions[0]?.cardCodes).toBeUndefined();
      expect(definitions[0]?.triggerCondition).toBeUndefined();
      expect(definitions[0]?.activatedUi).toBeUndefined();
    }
  );

  it('adds two to the card-effect reference and leaves real scores and resolution state intact', () => {
    const { game, ownLives } = setup();
    expect(effectScore(game)).toBe(6);
    expect(sumSuccessfulLiveScore(game, P1)).toBe(4);
    expect(getSuccessfulLiveEffectiveScore(game, P1, ownLives[0]!.instanceId)).toBe(4);
    expect(successLiveScoreAtLeast(game, P1, 6)).toBe(false);
    expect(successLiveScoreForCardEffectAtLeast(game, P1, 'source', [P1], 6)).toBe(true);
    expect(game.liveResolution.liveModifiers).toEqual([]);
    expect(game.liveResolution.playerScores.size).toBe(0);
    expect(game.pendingAbilities).toEqual([]);
    expect(game.activeEffect).toBeNull();
    expect(hasModifier(game, UMI_ABILITY)).toBe(false);
  });

  it('requires an owned card in its controller success zone, including a zero-score card', () => {
    expect(effectScore(setup({ ownScores: [] }).game)).toBe(0);
    expect(effectScore(setup({ ownScores: [0] }).game)).toBe(2);
    const { game, opponentLives } = setup({ ownScores: [], opponentScores: [8] });
    const foreignOnly = updatePlayer(game, P1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [opponentLives[0]!.instanceId, 'missing'] },
    }));
    expect(effectScore(foreignOnly)).toBe(0);
  });

  it('uses success-zone card presence independently from its total LIVE score', () => {
    const { game } = setup({ ownScores: [] });
    const successMember = member('SUCCESS-MEMBER', 'success-member');
    const withMember = updatePlayer(registerCards(game, [successMember]), P1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [successMember.instanceId] },
    }));
    expect(sumSuccessfulLiveScore(withMember, P1)).toBe(0);
    expect(effectScore(withMember)).toBe(2);
  });

  it('also modifies an own effect reference to the opponent success zone', () => {
    const { game } = setup({ ownScores: [0], opponentScores: [4] });
    expect(effectScore(game, [P2])).toBe(6);
    expect(effectScore(setup({ ownScores: [0], opponentScores: [] }).game, [P2])).toBe(2);
    const ownEmpty = updatePlayer(game, P1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [] },
    }));
    expect(effectScore(ownEmpty, [P2])).toBe(4);
  });

  it('adds the bonus only once for the combined total, even with duplicated zone IDs', () => {
    const { game } = setup({ ownScores: [3], opponentScores: [4] });
    expect(effectScore(game, [P1, P2])).toBe(9);
    expect(effectScore(game, [P1, P2, P1, 'missing-player'])).toBe(9);
    expect(effectScore(game, [])).toBe(0);
  });

  it('does not lend the controller Umi to an opposing card effect', () => {
    const { game } = setup({ ownScores: [4], opponentScores: [3] });
    expect(effectScore(game, [P1], P2, 'opponent-source')).toBe(4);
    expect(effectScore(game, [P1, P2], P2, 'opponent-source')).toBe(7);
    const enemyUmi = member('PL!-bp8-013-P', 'enemy-umi', P2);
    const bothWithUmi = updatePlayer(registerCards(game, [enemyUmi]), P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, enemyUmi.instanceId),
    }));
    expect(effectScore(bothWithUmi, [P1], P2, 'opponent-source')).toBe(6);
    expect(effectScore(bothWithUmi, [P1, P2], P2, 'opponent-source')).toBe(9);
  });

  it.each([OrientationState.ACTIVE, OrientationState.WAITING])(
    'stacks each main-stage Umi at orientation %s',
    (orientation) => {
      const { game } = setup({ umiCodes: ['PL!-bp8-013-N', 'PL!-bp8-013-UNSEEN'], orientation });
      expect(effectScore(game)).toBe(8);
    }
  );

  it('stops applying off stage and from underneath a member', () => {
    const { game, umis } = setup();
    const offStage = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      waitingRoom: { ...player.waitingRoom, cardIds: [umis[0]!.instanceId] },
    }));
    expect(effectScore(offStage)).toBe(4);
    const below = updatePlayer(offStage, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: addMemberBelowMember(
        player.memberSlots,
        SlotPosition.CENTER,
        umis[0]!.instanceId
      ),
    }));
    expect(effectScore(below)).toBe(4);
  });

  it('retains the explicit effect controller after the source leaves stage as a cost', () => {
    const { game, source } = setup();
    const paid = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: { ...player.waitingRoom, cardIds: [source.instanceId] },
    }));
    expect(effectScore(paid)).toBe(6);
    expect(effectScore(paid, [P1], P1, 'missing-source')).toBe(4);
  });

  it('combines with Angelic Angel real effective score without changing that LIVE', () => {
    const { game, ownLives } = setup({ ownScores: [4] });
    const angelic = live(4, ownLives[0]!.instanceId, P1, 'PL!-bp4-019-SRL');
    const withAngelic = registerCards(game, [angelic]);
    expect(getSuccessfulLiveEffectiveScore(withAngelic, P1, angelic.instanceId)).toBe(9);
    expect(sumSuccessfulLiveScore(withAngelic, P1)).toBe(9);
    expect(effectScore(withAngelic)).toBe(11);
  });

  it('feeds own score thresholds, per-five BLADE, and the dynamic member cost condition', () => {
    const yellow = setup({ sourceCode: 'PL!-bp5-008-P', ownScores: [4] });
    expect(hasModifier(yellow.game, 'PL!-bp5-008:continuous-success-score-yellow-heart')).toBe(
      true
    );
    const perFive = setup({ sourceCode: 'PL!-pb2-030-UNSEEN', ownScores: [3] });
    expect(collectLiveModifiers(perFive.game)).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        sourceCardId: perFive.source.instanceId,
        countDelta: 1,
        abilityId: 'PL!-pb2-030:continuous-success-score-per-five-gain-blade',
      })
    );
    const hanayo = setup({ sourceCode: 'PL!-bp4-008-N', ownScores: [4] });
    expect(getMemberEffectiveCost(hanayo.game, P1, hanayo.source.instanceId)).toBe(7);
    const withoutUmi = updatePlayer(hanayo.game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    expect(getMemberEffectiveCost(withoutUmi, P1, hanayo.source.instanceId)).toBe(4);
  });

  it('feeds opponent-only and combined continuous score thresholds with one bonus per total', () => {
    const opponent = setup({ sourceCode: 'PL!N-bp4-012-N', ownScores: [0], opponentScores: [4] });
    expect(
      hasModifier(opponent.game, 'PL!N-bp4-012:continuous-opponent-success-score-six-live-score')
    ).toBe(true);
    const total = setup({ sourceCode: 'PL!-PR-024-PR', ownScores: [3], opponentScores: [4] });
    expect(
      hasModifier(total.game, 'PR:continuous-total-success-live-score-ten-gain-pink-heart')
    ).toBe(false);
    const reachesTen = setup({ sourceCode: 'PL!-PR-024-PR', ownScores: [3], opponentScores: [5] });
    expect(
      hasModifier(reachesTen.game, 'PR:continuous-total-success-live-score-ten-gain-pink-heart')
    ).toBe(true);
  });

  it('compares both referenced totals under the same effect controller', () => {
    const tied = setup({ sourceCode: 'PL!-bp4-018-P', ownScores: [4], opponentScores: [4] });
    expect(hasModifier(tied.game, 'PL!-bp4-018:continuous-success-score-lead-gain-two-blade')).toBe(
      false
    );
    const leading = setup({ sourceCode: 'PL!-bp4-018-P', ownScores: [5], opponentScores: [4] });
    const opponentUmi = member('PL!-bp8-013-N', 'opponent-umi', P2);
    const bothWithUmi = updatePlayer(registerCards(leading.game, [opponentUmi]), P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, opponentUmi.instanceId),
    }));
    expect(
      hasModifier(bothWithUmi, 'PL!-bp4-018:continuous-success-score-lead-gain-two-blade')
    ).toBe(true);
  });
});
