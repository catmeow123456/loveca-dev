export const HOME_ENTRY_IDS = [
  'tutorial',
  'battle-lobby',
  'ranked',
  'theme-table',
  'solitaire',
  'debug',
  'match-records',
  'online-debug',
  'spectate',
  'deck-manager',
] as const;

export type HomeEntryId = (typeof HOME_ENTRY_IDS)[number];

const STORAGE_KEY = 'loveca.home.hiddenEntries';
export const DEFAULT_HIDDEN_HOME_ENTRIES: HomeEntryId[] = ['debug', 'online-debug', 'deck-manager'];
export const DEFAULT_HOME_ENTRY_ORDER: HomeEntryId[] = [
  'tutorial',
  'spectate',
  'match-records',
  'solitaire',
  'deck-manager',
  'debug',
  'online-debug',
  'battle-lobby',
  'ranked',
  'theme-table',
];
const ORDER_STORAGE_KEY = 'loveca.home.entryOrder';

export function readHomeEntryOrder(): HomeEntryId[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(ORDER_STORAGE_KEY) ?? 'null');
    if (Array.isArray(value)) {
      const order = [
        ...new Set(value.filter((id): id is HomeEntryId => HOME_ENTRY_IDS.includes(id))),
      ];
      return [...order, ...DEFAULT_HOME_ENTRY_ORDER.filter((id) => !order.includes(id))];
    }
  } catch {
    /* Preferences must not block navigation. */
  }
  return [...DEFAULT_HOME_ENTRY_ORDER];
}

export function writeHomeEntryOrder(order: HomeEntryId[]): boolean {
  try {
    window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
    return true;
  } catch {
    return false;
  }
}

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
