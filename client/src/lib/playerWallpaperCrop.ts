import type {
  WallpaperCrop,
  WallpaperFocus,
  WallpaperLayout,
} from '@game/online/player-wallpaper-types';

const LAYOUT_ASPECT: Record<WallpaperLayout, number> = {
  WIDE: 16 / 9,
  COMPACT: 9 / 16,
};

export function computeWallpaperCrop(
  sourceWidth: number,
  sourceHeight: number,
  layout: WallpaperLayout,
  focus: WallpaperFocus
): WallpaperCrop {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('壁纸尺寸无效');
  }
  const targetAspect = LAYOUT_ASPECT[layout];
  const sourceAspect = sourceWidth / sourceHeight;
  const normalizedFocus = {
    x: clamp01(focus.x),
    y: clamp01(focus.y),
  };

  if (sourceAspect > targetAspect) {
    const width = targetAspect / sourceAspect;
    return {
      x: (1 - width) * normalizedFocus.x,
      y: 0,
      width,
      height: 1,
    };
  }

  const height = sourceAspect / targetAspect;
  return {
    x: 0,
    y: (1 - height) * normalizedFocus.y,
    width: 1,
    height,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
