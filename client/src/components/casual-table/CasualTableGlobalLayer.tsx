import { CasualRuleBadge } from '@/components/common/CasualRuleSelector';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useCasualTableStore } from '@/store/casualTableStore';
import { CASUAL_PAGE_EVENT, openCasualDestination } from '@/lib/casualNavigation';
import '@/components/pages/casual-lobby.css';

/** One coordinator spans lobby, deck management, solo play and token spectator pages. */
export function CasualTableGlobalLayer() {
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const offline = useAuthStore((state) => state.offlineMode);
  const userId = user && profile && !offline ? user.id : null;
  const storeUser = useCasualTableStore((state) => state.userId);
  const status = useCasualTableStore((state) => state.status);
  const hydrated = useCasualTableStore((state) => state.hydrated);
  const setUser = useCasualTableStore((state) => state.setUser);
  const refresh = useCasualTableStore((state) => state.refresh);
  const heartbeat = useCasualTableStore((state) => state.heartbeat);
  const [page, setPage] = useState('');
  const previous = useRef<string | null>(null);
  const consumed = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (storeUser !== userId) {
      previous.current = null;
      consumed.current = null;
      window.sessionStorage.removeItem('loveca.online.room');
      setUser(userId);
    }
  }, [setUser, storeUser, userId]);
  useLayoutEffect(() => {
    const listener = (event: Event) => setPage((event as CustomEvent<string>).detail);
    window.addEventListener(CASUAL_PAGE_EVENT, listener);
    return () => window.removeEventListener(CASUAL_PAGE_EVENT, listener);
  }, []);
  useEffect(() => {
    if (!userId || storeUser !== userId) return;
    let stopped = false;
    let timer: number;
    let lastHeartbeat = 0;
    let failures = 0;
    const poll = async () => {
      try {
        const current = useCasualTableStore.getState();
        const table = current.status?.table;
        if (
          table &&
          (['WAITING', 'RESERVED', 'BOOTSTRAPPING'].includes(table.state) ||
            (table.state === 'BOUND' && table.runtime?.status === 'ENDED')) &&
          Date.now() - lastHeartbeat >= (table.state === 'BOUND' ? 5_000 : 15_000) &&
          !current.busy
        ) {
          await heartbeat(table);
          lastHeartbeat = Date.now();
        } else await refresh();
        failures = 0;
      } catch {
        failures += 1;
      }
      if (!stopped) {
        const state = useCasualTableStore.getState().status?.table?.state;
        timer = window.setTimeout(
          () => void poll(),
          Math.min(30_000, (state && state !== 'BOUND' ? 2500 : 5000) * 2 ** Math.min(failures, 3))
        );
      }
    };
    void poll();
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [heartbeat, refresh, storeUser, userId]);
  const table = userId === storeUser && hydrated ? status?.table : null;
  useEffect(() => {
    if (!table) return;
    const identity = `${table.tableId}:${table.roundId}:${table.roomGeneration}`;
    if (table.state === 'BOUND') {
      window.sessionStorage.setItem('loveca.online.room', table.roomCode);
      if (consumed.current !== identity) {
        consumed.current = identity;
        if (previous.current && previous.current !== 'BOUND')
          openCasualDestination('online-room', table.roomCode);
      }
    }
    previous.current = table.state;
  }, [table]);
  if (!table || page === 'battle-lobby' || table.state === 'CLOSED' || table.state === 'BOUND')
    return null;
  return (
    <aside className="casual-global-notice" role="status">
      <CasualRuleBadge mode={table.ruleMode} />
      <span>
        {table.state === 'WAITING'
          ? '房间正在等人'
          : table.state === 'BOOTSTRAPPING'
            ? '双方已确认，正在开局'
            : '对手已加入，等待本轮确认'}{' '}
        · <span className="font-mono">{table.roomCode}</span>
      </span>
      <button className="button-primary" onClick={() => openCasualDestination('battle-lobby')}>
        {table.state === 'RESERVED' ? '前往确认' : '查看我的房间'}
      </button>
    </aside>
  );
}
