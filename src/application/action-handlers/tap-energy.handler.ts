/**
 * 切换能量状态动作处理器
 *
 * "信任玩家"原则：能量支付与恢复由玩家显式操作，
 * 系统只维护公开对象的朝向真值。
 */

import type { GameState } from '../../domain/entities/game.js';
import type { TapEnergyAction } from '../actions.js';
import type { ActionHandler } from './types.js';
import { success, failure } from './types.js';
import { addAction, updatePlayer } from '../../domain/entities/game.js';
import { toggleEnergyOrientation } from '../../domain/entities/zone.js';
import { OrientationState } from '../../shared/types/enums.js';

export const handleTapEnergy: ActionHandler<TapEnergyAction> = (game: GameState, action, ctx) => {
  const { cardId, playerId } = action;

  const player = ctx.getPlayerById(game, playerId);
  if (!player) {
    return failure(game, '玩家不存在');
  }

  if (!player.energyZone.cardIds.includes(cardId)) {
    return failure(game, '卡牌当前不在能量区');
  }

  const card = ctx.getCardById(game, cardId);
  if (!card) {
    return failure(game, '卡牌不存在');
  }

  if (card.data.cardType !== 'ENERGY') {
    return failure(game, '只有能量牌可以切换能量状态');
  }

  const currentState = player.energyZone.cardStates.get(cardId);
  const currentOrientation = currentState?.orientation ?? OrientationState.ACTIVE;
  const newOrientation =
    currentOrientation === OrientationState.ACTIVE
      ? OrientationState.WAITING
      : OrientationState.ACTIVE;

  let state = updatePlayer(game, playerId, (p) => ({
    ...p,
    energyZone: toggleEnergyOrientation(p.energyZone, cardId),
  }));

  state = addAction(state, 'TAP_ENERGY', playerId, {
    cardId,
    cardName: card.data.name,
    fromOrientation: currentOrientation,
    toOrientation: newOrientation,
  });

  return success(state);
};
