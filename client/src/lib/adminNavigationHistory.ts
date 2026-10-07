const HISTORY_POSITION = 'lovecaAdminPosition';
export const ADMIN_HISTORY_LEAVE_EVENT = 'loveca:admin-history-leave';

export function readAdminHistoryPosition(): number | null {
  const position: unknown = window.history.state?.[HISTORY_POSITION];
  return typeof position === 'number' && Number.isInteger(position) ? position : null;
}

export function initializeAdminHistoryPosition(): number {
  const position = readAdminHistoryPosition() ?? 0;
  window.history.replaceState(
    { ...window.history.state, [HISTORY_POSITION]: position },
    '',
    window.location.href
  );
  return position;
}

export function pushAdminHistory(url: string): number {
  const position = initializeAdminHistoryPosition() + 1;
  window.history.pushState({ [HISTORY_POSITION]: position }, '', url);
  return position;
}

export function canLeaveAdminHistoryPage(): boolean {
  return window.dispatchEvent(new Event(ADMIN_HISTORY_LEAVE_EVENT, { cancelable: true }));
}
