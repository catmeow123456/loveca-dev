import { describe, expect, it } from 'vitest';
import { applyRuleActionResult, ruleActionProcessor } from '../../src/domain/rules/rule-actions';
import { createGameState, switchFirstPlayer, updatePlayer } from '../../src/domain/entities/game';
import { clearTurnMoveRecords } from '../../src/domain/entities/player';
import { hasPlayerRefreshedDeckThisTurn } from '../../src/domain/rules/deck-turn-state';

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

  it('records only the affected player refresh at the current global turnCount', () => {
    let game = { ...createGameState('refresh-turn-fact', 'p1', 'P1', 'p2', 'P2'), turnCount: 7 };
    expect(hasPlayerRefreshedDeckThisTurn(game, 'p1')).toBe(false);
    expect(hasPlayerRefreshedDeckThisTurn(game, 'p2')).toBe(false);
    expect(game.players[0].lastDeckRefreshTurnCount).toBeUndefined();

    game = applyRuleActionResult(game, ruleActionProcessor.executeRefresh('p1'), () => null);
    expect(hasPlayerRefreshedDeckThisTurn(game, 'p1')).toBe(true);
    expect(hasPlayerRefreshedDeckThisTurn(game, 'p2')).toBe(false);
    expect(game.players[0].lastDeckRefreshTurnCount).toBe(7);

    const nonRefresh = applyRuleActionResult(
      game,
      { type: 'ILLEGAL_CARD', executed: true, affectedPlayerId: 'p2', description: 'no refresh' },
      () => null
    );
    expect(hasPlayerRefreshedDeckThisTurn(nonRefresh, 'p2')).toBe(false);
    expect(nonRefresh.players[0].lastDeckRefreshTurnCount).toBe(7);
    expect(nonRefresh.players[1].lastDeckRefreshTurnCount).toBeUndefined();

    const afterSecondPlayerActive = updatePlayer(nonRefresh, 'p2', clearTurnMoveRecords);
    expect(hasPlayerRefreshedDeckThisTurn(afterSecondPlayerActive, 'p1')).toBe(true);
    expect(afterSecondPlayerActive.players[0].lastDeckRefreshTurnCount).toBe(7);

    const nextGlobalTurn = { ...afterSecondPlayerActive, turnCount: 8 };
    expect(hasPlayerRefreshedDeckThisTurn(nextGlobalTurn, 'p1')).toBe(false);
  });

  it('keeps a second-player refresh valid through that player ACTIVE cleanup in the same global turn', () => {
    const game = { ...createGameState('refresh-second-player', 'p1', 'P1', 'p2', 'P2'), turnCount: 12 };
    const refreshed = applyRuleActionResult(game, ruleActionProcessor.executeRefresh('p2'), () => null);
    const afterSecondPlayerActive = updatePlayer(refreshed, 'p2', clearTurnMoveRecords);

    expect(afterSecondPlayerActive.players[1].lastDeckRefreshTurnCount).toBe(12);
    expect(hasPlayerRefreshedDeckThisTurn(afterSecondPlayerActive, 'p2')).toBe(true);
  });

  it('does not treat an opponent refresh as the controller own refresh', () => {
    const game = { ...createGameState('refresh-opponent', 'p1', 'P1', 'p2', 'P2'), turnCount: 4 };
    const refreshed = applyRuleActionResult(game, ruleActionProcessor.executeRefresh('p2'), () => null);

    expect(hasPlayerRefreshedDeckThisTurn(refreshed, 'p1')).toBe(false);
    expect(hasPlayerRefreshedDeckThisTurn(refreshed, 'p2')).toBe(true);
    expect(refreshed.players[1].lastDeckRefreshTurnCount).toBe(4);
  });

  it('treats legacy player state without the refresh turn count as not refreshed', () => {
    const game = updatePlayer(createGameState('refresh-legacy', 'p1', 'P1', 'p2', 'P2'), 'p1', (player) => {
      const { lastDeckRefreshTurnCount: _legacyMissing, ...legacyPlayer } = player;
      return legacyPlayer;
    });

    expect(hasPlayerRefreshedDeckThisTurn(game, 'p1')).toBe(false);
  });
});
