import sharp from 'sharp';
import { config } from '../config.js';
import type {
  WallpaperCrop,
  WallpaperFocus,
  WallpaperLayout,
} from '../../online/player-wallpaper-types.js';

const SUPPORTED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MIN_SOURCE_EDGE = 720;
const MASTER_WEBP_QUALITY = 92;
const DISPLAY_WEBP_QUALITY = 84;

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

export class PlayerWallpaperImageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlayerWallpaperImageError';
    this.code = code;
  }
}

export interface ProcessedWallpaperImage {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
}

class ProcessingSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

const processingSemaphore = new ProcessingSemaphore(config.playerWallpaper.processingConcurrency);

export function withWallpaperProcessingSlot<T>(operation: () => Promise<T>): Promise<T> {
  return processingSemaphore.run(operation);
}

export async function normalizeWallpaperSource(input: Buffer): Promise<ProcessedWallpaperImage> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, {
      animated: true,
      failOn: 'error',
      limitInputPixels: config.playerWallpaper.maxInputPixels,
    })
      .timeout({ seconds: config.playerWallpaper.processingTimeoutSeconds })
      .metadata();
  } catch {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_DECODE_FAILED',
      '图片处理失败，请重新导出图片后再试。'
    );
  }

  if (!metadata.format || !SUPPORTED_INPUT_FORMATS.has(metadata.format)) {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_UNSUPPORTED_FORMAT',
      '请选择 JPG、PNG 或静态 WebP 图片。'
    );
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new PlayerWallpaperImageError('WALLPAPER_ANIMATED_IMAGE', '游戏桌壁纸暂不支持动画图片。');
  }
  if (!metadata.width || !metadata.height) {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_DECODE_FAILED',
      '图片处理失败，请重新导出图片后再试。'
    );
  }

  const swapsDimensions = (metadata.orientation ?? 1) >= 5;
  const orientedWidth = swapsDimensions ? metadata.height : metadata.width;
  const orientedHeight = swapsDimensions ? metadata.width : metadata.height;
  if (Math.max(orientedWidth, orientedHeight) > config.playerWallpaper.maxInputEdge) {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_DIMENSIONS_TOO_LARGE',
      '图片像素尺寸过大，请缩小后重新选择。'
    );
  }
  if (orientedWidth < MIN_SOURCE_EDGE || orientedHeight < MIN_SOURCE_EDGE) {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_PIXELS_TOO_SMALL',
      '图片分辨率过低，无法生成清晰的游戏桌壁纸。'
    );
  }

  try {
    const result = await sharp(input, {
      failOn: 'error',
      limitInputPixels: config.playerWallpaper.maxInputPixels,
    })
      .timeout({ seconds: config.playerWallpaper.processingTimeoutSeconds })
      .rotate()
      .toColourspace('srgb')
      .resize({
        width: config.playerWallpaper.normalizedMasterMaxEdge,
        height: config.playerWallpaper.normalizedMasterMaxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: MASTER_WEBP_QUALITY, alphaQuality: 100, effort: 5 })
      .toBuffer({ resolveWithObject: true });

    if (!result.info.width || !result.info.height) {
      throw new Error('missing output dimensions');
    }
    return {
      buffer: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  } catch (error) {
    if (error instanceof PlayerWallpaperImageError) {
      throw error;
    }
    throw new PlayerWallpaperImageError(
      'WALLPAPER_PROCESSING_FAILED',
      '图片处理失败，请重新导出图片后再试。'
    );
  }
}

export async function renderWallpaperLayout(
  master: ProcessedWallpaperImage,
  layout: WallpaperLayout,
  crop: WallpaperCrop,
  options: { readonly inheritedWideSource?: boolean } = {}
): Promise<ProcessedWallpaperImage> {
  const specification = LAYOUTS[layout];
  validateNormalizedCrop(crop, master.width, master.height, layout, options);

  const left = Math.round(crop.x * master.width);
  const top = Math.round(crop.y * master.height);
  const width = Math.min(master.width - left, Math.round(crop.width * master.width));
  const height = Math.min(master.height - top, Math.round(crop.height * master.height));

  try {
    const result = await sharp(master.buffer, {
      failOn: 'error',
      limitInputPixels: config.playerWallpaper.maxInputPixels,
    })
      .timeout({ seconds: config.playerWallpaper.processingTimeoutSeconds })
      .extract({ left, top, width, height })
      .resize({
        width: specification.outputWidth,
        height: specification.outputHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: DISPLAY_WEBP_QUALITY, alphaQuality: 100, effort: 6 })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  } catch {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_PROCESSING_FAILED',
      '图片处理失败，请重新导出图片后再试。'
    );
  }
}

export function validateNormalizedCrop(
  crop: WallpaperCrop,
  sourceWidth: number,
  sourceHeight: number,
  layout: WallpaperLayout,
  options: { readonly inheritedWideSource?: boolean } = {}
): void {
  const values = [crop.x, crop.y, crop.width, crop.height];
  const inRange = values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (
    !inRange ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1.000_001 ||
    crop.y + crop.height > 1.000_001
  ) {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_INVALID_CROP',
      '壁纸裁切区域无效，请重新调整位置。'
    );
  }

  const specification = LAYOUTS[layout];
  const cropWidth = crop.width * sourceWidth;
  const cropHeight = crop.height * sourceHeight;
  const aspect = cropWidth / cropHeight;
  if (Math.abs(aspect - specification.aspect) / specification.aspect > 0.01) {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_INVALID_CROP',
      '壁纸裁切比例无效，请重新调整位置。'
    );
  }
  const minimumWidth =
    layout === 'COMPACT' && options.inheritedWideSource
      ? LAYOUTS.COMPACT.inheritedMinimumWidth
      : specification.minimumWidth;
  const minimumHeight =
    layout === 'COMPACT' && options.inheritedWideSource
      ? LAYOUTS.COMPACT.inheritedMinimumHeight
      : specification.minimumHeight;
  if (cropWidth < minimumWidth || cropHeight < minimumHeight) {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_CROP_TOO_SMALL',
      '图片分辨率过低，无法生成清晰的游戏桌壁纸。'
    );
  }
}

export function validateWallpaperFocus(focus: WallpaperFocus): void {
  if (
    !Number.isFinite(focus.x) ||
    !Number.isFinite(focus.y) ||
    focus.x < 0 ||
    focus.x > 1 ||
    focus.y < 0 ||
    focus.y > 1
  ) {
    throw new PlayerWallpaperImageError(
      'WALLPAPER_INVALID_FOCUS',
      '壁纸主体位置无效，请重新调整位置。'
    );
  }
}

export function getWallpaperLayoutObjectName(layout: WallpaperLayout): 'wide' | 'compact' {
  return LAYOUTS[layout].objectName;
}
