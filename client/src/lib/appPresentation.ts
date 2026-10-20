import { create } from 'zustand';

export type AppPresentationMode = 'normal' | 'excel';
export type ExcelTheme = 'light' | 'dark';
export const PRESENTATION_MODE_KEY = 'loveca.presentation.mode';
export const EXCEL_THEME_KEY = 'loveca.presentation.theme';
export const PRESENTATION_COVER_KEY = 'loveca.presentation.covered';
export const PRESENTATION_SHORTCUT_KEY = 'loveca.presentation.shortcut';
export const DEFAULT_COVER_SHORTCUT = 'Ctrl+Alt+KeyX';
export const PRESENTATION_MODE_SHORTCUT = 'Ctrl+Alt+KeyE';

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
  if (icon) icon.href = mode === 'excel' || covered ? 'data:,' : '/pwa/icon-192.png';
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

let shortcutInstalled = false;
export function installPresentationShortcut(): void {
  if (shortcutInstalled || typeof window === 'undefined') return;
  shortcutInstalled = true;
  window.addEventListener(
    'keydown',
    (event) => {
      const state = useAppPresentation.getState();
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
        // Let browser shortcuts keep their default behavior, but never reach game handlers.
        event.stopImmediatePropagation();
      }
    },
    true
  );
}
