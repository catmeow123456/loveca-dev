/**
 * 阶段十新增动作处理器
 *
 * 包含：确认子阶段、手动移动卡牌、判定确认、分数确认等
 * 基于 "信任玩家" 设计方案
 */

import type { GameState } from '../../domain/entities/game';
import type {
  ConfirmSubPhaseAction,
  ManualMoveCardAction,
  ConfirmJudgmentAction,
  ConfirmScoreAction,
  SelectSuccessCardAction,
  UndoOperationAction,
  PerformCheerAction,
} from '../actions';
import type { ActionHandler, ActionHandlerContext } from './types';
import { success, failure } from './types';
import type { GameOperationResult } from '../game-service';
import {
  ZoneType,
  CardType,
  SlotPosition,
  SubPhase,
  OrientationState,
  FaceState,
} from '../../shared/types/enums';
import { addAction, updatePlayer, getFirstPlayer } from '../../domain/entities/game';
import { removeCardFromStatefulZone, addCardToZone, drawFromTop } from '../../domain/entities/zone';
import {
  removeCardFromPlayerZone,
  addCardToPlayerZone,
  moveCardUniversal,
} from './zone-operations';
import { phaseManager, type SubPhaseAutoAction } from '../phase-manager';
import { isUserActionRequired } from '../../shared/phase-config';

/**
 * 处理确认子阶段完成动作
 *
 * 用户确认当前子阶段的操作已完成
 * 会自动推进到下一个子阶段，并执行相应的自动处理
 */
export const handleConfirmSubPhase: ActionHandler<ConfirmSubPhaseAction> = (
  game: GameState,
  action: ConfirmSubPhaseAction,
  ctx: ActionHandlerContext
): GameOperationResult => {
  const { playerId, subPhase } = action;

  // 验证子阶段是否匹配
  if (game.currentSubPhase !== subPhase) {
    return failure(game, `当前子阶段不是 ${subPhase}`);
  }

  // 清空操作历史
  let state: GameState = {
    ...game,
    operationHistory: [],
  };

  // RESULT_SETTLEMENT 确认时自动清理：
  // 将解决区域的应援牌和双方 Live 区失败的卡牌移入休息室
  if (subPhase === SubPhase.RESULT_SETTLEMENT) {
    state = performSettlementCleanup(state, ctx);
  }

  // 记录动作
  state = addAction(state, 'PHASE_CHANGE', playerId, {
    subPhaseConfirmed: subPhase,
  });

  const triggeredEvents: string[] = [];

  // 推进子阶段：若进入的是"自动子阶段"，则自动连锁推进直到遇到需要用户操作的子阶段或主阶段结束。
  while (true) {
    const subPhaseResult = phaseManager.advanceToNextSubPhase(state);
    state = phaseManager.applySubPhaseTransition(state, subPhaseResult);

    // 执行子阶段自动处理
    for (const autoAction of subPhaseResult.autoActions) {
      if (autoAction.type === 'FINALIZE_LIVE_RESULT') {
        // 由 GameService 负责在正确时机调用 finalizeLiveResult()
        triggeredEvents.push('FINALIZE_LIVE_RESULT');
      }
      state = executeSubPhaseAutoAction(state, autoAction, ctx);
    }

    // 子阶段结束：交由 GameService 推进主阶段
    if (subPhaseResult.shouldAdvancePhase) {
      triggeredEvents.push('SHOULD_ADVANCE_PHASE');
      break;
    }

    // 到达需要用户操作的子阶段：停在这里等待下一次确认
    if (isUserActionRequired(state.currentSubPhase)) {
      break;
    }
  }

  return triggeredEvents.length > 0
    ? { success: true, gameState: state, triggeredEvents }
    : success(state);
};

/**
 * 执行子阶段自动处理
 */
