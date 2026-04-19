import { GameCommandType } from './game-commands.js';
import { SubPhase } from '../shared/types/enums.js';

export const MAIN_PHASE_MANUAL_COMMAND_TYPES: readonly GameCommandType[] = [
  GameCommandType.OPEN_INSPECTION,
  GameCommandType.PLAY_MEMBER_TO_SLOT,
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

export const PERFORMANCE_SUCCESS_EFFECT_COMMAND_TYPES: readonly GameCommandType[] = [
  ...MAIN_PHASE_MANUAL_COMMAND_TYPES,
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

export function isPerformanceSuccessEffectSubPhase(subPhase: SubPhase): boolean {
  return subPhase === SubPhase.PERFORMANCE_SUCCESS_EFFECTS;
}

export function isPerformanceFreeInteractionSubPhase(subPhase: SubPhase): boolean {
  return (
    subPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS ||
    subPhase === SubPhase.PERFORMANCE_JUDGMENT
  );
}
