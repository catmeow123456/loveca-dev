import type { GameState } from '../../src/domain/entities/game';
import { HEXTECH_RULES_VERSION } from '../../src/domain/hextech/catalog';

/** Add the acquired rule to focused workflow fixtures without replaying game setup. */
export function withCriticalHit(game: GameState, playerId: string): GameState {
  return {
    ...game,
    hextech: {
      rulesVersion: HEXTECH_RULES_VERSION,
      owned: [
        {
          instanceId: 'critical-hit',
          definitionId: 'critical-hit',
          playerId,
          acquiredTurn: game.turnCount,
        },
      ],
    },
  };
}
