import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock3, X } from 'lucide-react';
import { useThemeTableStore } from '@/store/themeTableStore';

const HEARTBEAT_MS = 15_000;
const POLL_MS = 2_500;
const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

export function ThemeTableGlobalLayer({
  enabled,
  showWaitingNotice = true,
  onEnterRoom,
}: {
  enabled: boolean;
  showWaitingNotice?: boolean;
  onEnterRoom: () => void | Promise<void>;
}) {
  const { overview, loading, error, refresh, heartbeat, confirm, cancel } = useThemeTableStore();
  const [now, setNow] = useState(() => Date.now());
  const enteredRoomRef = useRef<string | null>(null);
  const status = overview?.queue ?? null;
  const state = status?.state ?? 'IDLE';
  const roomIdentity =
    status?.state === 'MATCHED' && status.roomCode
      ? `${status.roomGeneration ?? 'unknown'}:${status.roomCode}`
      : null;

  useEffect(() => {
    if (enabled) void refresh().catch(() => undefined);
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled || state === 'IDLE' || state === 'MATCHED') return;
    const poll = window.setInterval(() => void refresh().catch(() => undefined), POLL_MS);
    const keepAlive = window.setInterval(
      () => void heartbeat().catch(() => undefined),
      HEARTBEAT_MS
    );
    return () => {
      window.clearInterval(poll);
      window.clearInterval(keepAlive);
    };
  }, [enabled, heartbeat, refresh, state]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!roomIdentity || !status?.roomCode) {
      enteredRoomRef.current = null;
      return;
    }
    if (enteredRoomRef.current === roomIdentity) return;
    enteredRoomRef.current = roomIdentity;
    window.sessionStorage.setItem(ONLINE_ROOM_STORAGE_KEY, status.roomCode);
    void onEnterRoom();
  }, [onEnterRoom, roomIdentity, status?.roomCode]);

  const remaining = useMemo(
    () =>
      status?.confirmationExpiresAt
        ? Math.max(0, Math.ceil((status.confirmationExpiresAt - now) / 1_000))
        : null,
    [now, status?.confirmationExpiresAt]
  );
  if (!enabled || !status || state === 'IDLE' || state === 'MATCHED') return null;
  if (state === 'WAITING') {
    if (!showWaitingNotice) return null;
    return (
      <div className="fixed inset-x-3 bottom-3 z-[94] mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] px-4 py-3 shadow-xl">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Clock3 size={16} /> 主题牌桌候场中
          </div>
          <div className="mt-1 truncate text-xs text-[var(--text-muted)]">
            {overview?.event?.name} · 卡组将在双方确认后分配
          </div>
        </div>
        <button
          className="button-secondary px-3 py-2 text-sm"
          disabled={loading}
          onClick={() => void cancel()}
        >
          退出
        </button>
      </div>
    );
  }
  const creating = state === 'CREATING_ROOM';
  return (
    <div className="fixed inset-0 z-[114] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="surface-panel w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
          <Check size={24} />
        </div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          {creating ? '正在抽取本局卡组' : '主题对手已就位'}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {creating
            ? `已从审核组合中分配卡组：${status.deckName ?? '正在揭晓'}`
            : status.confirmed
              ? '你已确认，等待对方。卡组会在双方确认后揭晓。'
              : `请在 ${remaining ?? '—'} 秒内确认参加本局。`}
        </p>
        {error ? <p className="mt-3 text-sm text-[var(--semantic-error)]">{error}</p> : null}
        {!creating ? (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              className="button-secondary py-3"
              disabled={loading}
              onClick={() => void cancel()}
            >
              <X className="mr-1 inline" size={16} /> 退出
            </button>
            <button
              className="button-primary py-3"
              disabled={loading || status.confirmed}
              onClick={() => void confirm()}
            >
              确认参加
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
