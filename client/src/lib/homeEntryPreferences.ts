export const HOME_ENTRY_IDS = [
  'tutorial',
  'public-table',
  'ranked',
  'theme-table',
  'online-room',
  'solitaire',
  'debug',
  'spectator',
  'match-records',
  'online-debug',
] as const;

export type HomeEntryId = (typeof HOME_ENTRY_IDS)[number];

const STORAGE_KEY = 'loveca.home.hiddenEntries';
export const DEFAULT_HIDDEN_HOME_ENTRIES: HomeEntryId[] = [
  'public-table',
  'online-room',
  'solitaire',
  'debug',
];

export function readHiddenHomeEntries(): HomeEntryId[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return [...DEFAULT_HIDDEN_HOME_ENTRIES];
    const value: unknown = JSON.parse(stored);
    // Earlier preferences were an array and predate the new, default-hidden shortcuts.
    if (Array.isArray(value)) {
      return HOME_ENTRY_IDS.filter(
        (id) => value.includes(id) || DEFAULT_HIDDEN_HOME_ENTRIES.includes(id)
      );
    }
    if (!value || typeof value !== 'object' || !('hidden' in value)) {
      return [...DEFAULT_HIDDEN_HOME_ENTRIES];
    }
    const hidden: unknown = value.hidden;
    if (!Array.isArray(hidden)) return [...DEFAULT_HIDDEN_HOME_ENTRIES];
    return HOME_ENTRY_IDS.filter((id) => hidden.includes(id));
  } catch {
    return [...DEFAULT_HIDDEN_HOME_ENTRIES];
  }
}

export function writeHiddenHomeEntries(hiddenEntries: HomeEntryId[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: hiddenEntries }));
    return true;
  } catch {
    return false;
  }
}
