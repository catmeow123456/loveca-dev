import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Eye, Loader2, SwitchCamera } from 'lucide-react';
import { BattleViewportShell, GameBoard } from '@/components/game';
import { PublicBattleLogButton } from '@/components/game/PublicBattleLog';
import { ThemeToggle } from '@/components/common';
import {
  fetchOnlineSpectatorSnapshotResponse,
  joinOnlineSpectatorLink,
  switchOnlineSpectatorView,
} from '@/lib/onlineClient';
import { ApiClientError } from '@/lib/apiClient';
import { SpectatorPollingScheduler, type SpectatorPollingErrorState } from '@/lib/spectatorPolling';
import { useGameStore } from '@/store/gameStore';
import type {
  OnlineSpectatorJoinView,
  OnlineSpectatorMatchSnapshot,
  OnlineSpectatorSessionView,
  OnlineSpectatorSnapshotResponse,
  OnlineSpectatorWaitingView,
  Seat,
} from '@game/online';

const MATCH_POLL_INTERVAL_MS = 800;
const SPECTATOR_CLIENT_ID_STORAGE_PREFIX = 'loveca.online.spectator.client.';
type SpectatorContinuityStatus = 'WATCHING_MATCH' | 'WAITING_NEXT_MATCH' | 'SWITCHING_MATCH';

interface OnlineSpectatorPageProps {
  readonly token: string;
  readonly onBackHome: () => void;
}

