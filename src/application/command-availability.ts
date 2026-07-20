import { GameCommandType } from './game-commands.js';
import { GamePhase, SubPhase } from '../shared/types/enums.js';
import { isUserActionRequired } from '../shared/phase-config/sub-phase-registry.js';

// 主阶段活跃玩家的手动操作命令集。
export const MAIN_PHASE_MANUAL_COMMAND_TYPES: readonly GameCommandType[] = [
  GameCommandType.OPEN_INSPECTION,
  GameCommandType.PLAY_MEMBER_TO_SLOT,
  GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY,
  GameCommandType.TAP_MEMBER,
  GameCommandType.TAP_ENERGY,
  GameCommandType.MOVE_TABLE_CARD,
  GameCommandType.MOVE_MEMBER_TO_SLOT,
  GameCommandType.ATTACH_ENERGY_TO_MEMBER,
  GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM,
  GameCommandType.MOVE_PUBLIC_CARD_TO_HAND,
  GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK,
  GameCommandType.MOVE_OWNED_CARD_TO_ZONE,
  GameCommandType.DRAW_CARD_TO_HAND,
  GameCommandType.DRAW_ENERGY_TO_ZONE,
  GameCommandType.RETURN_HAND_CARD_TO_TOP,
] as const;

// 仅主阶段当前玩家可用的主流程命令。
// 不要并入 OWN_DESK_FREE_DRAG_COMMAND_TYPES，否则会把起动效果暴露到 Live/判定整理窗口。
export const MAIN_PHASE_ACTIVE_PLAYER_COMMAND_TYPES: readonly GameCommandType[] = [
  ...MAIN_PHASE_MANUAL_COMMAND_TYPES,
  GameCommandType.ACTIVATE_ABILITY,
] as const;

// 自由拖拽窗口期间双方玩家均可使用的己方桌面操作命令集。
// 当前等同于主阶段手动命令集（"信任玩家"原则下所有己方桌面操作对双方开放）。
// 仅当前玩家可用的主阶段命令应加入 MAIN_PHASE_ACTIVE_PLAYER_COMMAND_TYPES。
export const OWN_DESK_FREE_DRAG_COMMAND_TYPES: readonly GameCommandType[] = [
  ...MAIN_PHASE_MANUAL_COMMAND_TYPES,
];

export const INSPECTION_COMMAND_TYPES: readonly GameCommandType[] = [
  GameCommandType.REVEAL_INSPECTED_CARD,
  GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
  GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
  GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
  GameCommandType.REORDER_INSPECTED_CARD,
  GameCommandType.FINISH_INSPECTION_WITH_ARRANGEMENT,
  GameCommandType.FINISH_INSPECTION,
] as const;

export const RESULT_SUCCESS_EFFECT_COMMAND_TYPES: readonly GameCommandType[] = [
  ...MAIN_PHASE_MANUAL_COMMAND_TYPES,
  ...INSPECTION_COMMAND_TYPES,
  GameCommandType.REVEAL_CHEER_CARD,
  GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
  GameCommandType.CONFIRM_STEP,
] as const;

export const PERFORMANCE_LIVE_START_COMMAND_TYPES: readonly GameCommandType[] = [
  ...MAIN_PHASE_MANUAL_COMMAND_TYPES,
  GameCommandType.CONFIRM_STEP,
] as const;

export const PERFORMANCE_SUCCESS_INTERACTION_COMMAND_TYPES: readonly GameCommandType[] = [
  ...MAIN_PHASE_MANUAL_COMMAND_TYPES,
  GameCommandType.REVEAL_CHEER_CARD,
  GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
  GameCommandType.CONFIRM_PERFORMANCE_OUTCOME,
  GameCommandType.SUBMIT_JUDGMENT,
  GameCommandType.SELECT_SUCCESS_LIVE,
] as const;

export function isResultSuccessEffectSubPhase(subPhase: SubPhase): boolean {
  return (
    subPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS ||
    subPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS
  );
}

export function isOwnDeskFreeDragWindow(phase: GamePhase, subPhase: SubPhase): boolean {
  if (phase === GamePhase.MAIN_PHASE) {
    return true;
  }

  if (phase === GamePhase.LIVE_SET_PHASE) {
    return isUserActionRequired(subPhase);
  }

  if (phase === GamePhase.PERFORMANCE_PHASE) {
    return isUserActionRequired(subPhase);
  }

  if (phase === GamePhase.LIVE_RESULT_PHASE) {
    return isUserActionRequired(subPhase);
  }

  return false;
}

export function isOwnDeskFreeDragCommand(commandType: GameCommandType): boolean {
  return OWN_DESK_FREE_DRAG_COMMAND_TYPES.includes(commandType);
}