function executeSubPhaseAutoAction(
  game: GameState,
  autoAction: SubPhaseAutoAction,
  ctx: ActionHandlerContext
): GameState {
  switch (autoAction.type) {
    case 'DRAW_CARDS_FOR_LIVE_SET': {
      // 根据设置的 Live 卡数量抽卡，并将该玩家标记为本次 Live Set 已完成。
      // 这是配合子阶段流转的版本：LIVE_SET_*_PLAYER -> LIVE_SET_*_DRAW 会触发该自动动作。
      let state = game;

      if (!state.liveSetCompletedPlayers.includes(autoAction.playerId)) {
        state = {
          ...state,
          liveSetCompletedPlayers: [...state.liveSetCompletedPlayers, autoAction.playerId],
        };
      }

      const player = ctx.getPlayerById(state, autoAction.playerId);
      if (!player) return game;

      const liveCardCount = player.liveZone.cardIds.length;
      for (let i = 0; i < liveCardCount; i++) {
        state = ctx.drawCard(state, autoAction.playerId);
      }
      return state;
    }

    case 'REVEAL_LIVE_CARDS': {
      // 翻开 Live 卡（在演出阶段开始时）
      return revealLiveCards(game, autoAction.playerId);
    }

    case 'FINALIZE_LIVE_RESULT': {
      // Live 结算完成，标记需要在 GameService 中调用 finalizeLiveResult()
      // 这里只做标记，实际处理在 GameService 中
      return game;
    }
  }
}

/**
 * 翻开玩家的 Live 区卡牌
 */
function revealLiveCards(game: GameState, playerId: string): GameState {
  return updatePlayer(game, playerId, (player) => {
    const newCardStates = new Map(player.liveZone.cardStates);
    for (const cardId of player.liveZone.cardIds) {
      const existing = newCardStates.get(cardId);
      newCardStates.set(cardId, {
        orientation: existing?.orientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: { ...player.liveZone, cardStates: newCardStates },
    };
  });
}

/**
 * RESULT_SETTLEMENT 确认时自动清理
 * - 将解决区域(RESOLUTION_ZONE)中所有卡牌移入对应玩家的休息室（应援牌）
 * - 将双方 Live 区中判定失败的卡牌移入休息室
 */
function performSettlementCleanup(game: GameState, ctx: ActionHandlerContext): GameState {
  let state = game;

  // 1. 清理解决区域中的应援牌 → 各玩家的休息室
  const resolutionCardIds = [...state.resolutionZone.cardIds];
  if (resolutionCardIds.length > 0) {
    // 将解决区域卡牌按 owner 分组，移到对应休息室
    for (const cardId of resolutionCardIds) {
      const card = ctx.getCardById(state, cardId);
      if (!card) continue;
      const ownerId = card.ownerId;
      // 从解决区域移除
      state = {
        ...state,
        resolutionZone: {
          ...state.resolutionZone,
          cardIds: state.resolutionZone.cardIds.filter((id) => id !== cardId),
        },
      };
      // 加入对应玩家的休息室
      state = addCardToPlayerZone(state, ownerId, cardId, ZoneType.WAITING_ROOM);
    }
  }

  // 2. 清理双方 Live 区中判定失败的卡牌 → 休息室
  const liveResults = state.liveResolution.liveResults;
  for (const player of state.players) {
    const failedCardIds = player.liveZone.cardIds.filter((cardId) => {
      const result = liveResults.get(cardId);
      return result === false; // 判定失败
    });
    for (const cardId of failedCardIds) {
      state = removeCardFromPlayerZone(state, player.id, cardId, ZoneType.LIVE_ZONE);
      state = addCardToPlayerZone(state, player.id, cardId, ZoneType.WAITING_ROOM);
    }
  }

  return state;
}

/**
 * 处理手动移动卡牌动作
 *
 * 在自由操作窗口中，用户可以手动移动卡牌
 */
export const handleManualMoveCard: ActionHandler<ManualMoveCardAction> = (
  game: GameState,
  action: ManualMoveCardAction,
  ctx: ActionHandlerContext
) => {
  const { playerId, cardId, fromZone, toZone, targetSlot, sourceSlot, position } = action;

  const player = ctx.getPlayerById(game, playerId);
  if (!player) {
    return failure(game, '玩家不存在');
  }

  const card = ctx.getCardById(game, cardId);
  if (!card) {
    return failure(game, '卡牌不存在');
  }

  // 能量牌移动限制（规则 4.5.5、10.5.4）
  const isEnergyCard = card.data.cardType === CardType.ENERGY;
  if (isEnergyCard) {
    if (toZone === ZoneType.HAND) {
      return failure(game, '能量牌不能移动到手牌');
    }
    if (toZone === ZoneType.LIVE_ZONE) {
      return failure(game, '能量牌不能移动到LIVE区');
    }
    if (toZone === ZoneType.SUCCESS_ZONE) {
      return failure(game, '能量牌不能移动到成功LIVE卡区');
    }
    if (toZone === ZoneType.WAITING_ROOM) {
      return failure(game, '能量牌不能移动到休息室（请移动到能量卡组）');
    }
    // 能量牌拖到成员区时：若目标槽位无成员卡则拒绝，有成员卡则附加到成员下方
    if (toZone === ZoneType.MEMBER_SLOT) {
      if (!targetSlot) {
        return failure(game, '请指定目标槽位');
      }
      const targetPlayer = ctx.getPlayerById(game, playerId);
      if (!targetPlayer) {
        return failure(game, '玩家不存在');
      }
      const memberCardId = targetPlayer.memberSlots.slots[targetSlot as SlotPosition] ?? null;
      if (!memberCardId) {
        return failure(game, '目标槽位没有成员卡，无法附加能量卡');
      }
    }
  }

  let state = game;

  // 记录操作（用于撤销）
  const operation = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'MOVE_CARD' as const,
    timestamp: Date.now(),
    playerId,
    details: { cardId, fromZone, toZone, targetSlot },
    canUndo: true,
  };

  state = {
    ...state,
    operationHistory: [...state.operationHistory, operation],
  };

  // 能量牌拖到成员区：以附加到成员下方模式执行（规则 4.5.5）
  // 成员卡在 MEMBER_SLOT 之间移动时：传入 sourceSlot 以随成员携带 energyBelow（规则 4.5.5.3）
  const moveOptions =
    isEnergyCard && toZone === ZoneType.MEMBER_SLOT
      ? { targetSlot: targetSlot as SlotPosition, asEnergyBelow: true }
      : { targetSlot, sourceSlot, position };

  // 使用通用移动函数（支持解决区域）
  state = moveCardUniversal(state, playerId, cardId, fromZone, toZone, moveOptions);

  // 记录动作
  state = addAction(state, 'MOVE_CARD', playerId, {
    cardId,
    fromZone,
    toZone,
    targetSlot,
  });

  return success(state);
};

/**
 * 处理确认 Live 判定结果动作
 *
 * 用户手动确认每张 Live 卡的判定结果
 */
export const handleConfirmJudgment: ActionHandler<ConfirmJudgmentAction> = (
  game: GameState,
  action: ConfirmJudgmentAction,
  ctx: ActionHandlerContext
) => {
  const { playerId, judgmentResults } = action;

  // 按卡牌合并判定结果，避免覆盖另一位玩家已确认的数据
  const mergedResults = new Map(game.liveResolution.liveResults);
  judgmentResults.forEach((result, cardId) => {
    mergedResults.set(cardId, result);
  });

  // 更新 liveResolution 中的判定结果
  const state: GameState = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      liveResults: mergedResults,
    },
  };

  return success(state);
};

