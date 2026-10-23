import { useAuthStore } from '@/store/authStore';
import { isApiConfigured } from '@/lib/apiClient';
import { useEffect } from 'react';
import {
  retainDeckPointTableAutoRefresh,
  useDeckPointTableStore,
} from '@/store/deckPointTableStore';

export function useDeckPointTableRules() {
  const rules = useDeckPointTableStore((state) => state.rules);
  const ensureLoaded = useDeckPointTableStore((state) => state.ensureLoaded);

  useEffect(() => {
    void ensureLoaded();
    return retainDeckPointTableAutoRefresh();
  }, [ensureLoaded]);

  return rules;
}

/** A failed online first read must not present fallback point totals as current facts. */
export function useDeckPointTableDisplayReady(): boolean {
  const offline = useAuthStore((state) => state.offlineMode);
  const known = useDeckPointTableStore((state) => state.source === 'SERVER' || !state.error);
  return offline || !isApiConfigured || known;
}