export function OnlineSpectatorPage({ token, onBackHome }: OnlineSpectatorPageProps) {
  const connectRemoteSession = useGameStore((s) => s.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((s) => s.applyRemoteSnapshot);
  const applySpectatorViewSession = useGameStore((s) => s.applySpectatorViewSession);
  const disconnectRemoteSession = useGameStore((s) => s.disconnectRemoteSession);
  const invalidateSpectatorSync = useGameStore((s) => s.invalidateSpectatorSync);
  const syncPublicBattleLog = useGameStore((s) => s.syncPublicBattleLog);
  const remoteSession = useGameStore((s) =>
    s.remoteSession?.source === 'SPECTATOR' ? s.remoteSession : null
  );
  const matchView = useGameStore((s) => s.getMatchView());
  const spectatorClientId = useMemo(() => readSpectatorClientId(token), [token]);
  const pollingSchedulerRef = useRef<SpectatorPollingScheduler | null>(null);
  const attachmentGenerationRef = useRef(0);
  const waitingGenerationRef = useRef<number | null>(null);

  const [sessionView, setSessionView] = useState<OnlineSpectatorSessionView | null>(null);
  const [linkView, setLinkView] = useState<OnlineSpectatorJoinView['link'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSwitchingView, setIsSwitchingView] = useState(false);
  const [isAccessInvalid, setIsAccessInvalid] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [continuityStatus, setContinuityStatus] =
    useState<SpectatorContinuityStatus>('WATCHING_MATCH');
  const [waitingView, setWaitingView] = useState<OnlineSpectatorWaitingView | null>(null);

  const spectatorSessionId = sessionView?.sessionId ?? null;

  const handlePollingError = useCallback((state: SpectatorPollingErrorState) => {
    if (state.kind === 'RATE_LIMITED') {
      setError(null);
      setSyncNotice('观战同步暂时繁忙，正在自动恢复');
      return;
    }
    if (state.kind === 'NETWORK') {
      setError(null);
      setSyncNotice('观战同步中断，正在重新连接');
      return;
    }
    setSyncNotice(null);
    const message = state.error instanceof Error ? state.error.message : '同步观战对局失败';
    setError(message);
    if (isInvalidSpectatorAccessError(state.error)) {
      setIsAccessInvalid(true);
      pollingSchedulerRef.current?.pause();
    }
  }, []);

  const applyWaitingState = useCallback(
    (waiting: OnlineSpectatorWaitingView) => {
      if (waiting.attachmentGeneration < attachmentGenerationRef.current) {
        return false;
      }
      attachmentGenerationRef.current = waiting.attachmentGeneration;
      if (waitingGenerationRef.current !== waiting.attachmentGeneration) {
        waitingGenerationRef.current = waiting.attachmentGeneration;
        disconnectRemoteSession();
      }
      setWaitingView((current) =>
        current &&
        current.roomGeneration === waiting.roomGeneration &&
        current.attachmentGeneration === waiting.attachmentGeneration &&
        current.preferredViewerDisplayName === waiting.preferredViewerDisplayName &&
        current.effectiveViewerDisplayName === waiting.effectiveViewerDisplayName
          ? current
          : waiting
      );
      setContinuityStatus('WAITING_NEXT_MATCH');
      setSessionView((current) =>
        current &&
        (current.viewerSeat !== null ||
          current.authorizedViewerSeats.length > 0 ||
          current.attachmentGeneration !== waiting.attachmentGeneration ||
          current.preferredViewerDisplayName !== waiting.preferredViewerDisplayName ||
          current.effectiveViewerDisplayName !== waiting.effectiveViewerDisplayName)
          ? {
              ...current,
              viewerSeat: null,
              authorizedViewerSeats: [],
              attachmentGeneration: waiting.attachmentGeneration,
              preferredViewerDisplayName: waiting.preferredViewerDisplayName,
              effectiveViewerDisplayName: waiting.effectiveViewerDisplayName,
            }
          : current
      );
      setError(null);
      return true;
    },
    [disconnectRemoteSession]
  );

  const applyWatchingSnapshot = useCallback(
    async (
      snapshot: OnlineSpectatorMatchSnapshot,
      activeSessionId: string,
      isContextCurrent: () => boolean = () => true
    ) => {
      const spectatorView = snapshot.spectatorView;
      if (
        !isContextCurrent() ||
        spectatorView.attachmentGeneration < attachmentGenerationRef.current
      ) {
        return false;
      }
      const currentRemoteSession = useGameStore.getState().remoteSession;
      const matchChanged =
        currentRemoteSession?.source !== 'SPECTATOR' ||
        currentRemoteSession.matchId !== snapshot.matchId ||
        currentRemoteSession.spectatorAttachmentGeneration !== spectatorView.attachmentGeneration;
      if (matchChanged) {
        setContinuityStatus('SWITCHING_MATCH');
        connectRemoteSession({
          source: 'SPECTATOR',
          matchId: snapshot.matchId,
          seat: snapshot.seat,
          playerId: snapshot.playerId,
          spectatorToken: token,
          spectatorSessionId: activeSessionId,
          spectatorAuthorizedViewerSeats: spectatorView.authorizedViewerSeats,
          spectatorViewVersion: spectatorView.viewVersion,
          spectatorAuthorizationNotice: spectatorView.authorizationNotice,
          spectatorRoomCode: spectatorView.roomCode,
          spectatorRoomGeneration: spectatorView.roomGeneration,
          spectatorAttachmentGeneration: spectatorView.attachmentGeneration,
        });
      } else if (
        currentRemoteSession.seat !== spectatorView.currentViewerSeat ||
        currentRemoteSession.playerId !== snapshot.playerId ||
        currentRemoteSession.spectatorViewVersion !== spectatorView.viewVersion
      ) {
        applySpectatorViewSession({
          seat: spectatorView.currentViewerSeat,
          playerId: snapshot.playerId,
          authorizedViewerSeats: spectatorView.authorizedViewerSeats,
          viewVersion: spectatorView.viewVersion,
          authorizationNotice: spectatorView.authorizationNotice,
          roomCode: spectatorView.roomCode,
          roomGeneration: spectatorView.roomGeneration,
          attachmentGeneration: spectatorView.attachmentGeneration,
        });
      }
      await applyRemoteSnapshot(snapshot);
      if (!isContextCurrent()) {
        return false;
      }
      attachmentGenerationRef.current = spectatorView.attachmentGeneration;
      waitingGenerationRef.current = null;
      setSessionView((current) =>
        current
          ? {
              ...current,
              viewerSeat: spectatorView.currentViewerSeat,
              authorizedViewerSeats: spectatorView.authorizedViewerSeats,
              attachmentGeneration: spectatorView.attachmentGeneration,
              preferredViewerDisplayName: spectatorView.preferredViewerDisplayName,
              effectiveViewerDisplayName: spectatorView.effectiveViewerDisplayName,
              viewVersion: spectatorView.viewVersion,
              lastSeenAt: Date.now(),
            }
          : current
      );
      setWaitingView(null);
      setContinuityStatus('WATCHING_MATCH');
      setError(null);
      return true;
    },
    [applyRemoteSnapshot, applySpectatorViewSession, connectRemoteSession, token]
  );

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
    attachmentGenerationRef.current = 0;
    waitingGenerationRef.current = null;

    const bootstrap = async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }
      setIsBootstrapping(true);
      setError(null);
      setIsAccessInvalid(false);
      setSyncNotice(null);
      setSessionView(null);
      setLinkView(null);
      setWaitingView(null);
      setContinuityStatus('WATCHING_MATCH');
      try {
        const joined = await joinOnlineSpectatorLink(token, { clientId: spectatorClientId });
        if (cancelled) {
          return;
        }

        setSessionView(joined.session);
        setLinkView(joined.link);
        if (isSpectatorWaitingView(joined.snapshot)) {
          applyWaitingState(joined.snapshot);
        } else {
          await applyWatchingSnapshot(joined.snapshot, joined.session.sessionId, () => !cancelled);
        }
        if (!cancelled) {
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
  }, [applyWaitingState, applyWatchingSnapshot, disconnectRemoteSession, spectatorClientId, token]);

  useEffect(() => {
    if (!spectatorSessionId) {
      return;
    }

    const scheduler = new SpectatorPollingScheduler({
      intervalMs: MATCH_POLL_INTERVAL_MS,
      poll: async (isCurrent) => {
        const store = useGameStore.getState();
        const currentRemoteSession =
          store.remoteSession?.source === 'SPECTATOR' ? store.remoteSession : null;
        const response = await fetchOnlineSpectatorSnapshotResponse(
          token,
          spectatorSessionId,
          continuityStatus === 'WATCHING_MATCH' ? store.playerViewState?.match.seq : undefined,
          continuityStatus === 'WATCHING_MATCH'
            ? currentRemoteSession?.spectatorViewVersion
            : undefined,
          currentRemoteSession?.spectatorRoomGeneration ?? waitingView?.roomGeneration,
          attachmentGenerationRef.current || undefined
        );
        if (!isCurrent()) {
          return;
        }
        if (isSpectatorWaitingView(response)) {
          applyWaitingState(response);
          return;
        }
        if (isSpectatorSnapshotNotModified(response)) {
          if (response.spectatorView.attachmentGeneration < attachmentGenerationRef.current) {
            return;
          }
          attachmentGenerationRef.current = response.spectatorView.attachmentGeneration;
          await syncPublicBattleLog();
          return;
        }
        await applyWatchingSnapshot(response, spectatorSessionId, isCurrent);
      },
      onSuccess: () => {
        setError(null);
        setSyncNotice(null);
      },
      onError: handlePollingError,
    });
    pollingSchedulerRef.current = scheduler;
    scheduler.start();

    return () => {
      scheduler.dispose();
      if (pollingSchedulerRef.current === scheduler) {
        pollingSchedulerRef.current = null;
      }
    };
  }, [
    applyWaitingState,
    applyWatchingSnapshot,
    continuityStatus,
    handlePollingError,
    spectatorSessionId,
    syncPublicBattleLog,
    token,
    waitingView?.roomGeneration,
  ]);

  const handleSwitchView = async (viewerSeat: Seat) => {
    if (
      !remoteSession?.spectatorToken ||
      !remoteSession.spectatorSessionId ||
      remoteSession.seat === viewerSeat ||
      isSwitchingView ||
      continuityStatus !== 'WATCHING_MATCH'
    ) {
      return;
    }

    setIsSwitchingView(true);
    setError(null);
    setSyncNotice(null);
    pollingSchedulerRef.current?.pause();
    invalidateSpectatorSync();
    const switchToken = remoteSession.spectatorToken;
    const switchSessionId = remoteSession.spectatorSessionId;
    const switchGeneration = useGameStore.getState().remoteSession?.spectatorSyncGeneration;
    const isSwitchContextCurrent = () => {
      const currentSession = useGameStore.getState().remoteSession;
      return (
        currentSession?.source === 'SPECTATOR' &&
        currentSession.spectatorToken === switchToken &&
        currentSession.spectatorSessionId === switchSessionId &&
        currentSession.spectatorSyncGeneration === switchGeneration
      );
    };
    try {
      const switched = await switchOnlineSpectatorView(switchToken, switchSessionId, viewerSeat);
      if (!isSwitchContextCurrent()) {
        return;
      }
      await applyWatchingSnapshot(switched.snapshot, switchSessionId, isSwitchContextCurrent);
      if (!isSwitchContextCurrent()) {
        return;
      }
      setSessionView(switched.session);
      pollingSchedulerRef.current?.resume();
    } catch (switchError) {
      if (!isSwitchContextCurrent()) {
        return;
      }
      if (isInvalidSpectatorAccessError(switchError)) {
        setIsAccessInvalid(true);
        setError(switchError instanceof Error ? switchError.message : '切换观战视角失败');
        pollingSchedulerRef.current?.pause();
      } else if (isRetryableSpectatorError(switchError)) {
        pollingSchedulerRef.current?.resume(switchError);
      } else {
        setError(switchError instanceof Error ? switchError.message : '切换观战视角失败');
        pollingSchedulerRef.current?.resume();
      }
    } finally {
      setIsSwitchingView(false);
    }
  };

  if (
    !isBootstrapping &&
    continuityStatus === 'WAITING_NEXT_MATCH' &&
    !matchView &&
    !error &&
    !isAccessInvalid
  ) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4">
        <SpectatorWaitingPanel onBackHome={onBackHome} notice={syncNotice} />
      </div>
    );
  }

  if (
    (isBootstrapping && !matchView) ||
    (!error && !matchView && continuityStatus !== 'WAITING_NEXT_MATCH')
  ) {
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
    continuityStatus === 'WATCHING_MATCH'
      ? (remoteSession?.spectatorAuthorizedViewerSeats ?? linkView?.authorizedViewerSeats ?? [])
      : [];

  return (
    <BattleViewportShell>
      <div className="absolute left-4 top-4 z-[var(--z-battle-chrome)] flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2">
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
        {continuityStatus === 'WATCHING_MATCH' ? <PublicBattleLogButton /> : null}
        <div className="hidden md:block">
          <ThemeToggle />
        </div>
      </div>
      {syncNotice ? (
        <div className="absolute right-4 top-4 z-[var(--z-battle-chrome)] max-w-[calc(100vw-2rem)] rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-warning)_42%,transparent)] bg-[var(--bg-frosted)] px-3 py-2 text-xs text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl md:max-w-sm">
          {syncNotice}
        </div>
      ) : error ? (
        <div className="absolute right-4 top-4 z-[var(--z-battle-chrome)] hidden max-w-sm rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[var(--bg-frosted)] px-3 py-2 text-xs text-[var(--semantic-error)] shadow-[var(--shadow-md)] backdrop-blur-xl md:block">
          {error}
        </div>
      ) : null}
      {!syncNotice && !error && remoteSession?.spectatorAuthorizationNotice ? (
        <div className="absolute right-4 top-4 z-[var(--z-battle-chrome)] max-w-sm rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-warning)_42%,transparent)] bg-[var(--bg-frosted)] px-3 py-2 text-xs leading-5 text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl">
          {remoteSession.spectatorAuthorizationNotice.message}
        </div>
      ) : null}
      {continuityStatus === 'WAITING_NEXT_MATCH' ? (
        <div className="absolute inset-0 z-[115] flex items-center justify-center bg-[var(--bg-base)] px-4">
          <SpectatorWaitingPanel onBackHome={onBackHome} />
        </div>
      ) : isSwitchingView || continuityStatus === 'SWITCHING_MATCH' ? (
        <div className="absolute inset-0 z-[110] flex items-center justify-center bg-[var(--bg-base)]">
          <div className="surface-panel-frosted flex items-center gap-3 px-6 py-4 text-sm text-[var(--text-primary)]">
            <Loader2 size={18} className="animate-spin" />
            正在切换观战视角...
          </div>
        </div>
      ) : (
        <GameBoard showDesktopPublicBattleLogButton={false} />
      )}
    </BattleViewportShell>
  );
}

