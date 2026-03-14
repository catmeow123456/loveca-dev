/**
 * 杂项动作处理器
 *
 * 包含：发动能力、结束阶段、选择卡牌、确认可选效果等
 */

import type { GameState } from '../../domain/entities/game';
import type {
  ActivateAbilityAction,
  EndPhaseAction,
  SelectCardsAction,
  ConfirmOptionalAction,
} from '../actions';
import type { ActionHandler, ActionHandlerContext } from './types';
import { success, failure } from './types';
import { addAction } from '../../domain/entities/game';

/**
 * 处理使用起动能力动作
 *
 * 注意：采用"信任玩家"新方案后，能力效果由玩家手动执行
 * 此方法仅记录能力发动，不自动执行效果
 */
export const handleActivateAbility: ActionHandler<ActivateAbilityAction> = (
  game: GameState,
  action: ActivateAbilityAction,
  ctx: ActionHandlerContext
) => {
  const { cardId, abilityId, playerId } = action;

  // 获取卡牌
  const card = ctx.getCardById(game, cardId);
  if (!card) {
    return failure(game, '卡牌不存在');
  }

  // 记录能力发动（玩家需要手动执行效果）
  const state = addAction(game, 'PLAY_ABILITY', playerId, {
    cardId,
    abilityId,
    cardName: card.data.name,
    note: '能力已发动，请手动执行效果',
  });

  return success(state);
};

/**
 * 处理结束阶段动作
 *
 * 注意：实际的阶段推进由 GameService.advancePhase() 处理
 * 此处理器只做基本验证
 */
export const handleEndPhase: ActionHandler<EndPhaseAction> = (
  game: GameState,
  action: EndPhaseAction,
  ctx: ActionHandlerContext
) => {
  // 阶段推进逻辑由 GameService 的 switch 分支处理
  // 这里只返回成功，实际推进在 GameService 中完成
  return success(game);
};

/**
 * 处理选择卡牌响应动作
 *
 * 用于效果执行中断后恢复执行
 */
export const handleSelectCards: ActionHandler<SelectCardsAction> = (
  game: GameState,
  action: SelectCardsAction,
  ctx: ActionHandlerContext
) => {
  const { playerId, selectedCardIds } = action;

  // 验证选择的卡牌存在
  for (const cardId of selectedCardIds) {
    const card = ctx.getCardById(game, cardId);
    if (!card) {
      return failure(game, `卡牌 ${cardId} 不存在`);
    }
  }

  // 记录选择操作
  const state = addAction(game, 'PLAY_ABILITY', playerId, {
    type: 'SELECT_CARDS',
    selectedCardIds,
  });

  return success(state);
};

/**
 * 处理确认可选效果响应动作
 *
 * 用于玩家确认或跳过可选效果
 */
export const handleConfirmOptional: ActionHandler<ConfirmOptionalAction> = (
  game: GameState,
  action: ConfirmOptionalAction,
  ctx: ActionHandlerContext
) => {
  const { playerId, confirmed } = action;

  // 记录确认操作
  const state = addAction(game, 'PLAY_ABILITY', playerId, {
    type: 'CONFIRM_OPTIONAL',
    confirmed,
  });

  return success(state);
};
