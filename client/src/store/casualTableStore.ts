import { create } from 'zustand';
import type {
  CasualTableCommandTarget,
  CasualTableCurrentView,
} from '@game/online/casual-table-types';
import { casualWrite, getCasualCurrent } from '@/lib/casualTableClient';

interface CasualState {
  userId: string | null;
  hydrated: boolean;
  status: CasualTableCurrentView | null;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  setUser: (userId: string | null) => void;
  refresh: () => Promise<void>;
  heartbeat: (target: CasualTableCommandTarget) => Promise<void>;
  mutate: (path: string, body: unknown) => Promise<void>;
}

export const useCasualTableStore = create<CasualState>((set, get) => {
  let epoch = 0;
  let serial = 0;
  let reading: Promise<void> | null = null;
  let writing: Promise<void> | null = null;
  const load = async (generation: number, request: number) => {
    const status = await getCasualCurrent();
    if (generation === epoch && request === serial) set({ status, hydrated: true, error: null });
  };
  const refresh = (): Promise<void> => {
    if (!get().userId) return Promise.resolve();
    if (writing) return writing;
    if (reading) return reading;
    const generation = epoch,
      request = ++serial;
    const promise = load(generation, request)
      .catch((error: unknown) => {
        if (generation === epoch && request === serial)
          set({ error: error instanceof Error ? error.message : '读取当前房间失败' });
        throw error;
      })
      .finally(() => {
        if (reading === promise) reading = null;
      });
    reading = promise;
    return promise;
  };
  const mutate = (path: string, body: unknown): Promise<void> => {
    if (!get().userId) return Promise.reject(new Error('请先登录'));
    if (writing) return Promise.reject(new Error('上一项操作尚未完成'));
    const generation = epoch,
      request = ++serial;
    set({ busy: true, error: null });
    const promise = (async () => {
      try {
        await casualWrite(path, body);
        if (generation === epoch) await load(generation, request);
      } catch (error) {
        if (generation === epoch) {
          try {
            await load(generation, request);
          } catch {
            /* Retain the last successful projection. */
          }
          set({ error: error instanceof Error ? error.message : '操作未完成，请重试' });
        }
        throw error;
      } finally {
        if (generation === epoch) set({ busy: false });
      }
    })().finally(() => {
      if (writing === promise) writing = null;
    });
    writing = promise;
    return promise;
  };
  return {
    userId: null,
    hydrated: false,
    status: null,
    busy: false,
    error: null,
    clearError: () => set({ error: null }),
    setUser: (userId) => {
      if (get().userId === userId) return;
      epoch += 1;
      serial += 1;
      reading = null;
      writing = null;
      set({ userId, hydrated: false, status: null, busy: false, error: null });
    },
    refresh,
    mutate,
    // Keepalive is a mutation too, so a late heartbeat cannot overwrite cancellation.
    heartbeat: (target) => mutate('heartbeat', { target }),
  };
});
