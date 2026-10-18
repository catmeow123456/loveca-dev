import { cn } from '@/lib/utils';
import type { Seat } from '@game/online';

export interface JudgmentViewSelection {
  activeSeat: Seat | null;
  viewingSeat: Seat | null;
}

export function resolveJudgmentViewingSeat(
  selection: JudgmentViewSelection,
  activeSeat: Seat | null
): Seat | null {
  return selection.activeSeat === activeSeat ? selection.viewingSeat : activeSeat;
}

interface JudgmentSeatSwitcherProps {
  firstSeat: Seat;
  activeSeat: Seat;
  viewingSeat: Seat;
  playerNames: Readonly<Record<Seat, string>>;
  onSelect: (seat: Seat) => void;
}

function getOtherSeat(seat: Seat): Seat {
  return seat === 'FIRST' ? 'SECOND' : 'FIRST';
}

export function getJudgmentSeatRoleLabel(seat: Seat, firstSeat: Seat): '先攻' | '后攻' {
  return seat === firstSeat ? '先攻' : '后攻';
}

export function JudgmentSeatSwitcher({
  firstSeat,
  activeSeat,
  viewingSeat,
  playerNames,
  onSelect,
}: JudgmentSeatSwitcherProps) {
  const roleSeats: readonly Seat[] = [firstSeat, getOtherSeat(firstSeat)];

  return (
    <div
      role="group"
      aria-label="切换判定查看玩家"
      className="inline-flex shrink-0 items-center gap-1"
    >
      {roleSeats.map((seat) => {
        const isActive = seat === activeSeat;
        const isViewing = seat === viewingSeat;
        const seatLabel = getJudgmentSeatRoleLabel(seat, firstSeat);
        const playerName = playerNames[seat];

        return (
          <button
            key={seat}
            type="button"
            onClick={() => onSelect(seat)}
            aria-pressed={isViewing}
            aria-label={`查看${seatLabel}玩家 ${playerName} 的判定`}
            aria-description={isActive ? '当前行动方' : undefined}
            title={`查看${seatLabel}玩家 ${playerName} 的判定${isActive ? '（当前行动方）' : ''}`}
            className={cn(
              'relative flex min-h-10 min-w-12 items-center justify-center rounded-md px-3 pb-1 pt-0.5 transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] md:min-h-9',
              isViewing
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            <span className={cn('text-[13px] leading-none', isViewing && 'font-semibold')}>
              {seatLabel}
            </span>
            {isViewing ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-[var(--accent-primary)]"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
