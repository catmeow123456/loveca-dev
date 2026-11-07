import { addAction, getPlayerById, type GameState } from '../../domain/entities/game.js';
import {
  getHextechDefinition,
  HEXTECH_RULES_VERSION,
  type HextechId,
} from '../../domain/hextech/catalog.js';
import type { GameOperationResult } from '../game-service.js';
import { drawCardsFromMainDeckToHand } from '../effects/draw.js';
import type { InitialHextechSetup } from '../../domain/hextech/state.js';
import { GamePhase } from '../../shared/types/enums.js';

export function validateInitialHextechSetup(setup: InitialHextechSetup): void {
  if (
    !Array.isArray(setup) ||
    setup.length !== 2 ||
    setup.some(
      (ids) =>
        !Array.isArray(ids) ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== 'string' || !getHextechDefinition(id))
    )
  ) {
    throw new Error('海克斯开局配置需要双方各自的已实现条目，且同一玩家不能重复选择');
  }
}

export function applyInitialHextechGrants(game: GameState): GameState {
  if (
    !game.hextech?.initialGrants ||
    game.currentPhase !== GamePhase.ACTIVE_PHASE ||
    game.turnCount !== 1
  ) {
    return game;
  }
  const { initialGrants, ...hextech } = game.hextech;
  let state: GameState = { ...game, hextech };
  for (const index of [game.firstPlayerIndex, 1 - game.firstPlayerIndex]) {
    for (const definitionId of initialGrants[index]) {
      const result = acquireHextech(
        state,
        game.players[index].id,
        definitionId,
        `hextech:initial:${index}:${definitionId}`
      );
      if (!result.success) throw new Error(result.error);
      state = result.gameState;
    }
  }
  return state;
}

/** Trusted application primitive; the local setup caller supplies validated definitions. */
export function acquireHextech(
  game: GameState,
  playerId: string,
  definitionId: HextechId,
  instanceId: string
): GameOperationResult {
  const definition = getHextechDefinition(definitionId);
  if (
    !game.hextech ||
    game.hextech.rulesVersion !== HEXTECH_RULES_VERSION ||
    game.rulesetId !== 'STANDARD' ||
    !game.isStarted ||
    game.isEnded ||
    !getPlayerById(game, playerId) ||
    !definition ||
    !instanceId ||
    game.hextech.owned.some((owned) => owned.instanceId === instanceId)
  ) {
    return { success: false, gameState: game, error: '无法取得该海克斯' };
  }

  let state: GameState = {
    ...game,
    hextech: {
      ...game.hextech,
      owned: [
        ...game.hextech.owned,
        {
          instanceId,
          definitionId,
          playerId,
          acquiredTurn: game.turnCount,
        },
      ],
    },
  };
  if (definition.effect.kind === 'ACQUIRE_DRAW') {
    state = drawCardsFromMainDeckToHand(state, playerId, definition.effect.count)!.gameState;
  }
  state = addAction(state, 'HEXTECH_ACQUIRED', playerId, { definitionId, instanceId });
  return { success: true, gameState: state };
}
