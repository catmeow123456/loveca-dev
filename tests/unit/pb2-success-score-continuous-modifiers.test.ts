import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
  getPlayerLiveHeartModifiers,
} from '../../src/domain/rules/live-modifiers';
import { CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';

const PB2_020_ABILITY_ID = 'PL!-pb2-020:continuous-success-score-nine-pink-yellow-heart';
const PB2_030_ABILITY_ID = 'PL!-pb2-030:continuous-success-score-per-five-gain-blade';

function createSourceMember(cardCode: string, instanceId: string) {
  return createCardInstance(
    {
      cardCode,
      name: cardCode.includes('-020-') ? '绚濑绘里' : '南琴梨（南小鸟）',
      cardType: CardType.MEMBER,
      cost: cardCode.includes('-020-') ? 15 : 5,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    },
    'p1',
    instanceId
  );
}

function createSuccessLive(score: number, instanceId: string) {
  return createCardInstance(
    {
      cardCode: `TEST-LIVE-${score}-${instanceId}`,
      name: `Score ${score}`,
      cardType: CardType.LIVE,
      score,
      requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
    },
    'p1',
    instanceId
  );
}

function setupScoreGame(cardCode: string, scores: readonly number[]) {
  const source = createSourceMember(cardCode, 'source');
  const liveCards = scores.map((score, index) => createSuccessLive(score, `live-${index}`));
  let game = registerCards(
    createGameState(`score-${cardCode}-${scores.join('-')}`, 'p1', 'P1', 'p2', 'P2'),
    [source, ...liveCards]
  );
  game = updatePlayer(game, 'p1', (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
    successZone: liveCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  return { game, source, liveCards };
}

describe('PL!-pb2-020 continuous successful-LIVE score Heart modifier', () => {
  it.each([
    [8, false],
    [9, true],
  ] as const)('uses the exact score-nine boundary at %s', (score, expectedActive) => {
    const { game, source } = setupScoreGame('PL!-pb2-020-UNSEEN', [score]);
    const modifiers = collectLiveModifiers(game);
    const modifier = modifiers.find(
      (candidate) => candidate.kind === 'HEART' && candidate.abilityId === PB2_020_ABILITY_ID
    );

    if (!expectedActive) {
      expect(modifier).toBeUndefined();
      expect(getMemberEffectiveHeartIcons(game, 'p1', source.instanceId, modifiers)).toEqual([
        createHeartIcon(HeartColor.BLUE, 1),
      ]);
      return;
    }

    expect(modifier).toEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: 'p1',
      hearts: [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: source.instanceId,
      abilityId: PB2_020_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(game, 'p1', source.instanceId, modifiers)).toEqual([
      createHeartIcon(HeartColor.BLUE, 1),
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.YELLOW, 1),
    ]);
    expect(getPlayerLiveHeartModifiers(game.liveResolution, 'p1', modifiers)).toEqual([]);
  });

  it('sums multiple successful LIVE cards to reach the score-nine threshold', () => {
    const { game } = setupScoreGame('PL!-pb2-020-N', [4, 5]);

    expect(collectLiveModifiers(game)).toContainEqual(
      expect.objectContaining({
        kind: 'HEART',
        abilityId: PB2_020_ABILITY_ID,
        hearts: [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.YELLOW, 1)],
      })
    );
  });

  it('dynamically disappears below threshold, recovers at threshold, and requires a stage source', () => {
    const { game, source, liveCards } = setupScoreGame('PL!-pb2-020-N', [9]);
    const withoutScore = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [] },
    }));
    expect(
      collectLiveModifiers(withoutScore).some(
        (modifier) => modifier.kind === 'HEART' && modifier.abilityId === PB2_020_ABILITY_ID
      )
    ).toBe(false);

    const restored = updatePlayer(withoutScore, 'p1', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, liveCards[0]!.instanceId),
    }));
    expect(
      collectLiveModifiers(restored).some(
        (modifier) => modifier.kind === 'HEART' && modifier.abilityId === PB2_020_ABILITY_ID
      )
    ).toBe(true);

    const sourceLeftStage = updatePlayer(restored, 'p1', (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(
      collectLiveModifiers(sourceLeftStage).some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.sourceCardId === source.instanceId &&
          modifier.abilityId === PB2_020_ABILITY_ID
      )
    ).toBe(false);
  });
});

describe('PL!-pb2-030 continuous successful-LIVE score BLADE modifier', () => {
  it.each([
    [0, 0],
    [4, 0],
    [5, 1],
    [9, 1],
    [10, 2],
  ] as const)('grants floor(%s / 5) = %s BLADE', (score, expectedBlade) => {
    const { game, source } = setupScoreGame('PL!-pb2-030-UNSEEN', score === 0 ? [] : [score]);
    const modifiers = collectLiveModifiers(game);
    const modifier = modifiers.find(
      (candidate) => candidate.kind === 'BLADE' && candidate.abilityId === PB2_030_ABILITY_ID
    );

    if (expectedBlade === 0) {
      expect(modifier).toBeUndefined();
    } else {
      expect(modifier).toEqual({
        kind: 'BLADE',
        target: 'SOURCE_MEMBER',
        playerId: 'p1',
        countDelta: expectedBlade,
        sourceCardId: source.instanceId,
        abilityId: PB2_030_ABILITY_ID,
      });
    }
    expect(getMemberEffectiveBladeCount(game, 'p1', source.instanceId, modifiers)).toBe(
      1 + expectedBlade
    );
  });

  it('sums multiple successful LIVE cards before applying each-five BLADE', () => {
    const { game, source } = setupScoreGame('PL!-pb2-030-N', [2, 3]);

    expect(getMemberEffectiveBladeCount(game, 'p1', source.instanceId)).toBe(2);
  });

  it('ignores non-LIVE cards in the success zone', () => {
    const { game, source } = setupScoreGame('PL!-pb2-030-N', [4]);
    const nonLive = createCardInstance(
      {
        cardCode: 'TEST-NON-LIVE',
        name: 'Not a LIVE card',
        cardType: CardType.MEMBER,
        cost: 99,
        blade: 0,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      },
      'p1',
      'non-live'
    );
    let withNonLive = registerCards(game, [nonLive]);
    withNonLive = updatePlayer(withNonLive, 'p1', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, nonLive.instanceId),
    }));

    expect(
      collectLiveModifiers(withNonLive).some(
        (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === PB2_030_ABILITY_ID
      )
    ).toBe(false);
    expect(getMemberEffectiveBladeCount(withNonLive, 'p1', source.instanceId)).toBe(1);
  });

  it('dynamically recomputes and stops applying after the source leaves the stage', () => {
    const { game, source, liveCards } = setupScoreGame('PL!-pb2-030-N', [10]);
    expect(getMemberEffectiveBladeCount(game, 'p1', source.instanceId)).toBe(3);

    const withoutScore = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [] },
    }));
    expect(getMemberEffectiveBladeCount(withoutScore, 'p1', source.instanceId)).toBe(1);

    const restored = updatePlayer(withoutScore, 'p1', (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, liveCards[0]!.instanceId),
    }));
    expect(getMemberEffectiveBladeCount(restored, 'p1', source.instanceId)).toBe(3);

    const sourceLeftStage = updatePlayer(restored, 'p1', (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(
      collectLiveModifiers(sourceLeftStage).some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === source.instanceId &&
          modifier.abilityId === PB2_030_ABILITY_ID
      )
    ).toBe(false);
  });
});
