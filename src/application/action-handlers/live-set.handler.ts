/**
 * Live 设置阶段动作处理器
 *
 * 基于规则 8.2
 */

import type { GameState } from '../../domain/entities/game';
import type { SetLiveCardAction, SkipLiveSetAction } from '../actions';
import type { ActionHandler, ActionHandlerContext } from './types';
import { success, failure } from './types';
import { GamePhase, OrientationState, FaceState } from '../../shared/types/enums';
import { GAME_CONFIG, addAction, updatePlayer } from '../../domain/entities/game';
import { removeCardFromZone, addCardToStatefulZone } from '../../domain/entities/zone';

/**
 * 处理放置 Live 卡动作
 *
 * 基于规则 8.2
 */
export const handleSetLiveCard: ActionHandler<SetLiveCardAction> = (
  game: GameState,
  action: SetLiveCardAction,
  ctx: ActionHandlerContext
) => {
  const { cardId, playerId, faceDown } = action;

  const player = ctx.getPlayerById(game, playerId);
  if (!player) {
    return failure(game, '玩家不存在');
  }

  // 验证卡牌在手牌中
  if (!player.hand.cardIds.includes(cardId)) {
    return failure(game, '卡牌不在手牌中');
  }

  // 验证是否在 Live 设置阶段
  if (game.currentPhase !== GamePhase.LIVE_SET_PHASE) {
    return failure(game, '只能在 Live 设置阶段放置 Live 卡');
  }

  // 检查已放置的 Live 卡数量
  if (player.liveZone.cardIds.length >= GAME_CONFIG.MAX_LIVE_CARDS_PER_PHASE) {
    return failure(game, '已达到 Live 卡放置上限');
  }

  // 执行：从手牌移除并放置到 Live 区
  let state = updatePlayer(game, playerId, (p) => {
    const newHand = removeCardFromZone(p.hand, cardId);
    const newLiveZone = addCardToStatefulZone(p.liveZone, cardId, {
      orientation: OrientationState.ACTIVE,
      face: faceDown ? FaceState.FACE_DOWN : FaceState.FACE_UP,
    });
    return { ...p, hand: newHand, liveZone: newLiveZone };
  });

  // 注意：抽卡逻辑已移至 handleSkipLiveSet
  // 根据规则 8.2.2，玩家先盖完所有牌，然后一次性抽与盖牌数量相同的卡牌

  // 记录动作
  state = addAction(state, 'SET_LIVE_CARD', playerId, { cardId, faceDown });

  return success(state);
};

/**
 * 处理跳过/完成 Live 设置动作
 *
 * 基于规则 8.2
 */
export const handleSkipLiveSet: ActionHandler<SkipLiveSetAction> = (
  game: GameState,
  action: SkipLiveSetAction,
  ctx: ActionHandlerContext
) => {
  const { playerId } = action;

  // 验证是否在 Live 设置阶段
  if (game.currentPhase !== GamePhase.LIVE_SET_PHASE) {
    return failure(game, '只能在 Live 设置阶段完成设置');
  }

  // 检查玩家是否已完成设置
  if (game.liveSetCompletedPlayers.includes(playerId)) {
    return failure(game, '你已经完成了 Live 设置');
  }

  // 获取玩家在本阶段盖了多少张牌
  const player = ctx.getPlayerById(game, playerId);
  const cardsPlacedCount = player?.liveZone.cardIds.length ?? 0;

  // 将玩家标记为已完成设置
  let state: GameState = {
    ...game,
    liveSetCompletedPlayers: [...game.liveSetCompletedPlayers, playerId],
  };

  // 规则 8.2.2: 抽与盖牌数量相同的卡牌
  // 玩家先盖完所有牌，然后一次性抽取相同数量的卡
  for (let i = 0; i < cardsPlacedCount; i++) {
    state = ctx.drawCard(state, playerId);
  }

  // 记录抽卡动作
  if (cardsPlacedCount > 0) {
    state = addAction(state, 'DRAW_CARD', playerId, {
      count: cardsPlacedCount,
      reason: 'LIVE_SET_DRAW',
    });
  }

  // 注意：阶段推进由 GameService.advancePhase 处理
  // 返回状态，让调用方决定是否推进阶段

  return success(state);
};
