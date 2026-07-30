import { create } from 'zustand';
import type { PublicTableStatusView } from '@game/online/public-table-types';
import type { RankedOverviewView } from '@game/online/ranked-types';
import {
  cancelRankedQueue,
  confirmRankedQueue,
  fetchRankedOverview,
  heartbeatRankedQueue,
  joinRankedQueue,
} from '@/lib/rankedClient';

interface RankedStoreState {
  overview: RankedOverviewView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  join: (deckId: string) => Promise<void>;
  heartbeat: () => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => Promise<void>;
}

export const useRankedStore = create<RankedStoreState>((set) => {
  const setQueue = (queue: PublicTableStatusView) =>
    set((state) => ({
      overview: state.overview ? { ...state.overview, queue } : state.overview,
      loading: false,
      error: null,
    }));
  const runQueue = async (operation: () => Promise<PublicTableStatusView>) => {
    set({ loading: true, error: null });
    try {
      setQueue(await operation());
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '操作没有完成，请稍后再试',
      });
      throw error;
    }
  };

  return {
    overview: null,
    loading: false,
    error: null,
    refresh: async () => {
      set({ loading: true, error: null });
      try {
        set({ overview: await fetchRankedOverview(), loading: false });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : '读取赛季排位状态失败',
        });
        throw error;
      }
    },
    join: (deckId) => runQueue(() => joinRankedQueue(deckId)),
    heartbeat: () => runQueue(heartbeatRankedQueue),
    confirm: () => runQueue(confirmRankedQueue),
    cancel: () => runQueue(cancelRankedQueue),
  };
});
