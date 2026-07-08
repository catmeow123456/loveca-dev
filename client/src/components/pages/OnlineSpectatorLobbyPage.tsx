import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, ScanLine } from 'lucide-react';
import { ThemeToggle } from '@/components/common';
import {
  createOnlineRoomSpectatorEntryLink,
  fetchOnlineRoomSpectatorEntry,
} from '@/lib/onlineClient';
import type { OnlineRoomSpectatorEntryView, Seat } from '@game/online';

interface OnlineSpectatorLobbyPageProps {
  readonly onBackHome: () => void;
}

export function OnlineSpectatorLobbyPage({ onBackHome }: OnlineSpectatorLobbyPageProps) {
  const [roomCodeInput, setRoomCodeInput] = useState(() => readInitialRoomCode());
  const [entry, setEntry] = useState<OnlineRoomSpectatorEntryView | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEntering, setIsEntering] = useState(false);

  const enabledSeats = useMemo(
    () => entry?.seats.filter((seat) => seat.enabled) ?? [],
    [entry?.seats]
  );
  const selectedSeatView = enabledSeats.find((seat) => seat.seat === selectedSeat) ?? null;
  const canEnter = Boolean(entry && selectedSeatView && !isEntering && !isLoading);

  useEffect(() => {
    if (!roomCodeInput) {
      return;
    }
    void handleLookup();
    // Run only once for a room code supplied by URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLookup = async () => {
    const roomCode = normalizeRoomCode(roomCodeInput);
    if (!roomCode) {
      setError('请输入 4 到 12 位房间号');
      setEntry(null);
      setSelectedSeat(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const nextEntry = await fetchOnlineRoomSpectatorEntry(roomCode);
      const nextEnabledSeats = nextEntry.seats.filter((seat) => seat.enabled);
      setEntry(nextEntry);
      setSelectedSeat(nextEnabledSeats[0]?.seat ?? null);
      setRoomCodeInput(nextEntry.roomCode);
      if (nextEnabledSeats.length === 0) {
        setError('该房间当前未开放房间号观战');
      }
    } catch (lookupError) {
      setEntry(null);
      setSelectedSeat(null);
      setError(lookupError instanceof Error ? lookupError.message : '读取房间号观战入口失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnter = async () => {
    const roomCode = entry?.roomCode ?? normalizeRoomCode(roomCodeInput);
    if (!roomCode || !selectedSeatView) {
      return;
    }

    setIsEntering(true);
    setError(null);
    try {
      const link = await createOnlineRoomSpectatorEntryLink(roomCode, selectedSeatView.seat);
      window.location.href = `${window.location.origin}${link.path}`;
    } catch (enterError) {
      setError(enterError instanceof Error ? enterError.message : '进入房间号观战失败');
    } finally {
      setIsEntering(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleLookup();
  };

  return (
    <div className="app-shell flex min-h-screen flex-col overflow-x-hidden">
      <header className="relative z-10 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="button-ghost inline-flex min-h-10 items-center gap-2 px-3 text-sm"
          >
            <ArrowLeft size={16} />
            返回
          </button>
          <div className="flex items-center gap-2">
            <div className="hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] sm:block">
              房间号观战
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-5 sm:px-6">
        <section className="surface-panel-frosted flex w-full max-w-3xl flex-col gap-5 p-5 sm:p-6">
          <h1 className="text-2xl font-bold leading-tight text-[var(--text-primary)] sm:text-3xl">
            输入房间号观战
          </h1>

          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={roomCodeInput}
              onChange={(event) => {
                setRoomCodeInput(event.target.value.toUpperCase());
                setEntry(null);
                setSelectedSeat(null);
                setError(null);
              }}
              className="h-12 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] px-4 text-lg font-bold tracking-[0.18em] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent-primary)_20%,transparent)]"
              placeholder="房间号"
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
              aria-label="房间号"
            />
            <button
              type="submit"
              disabled={isLoading || isEntering}
              className="button-primary inline-flex h-12 items-center justify-center gap-2 px-5 text-sm"
            >
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
              查找
            </button>
          </form>

          <SeatScanner entry={entry} selectedSeat={selectedSeat} onSelectSeat={setSelectedSeat} />

          {error ? (
            <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_36%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_10%,transparent)] px-4 py-3 text-sm text-[var(--semantic-error)]">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs leading-5 text-[var(--text-muted)]">
              {entry ? `房间 ${entry.roomCode} · ${enabledSeats.length} 个视角开放` : ''}
            </div>
            <button
              type="button"
              onClick={() => void handleEnter()}
              disabled={!canEnter}
              className={`button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 ${
                !canEnter ? 'cursor-not-allowed opacity-55' : ''
              }`}
            >
              {isEntering ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              进入观战
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function SeatScanner({
  entry,
  selectedSeat,
  onSelectSeat,
}: {
  readonly entry: OnlineRoomSpectatorEntryView | null;
  readonly selectedSeat: Seat | null;
  readonly onSelectSeat: (seat: Seat) => void;
}) {
  const seats = entry?.seats ?? [];

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {(['FIRST', 'SECOND'] as const).map((seat) => {
          const seatView = seats.find((candidate) => candidate.seat === seat) ?? null;
          const enabled = seatView?.enabled === true;
          const selected = selectedSeat === seat;
          return (
            <button
              key={seat}
              type="button"
              onClick={() => enabled && onSelectSeat(seat)}
              disabled={!enabled}
              className={`min-h-[5.5rem] rounded-lg border px-4 py-3 text-left transition ${
                selected
                  ? 'border-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_13%,transparent)] shadow-[var(--shadow-sm)]'
                  : enabled
                    ? 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[color:color-mix(in_srgb,var(--accent-primary)_45%,var(--border-default))]'
                    : 'cursor-not-allowed border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-muted)_65%,transparent)] opacity-65'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-bold text-[var(--text-primary)]">
                  {getSeatLabel(seat)}
                </div>
                <div
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                    enabled
                      ? 'border-[color:color-mix(in_srgb,var(--semantic-success)_45%,transparent)] text-[var(--semantic-success)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-muted)]'
                  }`}
                >
                  {enabled ? '开放' : '关闭'}
                </div>
              </div>
              <div className="mt-3 truncate text-xs text-[var(--text-secondary)]">
                {seatView?.displayName ?? '等待对局'}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function normalizeRoomCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function readInitialRoomCode(): string {
  const value = new URLSearchParams(window.location.search).get('room');
  return value ? normalizeRoomCode(value) : '';
}

function getSeatLabel(seat: Seat): string {
  return seat === 'FIRST' ? '先攻视角' : '后攻视角';
}
