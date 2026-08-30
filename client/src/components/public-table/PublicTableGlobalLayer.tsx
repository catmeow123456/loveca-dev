import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock3, X } from 'lucide-react';
import { MatchmakingAudioHint } from '@/components/matchmaking/MatchmakingAudioHint';
import { usePublicTableStore } from '@/store/publicTableStore';

const HEARTBEAT_MS = 15_000;
const POLL_MS = 2_500;
const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

export function PublicTableGlobalLayer({
  enabled,
  userId,
  onEnterRoom,
}: {
  enabled: boolean;
  userId: string | null;
  onEnterRoom: () => void | Promise<void>;
}) {
  const status = usePublicTableStore((state) => state.status);
  const sessionUserId = usePublicTableStore((state) => state.sessionUserId);
  const hydrated = usePublicTableStore((state) => state.hydrated);
  const loading = usePublicTableStore((state) => state.loading);
  const error = usePublicTableStore((state) => state.error);
  const refresh = usePublicTableStore((state) => state.refresh);
  const heartbeat = usePublicTableStore((state) => state.heartbeat);
  const confirm = usePublicTableStore((state) => state.confirm);
  const cancel = usePublicTableStore((state) => state.cancel);
  const [now, setNow] = useState(() => Date.now());
  const enteredRoomIdentityRef = useRef<string | null>(null);
  const statusReady = enabled && userId !== null && sessionUserId === userId && hydrated;
  const visibleStatus = statusReady ? status : null;
  const activeState = visibleStatus?.state ?? 'IDLE';
  const matchedRoomIdentity =
    visibleStatus?.state === 'MATCHED' && visibleStatus.roomCode
      ? `${visibleStatus.roomGeneration ?? 'unknown'}:${visibleStatus.roomCode}`
      : null;

  useEffect(() => {
    if (!enabled || !userId || sessionUserId !== userId) return;
    void refresh().catch(() => undefined);
  }, [enabled, refresh, sessionUserId, userId]);

  useEffect(() => {
    if (!statusReady || activeState === 'IDLE' || activeState === 'MATCHED') return;
    const poll = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, POLL_MS);
    const keepAlive = window.setInterval(() => {
      void heartbeat().catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(keepAlive);
    };
  }, [activeState, heartbeat, refresh, statusReady]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    if (!matchedRoomIdentity || !visibleStatus?.roomCode) {
      enteredRoomIdentityRef.current = null;
      return;
    }
    if (enteredRoomIdentityRef.current === matchedRoomIdentity) {
      return;
    }
    enteredRoomIdentityRef.current = matchedRoomIdentity;
    window.sessionStorage.setItem(ONLINE_ROOM_STORAGE_KEY, visibleStatus.roomCode);
    void onEnterRoom();
  }, [matchedRoomIdentity, onEnterRoom, visibleStatus?.roomCode]);

  const remainingSeconds = useMemo(() => {
    if (!visibleStatus?.confirmationExpiresAt) return null;
    return Math.max(0, Math.ceil((visibleStatus.confirmationExpiresAt - now) / 1_000));
  }, [now, visibleStatus?.confirmationExpiresAt]);

  if (
    !statusReady ||
    !visibleStatus ||
    visibleStatus.state === 'IDLE' ||
    visibleStatus.state === 'MATCHED'
  ) {
    return null;
  }

  if (visibleStatus.state === 'WAITING') {
    const waitingSeconds = visibleStatus.joinedAt
      ? Math.max(0, Math.floor((now - visibleStatus.joinedAt) / 1_000))
      : 0;
    return (
      <div className="fixed inset-x-3 bottom-3 z-[90] mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] px-4 py-3 shadow-xl">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Clock3 size={16} />
            正在找对手
          </div>
          <div className="mt-1 truncate text-xs text-[var(--text-muted)]">
            已等待 {formatDuration(waitingSeconds)} · {visibleStatus.deckName}
          </div>
          <MatchmakingAudioHint className="mt-1" />
        </div>
        <button
          className="button-secondary px-3 py-2 text-sm"
          disabled={loading}
          onClick={() => void cancel()}
        >
          结束等待
        </button>
      </div>
    );
  }

  const creating = visibleStatus.state === 'CREATING_ROOM';
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="surface-panel w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
          <Check size={24} />
        </div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          {creating ? '正在进入对局' : '找到对手'}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {creating
            ? '双方已确认，正在进入开局。'
            : visibleStatus.confirmed
              ? '你已确认，等待对方确认。'
              : `请在 ${remainingSeconds ?? '—'} 秒内确认开局。`}
        </p>
        {error ? <p className="mt-3 text-sm text-[var(--semantic-error)]">{error}</p> : null}
        {!creating ? (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              className="button-secondary py-3"
              disabled={loading}
              onClick={() => void cancel()}
            >
              <X className="mr-1 inline" size={16} />
              取消等待
            </button>
            <button
              className="button-primary py-3"
              disabled={loading || visibleStatus.confirmed}
              onClick={() => void confirm()}
            >
              确认开局
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`;
}
