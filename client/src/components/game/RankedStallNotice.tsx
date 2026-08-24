import { memo, useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { RankedStallView, Seat } from '@game/online';
import { cn } from '@/lib/utils';

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
  const isCritical = remainingSeconds <= 10;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const countdown = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const visibleMessage = isResponsiblePlayer ? '轮到你操作' : '等待对手操作';

  return (
    <div
      className={cn(
        'pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+4rem)] z-[90] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-lg border bg-[var(--bg-frosted)] px-2.5 py-2 text-xs font-semibold text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl md:text-sm',
        isCritical
          ? 'border-[color:color-mix(in_srgb,var(--semantic-error)_70%,var(--border-default))]'
          : isResponsiblePlayer
            ? 'border-[color:color-mix(in_srgb,var(--semantic-warning)_58%,var(--border-default))]'
            : 'border-[color:color-mix(in_srgb,var(--semantic-info)_42%,var(--border-default))]'
      )}
    >
      <Clock3
        size={16}
        aria-hidden="true"
        className={cn(
          'shrink-0',
          isCritical
            ? 'text-[var(--semantic-error)]'
            : isResponsiblePlayer
              ? 'text-[var(--semantic-warning)]'
              : 'text-[var(--semantic-info)]'
        )}
      />
      <span role="status" aria-live="polite" className="whitespace-nowrap">
        {visibleMessage}
      </span>
      <time
        role="timer"
        aria-live="off"
        aria-label={`剩余 ${remainingSeconds} 秒`}
        dateTime={`PT${remainingSeconds}S`}
        className={cn(
          'inline-flex min-w-[5.25ch] justify-center rounded-md border px-1.5 py-0.5 font-mono text-xs font-bold leading-none tabular-nums md:text-sm',
          isCritical
            ? 'border-[color:color-mix(in_srgb,var(--semantic-error)_36%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_14%,transparent)] text-[var(--semantic-error)]'
            : isResponsiblePlayer
              ? 'border-[color:color-mix(in_srgb,var(--semantic-warning)_32%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_12%,transparent)]'
              : 'border-[color:color-mix(in_srgb,var(--semantic-info)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-info)_10%,transparent)]'
        )}
      >
        {countdown}
      </time>
    </div>
  );
});
