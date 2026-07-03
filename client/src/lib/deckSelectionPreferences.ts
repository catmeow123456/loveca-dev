import type { DeckDisplayItem } from '@/lib/deckDisplay';

const LAST_USED_DECK_STORAGE_PREFIX = 'loveca.deckSelection.lastUsed.';

export const DECK_SELECTION_PREFERENCE_KEYS = {
  onlineRoom: 'online-room',
  solitaire: 'solitaire',
  localDebugPlayer1: 'local-debug-player-1',
  localDebugPlayer2: 'local-debug-player-2',
} as const;

export type PreferredDeckReason = 'last-used' | 'only-valid' | 'latest-valid';

export interface PreferredDeckSelection {
  deck: DeckDisplayItem | null;
  reason: PreferredDeckReason | null;
}

export function getOnlineDebugDeckPreferenceKey(matchId: string, seat: string): string {
  return `online-debug:${matchId}:${seat}`;
}

export function readLastUsedDeckId(preferenceKey: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(getStorageKey(preferenceKey));
  } catch {
    return null;
  }
}

export function writeLastUsedDeckId(preferenceKey: string, deckId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(getStorageKey(preferenceKey), deckId);
  } catch {
    // Local preferences are a convenience only; storage failures should not block play.
  }
}

export function choosePreferredDeck(
  decks: DeckDisplayItem[],
  lastUsedDeckId: string | null
): PreferredDeckSelection {
  const validDecks = decks.filter((deck) => deck.isValid);
  if (validDecks.length === 0) {
    return { deck: null, reason: null };
  }

  if (lastUsedDeckId) {
    const lastUsedDeck = validDecks.find((deck) => deck.id === lastUsedDeckId);
    if (lastUsedDeck) {
      return { deck: lastUsedDeck, reason: 'last-used' };
    }
  }

  if (validDecks.length === 1) {
    return { deck: validDecks[0], reason: 'only-valid' };
  }

  const latestDeck = [...validDecks].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  )[0];
  return { deck: latestDeck, reason: 'latest-valid' };
}

function getStorageKey(preferenceKey: string): string {
  return `${LAST_USED_DECK_STORAGE_PREFIX}${preferenceKey}`;
}
