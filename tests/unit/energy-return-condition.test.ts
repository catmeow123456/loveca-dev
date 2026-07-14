import { describe, expect, it } from 'vitest';
import { createGameState, emitGameEvent } from '../../src/domain/entities/game';
import { createEnergyMovedToDeckEvent } from '../../src/domain/events/game-events';
import { hasPlayerMovedEnergyFromZoneToDeckThisTurn } from '../../src/application/effects/conditions';

describe('hasPlayerMovedEnergyFromZoneToDeckThisTurn', () => {
  it('matches the player and current turn without restricting cause', () => {
    let game = createGameState('query', 'p1', 'P1', 'p2', 'P2');
    game = emitGameEvent(
      game,
      createEnergyMovedToDeckEvent(
        'p1',
        ['energy'],
        { kind: 'RULE_ACTION', playerId: 'p1' },
        game.turnCount
      )
    );
    expect(hasPlayerMovedEnergyFromZoneToDeckThisTurn(game, 'p1')).toBe(true);
    expect(hasPlayerMovedEnergyFromZoneToDeckThisTurn(game, 'p2')).toBe(false);
    expect(
      hasPlayerMovedEnergyFromZoneToDeckThisTurn({ ...game, turnCount: game.turnCount + 1 }, 'p1')
    ).toBe(false);
  });

  it('does not infer a return from energyBelow or unrelated logs', () => {
    const game = createGameState('query-negative', 'p1', 'P1', 'p2', 'P2');
    expect(hasPlayerMovedEnergyFromZoneToDeckThisTurn(game, 'p1')).toBe(false);
  });
});
