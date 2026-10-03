import type { BattleSurfaceCapabilities } from '../store/battleSurfaceCapabilities';

export function canPresentCardEntrance(
  capabilities: Pick<BattleSurfaceCapabilities, 'surface' | 'isReadOnly'>
) {
  return (
    !capabilities.isReadOnly &&
    ['LOCAL_DEBUG', 'REMOTE_DEBUG', 'SOLITAIRE', 'ONLINE'].includes(capabilities.surface)
  );
}
const storageKey = 'loveca-card-entrance-enabled';
export function readCardEntranceEnabled(): boolean {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(storageKey) !== 'false';
  } catch {
    return true;
  }
}
export function saveCardEntranceEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(storageKey, String(enabled));
  } catch {
    /* The current board preference still works when storage is unavailable. */
  }
}
