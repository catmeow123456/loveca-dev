import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Loader2, ScanLine } from 'lucide-react';
import {
  ActionButton,
  Panel,
  ProductFrame,
  ProductHeader,
  SectionHeading,
  SiteLegalFooter,
  StatusBadge,
  TextInput,
  ThemeToggle,
  type ProductNavigationHandlers,
} from '@/components/common';
import {
  createOnlineRoomSpectatorEntryLink,
  fetchOnlineRoomSpectatorEntry,
} from '@/lib/onlineClient';
import type { OnlineRoomSpectatorEntryView, Seat } from '@game/online';
import { LatestRequestGate } from '@/lib/asyncRequestControl';
import './online-spectator-lobby.css';

interface OnlineSpectatorLobbyPageProps {
  readonly onBackHome: () => void;
  readonly navigation?: ProductNavigationHandlers;
  readonly headerActions?: ReactNode;
  readonly mobileMenuActions?: ReactNode;
}

export function OnlineSpectatorLobbyPage({
  onBackHome,
  navigation,
  headerActions,
  mobileMenuActions,
}: OnlineSpectatorLobbyPageProps) {
  const [roomCodeInput, setRoomCodeInput] = useState(() => readInitialRoomCode());
  const [entry, setEntry] = useState<OnlineRoomSpectatorEntryView | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEntering, setIsEntering] = useState(false);
  const lookupRequestGateRef = useRef(new LatestRequestGate());

  const enabledSeats = useMemo(
    () => entry?.seats.filter((seat) => seat.enabled) ?? [],
    [entry?.seats]
  );
  const selectedSeatView = enabledSeats.find((seat) => seat.seat === selectedSeat) ?? null;
  const canEnter = Boolean(entry && selectedSeatView && !isEntering && !isLoading);

  const handleLookup = async () => {
    const roomCode = normalizeRoomCode(roomCodeInput);
    if (roomCode.length < 4) {
      lookupRequestGateRef.current.invalidate();
      setIsLoading(false);
      setError('请输入 4 到 12 位房间号');
      setEntry(null);
      setSelectedSeat(null);
      return;
    }

    const requestGeneration = lookupRequestGateRef.current.begin();
    setIsLoading(true);
    setError(null);
    try {
      const nextEntry = await fetchOnlineRoomSpectatorEntry(roomCode);
      if (!lookupRequestGateRef.current.isCurrent(requestGeneration)) {
        return;
      }
      const nextEnabledSeats = nextEntry.seats.filter((seat) => seat.enabled);
      setEntry(nextEntry);
      setSelectedSeat(nextEnabledSeats[0]?.seat ?? null);
      setRoomCodeInput(nextEntry.roomCode);
      if (nextEnabledSeats.length === 0) {
        setError('该房间当前未开放房间号观战');
      }
    } catch (lookupError) {
      if (!lookupRequestGateRef.current.isCurrent(requestGeneration)) {
        return;
      }
      setEntry(null);
      setSelectedSeat(null);
      setError(lookupError instanceof Error ? lookupError.message : '读取房间号观战入口失败');
    } finally {
      if (lookupRequestGateRef.current.isCurrent(requestGeneration)) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!roomCodeInput) {
      return;
    }
    const timer = window.setTimeout(() => void handleLookup(), 0);
    return () => window.clearTimeout(timer);
    // Run only once for a room code supplied by URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      lookupRequestGateRef.current.invalidate();
    },
    []
  );

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

  const pageContent = (
    <main className="spectator-lobby-main">
      <Panel
        as="section"
        padding="none"
        className={`spectator-lobby-desk ${navigation ? 'spectator-lobby-desk--compact' : ''}`}
      >
        {!navigation ? (
          <header className="spectator-lobby-intro">
            <span>SPECTATOR DESK</span>
            <h1>房间观战</h1>
            <p>输入房间号观看对局。</p>
          </header>
        ) : null}

        <div className="spectator-lobby-console">
          <SectionHeading
            className="spectator-lobby-section-heading"
            eyebrow="ROOM LOOKUP"
            title="查找对局"
            description="房间号由创建房间的玩家提供。"
          />

          <form onSubmit={handleSubmit} className="spectator-lobby-search">
            <TextInput
              value={roomCodeInput}
              onChange={(event) => {
                lookupRequestGateRef.current.invalidate();
                setIsLoading(false);
                setRoomCodeInput(event.target.value.toUpperCase());
                setEntry(null);
                setSelectedSeat(null);
                setError(null);
              }}
              className="spectator-lobby-room-input"
              placeholder="例如 ABCD12"
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
              aria-label="房间号"
            />
            <ActionButton
              type="submit"
              disabled={isLoading || isEntering}
              className="spectator-lobby-search-button"
            >
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
              查找
            </ActionButton>
          </form>

          <SectionHeading
            className="spectator-lobby-section-heading spectator-lobby-section-heading--seats"
            eyebrow="PLAYER VIEW"
            title="选择观看视角"
          />
          <SeatScanner entry={entry} selectedSeat={selectedSeat} onSelectSeat={setSelectedSeat} />

          {error ? (
            <div className="spectator-lobby-error" role="alert">
              {error}
            </div>
          ) : null}

          <footer className="spectator-lobby-actions">
            <div>{entry ? `房间 ${entry.roomCode} · ${enabledSeats.length} 个视角开放` : ''}</div>
            <ActionButton
              type="button"
              onClick={() => void handleEnter()}
              disabled={!canEnter}
              className="spectator-lobby-enter-button"
            >
              {isEntering ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              进入观战
            </ActionButton>
          </footer>
        </div>
      </Panel>
    </main>
  );

  if (navigation) {
    return (
      <ProductFrame
        active="spectate"
        navigation={navigation}
        actions={headerActions}
        mobileMenuActions={mobileMenuActions}
        title="房间观战"
        description="输入房间号"
        backLabel="返回大厅"
        onBack={onBackHome}
        className="spectator-lobby-page"
      >
        {pageContent}
      </ProductFrame>
    );
  }

  return (
    <div className="app-shell spectator-lobby-page flex min-h-screen flex-col overflow-x-hidden">
      <ProductHeader
        brandAriaLabel="返回 Loveca 首页"
        brandHref="/"
        actions={
          <>
            <button type="button" onClick={onBackHome} className="spectator-lobby-header-back">
              <ArrowLeft size={15} aria-hidden="true" />
              返回首页
            </button>
            <ThemeToggle />
          </>
        }
      />
      {pageContent}
      <SiteLegalFooter />
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
    <div className="spectator-seat-scanner">
      <div className="spectator-seat-grid">
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
              className={`spectator-seat ${
                selected
                  ? 'spectator-seat--selected'
                  : enabled
                    ? 'spectator-seat--enabled'
                    : 'spectator-seat--disabled'
              }`}
            >
              <div className="spectator-seat__topline">
                <div>{getSeatLabel(seat)}</div>
                <StatusBadge
                  tone={enabled ? 'success' : 'neutral'}
                  className="spectator-seat__status"
                >
                  {enabled ? '开放' : '关闭'}
                </StatusBadge>
              </div>
              <div className="spectator-seat__player">
                {seatView?.displayName ?? '输入房间号后显示玩家'}
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
