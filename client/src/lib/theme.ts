export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'loveca-theme';

export function getPreferredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : getPreferredTheme();
}

export function applyTheme(theme: Theme): Theme {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
  return theme;
}

export function toggleTheme(theme: Theme): Theme {
  return theme === 'light' ? 'dark' : 'light';
}
