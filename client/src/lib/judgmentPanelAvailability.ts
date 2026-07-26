import { GamePhase, SubPhase } from '@game/shared/types/enums';

export function isJudgmentPanelAvailable(
  phase: GamePhase | null | undefined,
  subPhase: SubPhase | null | undefined
): boolean {
  if (phase === GamePhase.PERFORMANCE_PHASE) {
    return (
      subPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS ||
      subPhase === SubPhase.PERFORMANCE_JUDGMENT
    );
  }

  if (phase !== GamePhase.LIVE_RESULT_PHASE) {
    return false;
  }

  return (
    subPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS ||
    subPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS ||
    subPhase === SubPhase.RESULT_SCORE_CONFIRM ||
    subPhase === SubPhase.RESULT_ANIMATION ||
    subPhase === SubPhase.RESULT_SETTLEMENT
  );
}
