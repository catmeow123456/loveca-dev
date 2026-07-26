import type { Seat } from '@game/online';
import { SubPhase } from '@game/shared/types/enums';

export function buildScoreConfirmStateKey(
  matchId: string,
  turnCount: number,
  viewerSeat: Seat
): string {
  return `${matchId}:${turnCount}:${SubPhase.RESULT_SCORE_CONFIRM}:${viewerSeat}`;
}
