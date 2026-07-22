import type { GameState } from '../domain/entities/game.js';
import { hasPendingAbilityOrChoice } from '../domain/entities/game.js';
import { GamePhase, SubPhase } from '../shared/types/enums.js';
import { getManualOperationMode } from './manual-operation-mode.js';
import { GameCommandType } from './game-commands.js';

export type PlayerCommandCategory =
  'NORMAL_RULE_ACTION' | 'FLOW_INPUT' | 'MANUAL_OVERRIDE' | 'DEBUG_ONLY';

export interface PlayerCommandPolicyDecision {
  readonly category: PlayerCommandCategory;
  readonly allowed: boolean;
  readonly reason: string | null;
}

const COMMAND_CATEGORIES = {
  [GameCommandType.MULLIGAN]: 'NORMAL_RULE_ACTION',
  [GameCommandType.SET_LIVE_CARD]: 'NORMAL_RULE_ACTION',
  [GameCommandType.TAP_MEMBER]: 'MANUAL_OVERRIDE',
  [GameCommandType.TAP_ENERGY]: 'MANUAL_OVERRIDE',
  [GameCommandType.END_PHASE]: 'NORMAL_RULE_ACTION',
  [GameCommandType.OPEN_INSPECTION]: 'MANUAL_OVERRIDE',
  [GameCommandType.REVEAL_CHEER_CARD]: 'MANUAL_OVERRIDE',
  [GameCommandType.REVEAL_INSPECTED_CARD]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_INSPECTED_CARD_TO_TOP]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_CARD_TO_INSPECTION]: 'MANUAL_OVERRIDE',
  [GameCommandType.REORDER_INSPECTED_CARD]: 'MANUAL_OVERRIDE',
  [GameCommandType.FINISH_INSPECTION_WITH_ARRANGEMENT]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_TABLE_CARD]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_MEMBER_TO_SLOT]: 'MANUAL_OVERRIDE',
  [GameCommandType.ATTACH_ENERGY_TO_MEMBER]: 'MANUAL_OVERRIDE',
  [GameCommandType.PLAY_MEMBER_TO_SLOT]: 'NORMAL_RULE_ACTION',
  [GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY]: 'NORMAL_RULE_ACTION',
  [GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY]: 'FLOW_INPUT',
  [GameCommandType.CANCEL_SPECIAL_MEMBER_PLAY]: 'FLOW_INPUT',
  [GameCommandType.ACTIVATE_ABILITY]: 'NORMAL_RULE_ACTION',
  [GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_PUBLIC_CARD_TO_HAND]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK]: 'MANUAL_OVERRIDE',
  [GameCommandType.MOVE_OWNED_CARD_TO_ZONE]: 'MANUAL_OVERRIDE',
  [GameCommandType.FINISH_INSPECTION]: 'MANUAL_OVERRIDE',
  [GameCommandType.CONFIRM_COST_PAYMENT]: 'FLOW_INPUT',
  [GameCommandType.CONFIRM_EFFECT_STEP]: 'FLOW_INPUT',
  [GameCommandType.CONFIRM_STEP]: 'FLOW_INPUT',
  [GameCommandType.CONFIRM_PERFORMANCE_OUTCOME]: 'MANUAL_OVERRIDE',
  [GameCommandType.SUBMIT_JUDGMENT]: 'FLOW_INPUT',
  [GameCommandType.SUBMIT_SCORE]: 'FLOW_INPUT',
  [GameCommandType.SELECT_SUCCESS_LIVE]: 'FLOW_INPUT',
  [GameCommandType.DRAW_CARD_TO_HAND]: 'MANUAL_OVERRIDE',
  [GameCommandType.DRAW_ENERGY_TO_ZONE]: 'MANUAL_OVERRIDE',
  [GameCommandType.RETURN_HAND_CARD_TO_TOP]: 'MANUAL_OVERRIDE',
} as const satisfies Record<GameCommandType, PlayerCommandCategory>;

export function classifyPlayerCommand(commandType: GameCommandType): PlayerCommandCategory {
  return COMMAND_CATEGORIES[commandType];
}

/**
 * 玩家命令的中央粗粒度策略。
 *
 * 该查询只负责“当前模式/流程是否允许这一类玩家命令”；卡牌归属、
 * 区域、数量、候选与阶段细节仍由 GameSession 的命令校验负责。
 * 卡效 workflow/runtime helper 不提交玩家命令，因此不经过本策略。
 */
