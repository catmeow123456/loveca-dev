import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  evaluateCurrentLiveRevealedCheerCardCondition,
  moveRevealedCheerCards,
  selectCurrentLiveRevealedCheerCardIds,
} from '../../src/application/effects/cheer-selection';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
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

describe('revealed cheer card movement', () => {
  it('appends movable revealed cards to the bottom of the main deck and clears both resolution lists', () => {
    const deckTop = createCardInstance(live('PL!S-test-deck-top', ['Aqours']), PLAYER1, 'deck-top');
    const deckBottom = createCardInstance(
      live('PL!S-test-deck-bottom', ['Aqours']),
      PLAYER1,
      'deck-bottom'
    );
    const revealedLive = createCardInstance(
      live('PL!S-test-revealed-live', ['Aqours']),
      PLAYER1,
      'revealed-live'
    );
    let game = registerCards(
      createGameState('cheer-selection-bottom', PLAYER1, 'P1', PLAYER2, 'P2'),
      [deckTop, deckBottom, revealedLive]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckTop.instanceId, deckBottom.instanceId] },
    }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [revealedLive.instanceId],
      },
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: [revealedLive.instanceId],
        revealedCardIds: [revealedLive.instanceId],
      },
    };

    const result = moveRevealedCheerCards(game, PLAYER1, [revealedLive.instanceId], 'MAIN_DECK_BOTTOM');

    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual([
      deckTop.instanceId,
      deckBottom.instanceId,
      revealedLive.instanceId,
    ]);
    expect(result?.gameState.resolutionZone.cardIds).toEqual([]);
    expect(result?.gameState.resolutionZone.revealedCardIds).toEqual([]);
  });

  it('rejects duplicate, unrevealed, departed, and opponent cards without moving any card', () => {
    const ownLive = createCardInstance(live('PL!S-test-own-live', ['Aqours']), PLAYER1, 'own-live');
    const opponentLive = createCardInstance(
      live('PL!S-test-opponent-live', ['Aqours']),
      PLAYER2,
      'opponent-live'
    );
    let game = registerCards(
      createGameState('cheer-selection-invalid', PLAYER1, 'P1', PLAYER2, 'P2'),
      [ownLive, opponentLive]
    );
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [ownLive.instanceId, opponentLive.instanceId],
      },
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: [ownLive.instanceId, opponentLive.instanceId],
        revealedCardIds: [ownLive.instanceId, opponentLive.instanceId],
      },
    };

    expect(
      moveRevealedCheerCards(game, PLAYER1, [ownLive.instanceId, ownLive.instanceId], 'MAIN_DECK_BOTTOM')
    ).toBeNull();
    expect(moveRevealedCheerCards(game, PLAYER1, [opponentLive.instanceId], 'MAIN_DECK_BOTTOM')).toBeNull();
    expect(
      moveRevealedCheerCards(
        { ...game, resolutionZone: { ...game.resolutionZone, revealedCardIds: [] } },
        PLAYER1,
        [ownLive.instanceId],
        'MAIN_DECK_BOTTOM'
      )
    ).toBeNull();
    expect(
      moveRevealedCheerCards(
        { ...game, resolutionZone: { ...game.resolutionZone, cardIds: [] } },
        PLAYER1,
        [ownLive.instanceId],
        'MAIN_DECK_BOTTOM'
      )
    ).toBeNull();
  });
});

describe('reveal cheer current facts', () => {
  it('appends by default but replaceCurrentCheerCards replaces only the acting player and returns the exact new event', () => {
    const oldFirst = createCardInstance(live('OLD-FIRST', ['Aqours']), PLAYER1, 'old-first');
    const oldSecond = createCardInstance(live('OLD-SECOND', ['Aqours']), PLAYER2, 'old-second');
    const newFirst = createCardInstance(live('NEW-FIRST', ['Aqours']), PLAYER1, 'new-first');
    const appendedFirst = createCardInstance(live('APPENDED-FIRST', ['Aqours']), PLAYER1, 'appended-first');
    let game = registerCards(
      createGameState('cheer-replace-current', PLAYER1, 'P1', PLAYER2, 'P2'),
      [oldFirst, oldSecond, newFirst, appendedFirst]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [newFirst.instanceId, appendedFirst.instanceId] },
    }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [oldFirst.instanceId],
        secondPlayerCheerCardIds: [oldSecond.instanceId],
      },
    };

    const replaced = revealCheerCardsFromMainDeck(game, PLAYER1, 1, {
      automated: true,
      replaceCurrentCheerCards: true,
    });
    expect(replaced.gameState.liveResolution.firstPlayerCheerCardIds).toEqual([newFirst.instanceId]);
    expect(replaced.gameState.liveResolution.secondPlayerCheerCardIds).toEqual([oldSecond.instanceId]);
    expect(replaced.cheerEvent).toMatchObject({
      playerId: PLAYER1,
      revealedCardIds: [newFirst.instanceId],
      automated: true,
      additional: false,
    });

    const appended = revealCheerCardsFromMainDeck(replaced.gameState, PLAYER1, 1);
    expect(appended.gameState.liveResolution.firstPlayerCheerCardIds).toEqual([
      newFirst.instanceId,
      appendedFirst.instanceId,
    ]);
    expect(appended.gameState.liveResolution.secondPlayerCheerCardIds).toEqual([oldSecond.instanceId]);
  });
});
