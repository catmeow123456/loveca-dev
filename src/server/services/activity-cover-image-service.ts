import { config } from '../config.js';
import type {
  ActivityCoverCrop,
  ActivityCoverFocus,
  ActivityCoverLayout,
} from '../../online/activity-cover-types.js';
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
    aspect: 16 / 7,
    minimumWidth: 1280,
    minimumHeight: 560,
    outputWidth: 1920,
    outputHeight: 840,
  },
  COMPACT: {
    aspect: 4 / 3,
    minimumWidth: 960,
    minimumHeight: 720,
    outputWidth: 960,
    outputHeight: 720,
  },
} as const satisfies Record<ActivityCoverLayout, StaticImageLayoutSpecification>;

const IMAGE_LIMITS: StaticImageProcessingLimits = {
  maxInputPixels: config.playerWallpaper.maxInputPixels,
  maxInputEdge: config.playerWallpaper.maxInputEdge,
  minimumSourceEdge: 720,
  normalizedMasterMaxEdge: config.playerWallpaper.normalizedMasterMaxEdge,
  processingTimeoutSeconds: config.playerWallpaper.processingTimeoutSeconds,
  masterWebpQuality: 92,
  displayWebpQuality: 84,
};

export class ActivityCoverImageError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ActivityCoverImageError';
  }
}

export type ProcessedActivityCoverImage = ProcessedStaticImage;

export function withActivityCoverProcessingSlot<T>(operation: () => Promise<T>): Promise<T> {
  return withStaticImageProcessingSlot(config.playerWallpaper.processingConcurrency, operation);
}

export async function normalizeActivityCoverSource(
  input: Buffer
): Promise<ProcessedActivityCoverImage> {
  try {
    return await normalizeStaticImageSource(input, IMAGE_LIMITS);
  } catch (error) {
    throw mapStaticImageError(error);
  }
}

export async function renderActivityCoverLayout(
  master: ProcessedActivityCoverImage,
  layout: ActivityCoverLayout,
  crop: ActivityCoverCrop
): Promise<ProcessedActivityCoverImage> {
  try {
    return await renderStaticImageCrop(master, crop, LAYOUTS[layout], IMAGE_LIMITS);
  } catch (error) {
    throw mapStaticImageError(error);
  }
}

export function validateActivityCoverCrop(
  crop: ActivityCoverCrop,
  sourceWidth: number,
  sourceHeight: number,
  layout: ActivityCoverLayout
): void {
  try {
    validateNormalizedImageCrop(crop, sourceWidth, sourceHeight, LAYOUTS[layout]);
  } catch (error) {
    throw mapStaticImageError(error);
  }
}

export function validateActivityCoverFocus(focus: ActivityCoverFocus): void {
  try {
    validateNormalizedImageFocus(focus);
  } catch (error) {
    throw mapStaticImageError(error);
  }
}

function mapStaticImageError(error: unknown): ActivityCoverImageError {
  if (error instanceof ActivityCoverImageError) return error;
  const code = error instanceof StaticImageProcessingError ? error.code : 'PROCESSING_FAILED';
  switch (code) {
    case 'UNSUPPORTED_FORMAT':
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_UNSUPPORTED_FORMAT',
        '请选择 JPG、PNG 或静态 WebP 图片。'
      );
    case 'ANIMATED_IMAGE':
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_ANIMATED_IMAGE',
        '活动封面暂不支持动画图片。'
      );
    case 'DIMENSIONS_TOO_LARGE':
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_DIMENSIONS_TOO_LARGE',
        '图片像素尺寸过大，请缩小后重新选择。'
      );
    case 'PIXELS_TOO_SMALL':
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_PIXELS_TOO_SMALL',
        '图片分辨率过低，无法生成清晰的活动封面。'
      );
    case 'INVALID_CROP':
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_INVALID_CROP',
        '活动封面裁切区域无效，请重新调整。'
      );
    case 'INVALID_CROP_ASPECT':
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_INVALID_CROP',
        '活动封面裁切比例无效，请重新调整。'
      );
    case 'CROP_TOO_SMALL':
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_CROP_TOO_SMALL',
        '当前裁切区域像素不足，请扩大裁切范围或更换图片。'
      );
    case 'INVALID_FOCUS':
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_INVALID_FOCUS',
        '活动封面主体位置无效，请重新调整。'
      );
    case 'DECODE_FAILED':
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_DECODE_FAILED',
        '图片无法解码，请重新导出后再试。'
      );
    default:
      return new ActivityCoverImageError(
        'ACTIVITY_COVER_PROCESSING_FAILED',
        '图片处理失败，当前封面没有改变，请稍后重试。'
      );
  }
}
