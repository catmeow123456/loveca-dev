import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards } from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  evaluateCurrentLiveRevealedCheerCardCondition,
  selectCurrentLiveRevealedCheerCardIds,
} from '../../src/application/effects/cheer-selection';
import { CardType, HeartColor } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(cardCode: string, groupNames: readonly string[]): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function member(cardCode: string, unitName: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

describe('current live revealed cheer selection', () => {
  it('filters current cheer cards by type, group, unit, and count after they leave resolutionZone', () => {
    const aqoursLive = createCardInstance(live('PL!S-test-live', ['Aqours']), PLAYER1, 'aqours-live');
    const liellaLive = createCardInstance(live('PL!SP-test-live', ['Liella!']), PLAYER1, 'liella-live');
    const kaleidoscoreMember = createCardInstance(
      member('PL!SP-test-kaleidoscore-member', 'KALEIDOSCORE'),
      PLAYER1,
      'kaleidoscore-member'
    );
    const hiddenKaleidoscoreMember = createCardInstance(
      member('PL!SP-test-hidden-kaleidoscore-member', 'KALEIDOSCORE'),
      PLAYER1,
      'hidden-kaleidoscore-member'
    );

    let game = registerCards(
      createGameState('cheer-selection-current-live', PLAYER1, 'P1', PLAYER2, 'P2'),
      [aqoursLive, liellaLive, kaleidoscoreMember, hiddenKaleidoscoreMember]
    );
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [
          aqoursLive.instanceId,
          liellaLive.instanceId,
          kaleidoscoreMember.instanceId,
          hiddenKaleidoscoreMember.instanceId,
        ],
      },
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: [],
        revealedCardIds: [],
      },
    };
    game = emitGameEvent(
      game,
      createCheerEvent(
        PLAYER1,
        [aqoursLive.instanceId, liellaLive.instanceId, kaleidoscoreMember.instanceId],
        3,
        { automated: true }
      )
    );

    expect(
      selectCurrentLiveRevealedCheerCardIds(game, PLAYER1, {
        cardTypes: CardType.LIVE,
        groupAliases: ['Aqours'],
      })
    ).toEqual([aqoursLive.instanceId]);

    expect(
      evaluateCurrentLiveRevealedCheerCardCondition(game, PLAYER1, {
        cardTypes: CardType.MEMBER,
        unitAliases: ['KALEIDOSCORE'],
        minCount: 1,
      })
    ).toEqual({
      matchingCardIds: [kaleidoscoreMember.instanceId],
      matchingCount: 1,
      conditionMet: true,
    });
  });
});