function SpectatorWaitingPanel({
  onBackHome,
  notice,
}: {
  readonly onBackHome: () => void;
  readonly notice?: string | null;
}) {
  return (
    <div className="surface-panel-frosted w-full max-w-md p-6 text-center shadow-[var(--shadow-xl)]">
      <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_38%,transparent)] bg-[var(--bg-overlay)] text-[var(--accent-primary)]">
        <Loader2 size={20} className="animate-spin" />
      </div>
      <div className="text-base font-semibold text-[var(--text-primary)]">正在准备下一局</div>
      {notice ? <div className="mt-3 text-xs text-[var(--semantic-warning)]">{notice}</div> : null}
      <button
        type="button"
        onClick={onBackHome}
        className="button-ghost mt-5 inline-flex min-h-10 items-center gap-2 px-4"
      >
        <ArrowLeft size={16} />
        返回首页
      </button>
    </div>
  );
}

function isSpectatorWaitingView(
  response: OnlineSpectatorSnapshotResponse | OnlineSpectatorJoinView['snapshot']
): response is OnlineSpectatorWaitingView {
  return 'status' in response && response.status === 'WAITING_NEXT_MATCH';
}

function isSpectatorSnapshotNotModified(
  response: OnlineSpectatorSnapshotResponse
): response is Extract<OnlineSpectatorSnapshotResponse, { readonly modified: false }> {
  return 'modified' in response && response.modified === false;
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

function isInvalidSpectatorAccessError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    [
      'ONLINE_SPECTATOR_LINK_NOT_FOUND',
      'ONLINE_SPECTATOR_LINK_EXPIRED',
      'ONLINE_SPECTATOR_SESSION_INVALID',
      'ONLINE_SPECTATOR_SESSION_REQUIRED',
      'ONLINE_SPECTATOR_SESSION_EXPIRED',
      'ONLINE_SPECTATOR_MATCH_NOT_FOUND',
      'ONLINE_SPECTATOR_AUTHORIZATION_CLOSED',
      'ONLINE_SPECTATOR_VIEW_FORBIDDEN',
      'ONLINE_SPECTATOR_ROOM_CLOSED',
      'ONLINE_SPECTATOR_ROOM_REPLACED',
    ].includes(error.code)
  );
}

function isRetryableSpectatorError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === 'ONLINE_SPECTATOR_RATE_LIMITED' ||
      error.code === 'NETWORK_ERROR' ||
      error.code === 'TIMEOUT')
  );
}
