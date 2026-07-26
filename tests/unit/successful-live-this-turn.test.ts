import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards } from '../../src/domain/entities/game';
import {
  getSuccessfulLiveCardIdsForPlayerThisTurn,
  hasPlayerSuccessfulLiveThisTurn,
} from '../../src/domain/rules/success-live-placement';
import { CardType, HeartColor } from '../../src/shared/types/enums';

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

describe('successful LIVE facts for the current turn', () => {
  it('returns only successful LIVE cards owned by the requested player', () => {
    const p1Live = createCardInstance(live('P1-LIVE'), 'p1', 'p1-live');
    const p2Live = createCardInstance(live('P2-LIVE'), 'p2', 'p2-live');
    const failed = createCardInstance(live('FAILED'), 'p2', 'failed');
    const nonLive = createCardInstance(member('MEMBER'), 'p2', 'member');
    let game = registerCards(createGameState('successful-live-query', 'p1', 'P1', 'p2', 'P2'), [
      p1Live,
      p2Live,
      failed,
      nonLive,
    ]);
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map([
          [p1Live.instanceId, true],
          [p2Live.instanceId, true],
          [failed.instanceId, false],
          [nonLive.instanceId, true],
          ['missing', true],
        ]),
      },
    };

    expect(getSuccessfulLiveCardIdsForPlayerThisTurn(game, 'p2')).toEqual([p2Live.instanceId]);
    expect(hasPlayerSuccessfulLiveThisTurn(game, 'p2')).toBe(true);
  });

  it('returns false when the player has no successful LIVE fact', () => {
    const failed = createCardInstance(live('FAILED'), 'p2', 'failed');
    let game = registerCards(createGameState('no-successful-live', 'p1', 'P1', 'p2', 'P2'), [
      failed,
    ]);
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map([[failed.instanceId, false]]),
      },
    };

    expect(getSuccessfulLiveCardIdsForPlayerThisTurn(game, 'p2')).toEqual([]);
    expect(hasPlayerSuccessfulLiveThisTurn(game, 'p2')).toBe(false);
  });
});
