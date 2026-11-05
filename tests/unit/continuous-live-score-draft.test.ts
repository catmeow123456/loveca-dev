import { describe, expect, it } from 'vitest';
import { playMemberBelowCardToEmptySlot } from '../../src/application/effects/member-state';
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
  type LiveResolutionState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  refreshJudgedContinuousLiveScoreDrafts,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';

function createStageMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    groupNames: ['μ’s'],
    cost: 1,
    blade: 1,
    hearts: [],
  };
}

function setup(stageCount: 1 | 2): GameState {
  const song: LiveCardData = {
    cardCode: 'PL!-pb2-038-L',
    name: '正因为是暴风雨中的爱恋',
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({}),
  };
  let game = registerCards(createGameState('continuous-draft', 'p1', 'P1', 'p2', 'P2'), [
    createCardInstance(createStageMember('host'), 'p1', 'host'),
    createCardInstance(createStageMember('other-member'), 'p1', 'other-member'),
    createCardInstance(createStageMember('below'), 'p1', 'below'),
    createCardInstance(song, 'p1', 'live-source'),
    createCardInstance(song, 'p1', 'success-source'),
    createCardInstance(
      { ...song, cardCode: 'judged-live', name: 'judged-live' },
      'p1',
      'judged-live'
    ),
  ]);
  game = updatePlayer(game, 'p1', (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'host');
    if (stageCount === 2) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, 'other-member');
    }
    return {
      ...player,
      memberSlots: addMemberBelowMember(memberSlots, SlotPosition.CENTER, 'below'),
      liveZone: addCardToStatefulZone(player.liveZone, 'live-source'),
      successZone: addCardToZone(player.successZone, 'success-source'),
      // The successful LIVE still counts after an earlier effect returned it to hand.
      hand: addCardToZone(player.hand, 'judged-live'),
    };
  });
  game = addLiveModifier(game, { kind: 'SCORE', playerId: 'p1', countDelta: 3 });
  game = addLiveModifier(game, {
    kind: 'SCORE',
    playerId: 'p1',
    liveCardId: 'judged-live',
    countDelta: 2,
  });
  return {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    liveResolution: {
      ...game.liveResolution,
      isInLive: false,
      liveResults: new Map([['judged-live', true]]),
      // The draft already includes the resolved rewards and a manual adjustment.
      playerScores: new Map([
        ['p1', 14],
        ['p2', 0],
      ]),
      playerRemainingHearts: new Map([['p1', [createHeartIcon(HeartColor.PINK, 1)]]]),
      playerLiveJudgmentHearts: new Map([['p1', [createHeartIcon(HeartColor.PINK, 2)]]]),
    },
  };
}

function playFromBelow(game: GameState): GameState {
  const result = playMemberBelowCardToEmptySlot(game, 'p1', {
    hostCardId: 'host',
    fromSlot: SlotPosition.CENTER,
    cardId: 'below',
    toSlot: SlotPosition.RIGHT,
  });
  expect(result).not.toBeNull();
  return result!.gameState;
}

describe('continuous LIVE score draft after playing a member from below', () => {
  it.each<[1 | 2, number]>([
    [1, 15],
    [2, 13],
  ])('applies the non-stacking SCORE delta with %i starting members', (stageCount, score) => {
    const game = setup(stageCount);
    const after = playFromBelow(game);

    expect(after.liveResolution.playerScores.get('p1')).toBe(score);
    expect(after.liveResolution.playerScores.get('p2')).toBe(0);
    expect(game.liveResolution.playerScores.get('p1')).toBe(14);
    expect(after.liveResolution.liveModifiers).toBe(game.liveResolution.liveModifiers);
    expect(after.liveResolution.playerRemainingHearts).toBe(
      game.liveResolution.playerRemainingHearts
    );
    expect(after.liveResolution.playerLiveJudgmentHearts).toBe(
      game.liveResolution.playerLiveJudgmentHearts
    );
  });

  it.each<[string, Partial<GameState>, Partial<LiveResolutionState>]>([
    ['no score draft', {}, { playerScores: new Map() }],
    ['failed LIVE', {}, { liveResults: new Map([['judged-live', false]]) }],
    ['no judgment yet', {}, { liveResults: new Map() }],
    ['performance phase', { currentPhase: GamePhase.PERFORMANCE_PHASE }, {}],
    [
      'confirmed score',
      { currentSubPhase: SubPhase.RESULT_SCORE_CONFIRM },
      { scoreConfirmedBy: ['p1'] },
    ],
    ['settlement phase', { currentSubPhase: SubPhase.RESULT_SETTLEMENT }, {}],
  ])('preserves player scores with %s', (_name, stateOverrides, liveOverrides) => {
    const game = setup(2);
    const before = {
      ...game,
      ...stateOverrides,
      liveResolution: { ...game.liveResolution, ...liveOverrides },
    };

    expect(playFromBelow(before).liveResolution.playerScores).toBe(
      before.liveResolution.playerScores
    );
  });

  it('ignores a change to persisted SCORE modifiers when refreshing the draft', () => {
    const before = setup(2);
    const after = addLiveModifier(before, { kind: 'SCORE', playerId: 'p1', countDelta: 2 });

    expect(refreshJudgedContinuousLiveScoreDrafts(before, after)).toBe(after);
  });
});
