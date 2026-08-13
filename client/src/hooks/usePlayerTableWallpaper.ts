import { useEffect } from 'react';
import { usePlayerWallpaperStore } from '@/store/playerWallpaperStore';
import { getPlayerWallpaperSolidColor } from '@game/online/player-wallpaper-types';
import type { WallpaperFocus } from '@game/online/player-wallpaper-types';

const CENTER_FOCUS: WallpaperFocus = { x: 0.5, y: 0.5 };

export interface PlayerTableWallpaperPresentation {
  readonly sourceUrl: string | null;
  readonly solidColor: string | null;
  readonly focus: WallpaperFocus;
  readonly isCustom: boolean;
}

export function usePlayerTableWallpaper(
  isMobileBattlefield: boolean
): PlayerTableWallpaperPresentation {
  const wallpaper = usePlayerWallpaperStore((state) => state.wallpaper);
  const objectUrls = usePlayerWallpaperStore((state) => state.objectUrls);
  const ensureAsset = usePlayerWallpaperStore((state) => state.ensureAsset);
  const asset = isMobileBattlefield ? (wallpaper?.compact ?? null) : (wallpaper?.wide ?? null);
  const solidPreset = isMobileBattlefield
    ? wallpaper?.compactMode === 'INHERIT_PC'
      ? (wallpaper.wideSolidPreset ?? null)
      : (wallpaper?.compactSolidPreset ?? null)
    : (wallpaper?.wideSolidPreset ?? null);

  useEffect(() => {
    void ensureAsset(asset);
  }, [asset, ensureAsset]);

  const sourceUrl = asset ? (objectUrls[asset.id] ?? null) : null;
  const solidColor = getPlayerWallpaperSolidColor(solidPreset);
  return {
    sourceUrl,
    solidColor,
    focus: asset?.focus ?? CENTER_FOCUS,
    isCustom: !!sourceUrl || !!solidColor,
  };
}
