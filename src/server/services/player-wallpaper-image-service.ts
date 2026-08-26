import { config } from '../config.js';
import type {
  WallpaperCrop,
  WallpaperFocus,
  WallpaperLayout,
} from '../../online/player-wallpaper-types.js';
import {
  normalizeStaticImageSource,
  renderStaticImageCrop,
  StaticImageProcessingError,
  validateNormalizedImageCrop,
  validateNormalizedImageFocus,
  withStaticImageProcessingSlot,
  type ProcessedStaticImage,
  type StaticImageLayoutSpecification,
  type StaticImageProcessingLimits,
} from './static-image-processing-service.js';

const LAYOUTS = {
  WIDE: {
    aspect: 16 / 9,
    minimumWidth: 1280,
    minimumHeight: 720,
    outputWidth: 1920,
    outputHeight: 1080,
    objectName: 'wide',
  },
  COMPACT: {
    aspect: 9 / 16,
    minimumWidth: 720,
    minimumHeight: 1280,
    inheritedMinimumWidth: 540,
    inheritedMinimumHeight: 960,
    outputWidth: 1080,
    outputHeight: 1920,
    objectName: 'compact',
  },
} as const;

const IMAGE_LIMITS: StaticImageProcessingLimits = {
  maxInputPixels: config.playerWallpaper.maxInputPixels,
  maxInputEdge: config.playerWallpaper.maxInputEdge,
  minimumSourceEdge: 720,
  normalizedMasterMaxEdge: config.playerWallpaper.normalizedMasterMaxEdge,
  processingTimeoutSeconds: config.playerWallpaper.processingTimeoutSeconds,
  masterWebpQuality: 92,
  displayWebpQuality: 84,
};

export class PlayerWallpaperImageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlayerWallpaperImageError';
    this.code = code;
  }
}

export type ProcessedWallpaperImage = ProcessedStaticImage;

export function withWallpaperProcessingSlot<T>(operation: () => Promise<T>): Promise<T> {
  return withStaticImageProcessingSlot(config.playerWallpaper.processingConcurrency, operation);
}

export async function normalizeWallpaperSource(input: Buffer): Promise<ProcessedWallpaperImage> {
  try {
    return await normalizeStaticImageSource(input, IMAGE_LIMITS);
  } catch (error) {
    throw mapStaticImageError(error);
  }
}

export async function renderWallpaperLayout(
  master: ProcessedWallpaperImage,
  layout: WallpaperLayout,
  crop: WallpaperCrop,
  options: { readonly inheritedWideSource?: boolean } = {}
): Promise<ProcessedWallpaperImage> {
  const specification = LAYOUTS[layout];
  try {
    return await renderStaticImageCrop(
      master,
      crop,
      wallpaperLayoutSpecification(specification, layout, options),
      IMAGE_LIMITS
    );
  } catch (error) {
    throw mapStaticImageError(error);
  }
}

export function validateNormalizedCrop(
  crop: WallpaperCrop,
  sourceWidth: number,
  sourceHeight: number,
  layout: WallpaperLayout,
  options: { readonly inheritedWideSource?: boolean } = {}
): void {
  const specification = LAYOUTS[layout];
  try {
    validateNormalizedImageCrop(
      crop,
      sourceWidth,
      sourceHeight,
      wallpaperLayoutSpecification(specification, layout, options)
    );
  } catch (error) {
    throw mapStaticImageError(error);
  }
}

export function validateWallpaperFocus(focus: WallpaperFocus): void {
  try {
    validateNormalizedImageFocus(focus);
  } catch (error) {
    throw mapStaticImageError(error);
  }
}

export function getWallpaperLayoutObjectName(layout: WallpaperLayout): 'wide' | 'compact' {
  return LAYOUTS[layout].objectName;
}

function wallpaperLayoutSpecification(
  specification: (typeof LAYOUTS)[WallpaperLayout],
  layout: WallpaperLayout,
  options: { readonly inheritedWideSource?: boolean }
): StaticImageLayoutSpecification {
  return {
    aspect: specification.aspect,
    minimumWidth:
      layout === 'COMPACT' && options.inheritedWideSource
        ? LAYOUTS.COMPACT.inheritedMinimumWidth
        : specification.minimumWidth,
    minimumHeight:
      layout === 'COMPACT' && options.inheritedWideSource
        ? LAYOUTS.COMPACT.inheritedMinimumHeight
        : specification.minimumHeight,
    outputWidth: specification.outputWidth,
    outputHeight: specification.outputHeight,
  };
}

function mapStaticImageError(error: unknown): PlayerWallpaperImageError {
  if (error instanceof PlayerWallpaperImageError) return error;
  const code = error instanceof StaticImageProcessingError ? error.code : 'PROCESSING_FAILED';
  switch (code) {
    case 'UNSUPPORTED_FORMAT':
      return new PlayerWallpaperImageError(
        'WALLPAPER_UNSUPPORTED_FORMAT',
        '请选择 JPG、PNG 或静态 WebP 图片。'
      );
    case 'ANIMATED_IMAGE':
      return new PlayerWallpaperImageError(
        'WALLPAPER_ANIMATED_IMAGE',
        '游戏桌壁纸暂不支持动画图片。'
      );
    case 'DIMENSIONS_TOO_LARGE':
      return new PlayerWallpaperImageError(
        'WALLPAPER_DIMENSIONS_TOO_LARGE',
        '图片像素尺寸过大，请缩小后重新选择。'
      );
    case 'PIXELS_TOO_SMALL':
      return new PlayerWallpaperImageError(
        'WALLPAPER_PIXELS_TOO_SMALL',
        '图片分辨率过低，无法生成清晰的游戏桌壁纸。'
      );
    case 'INVALID_CROP':
      return new PlayerWallpaperImageError(
        'WALLPAPER_INVALID_CROP',
        '壁纸裁切区域无效，请重新调整位置。'
      );
    case 'INVALID_CROP_ASPECT':
      return new PlayerWallpaperImageError(
        'WALLPAPER_INVALID_CROP',
        '壁纸裁切比例无效，请重新调整位置。'
      );
    case 'CROP_TOO_SMALL':
      return new PlayerWallpaperImageError(
        'WALLPAPER_CROP_TOO_SMALL',
        '图片分辨率过低，无法生成清晰的游戏桌壁纸。'
      );
    case 'INVALID_FOCUS':
      return new PlayerWallpaperImageError(
        'WALLPAPER_INVALID_FOCUS',
        '壁纸主体位置无效，请重新调整位置。'
      );
    case 'DECODE_FAILED':
      return new PlayerWallpaperImageError(
        'WALLPAPER_DECODE_FAILED',
        '图片处理失败，请重新导出图片后再试。'
      );
    default:
      return new PlayerWallpaperImageError(
        'WALLPAPER_PROCESSING_FAILED',
        '图片处理失败，请重新导出图片后再试。'
      );
  }
}
