import { create } from 'zustand';
import type { PublicTableStatusView } from '@game/online/public-table-types';
import type { ThemeTableOverviewView } from '@game/online/theme-table-types';
import {
  cancelThemeTable,
  confirmThemeTable,
  fetchThemeTableOverview,
  heartbeatThemeTable,
  joinThemeTable,
} from '@/lib/themeTableClient';

interface ThemeTableStoreState {
  overview: ThemeTableOverviewView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  join: () => Promise<void>;
  heartbeat: () => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => Promise<void>;
}

export const useThemeTableStore = create<ThemeTableStoreState>((set) => {
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
        set({ overview: await fetchThemeTableOverview(), loading: false });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : '读取娱乐模式失败',
        });
        throw error;
      }
    },
    join: () => runQueue(joinThemeTable),
    heartbeat: () => runQueue(heartbeatThemeTable),
    confirm: () => runQueue(confirmThemeTable),
    cancel: () => runQueue(cancelThemeTable),
  };
});
