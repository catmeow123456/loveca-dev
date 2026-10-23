import { useSyncExternalStore } from 'react';
import type { CasualRuleMode } from '@game/online/casual-table-types';

export const casualRuleName = (mode: CasualRuleMode) =>
  mode === 'UNLIMITED' ? '娱乐模式' : '标准模式';
export const casualRuleDescription = (mode: CasualRuleMode) =>
  mode === 'UNLIMITED'
    ? '双方均可使用超 PT 卡组，其余构筑规则照常。'
    : '使用当前 PT 上限内的自组卡组。';
export const casualPointSummary = (points: number, limit: number, mode: CasualRuleMode) =>
  mode === 'UNLIMITED' ? `${points} PT · 无上限` : `${points} / ${limit} PT`;
export const casualDeckPreferenceKey = (userId: string, mode: CasualRuleMode) =>
  `casual:${userId}:${mode}`;
const preferencePrefix = 'loveca.casualRuleMode:';
const preferenceKey = (userId: string) => `${preferencePrefix}${userId}`;
const eventName = 'loveca:casual-rule-mode';
// The selection remains usable if the browser refuses preference persistence.
const unsavedModes = new Map<string, CasualRuleMode>();

export function readCasualRuleMode(userId: string): CasualRuleMode {
  const unsaved = unsavedModes.get(userId);
  if (unsaved) return unsaved;
  try {
    return localStorage.getItem(preferenceKey(userId)) === 'UNLIMITED' ? 'UNLIMITED' : 'NORMAL';
  } catch {
    return 'NORMAL';
  }
}
export function writeCasualRuleMode(userId: string, mode: CasualRuleMode): void {
  try {
    localStorage.setItem(preferenceKey(userId), mode);
    unsavedModes.delete(userId);
  } catch {
    unsavedModes.set(userId, mode);
  }
  window.dispatchEvent(new Event(eventName));
}
function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null) unsavedModes.clear();
    else if (event.key?.startsWith(preferencePrefix))
      unsavedModes.delete(event.key.slice(preferencePrefix.length));
    callback();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(eventName, callback);
  };
}
export function useCasualRuleMode(userId: string): CasualRuleMode {
  return useSyncExternalStore(
    subscribe,
    () => readCasualRuleMode(userId),
    () => 'NORMAL'
  );
}
