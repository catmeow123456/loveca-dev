import { describe, expect, it } from 'vitest';
import { applyRuleActionResult, ruleActionProcessor } from '../../src/domain/rules/rule-actions';
import { createGameState, switchFirstPlayer, updatePlayer } from '../../src/domain/entities/game';

describe('refresh rules', () => {
  it('refresh should keep existing main deck order and append shuffled waiting room cards to the bottom', () => {
    let game = createGameState('refresh-order', 'p1', 'P1', 'p2', 'P2');

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      mainDeck: {
        ...player.mainDeck,
        cardIds: ['main-a', 'main-b'],
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: ['wait-a', 'wait-b', 'wait-c'],
      },
    }));

    const refreshed = applyRuleActionResult(
      game,
      ruleActionProcessor.executeRefresh('p1'),
      () => null
    );
    const player = refreshed.players[0];

    expect(player.mainDeck.cardIds.slice(0, 2)).toEqual(['main-a', 'main-b']);
    expect(player.mainDeck.cardIds.slice(2).sort()).toEqual(['wait-a', 'wait-b', 'wait-c']);
    expect(player.waitingRoom.cardIds).toEqual([]);
  });

  it('simultaneous refresh actions should follow current first-player order', () => {
    let game = createGameState('refresh-priority', 'p1', 'P1', 'p2', 'P2');
    game = switchFirstPlayer(game);

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      mainDeck: {
        ...player.mainDeck,
        cardIds: [],
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: ['p1-wait'],
      },
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      mainDeck: {
        ...player.mainDeck,
        cardIds: [],
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: ['p2-wait'],
      },
    }));

    const actions = ruleActionProcessor.collectPendingRefreshActions(game);

    expect(actions.map((action) => action.affectedPlayerId)).toEqual(['p2', 'p1']);
  });
});
