import { describe, expect, it } from 'vitest';
import {
  getPlayerWallpaperSolidColor,
  isPlayerWallpaperSolidPreset,
  PLAYER_WALLPAPER_SOLID_PRESETS,
} from '../../src/online/player-wallpaper-types.js';

describe('player wallpaper solid presets', () => {
  it('keeps every selectable preset named, unique and color-resolvable', () => {
    expect(PLAYER_WALLPAPER_SOLID_PRESETS).toHaveLength(6);
    expect(new Set(PLAYER_WALLPAPER_SOLID_PRESETS.map((preset) => preset.id)).size).toBe(6);
    expect(new Set(PLAYER_WALLPAPER_SOLID_PRESETS.map((preset) => preset.color)).size).toBe(6);

    for (const preset of PLAYER_WALLPAPER_SOLID_PRESETS) {
      expect(preset.label).not.toBe('');
      expect(isPlayerWallpaperSolidPreset(preset.id)).toBe(true);
      expect(getPlayerWallpaperSolidColor(preset.id)).toBe(preset.color);
    }
  });

  it('rejects arbitrary values instead of accepting CSS colors from clients', () => {
    expect(isPlayerWallpaperSolidPreset('#ffffff')).toBe(false);
    expect(isPlayerWallpaperSolidPreset('url(javascript:alert(1))')).toBe(false);
    expect(isPlayerWallpaperSolidPreset(null)).toBe(false);
    expect(getPlayerWallpaperSolidColor(null)).toBeNull();
  });
});
