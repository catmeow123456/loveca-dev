import { create } from 'zustand';
import type { DeckPointTableRules } from '@game/domain/rules/deck-point-table';
import {
  fetchCurrentDeckPointTableRules,
  getNextBuiltInDeckPointTableEffectiveAt,
  resolveBuiltInDeckPointTableRules,
} from '@/lib/deckPointTableClient';

export type DeckPointTableSource = 'BUILT_IN' | 'SERVER';

interface DeckPointTableState {
  readonly rules: DeckPointTableRules;
  readonly source: DeckPointTableSource;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<void>;
}

let loadPromise: Promise<void> | null = null;

export const DECK_POINT_TABLE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const BOUNDARY_REFRESH_DELAY_MS = 1000;
const MAX_BROWSER_TIMER_DELAY_MS = 2_147_000_000;

export const useDeckPointTableStore = create<DeckPointTableState>((set, get) => {
  const refresh = async (): Promise<void> => {
    if (loadPromise) return loadPromise;

    const operation = (async () => {
      const fallback = resolveBuiltInDeckPointTableRules();
      set((state) => ({
        loading: true,
        error: null,
        rules: state.source === 'SERVER' ? state.rules : fallback,
      }));
      try {
        const rules = await fetchCurrentDeckPointTableRules();
        set({ rules, source: 'SERVER', initialized: true, loading: false, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : '读取当前PT限制表失败';
        set((state) => ({
          ...(state.source === 'SERVER'
            ? { rules: state.rules, source: 'SERVER' as const }
            : { rules: fallback, source: 'BUILT_IN' as const }),
          initialized: true,
          loading: false,
          error: message,
        }));
      }
    })();
    loadPromise = operation;
    try {
      await operation;
    } finally {
      if (loadPromise === operation) loadPromise = null;
    }
  };

  return {
    rules: resolveBuiltInDeckPointTableRules(),
    source: 'BUILT_IN',
    initialized: false,
    loading: false,
    error: null,
    ensureLoaded: async () => {
      if (get().initialized) return;
      await refresh();
    },
    refresh,
  };
});

export function getCurrentDeckPointTableRules(): DeckPointTableRules {
  return useDeckPointTableStore.getState().rules;
}

/**
 * Keep a long-lived page reasonably current without polling aggressively. A visible/focused
 * tab refreshes immediately, a 15-minute timer covers unattended open pages, and the one
 * confirmed built-in effective boundary receives a precise follow-up refresh.
 */
export function startDeckPointTableAutoRefresh(
  refresh: () => Promise<void> = () => useDeckPointTableStore.getState().refresh()
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  const refreshNow = () => {
    void refresh();
  };
  const refreshIfVisible = () => {
    if (document.visibilityState === 'visible') refreshNow();
  };
  const handleVisibilityChange = () => refreshIfVisible();

  window.addEventListener('focus', refreshNow);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  const intervalId = window.setInterval(refreshIfVisible, DECK_POINT_TABLE_REFRESH_INTERVAL_MS);

  const nextBoundary = getNextBuiltInDeckPointTableEffectiveAt();
  const boundaryDelay = nextBoundary ? nextBoundary.getTime() - Date.now() : null;
  const boundaryTimerId =
    boundaryDelay !== null &&
    boundaryDelay <= MAX_BROWSER_TIMER_DELAY_MS - BOUNDARY_REFRESH_DELAY_MS
      ? window.setTimeout(refreshIfVisible, Math.max(0, boundaryDelay) + BOUNDARY_REFRESH_DELAY_MS)
      : null;

  return () => {
    window.removeEventListener('focus', refreshNow);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.clearInterval(intervalId);
    if (boundaryTimerId !== null) window.clearTimeout(boundaryTimerId);
  };
}

let autoRefreshConsumerCount = 0;
let stopAutoRefresh: (() => void) | null = null;

export function retainDeckPointTableAutoRefresh(): () => void {
  autoRefreshConsumerCount += 1;
  if (autoRefreshConsumerCount === 1) {
    stopAutoRefresh = startDeckPointTableAutoRefresh();
  }

  let retained = true;
  return () => {
    if (!retained) return;
    retained = false;
    autoRefreshConsumerCount = Math.max(0, autoRefreshConsumerCount - 1);
    if (autoRefreshConsumerCount === 0) {
      stopAutoRefresh?.();
      stopAutoRefresh = null;
    }
  };
}
