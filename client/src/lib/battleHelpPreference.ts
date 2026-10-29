const storageKey = 'loveca.battle.hideAutomaticHelp';

export function readHideAutomaticBattleHelp(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

export function hideAutomaticBattleHelp(): void {
  try {
    window.localStorage.setItem(storageKey, 'true');
  } catch {
    // The current dialog can still be dismissed when storage is unavailable.
  }
}