export function getPlayerCommandPolicyDecision(
  state: GameState,
  playerId: string,
  commandType: GameCommandType
): PlayerCommandPolicyDecision {
  const category = classifyPlayerCommand(commandType);
  const mode = getManualOperationMode(state);

  const pendingSpecialPlay = state.pendingSpecialMemberPlay ?? null;
  if (pendingSpecialPlay) {
    const allowed =
      pendingSpecialPlay.playerId === playerId &&
      (commandType === GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY ||
        commandType === GameCommandType.CANCEL_SPECIAL_MEMBER_PLAY);
    return decision(category, allowed, '请先完成当前特殊登场选择');
  }

  const pendingCostPayment = state.pendingCostPayment;
  if (pendingCostPayment) {
    const allowed =
      commandType === GameCommandType.CONFIRM_COST_PAYMENT &&
      pendingCostPayment.playerId === playerId;
    return decision(category, allowed, '请先完成当前费用支付');
  }

  if (mode === 'RULES') {
    if (state.activeEffect) {
      const canAutoAdvancePublicDisplay =
        state.activeEffect.publicCardSelectionAutoAdvanceAt !== undefined ||
        state.activeEffect.publicEffectChoiceAutoAdvanceAt !== undefined;
      const allowed =
        commandType === GameCommandType.CONFIRM_EFFECT_STEP &&
        (state.activeEffect.awaitingPlayerId === playerId || canAutoAdvancePublicDisplay);
      return decision(category, allowed, '请先完成当前卡牌效果');
    }

    if (
      hasPendingAbilityOrChoice(state) ||
      (state.delegatedAbilitySequence ?? null) !== null ||
      (state.checkTimingContext ?? null) !== null
    ) {
      return decision(category, false, '请先完成当前卡牌效果');
    }

    if (category === 'MANUAL_OVERRIDE' || category === 'DEBUG_ONLY') {
      return decision(category, false, '规则模式下只能执行当前游戏流程允许的操作');
    }

    const timingReason = getRulesModeTimingBlockedReason(state, playerId, commandType);
    if (timingReason) {
      return decision(category, false, timingReason);
    }
  }

  return decision(category, true, null);
}

export function getRulesModeConfirmStepBlockedReason(
  state: GameState,
  playerId: string
): string | null {
  switch (state.currentSubPhase) {
    case SubPhase.LIVE_SET_FIRST_PLAYER:
    case SubPhase.LIVE_SET_SECOND_PLAYER:
    case SubPhase.PERFORMANCE_LIVE_START_EFFECTS:
    case SubPhase.RESULT_FIRST_SUCCESS_EFFECTS:
    case SubPhase.RESULT_SECOND_SUCCESS_EFFECTS:
    case SubPhase.RESULT_ANIMATION:
    case SubPhase.RESULT_SETTLEMENT:
      return null;
    case SubPhase.PERFORMANCE_JUDGMENT:
      return hasPerformanceJudgmentDraft(state, playerId) ? null : '请先提交当前自动 Live 判定结果';
    case SubPhase.RESULT_SCORE_CONFIRM:
      return '请使用分数确认流程';
    default:
      return '当前子阶段不能由玩家手动确认';
  }
}

function hasPerformanceJudgmentDraft(state: GameState, playerId: string): boolean {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.liveZone.cardIds.length === 0) {
    return player !== undefined;
  }
  return player.liveZone.cardIds.every((cardId) => state.liveResolution.liveResults.has(cardId));
}

function getRulesModeTimingBlockedReason(
  state: GameState,
  playerId: string,
  commandType: GameCommandType
): string | null {
  switch (commandType) {
    case GameCommandType.MULLIGAN:
      return state.currentPhase === GamePhase.MULLIGAN_PHASE ? null : '当前不是换牌阶段';
    case GameCommandType.SET_LIVE_CARD:
      return state.currentPhase === GamePhase.LIVE_SET_PHASE &&
        (state.currentSubPhase === SubPhase.LIVE_SET_FIRST_PLAYER ||
          state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER)
        ? null
        : '当前不是 Live 设置操作时点';
    case GameCommandType.END_PHASE:
      return state.currentPhase === GamePhase.MAIN_PHASE && state.currentSubPhase === SubPhase.NONE
        ? null
        : '只能在自己的主要阶段结束阶段';
    case GameCommandType.PLAY_MEMBER_TO_SLOT:
    case GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY:
      return state.currentPhase === GamePhase.MAIN_PHASE && state.currentSubPhase === SubPhase.NONE
        ? null
        : '只能在自己的主要阶段登场成员';
    case GameCommandType.ACTIVATE_ABILITY:
      return state.currentPhase === GamePhase.MAIN_PHASE && state.currentSubPhase === SubPhase.NONE
        ? null
        : '当前不是可发动起动效果的主阶段';
    case GameCommandType.SUBMIT_JUDGMENT:
      return state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT
        ? null
        : '当前不是 Live 判定子阶段';
    case GameCommandType.SUBMIT_SCORE:
      return state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM
        ? null
        : '当前不是分数确认阶段';
    case GameCommandType.SELECT_SUCCESS_LIVE:
      return state.currentSubPhase === SubPhase.RESULT_SETTLEMENT
        ? null
        : '当前不是成功 Live 结算阶段';
    case GameCommandType.CONFIRM_STEP:
      return getRulesModeConfirmStepBlockedReason(state, playerId);
    default:
      return null;
  }
}

export function isPlayerCommandAllowedByPolicy(
  state: GameState,
  playerId: string,
  commandType: GameCommandType
): boolean {
  return getPlayerCommandPolicyDecision(state, playerId, commandType).allowed;
}

function decision(
  category: PlayerCommandCategory,
  allowed: boolean,
  blockedReason: string | null
): PlayerCommandPolicyDecision {
  return {
    category,
    allowed,
    reason: allowed ? null : blockedReason,
  };
}