/**
 * 处理确认分数动作
 *
 * 用户可调整最终分数后确认
 */
export const handleConfirmScore: ActionHandler<ConfirmScoreAction> = (
  game: GameState,
  action: ConfirmScoreAction,
  ctx: ActionHandlerContext
) => {
  const { playerId, adjustedScore, winnerIds } = action;

  let state = game;

  // 如果提供了调整后的分数，更新玩家分数
  if (adjustedScore !== undefined) {
    const newPlayerScores = new Map(game.liveResolution.playerScores);
    newPlayerScores.set(playerId, adjustedScore);

    state = {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        playerScores: newPlayerScores,
      },
    };
  }

  // 如果提供了胜者列表，更新胜者
  if (winnerIds) {
    state = {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        liveWinnerIds: [...winnerIds],
      },
    };
  }

  return success(state);
};

/**
 * 处理选择成功 Live 卡动作
 *
 * 胜者选择要移到成功区的 Live 卡
 */
export const handleSelectSuccessCard: ActionHandler<SelectSuccessCardAction> = (
  game: GameState,
  action: SelectSuccessCardAction,
  ctx: ActionHandlerContext
) => {
  const { playerId, cardId } = action;

  const player = ctx.getPlayerById(game, playerId);
  if (!player) {
    return failure(game, '玩家不存在');
  }

  // 验证卡牌在 Live 区
  if (!player.liveZone.cardIds.includes(cardId)) {
    return failure(game, '卡牌不在 Live 区');
  }

  // 验证玩家是胜者
  if (!game.liveResolution.liveWinnerIds.includes(playerId)) {
    return failure(game, '你不是 Live 胜者');
  }

  // 验证玩家尚未移动过卡牌（防止重复移动）
  if (game.liveResolution.successCardMovedBy.includes(playerId)) {
    return failure(game, '你已经移动过卡牌到成功区');
  }

  // 移动卡牌到成功区
  let state = updatePlayer(game, playerId, (p) => {
    const newLiveZone = removeCardFromStatefulZone(p.liveZone, cardId);
    const newSuccessZone = addCardToZone(p.successZone, cardId);
    return { ...p, liveZone: newLiveZone, successZone: newSuccessZone };
  });

  // 记录谁移动了卡牌到成功区（用于 finalizeLiveResult() 更新先攻）
  state = {
    ...state,
    liveResolution: {
      ...state.liveResolution,
      successCardMovedBy: [...state.liveResolution.successCardMovedBy, playerId],
    },
  };

  // 记录动作
  state = addAction(state, 'MOVE_CARD', playerId, {
    cardId,
    fromZone: ZoneType.LIVE_ZONE,
    toZone: ZoneType.SUCCESS_ZONE,
    action: 'SELECT_SUCCESS_CARD',
  });

  return success(state);
};

