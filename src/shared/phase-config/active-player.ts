/**
 * 统一的"当前行动玩家"判断逻辑
 * 解决问题 2: "回合"概念在不同阶段含义不同
 */

import type { GameState } from '../../domain/entities/game';
import { getPhaseConfig } from './phase-registry';
import { getSubPhaseConfig } from './sub-phase-registry';

// ============================================
// 核心判断函数
// ============================================

/**
 * 统一判断指定玩家是否是"当前行动玩家"
 *
 * 这个函数替代了分散在各处的判断逻辑，根据阶段配置的
 * activePlayerStrategy 统一判断当前谁可以行动。
 *
 * @param game 当前游戏状态
 * @param playerId 要检查的玩家 ID
 * @returns 该玩家是否是当前行动玩家
 */
export function isPlayerActive(game: GameState, playerId: string): boolean {
  const phaseConfig = getPhaseConfig(game.currentPhase);
  if (!phaseConfig) return false;

  const strategy = phaseConfig.behavior.activePlayerStrategy;

  switch (strategy) {
    case 'USE_ACTIVE_PLAYER_INDEX':
      // 直接使用 activePlayerIndex
      return game.players[game.activePlayerIndex].id === playerId;

    case 'USE_FIRST_PLAYER':
      // 始终是先攻玩家
      return game.players[game.firstPlayerIndex].id === playerId;

    case 'BOTH_PLAYERS':
      // 双方都可行动
      return game.players.some((p) => p.id === playerId);

    case 'DERIVE_FROM_SUB_PHASE':
      // 根据子阶段推断
      return isPlayerActiveBySubPhase(game, playerId);

    default:
      // 默认使用 activePlayerIndex
      return game.players[game.activePlayerIndex].id === playerId;
  }
}

/**
 * 根据子阶段判断当前行动玩家
 */
function isPlayerActiveBySubPhase(game: GameState, playerId: string): boolean {
  const subPhaseConfig = getSubPhaseConfig(game.currentSubPhase);
  if (!subPhaseConfig) {
    // 无子阶段配置，降级使用 activePlayerIndex
    return game.players[game.activePlayerIndex].id === playerId;
  }

  const firstPlayerId = game.players[game.firstPlayerIndex].id;
  const secondPlayerIndex = game.firstPlayerIndex === 0 ? 1 : 0;
  const secondPlayerId = game.players[secondPlayerIndex].id;

  switch (subPhaseConfig.behavior.activePlayer) {
    case 'FIRST':
      return playerId === firstPlayerId;
    case 'SECOND':
      return playerId === secondPlayerId;
    case 'BOTH':
      return playerId === firstPlayerId || playerId === secondPlayerId;
    case 'CURRENT_ACTIVE':
    default:
      return game.players[game.activePlayerIndex].id === playerId;
  }
}

// ============================================
// 辅助查询函数
// ============================================

/**
 * 获取当前阶段的所有可行动玩家 ID
 */
export function getActivePlayerIds(game: GameState): string[] {
  const phaseConfig = getPhaseConfig(game.currentPhase);
  if (!phaseConfig) return [game.players[game.activePlayerIndex].id];

  const strategy = phaseConfig.behavior.activePlayerStrategy;

  if (strategy === 'BOTH_PLAYERS') {
    return game.players.map((p) => p.id);
  }

  if (strategy === 'DERIVE_FROM_SUB_PHASE') {
    const subPhaseConfig = getSubPhaseConfig(game.currentSubPhase);
    if (subPhaseConfig?.behavior.activePlayer === 'BOTH') {
      return game.players.map((p) => p.id);
    }
  }

  // 单一活跃玩家
  const activePlayer = game.players.find((p) => isPlayerActive(game, p.id));
  return activePlayer ? [activePlayer.id] : [];
}

/**
 * 获取当前活跃玩家 ID
 * 如果是双方都可行动的阶段，返回第一个玩家
 */
export function getActivePlayerId(game: GameState): string | undefined {
  const activeIds = getActivePlayerIds(game);
  return activeIds[0];
}

/**
 * 检查当前是否是共享阶段（双方都可行动）
 */
export function isCurrentlySharedPhase(game: GameState): boolean {
  const phaseConfig = getPhaseConfig(game.currentPhase);
  if (!phaseConfig) return false;

  if (phaseConfig.behavior.activePlayerStrategy === 'BOTH_PLAYERS') {
    return true;
  }

  if (phaseConfig.behavior.activePlayerStrategy === 'DERIVE_FROM_SUB_PHASE') {
    const subPhaseConfig = getSubPhaseConfig(game.currentSubPhase);
    return subPhaseConfig?.behavior.activePlayer === 'BOTH';
  }

  return false;
}
