/**
 * 换牌（Mulligan）动作处理器
 *
 * 处理游戏开始时的换牌动作
 */

import type { GameState } from '../../domain/entities/game.js';
import type { MulliganAction } from '../actions.js';
import type { ActionHandler, ActionHandlerContext } from './types.js';
import { success, failure } from './types.js';
import { GamePhase, SubPhase } from '../../shared/types/enums.js';
import {
  getFirstPlayer,
  addMulliganCompletedPlayer,
  isAllMulliganCompleted,
  markMulliganCompleted,
  setSubPhase,
  addAction,
  updatePlayer,
} from '../../domain/entities/game.js';
import { removeCardFromZone, shuffleZone } from '../../domain/entities/zone.js';

/**
 * 处理换牌动作（Mulligan）
 *
 * 玩家先将要换的牌暂时放在一旁，抽取相同数量后再放回主卡组并洗牌
 */
export const handleMulligan: ActionHandler<MulliganAction> = (
  game: GameState,
  action: MulliganAction,
  ctx: ActionHandlerContext
) => {
  const { playerId, cardIdsToMulligan } = action;

  // 验证是否在换牌阶段
  if (game.currentPhase !== GamePhase.MULLIGAN_PHASE) {
    return failure(game, '只能在换牌阶段执行换牌');
  }

  // 检查玩家是否已完成换牌
  if (game.mulliganCompletedPlayers.includes(playerId)) {
    return failure(game, '你已经完成了换牌');
  }

  const player = ctx.getPlayerById(game, playerId);
  if (!player) {
    return failure(game, '玩家不存在');
  }

  if (new Set(cardIdsToMulligan).size !== cardIdsToMulligan.length) {
    return failure(game, '换牌列表中存在重复的卡牌');
  }

  // 验证所有要换的牌都在手牌中
  for (const cardId of cardIdsToMulligan) {
    if (!player.hand.cardIds.includes(cardId)) {
      return failure(game, '选择的卡牌不在手牌中');
    }
  }

  let state = game;
  const mulliganCount = cardIdsToMulligan.length;

  if (mulliganCount > 0) {
    // 1. 将选中的牌从手牌移除，在本次原子结算中暂时放在一旁
    state = updatePlayer(state, playerId, (p) => ({
      ...p,
      hand: cardIdsToMulligan.reduce((hand, cardId) => removeCardFromZone(hand, cardId), p.hand),
    }));

    // 2. 从原主卡组顶抽取相同数量的卡牌
    for (let i = 0; i < mulliganCount; i++) {
      state = ctx.drawCard(state, playerId);
    }

    // 3. 将暂放的牌放回主卡组，然后洗牌
    state = updatePlayer(state, playerId, (p) => ({
      ...p,
      mainDeck: shuffleZone({
        ...p.mainDeck,
        cardIds: [...p.mainDeck.cardIds, ...cardIdsToMulligan],
      }),
    }));

    // 记录换牌动作
    state = addAction(state, 'DRAW_CARD', playerId, {
      count: mulliganCount,
      reason: 'MULLIGAN',
      returnedCardIds: cardIdsToMulligan,
    });
  }

  // 标记玩家已完成换牌
  state = addMulliganCompletedPlayer(state, playerId);

  // 更新子阶段
  const firstPlayer = getFirstPlayer(state);

  if (playerId === firstPlayer.id) {
    // 先攻完成换牌，切换到后攻
    state = setSubPhase(state, SubPhase.MULLIGAN_SECOND_PLAYER);
  }

  // 检查是否所有玩家都完成了换牌
  if (isAllMulliganCompleted(state)) {
    // 换牌阶段结束，进入活跃阶段
    state = markMulliganCompleted(state);
  }

  return success(state);
};
