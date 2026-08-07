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
