import type { MatchEndView, Seat } from '@game/online';
import { GameEndReason } from '@game/shared/types/enums';

export interface OnlineMatchEndCopy {
  readonly title: string;
  readonly detail: string;
}

export function getOnlineMatchEndCopy(
  endInfo: MatchEndView,
  viewerSeat: Seat
): OnlineMatchEndCopy {
  if (endInfo.rankedForfeitCause === 'STALL_TIMEOUT') {
    return endInfo.loserSeat === viewerSeat
      ? { title: '操作超时判负', detail: '你连续 3 分钟没有完成对局操作，本局已结束。' }
      : { title: '本局获胜', detail: '对手操作超时，本局已结束。' };
  }

  if (endInfo.rankedForfeitCause === 'DISCONNECT_TIMEOUT') {
    return endInfo.loserSeat === viewerSeat
      ? { title: '断线超时判负', detail: '你未在重连期限内返回，本局已结束。' }
      : { title: '本局获胜', detail: '对手断线超时，本局已结束。' };
  }

  if (endInfo.reason === GameEndReason.OPPONENT_SURRENDER) {
    if (endInfo.loserSeat === viewerSeat) {
      return { title: '你已认输', detail: '本局结束。' };
    }
    if (endInfo.winnerSeat === viewerSeat) {
      return { title: '本局获胜', detail: '对方已认输。' };
    }
  }

  if (endInfo.winnerSeat === viewerSeat) {
    return { title: '本局获胜', detail: '你已达成胜利条件。' };
  }
  if (endInfo.loserSeat === viewerSeat) {
    return { title: '本局结束', detail: '对手已达成胜利条件。' };
  }
  return { title: '本局结束', detail: '本局以平局结束。' };
}
