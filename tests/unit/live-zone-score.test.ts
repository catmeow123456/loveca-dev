import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  getLiveZoneCardEffectiveScores,
  sumLiveZoneCardEffectiveScore,
} from '../../src/domain/rules/live-zone-score';
import { CardType, FaceState, HeartColor, OrientationState } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function liveData(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['TEST'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
  };
}

function memberData(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['TEST'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setup(): {
  readonly game: GameState;
  readonly scoreFourId: string;
  readonly scoreThreeId: string;
  readonly memberId: string;
  readonly opponentLiveId: string;
} {
  const scoreFour = createCardInstance(liveData('LIVE-4', 4), P1, 'live-4');
  const scoreThree = createCardInstance(liveData('LIVE-3', 3), P1, 'live-3');
  const member = createCardInstance(memberData('MEMBER'), P1, 'member');
  const opponentLive = createCardInstance(liveData('OPPONENT-LIVE', 9), P2, 'opponent-live');
  let game = registerCards(createGameState('live-zone-score', P1, 'P1', P2, 'P2'), [
    scoreFour,
    scoreThree,
    member,
    opponentLive,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: [
      scoreFour.instanceId,
      scoreThree.instanceId,
      scoreFour.instanceId,
      member.instanceId,
      opponentLive.instanceId,
    ].reduce(
      (zone, cardId) =>
        addCardToStatefulZone(zone, cardId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.liveZone
    ),
  }));
  return {
    game,
    scoreFourId: scoreFour.instanceId,
    scoreThreeId: scoreThree.instanceId,
    memberId: member.instanceId,
    opponentLiveId: opponentLive.instanceId,
  };
}

describe('LIVE zone effective score query', () => {
  it('counts each legal owned LIVE card once and excludes invalid zone contents', () => {
    const scenario = setup();

    expect(getLiveZoneCardEffectiveScores(scenario.game, P1)).toEqual([
      {
        cardId: scenario.scoreFourId,
        printedScore: 4,
        scoreModifier: 0,
        effectiveScore: 4,
      },
      {
        cardId: scenario.scoreThreeId,
        printedScore: 3,
        scoreModifier: 0,
        effectiveScore: 3,
      },
    ]);
    expect(sumLiveZoneCardEffectiveScore(scenario.game, P1)).toBe(7);
    expect(sumLiveZoneCardEffectiveScore(scenario.game, 'missing')).toBe(0);
  });

  it('includes only live-card-bound SCORE modifiers and ignores player totals and score drafts', () => {
    const scenario = setup();
    let game = addLiveModifier(scenario.game, {
      kind: 'SCORE',
      playerId: P1,
      countDelta: 1,
      liveCardId: scenario.scoreThreeId,
      sourceCardId: 'live-score-source',
      abilityId: 'live-score',
    });
    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: P1,
      countDelta: 5,
      sourceCardId: 'player-score-source',
      abilityId: 'player-score',
    });
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[P1, 99]]),
      },
    };

    expect(sumLiveZoneCardEffectiveScore(game, P1)).toBe(8);
    expect(getLiveZoneCardEffectiveScores(game, P1)).toContainEqual({
      cardId: scenario.scoreThreeId,
      printedScore: 3,
      scoreModifier: 1,
      effectiveScore: 4,
    });
  });

  it('clamps each card at zero before summing', () => {
    const scenario = setup();
    const game = addLiveModifier(scenario.game, {
      kind: 'SCORE',
      playerId: P1,
      countDelta: -9,
      liveCardId: scenario.scoreFourId,
      sourceCardId: 'negative-score-source',
      abilityId: 'negative-score',
    });

    expect(getLiveZoneCardEffectiveScores(game, P1)[0]).toMatchObject({
      printedScore: 4,
      scoreModifier: -9,
      effectiveScore: 0,
    });
    expect(sumLiveZoneCardEffectiveScore(game, P1)).toBe(3);
  });
});
