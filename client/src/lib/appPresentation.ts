import { create } from 'zustand';

export type AppPresentationMode = 'normal' | 'excel';
export type ExcelTheme = 'light' | 'dark';
export const PRESENTATION_MODE_KEY = 'loveca.presentation.mode';
export const EXCEL_THEME_KEY = 'loveca.presentation.theme';
export const PRESENTATION_COVER_KEY = 'loveca.presentation.covered';
export const PRESENTATION_SHORTCUT_KEY = 'loveca.presentation.shortcut';
export const DEFAULT_COVER_SHORTCUT = 'Ctrl+Alt+KeyX';
export const PRESENTATION_MODE_SHORTCUT = 'Ctrl+Alt+KeyE';
// Keep the inline bootstrap icon in index.html identical; no image request is needed.
export const WORKBOOK_ICON =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20fill%3D%22%2323864f%22%20d%3D%22M9%207h19v23H9z%22%2F%3E%3Cpath%20fill%3D%22%234fbc83%22%20d%3D%22M4%202h18l5%205v21H4z%22%2F%3E%3Cpath%20fill%3D%22%239de1bb%22%20d%3D%22M22%202v5h5z%22%2F%3E%3Cpath%20fill%3D%22%23fff%22%20d%3D%22M8%2013h6v3H8zm9%200h6v3h-6zM8%2019h6v3H8zm9%200h6v3h-6z%22%2F%3E%3C%2Fsvg%3E';

function readPreference(key: string, session = false): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return (session ? window.sessionStorage : window.localStorage).getItem(key);
  } catch {
    return key === PRESENTATION_COVER_KEY ? 'true' : null;
  }
}

export function isCoverShortcut(value: string): boolean {
  return (
    /^(?:(?:Ctrl|Alt|Shift|Meta)\+){2,3}Key[A-Z]$/.test(value) &&
    new Set(value.split('+')).size === value.split('+').length &&
    value.split('+').sort().join('+') !== PRESENTATION_MODE_SHORTCUT.split('+').sort().join('+')
  );
}

export function matchesCoverShortcut(
  event: Pick<
    KeyboardEvent,
    'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'repeat' | 'isComposing'
  >,
  shortcut: string
): boolean {
  if (event.repeat || event.isComposing) return false;
  const parts = shortcut.split('+');
  return (
    event.code === parts.at(-1) &&
    event.ctrlKey === parts.includes('Ctrl') &&
    event.altKey === parts.includes('Alt') &&
    event.shiftKey === parts.includes('Shift') &&
    event.metaKey === parts.includes('Meta')
  );
}

interface PresentationState {
  mode: AppPresentationMode;
  excelTheme: ExcelTheme;
  covered: boolean;
  shortcut: string;
  notice: string;
  setMode: (mode: AppPresentationMode) => void;
  setExcelTheme: (theme: ExcelTheme) => void;
  setCovered: (covered: boolean) => void;
  setShortcut: (shortcut: string) => boolean;
}

function persist(key: string, value: string, session = false): void {
  try {
    (session ? window.sessionStorage : window.localStorage).setItem(key, value);
  } catch {
    /* Memory state remains usable. */
  }
}

export const useAppPresentation = create<PresentationState>((set) => ({
  mode: readPreference(PRESENTATION_MODE_KEY) === 'excel' ? 'excel' : 'normal',
  excelTheme: readPreference(EXCEL_THEME_KEY) === 'dark' ? 'dark' : 'light',
  covered: readPreference(PRESENTATION_COVER_KEY, true) === 'true',
  shortcut: (() => {
    const stored = readPreference(PRESENTATION_SHORTCUT_KEY);
    return stored && isCoverShortcut(stored) ? stored : DEFAULT_COVER_SHORTCUT;
  })(),
  notice: '',
  setExcelTheme: (excelTheme) => {
    persist(EXCEL_THEME_KEY, excelTheme);
    set({ excelTheme });
    applyDocumentPresentation();
  },
  setMode: (mode) => {
    persist(PRESENTATION_MODE_KEY, mode);
    set({ mode, notice: '界面已切换，请核对当前操作；已提交的动作不会重新发送。' });
    applyDocumentPresentation();
  },
  setCovered: (covered) => {
    persist(PRESENTATION_COVER_KEY, String(covered), true);
    set({ covered });
    applyDocumentPresentation();
  },
  setShortcut: (shortcut) => {
    if (!isCoverShortcut(shortcut)) return false;
    persist(PRESENTATION_SHORTCUT_KEY, shortcut);
    set({ shortcut });
    return true;
  },
}));

export function allowPresentationAssets(): boolean {
  const { mode, covered } = useAppPresentation.getState();
  return mode === 'normal' && !covered;
}

export function useTextPresentation(): boolean {
  return useAppPresentation((state) => state.mode === 'excel' || state.covered);
}

export function applyDocumentPresentation(): void {
  if (typeof document === 'undefined') return;
  const { mode, covered, excelTheme } = useAppPresentation.getState();
  document.documentElement.dataset.presentation = mode;
  document.documentElement.dataset.excelTheme = excelTheme;
  document.documentElement.dataset.covered = String(covered);
  document.title = mode === 'excel' || covered ? '工作簿' : 'LOVECA';
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = mode === 'excel' || covered ? WORKBOOK_ICON : '/pwa/icon-192.png';
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (mode === 'excel' || covered) manifest?.remove();
  else if (!manifest && import.meta.env.PROD) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.webmanifest';
    document.head.appendChild(link);
  }
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor)
    themeColor.content =
      mode === 'excel' || covered ? (excelTheme === 'dark' ? '#202427' : '#ffffff') : '#1d1321';
  for (const id of ['app-surface', 'app-overlays']) {
    const element = document.getElementById(id);
    if (element) {
      element.inert = covered;
      if (covered) element.setAttribute('aria-hidden', 'true');
      else element.removeAttribute('aria-hidden');
    }
  }
}

export function getPresentationPortalRoot(): HTMLElement {
  return document.getElementById('app-overlays') ?? document.body;
}

let coverKeyboard: ((event: KeyboardEvent) => void) | null = null;

/** Forward cover editing keys without allowing them to reach underlying game listeners. */
export function registerCoverKeyboard(handler: (event: KeyboardEvent) => void): () => void {
  coverKeyboard = handler;
  return () => {
    if (coverKeyboard === handler) coverKeyboard = null;
  };
}

let shortcutRecorder: ((event: KeyboardEvent) => void) | null = null;

export function capturePresentationShortcut(recorder: (event: KeyboardEvent) => void): () => void {
  shortcutRecorder = recorder;
  return () => {
    if (shortcutRecorder === recorder) shortcutRecorder = null;
  };
}

let shortcutInstalled = false;
export function installPresentationShortcut(): void {
  if (shortcutInstalled || typeof window === 'undefined') return;
  shortcutInstalled = true;
  window.addEventListener(
    'keydown',
    (event) => {
      const state = useAppPresentation.getState();
      if (shortcutRecorder && state.mode === 'excel' && !state.covered) {
        shortcutRecorder(event);
        return;
      }
      if (matchesCoverShortcut(event, state.shortcut)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        state.setCovered(!state.covered);
      } else if (matchesCoverShortcut(event, PRESENTATION_MODE_SHORTCUT)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        // Switching the renderer must never dismiss the independent privacy cover.
        state.setMode(state.mode === 'excel' ? 'normal' : 'excel');
      } else if (state.covered) {
        // Native typing, clipboard and browser defaults still work; game handlers stay blocked.
        event.stopImmediatePropagation();
        coverKeyboard?.(event);
      }
    },
    true
  );
}
