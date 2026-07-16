import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Loader2, ScrollText, SwitchCamera } from 'lucide-react';
import { BattleViewportShell, GameBoard } from '@/components/game';
import { PublicBattleLogButton } from '@/components/game/PublicBattleLog';
import { ThemeToggle } from '@/components/common';
import { joinOnlineSpectatorLink, switchOnlineSpectatorView } from '@/lib/onlineClient';
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
  const [isSwitchingView, setIsSwitchingView] = useState(false);
  const [isAccessInvalid, setIsAccessInvalid] = useState(false);

  useEffect(() => {
    const previousReferrer = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    const previousRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousReferrerContent = previousReferrer?.content;
    const previousRobotsContent = previousRobots?.content;
    const referrer = previousReferrer ?? document.createElement('meta');
    const robots = previousRobots ?? document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    robots.name = 'robots';
    robots.content = 'noindex,nofollow,noarchive';
    if (!previousReferrer) document.head.appendChild(referrer);
    if (!previousRobots) document.head.appendChild(robots);
    return () => {
      if (previousReferrer) previousReferrer.content = previousReferrerContent ?? '';
      else referrer.remove();
      if (previousRobots) previousRobots.content = previousRobotsContent ?? '';
      else robots.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsBootstrapping(true);
    setError(null);
    setIsAccessInvalid(false);

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
          spectatorAuthorizedViewerSeats: joined.session.authorizedViewerSeats,
          spectatorViewVersion: joined.session.viewVersion,
          spectatorAuthorizationNotice: joined.snapshot.spectatorView.authorizationNotice,
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
  }, [
    applyRemoteSnapshot,
    connectRemoteSession,
    disconnectRemoteSession,
    spectatorClientId,
    token,
  ]);

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
          const message = pollError instanceof Error ? pollError.message : '同步观战对局失败';
          setError(message);
          if (isInvalidSpectatorAccessMessage(message)) {
            setIsAccessInvalid(true);
          }
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

  const handleSwitchView = async (viewerSeat: Seat) => {
    if (
      !remoteSession?.spectatorToken ||
      !remoteSession.spectatorSessionId ||
      remoteSession.seat === viewerSeat ||
      isSwitchingView
    ) {
      return;
    }

    setIsSwitchingView(true);
    setError(null);
    try {
      const switched = await switchOnlineSpectatorView(
        remoteSession.spectatorToken,
        remoteSession.spectatorSessionId,
        viewerSeat
      );
      connectRemoteSession({
        ...remoteSession,
        seat: switched.snapshot.spectatorView.currentViewerSeat,
        playerId: switched.snapshot.playerId,
        spectatorAuthorizedViewerSeats: switched.snapshot.spectatorView.authorizedViewerSeats,
        spectatorViewVersion: switched.snapshot.spectatorView.viewVersion,
        spectatorAuthorizationNotice: switched.snapshot.spectatorView.authorizationNotice,
      });
      await applyRemoteSnapshot(switched.snapshot);
      setSessionView(switched.session);
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : '切换观战视角失败');
    } finally {
      setIsSwitchingView(false);
    }
  };

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

  if ((error && !matchView) || isAccessInvalid) {
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
    remoteSession?.seat && matchView
      ? (matchView.participants[remoteSession.seat]?.name ?? getSeatLabel(remoteSession.seat))
      : null;
  const authorizedViewerSeats =
    remoteSession?.spectatorAuthorizedViewerSeats ?? linkView?.authorizedViewerSeats ?? [];

  return (
    <BattleViewportShell>
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
        {authorizedViewerSeats.length > 1 ? (
          <div className="inline-flex min-h-10 items-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-frosted)] p-1 shadow-[var(--shadow-md)] backdrop-blur-xl">
            {authorizedViewerSeats.map((seat) => (
              <button
                key={seat}
                type="button"
                onClick={() => void handleSwitchView(seat)}
                disabled={isSwitchingView || remoteSession?.seat === seat}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
                  remoteSession?.seat === seat
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]'
                }`}
              >
                {isSwitchingView && remoteSession?.seat !== seat ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <SwitchCamera size={13} />
                )}
                {getSeatLabel(seat)}
              </button>
            ))}
          </div>
        ) : null}
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
      {!error && remoteSession?.spectatorAuthorizationNotice ? (
        <div className="absolute right-4 top-4 z-[120] max-w-sm rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-warning)_42%,transparent)] bg-[var(--bg-frosted)] px-3 py-2 text-xs leading-5 text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl">
          {remoteSession.spectatorAuthorizationNotice.message}
        </div>
      ) : null}
      {isSwitchingView ? (
        <div className="absolute inset-0 z-[110] flex items-center justify-center bg-[var(--bg-base)]">
          <div className="surface-panel-frosted flex items-center gap-3 px-6 py-4 text-sm text-[var(--text-primary)]">
            <Loader2 size={18} className="animate-spin" />
            正在切换观战视角...
          </div>
        </div>
      ) : (
        <GameBoard showDesktopPublicBattleLogButton={false} />
      )}
      <div className="absolute bottom-4 left-4 z-[90] hidden items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-[var(--shadow-md)] backdrop-blur-xl md:inline-flex">
        <ScrollText size={14} />
        只读观战
      </div>
    </BattleViewportShell>
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

function isInvalidSpectatorAccessMessage(message: string): boolean {
  return /观战链接不存在|观战链接已过期|观战会话已失效|观战对局不存在|观战授权已关闭|观战授权已被分享者关闭/.test(
    message
  );
}
