import type {
  WallpaperCrop,
  WallpaperFocus,
  WallpaperLayout,
} from '@game/online/player-wallpaper-types';

const LAYOUT_ASPECT: Record<WallpaperLayout, number> = {
  WIDE: 16 / 9,
  COMPACT: 9 / 16,
};

const LAYOUT_MINIMUM = {
  WIDE: { width: 1280, height: 720 },
  COMPACT: { width: 720, height: 1280 },
  INHERITED_COMPACT: { width: 540, height: 960 },
} as const;

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

export function getWallpaperResolutionError(
  sourceWidth: number,
  sourceHeight: number,
  layout: WallpaperLayout,
  inheritedWideSource = false
): string | null {
  const crop = computeWallpaperCrop(sourceWidth, sourceHeight, layout, { x: 0.5, y: 0.5 });
  const minimum =
    layout === 'WIDE'
      ? LAYOUT_MINIMUM.WIDE
      : inheritedWideSource
        ? LAYOUT_MINIMUM.INHERITED_COMPACT
        : LAYOUT_MINIMUM.COMPACT;
  const cropWidth = crop.width * sourceWidth;
  const cropHeight = crop.height * sourceHeight;
  if (cropWidth >= minimum.width && cropHeight >= minimum.height) {
    return null;
  }
  const target = layout === 'WIDE' ? 'PC 壁纸' : '手机壁纸';
  return `图片分辨率不足，${target}至少需要可裁切出 ${minimum.width}×${minimum.height}。`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
