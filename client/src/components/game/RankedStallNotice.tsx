import { memo, useEffect, useState } from 'react';
import type { RankedStallView, Seat } from '@game/online';

interface RankedStallNoticeProps {
  readonly stall: RankedStallView | null;
  readonly viewerSeat: Seat | null;
}

const MAX_NOTICE_REMAINING_MS = 60 * 1000;

export const RankedStallNotice = memo(function RankedStallNotice({
  stall,
  viewerSeat,
}: RankedStallNoticeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!stall) {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const noticeRemainingMs = Math.min(
      MAX_NOTICE_REMAINING_MS,
      Math.max(0, stall.deadlineAt - stall.startedAt)
    );
    const warningAt = stall.deadlineAt - noticeRemainingMs;
    const startTicking = () => {
      setNow(Date.now());
      intervalId = setInterval(() => setNow(Date.now()), 1_000);
    };
    const delay = Math.max(0, warningAt - Date.now());
    const timeoutId = setTimeout(startTicking, delay);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [stall]);

  if (!stall) {
    return null;
  }

  const remainingMs = Math.max(0, stall.deadlineAt - now);
  const noticeRemainingMs = Math.min(
    MAX_NOTICE_REMAINING_MS,
    Math.max(0, stall.deadlineAt - stall.startedAt)
  );
  if (remainingMs > noticeRemainingMs) {
    return null;
  }

  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  const isResponsiblePlayer = viewerSeat === stall.responsibleSeat;
  const visibleMessage = isResponsiblePlayer
    ? `该你操作了，还剩 ${remainingSeconds} 秒`
    : `等待对手操作，还剩 ${remainingSeconds} 秒`;
  const accessibleMessage = isResponsiblePlayer ? '该你操作了' : '正在等待对手操作';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={accessibleMessage}
      className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+4rem)] z-[90] w-[min(calc(100vw-1.5rem),36rem)] -translate-x-1/2 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-warning)_58%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,var(--semantic-warning))] px-3 py-2 text-center text-xs font-semibold text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl md:top-4 md:text-sm"
    >
      <span aria-hidden="true">{visibleMessage}</span>
    </div>
  );
});
