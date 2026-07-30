import { create } from 'zustand';
import type { PublicTableStatusView } from '@game/online/public-table-types';
import {
  cancelPublicTable,
  confirmPublicTable,
  fetchPublicTableStatus,
  heartbeatPublicTable,
  joinPublicTable,
} from '@/lib/publicTableClient';

interface PublicTableStoreState {
  sessionUserId: string | null;
  hydrated: boolean;
  status: PublicTableStatusView | null;
  loading: boolean;
  error: string | null;
  setSessionUser: (userId: string | null) => void;
  refresh: () => Promise<void>;
  heartbeat: () => Promise<void>;
  join: (deckId: string, entrySource?: 'DIRECT' | 'SHARED_LINK') => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => Promise<void>;
}

export const usePublicTableStore = create<PublicTableStoreState>((set, get) => {
  let activeRequestId = 0;
  let sessionRevision = 0;
  let refreshInFlight: {
    userId: string;
    sessionRevision: number;
    promise: Promise<void>;
  } | null = null;
  let mutationInFlight: {
    userId: string;
    sessionRevision: number;
    promise: Promise<void>;
  } | null = null;

  const run = async (operation: () => Promise<PublicTableStatusView>) => {
    const sessionUserId = get().sessionUserId;
    if (!sessionUserId) {
      throw new Error('公共牌桌状态尚未绑定到当前用户');
    }

    const requestId = ++activeRequestId;
    set({ loading: true, error: null });
    try {
      const status = await operation();
      if (get().sessionUserId !== sessionUserId || requestId !== activeRequestId) {
        return;
      }
      set({ status, hydrated: true, loading: false });
    } catch (error) {
      if (get().sessionUserId !== sessionUserId || requestId !== activeRequestId) {
        return;
      }
      set({
        loading: false,
        error: error instanceof Error ? error.message : '操作没有完成，请稍后再试',
      });
      throw error;
    }
  };

  const refresh = (): Promise<void> => {
    const userId = get().sessionUserId;
    if (
      userId &&
      mutationInFlight?.userId === userId &&
      mutationInFlight.sessionRevision === sessionRevision
    ) {
      return mutationInFlight.promise;
    }
    if (
      userId &&
      refreshInFlight?.userId === userId &&
      refreshInFlight.sessionRevision === sessionRevision
    ) {
      return refreshInFlight.promise;
    }

    const promise = run(fetchPublicTableStatus).finally(() => {
      if (refreshInFlight?.promise === promise) {
        refreshInFlight = null;
      }
    });
    if (userId) {
      refreshInFlight = { userId, sessionRevision, promise };
    }
    return promise;
  };

  const runMutation = (operation: () => Promise<PublicTableStatusView>): Promise<void> => {
    const userId = get().sessionUserId;
    const operationSessionRevision = sessionRevision;
    const promise = run(operation).finally(() => {
      if (mutationInFlight?.promise === promise) {
        mutationInFlight = null;
      }
    });
    if (userId) {
      mutationInFlight = {
        userId,
        sessionRevision: operationSessionRevision,
        promise,
      };
    }
    return promise;
  };

  return {
    sessionUserId: null,
    hydrated: false,
    status: null,
    loading: false,
    error: null,
    setSessionUser: (userId) => {
      if (get().sessionUserId === userId) {
        return;
      }
      activeRequestId += 1;
      sessionRevision += 1;
      refreshInFlight = null;
      mutationInFlight = null;
      set({
        sessionUserId: userId,
        hydrated: false,
        status: null,
        loading: false,
        error: null,
      });
    },
    refresh,
    heartbeat: () => runMutation(heartbeatPublicTable),
    join: (deckId, entrySource = 'DIRECT') =>
      runMutation(() => joinPublicTable(deckId, entrySource)),
    confirm: () => runMutation(confirmPublicTable),
    cancel: () => runMutation(cancelPublicTable),
  };
});
