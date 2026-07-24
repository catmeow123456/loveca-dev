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
  status: PublicTableStatusView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  heartbeat: () => Promise<void>;
  join: (deckId: string, entrySource?: 'DIRECT' | 'SHARED_LINK') => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => Promise<void>;
}

export const usePublicTableStore = create<PublicTableStoreState>((set) => {
  const run = async (operation: () => Promise<PublicTableStatusView>) => {
    set({ loading: true, error: null });
    try {
      set({ status: await operation(), loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '操作没有完成，请稍后再试',
      });
      throw error;
    }
  };

  return {
    status: null,
    loading: false,
    error: null,
    refresh: () => run(fetchPublicTableStatus),
    heartbeat: () => run(heartbeatPublicTable),
    join: (deckId, entrySource = 'DIRECT') => run(() => joinPublicTable(deckId, entrySource)),
    confirm: () => run(confirmPublicTable),
    cancel: () => run(cancelPublicTable),
  };
});
