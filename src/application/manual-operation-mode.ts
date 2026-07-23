import type { GameState } from '../domain/entities/game.js';
import { hasPendingAbilityOrChoice } from '../domain/entities/game.js';
import { SubPhase } from '../shared/types/enums.js';
import type { ManualOperationMode } from '../shared/types/manual-operation-mode.js';
import { isOwnDeskFreeDragWindow } from './command-availability.js';
import { GameCommandType, type GameCommand } from './game-commands.js';

export function getManualOperationMode(
  state: Pick<GameState, 'manualOperationMode'>
): ManualOperationMode {
  if (state.manualOperationMode !== 'RULES' && state.manualOperationMode !== 'FREE') {
    throw new Error('权威游戏状态缺少有效的 manualOperationMode');
  }
  return state.manualOperationMode;
}

/**
 * 模式只能在没有规则流程正在等待处理的桌面窗口切换。
 *
 * 这是服务端和本地会话共用的权威判断，不依赖客户端按钮状态。
 */
export function getManualOperationModeSwitchBlockedReason(state: GameState): string | null {
  if (state.isEnded) {
    return '对局已结束，不能切换操作模式';
  }

  if (hasPendingAbilityOrChoice(state) || (state.delegatedAbilitySequence ?? null) !== null) {
    return '请先处理当前卡牌效果或费用';
  }

  if (state.inspectionContext || state.inspectionZone.cardIds.length > 0) {
    return '请先完成当前检视流程';
  }

  if (
    state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT ||
    state.currentSubPhase === SubPhase.RESULT_SETTLEMENT ||
    state.resolutionZone.cardIds.length > 0
  ) {
    return '请先完成当前 LIVE 判定或成功 LIVE 选择';
  }

  if (!isOwnDeskFreeDragWindow(state.currentPhase, state.currentSubPhase)) {
    return '当前正在自动处理流程，请到下一个可操作时点再切换';
  }

  return null;
}

/** 远程命令不得自行声明 freePlay，必须由权威模式重写。 */
export function applyAuthoritativeManualOperationModeToCommand(
  command: GameCommand,
  mode: ManualOperationMode
): GameCommand {
  if (command.type !== GameCommandType.PLAY_MEMBER_TO_SLOT) {
    return command;
  }
  return {
    ...command,
    freePlay: mode === 'FREE',
  };
}
