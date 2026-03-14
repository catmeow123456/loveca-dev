/**
 * 换牌（Mulligan）动作处理器
 *
 * 处理游戏开始时的换牌动作
 */

import type { GameState } from '../../domain/entities/game';
import type { MulliganAction } from '../actions';
import type { ActionHandler, ActionHandlerContext } from './types';
import { success, failure } from './types';
import { GamePhase, SubPhase } from '../../shared/types/enums';
import {
  getFirstPlayer,
  getSecondPlayer,
  addMulliganCompletedPlayer,
  isAllMulliganCompleted,
  markMulliganCompleted,
  setSubPhase,
  addAction,
  updatePlayer,
} from '../../domain/entities/game';
import { removeCardFromZone, shuffleZone } from '../../domain/entities/zone';

/**
 * 处理换牌动作（Mulligan）
 *
 * 玩家选择要换的牌，洗入牌库后重新抽取相同数量
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

  // 验证所有要换的牌都在手牌中
  for (const cardId of cardIdsToMulligan) {
    if (!player.hand.cardIds.includes(cardId)) {
      return failure(game, '选择的卡牌不在手牌中');
    }
  }

  let state = game;
  const mulliganCount = cardIdsToMulligan.length;

  if (mulliganCount > 0) {
    // 1. 将选中的牌从手牌移除，放入牌库底部
    for (const cardId of cardIdsToMulligan) {
      state = updatePlayer(state, playerId, (p) => {
        const newHand = removeCardFromZone(p.hand, cardId);
        const newDeck = {
          ...p.mainDeck,
          cardIds: [...p.mainDeck.cardIds, cardId], // 放到牌库底部
        };
        return { ...p, hand: newHand, mainDeck: newDeck };
      });
    }

    // 2. 洗牌
    state = updatePlayer(state, playerId, (p) => ({
      ...p,
      mainDeck: shuffleZone(p.mainDeck),
    }));

    // 3. 抽取相同数量的卡牌
    for (let i = 0; i < mulliganCount; i++) {
      state = ctx.drawCard(state, playerId);
    }

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
  const secondPlayer = getSecondPlayer(state);

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
