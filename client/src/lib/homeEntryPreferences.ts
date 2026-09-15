export const HOME_ENTRY_IDS = [
  'tutorial',
  'ranked',
  'theme-table',
  'spectator',
  'match-records',
  'online-debug',
] as const;

export type HomeEntryId = (typeof HOME_ENTRY_IDS)[number];

const STORAGE_KEY = 'loveca.home.hiddenEntries';

export function readHiddenHomeEntries(): HomeEntryId[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return HOME_ENTRY_IDS.filter((id) => value.includes(id));
  } catch {
    return [];
  }
}

export function writeHiddenHomeEntries(hiddenEntries: HomeEntryId[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hiddenEntries));
    return true;
  } catch {
    return false;
  }
}
