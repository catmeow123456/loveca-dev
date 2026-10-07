import { useEffect } from 'react';
import { ADMIN_HISTORY_LEAVE_EVENT } from '@/lib/adminNavigationHistory';

export function useAdminHistoryGuard(active: boolean, warning: string): void {
  useEffect(() => {
    if (!active) return;
    const confirmLeave = (event: Event) => {
      if (!window.confirm(warning)) event.preventDefault();
    };
    window.addEventListener(ADMIN_HISTORY_LEAVE_EVENT, confirmLeave);
    return () => window.removeEventListener(ADMIN_HISTORY_LEAVE_EVENT, confirmLeave);
  }, [active, warning]);
}
