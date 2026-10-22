import { createContext, useContext } from 'react';

/** Shared by all cosmetic battle presentations, including portalled panels. */
export const BattleEffectsContext = createContext(true);
export const useBattleEffectsEnabled = () => useContext(BattleEffectsContext);

// Retain the existing site preference: expanding the switch must not opt players back in.
const storageKey = 'loveca-card-entrance-enabled';
export function readBattleEffectsEnabled(): boolean {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(storageKey) !== 'false';
  } catch {
    return true;
  }
}
export function saveBattleEffectsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(storageKey, String(enabled));
  } catch {
    /* The current board preference still works when storage is unavailable. */
  }
}
