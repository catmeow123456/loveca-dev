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
      className="inline-flex rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_58%,transparent)] p-0.5 shadow-sm"
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
            title={`查看${seatLabel}玩家 ${playerName} 的判定`}
            className={cn(
              'flex min-h-[25px] min-w-[68px] items-center justify-center gap-1 rounded-md border px-2 py-0.5 transition-colors',
              isViewing
                ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_62%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_18%,var(--bg-surface))] text-[var(--accent-primary)] shadow-sm'
                : 'border-transparent text-[var(--text-muted)] hover:bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] hover:text-[var(--text-secondary)]'
            )}
          >
            <span className="text-[14px] leading-none">{seatLabel}</span>
            {isActive ? (
              <span className="rounded bg-[color:color-mix(in_srgb,var(--semantic-info)_18%,transparent)] px-1 py-0.5 text-[9px] leading-none text-[var(--semantic-info)]">
                当前
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
