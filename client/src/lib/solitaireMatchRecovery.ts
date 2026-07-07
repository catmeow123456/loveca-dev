interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SOLITAIRE_MATCH_RECOVERY_STORAGE_KEY = 'loveca.solitaire.match';

export function readStoredSolitaireMatchId(
  storage: SessionStorageLike | null = getSessionStorage()
): string | null {
  if (!storage) {
    return null;
  }

  try {
    const stored = storage.getItem(SOLITAIRE_MATCH_RECOVERY_STORAGE_KEY)?.trim() ?? '';
    return stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredSolitaireMatchId(
  matchId: string,
  storage: SessionStorageLike | null = getSessionStorage()
): void {
  if (!storage) {
    return;
  }

  const normalizedMatchId = matchId.trim();
  if (!normalizedMatchId) {
    return;
  }

  try {
    storage.setItem(SOLITAIRE_MATCH_RECOVERY_STORAGE_KEY, normalizedMatchId);
  } catch {
    // Storage may be unavailable in private browsing or restricted embeds.
  }
}

export function clearStoredSolitaireMatchId(
  matchId?: string,
  storage: SessionStorageLike | null = getSessionStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    if (matchId && readStoredSolitaireMatchId(storage) !== matchId) {
      return;
    }
    storage.removeItem(SOLITAIRE_MATCH_RECOVERY_STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

function getSessionStorage(): SessionStorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