/**
 * 处理撤销操作动作
 *
 * 撤销上一步用户操作
 */
export const handleUndoOperation: ActionHandler<UndoOperationAction> = (
  game: GameState,
  action: UndoOperationAction,
  ctx: ActionHandlerContext
) => {
  const { playerId } = action;

  if (game.operationHistory.length === 0) {
    return failure(game, '没有可撤销的操作');
  }

  const lastOperation = game.operationHistory[game.operationHistory.length - 1];

  // 检查操作是否可撤销
  if (!lastOperation.canUndo) {
    return failure(game, '该操作不可撤销');
  }

  // 检查是否是该玩家的操作
  if (lastOperation.playerId !== playerId) {
    return failure(game, '只能撤销自己的操作');
  }

  let state: GameState = {
    ...game,
    operationHistory: game.operationHistory.slice(0, -1),
  };

  // 根据操作类型执行撤销
  if (lastOperation.type === 'MOVE_CARD' && lastOperation.details) {
    const { cardId, fromZone, toZone, targetSlot } = lastOperation.details;

    if (cardId && fromZone && toZone) {
      // 反向移动：从 toZone 移回 fromZone
      state = removeCardFromPlayerZone(state, playerId, cardId as string, toZone as ZoneType);
      state = addCardToPlayerZone(state, playerId, cardId as string, fromZone as ZoneType, {
        targetSlot: targetSlot as SlotPosition | undefined,
      });
    }
  }

  return success(state);
};

/**
 * 处理执行应援动作
 *
 * 用户手动控制应援（Cheer）过程
 */
export const handlePerformCheer: ActionHandler<PerformCheerAction> = (
  game: GameState,
  action: PerformCheerAction,
  ctx: ActionHandlerContext
) => {
  const { playerId, cheerCount } = action;

  const player = ctx.getPlayerById(game, playerId);
  if (!player) {
    return failure(game, '玩家不存在');
  }

  let state = game;
  const cheerCardIds: string[] = [];

  // 从卡组顶翻开指定数量的卡牌
  for (let i = 0; i < cheerCount; i++) {
    state = updatePlayer(state, playerId, (p) => {
      const { zone: newDeck, cardId } = drawFromTop(p.mainDeck);
      if (cardId) {
        cheerCardIds.push(cardId);
      }
      return { ...p, mainDeck: newDeck };
    });
  }

  // 将应援卡牌放入解决区域
  state = {
    ...state,
    resolutionZone: {
      ...state.resolutionZone,
      cardIds: [...state.resolutionZone.cardIds, ...cheerCardIds],
    },
  };

  // 更新 liveResolution 状态
  const isFirstPlayer = playerId === getFirstPlayer(state).id;
  state = {
    ...state,
    liveResolution: {
      ...state.liveResolution,
      firstPlayerCheerCardIds: isFirstPlayer
        ? cheerCardIds
        : state.liveResolution.firstPlayerCheerCardIds,
      secondPlayerCheerCardIds: isFirstPlayer
        ? state.liveResolution.secondPlayerCheerCardIds
        : cheerCardIds,
    },
  };

  // 记录动作
  state = addAction(state, 'CHEER', playerId, {
    cheerCount,
    cheerCardIds,
  });

  return success(state);
};
