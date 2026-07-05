import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Loader2, ScrollText } from 'lucide-react';
import { GameBoard } from '@/components/game';
import { PublicBattleLogButton } from '@/components/game/PublicBattleLog';
import { ThemeToggle } from '@/components/common';
import { joinOnlineSpectatorLink } from '@/lib/onlineClient';
import { useGameStore } from '@/store/gameStore';
import type { OnlineSpectatorJoinView, OnlineSpectatorSessionView, Seat } from '@game/online';

const MATCH_POLL_INTERVAL_MS = 800;
const SPECTATOR_CLIENT_ID_STORAGE_PREFIX = 'loveca.online.spectator.client.';

interface OnlineSpectatorPageProps {
  readonly token: string;
  readonly onBackHome: () => void;
}

export function OnlineSpectatorPage({ token, onBackHome }: OnlineSpectatorPageProps) {
  const connectRemoteSession = useGameStore((s) => s.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((s) => s.applyRemoteSnapshot);
  const disconnectRemoteSession = useGameStore((s) => s.disconnectRemoteSession);
  const syncRemoteState = useGameStore((s) => s.syncRemoteState);
  const remoteSession = useGameStore((s) =>
    s.remoteSession?.source === 'SPECTATOR' ? s.remoteSession : null
  );
  const matchView = useGameStore((s) => s.getMatchView());
  const spectatorClientId = useMemo(() => readSpectatorClientId(token), [token]);

  const [sessionView, setSessionView] = useState<OnlineSpectatorSessionView | null>(null);
  const [linkView, setLinkView] = useState<OnlineSpectatorJoinView['link'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsBootstrapping(true);
    setError(null);

    const bootstrap = async () => {
      try {
        const joined = await joinOnlineSpectatorLink(token, { clientId: spectatorClientId });
        if (cancelled) {
          return;
        }

        connectRemoteSession({
          source: 'SPECTATOR',
          matchId: joined.snapshot.matchId,
          seat: joined.snapshot.seat,
          playerId: joined.snapshot.playerId,
          spectatorToken: token,
          spectatorSessionId: joined.session.sessionId,
        });
        await applyRemoteSnapshot(joined.snapshot);
        if (!cancelled) {
          setSessionView(joined.session);
          setLinkView(joined.link);
          setError(null);
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : '进入观战失败');
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      disconnectRemoteSession();
    };
  }, [applyRemoteSnapshot, connectRemoteSession, disconnectRemoteSession, spectatorClientId, token]);

  useEffect(() => {
    if (!remoteSession) {
      return;
    }

    let cancelled = false;
    let polling = false;

    const pollMatch = async () => {
      if (polling) {
        return;
      }

      polling = true;
      try {
        await syncRemoteState();
        if (!cancelled) {
          setError(null);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : '同步观战对局失败');
        }
      } finally {
        polling = false;
      }
    };

    void pollMatch();
    const timer = window.setInterval(() => {
      void pollMatch();
    }, MATCH_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [remoteSession, syncRemoteState]);

  if ((isBootstrapping && !matchView) || (!error && !matchView)) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center">
        <div className="surface-panel-frosted flex items-center gap-3 px-6 py-4 text-[var(--text-primary)]">
          <Loader2 size={18} className="animate-spin" />
          正在进入观战...
        </div>
      </div>
    );
  }

  if (error && !matchView) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4">
        <div className="surface-panel-frosted w-full max-w-md p-5">
          <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--semantic-error)]">
            <Eye size={16} />
            观战不可用
          </div>
          <div className="text-sm leading-6 text-[var(--text-secondary)]">{error}</div>
          <button
            type="button"
            onClick={onBackHome}
            className="button-primary mt-5 inline-flex min-h-10 items-center gap-2 px-4"
          >
            <ArrowLeft size={16} />
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const viewerName =
    linkView && matchView
      ? matchView.participants[linkView.viewerSeat]?.name ?? getSeatLabel(linkView.viewerSeat)
      : null;

  return (
    <div className="relative h-screen overflow-hidden">
      <div className="absolute left-4 top-4 z-[120] flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBackHome}
          className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 text-sm shadow-[var(--shadow-md)] backdrop-blur-xl"
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent-primary)_38%,transparent)] bg-[var(--bg-frosted)] px-3 text-sm font-semibold text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl">
          <Eye size={16} className="text-[var(--accent-primary)]" />
          玩家视角观战
          {viewerName ? <span className="text-[var(--text-secondary)]">· {viewerName}</span> : null}
        </div>
        {sessionView ? (
          <div className="hidden min-h-10 items-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 text-xs text-[var(--text-secondary)] shadow-[var(--shadow-md)] backdrop-blur-xl sm:inline-flex">
            {sessionView.displayName}
          </div>
        ) : null}
        <PublicBattleLogButton />
        <div className="hidden md:block">
          <ThemeToggle />
        </div>
      </div>
      {error ? (
        <div className="absolute right-4 top-4 z-[120] hidden max-w-sm rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[var(--bg-frosted)] px-3 py-2 text-xs text-[var(--semantic-error)] shadow-[var(--shadow-md)] backdrop-blur-xl md:block">
          {error}
        </div>
      ) : null}
      <GameBoard showDesktopPublicBattleLogButton={false} />
      <div className="absolute bottom-4 left-4 z-[90] hidden items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-[var(--shadow-md)] backdrop-blur-xl md:inline-flex">
        <ScrollText size={14} />
        只读观战
      </div>
    </div>
  );
}

function getSeatLabel(seat: Seat): string {
  return seat === 'FIRST' ? '先攻视角' : '后攻视角';
}

function readSpectatorClientId(token: string): string {
  const storageKey = `${SPECTATOR_CLIENT_ID_STORAGE_PREFIX}${encodeURIComponent(token)}`;
  try {
    const existing = window.sessionStorage.getItem(storageKey)?.trim();
    if (existing) {
      return existing;
    }
    const next = createSpectatorClientId();
    window.sessionStorage.setItem(storageKey, next);
    return next;
  } catch {
    return createSpectatorClientId();
  }
}

function createSpectatorClientId(): string {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
