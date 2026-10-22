import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allowPresentationAssets,
  DEFAULT_COVER_SHORTCUT,
  PRESENTATION_MODE_SHORTCUT,
  isCoverShortcut,
  matchesCoverShortcut,
  useAppPresentation,
} from './appPresentation';
import { preloadImage } from './imageService';

const key = {
  code: 'KeyX',
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
};
afterEach(() => {
  useAppPresentation.setState({ mode: 'normal', covered: false });
  vi.unstubAllGlobals();
});
describe('presentation policy', () => {
  it('requires an exact deliberate combination and rejects held or composing input', () => {
    expect(matchesCoverShortcut(key, DEFAULT_COVER_SHORTCUT)).toBe(true);
    for (const override of [
      { repeat: true },
      { isComposing: true },
      { altKey: false },
      { metaKey: true },
      { code: 'KeyY' },
    ])
      expect(matchesCoverShortcut({ ...key, ...override }, DEFAULT_COVER_SHORTCUT)).toBe(false);
    for (const shortcut of ['KeyX', 'Ctrl+KeyX', 'Ctrl+Ctrl+KeyX', 'Ctrl+Alt+F4'])
      expect(isCoverShortcut(shortcut)).toBe(false);
    expect(isCoverShortcut('Meta+Shift+KeyZ')).toBe(true);
  });
  it('does not construct an image while Excel or a cover is active', async () => {
    const image = vi.fn();
    vi.stubGlobal('Image', image);
    for (const state of [
      { mode: 'excel' as const, covered: false },
      { mode: 'normal' as const, covered: true },
    ]) {
      useAppPresentation.setState(state);
      expect(allowPresentationAssets()).toBe(false);
      await preloadImage('/never-load.webp');
    }
    expect(image).not.toHaveBeenCalled();
    useAppPresentation.setState({ mode: 'normal', covered: false });
    expect(allowPresentationAssets()).toBe(true);
  });
  it('reserves the mode shortcut and rejects repeat or composing mode switches', () => {
    const modeKey = { ...key, code: 'KeyE' };
    expect(matchesCoverShortcut(modeKey, PRESENTATION_MODE_SHORTCUT)).toBe(true);
    expect(matchesCoverShortcut({ ...modeKey, repeat: true }, PRESENTATION_MODE_SHORTCUT)).toBe(
      false
    );
    expect(
      matchesCoverShortcut({ ...modeKey, isComposing: true }, PRESENTATION_MODE_SHORTCUT)
    ).toBe(false);
    for (const shortcut of ['Ctrl+Alt+KeyE', 'Alt+Ctrl+KeyE']) {
      expect(isCoverShortcut(shortcut)).toBe(false);
      expect(useAppPresentation.getState().setShortcut(shortcut)).toBe(false);
    }
  });
});
