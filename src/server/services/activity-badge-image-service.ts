import { config } from '../config.js';
import {
  normalizeStaticImageSource,
  StaticImageProcessingError,
  withStaticImageProcessingSlot,
  type ProcessedStaticImage,
  type StaticImageProcessingLimits,
} from './static-image-processing-service.js';

const IMAGE_LIMITS: StaticImageProcessingLimits = {
  maxInputPixels: config.playerWallpaper.maxInputPixels,
  maxInputEdge: config.playerWallpaper.maxInputEdge,
  minimumSourceEdge: 128,
  normalizedMasterMaxEdge: 512,
  processingTimeoutSeconds: config.playerWallpaper.processingTimeoutSeconds,
  masterWebpQuality: 90,
  displayWebpQuality: 90,
};

export class ActivityBadgeImageError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ActivityBadgeImageError';
  }
}

export function withActivityBadgeProcessingSlot<T>(operation: () => Promise<T>): Promise<T> {
  return withStaticImageProcessingSlot(config.playerWallpaper.processingConcurrency, operation);
}

export async function normalizeActivityBadgeImage(input: Buffer): Promise<ProcessedStaticImage> {
  try {
    return await normalizeStaticImageSource(input, IMAGE_LIMITS);
  } catch (error) {
    throw mapStaticImageError(error);
  }
}

function mapStaticImageError(error: unknown): ActivityBadgeImageError {
  const code = error instanceof StaticImageProcessingError ? error.code : 'PROCESSING_FAILED';
  switch (code) {
    case 'UNSUPPORTED_FORMAT':
      return new ActivityBadgeImageError(
        'ACTIVITY_BADGE_UNSUPPORTED_FORMAT',
        '请选择 JPG、PNG 或静态 WebP 图片。'
      );
    case 'ANIMATED_IMAGE':
      return new ActivityBadgeImageError(
        'ACTIVITY_BADGE_ANIMATED_IMAGE',
        '活动徽章暂不支持动画图片。'
      );
    case 'DIMENSIONS_TOO_LARGE':
      return new ActivityBadgeImageError(
        'ACTIVITY_BADGE_DIMENSIONS_TOO_LARGE',
        '图片像素尺寸过大，请缩小后重新选择。'
      );
    case 'PIXELS_TOO_SMALL':
      return new ActivityBadgeImageError(
        'ACTIVITY_BADGE_PIXELS_TOO_SMALL',
        '徽章图片的宽和高都不能小于 128 像素。'
      );
    case 'DECODE_FAILED':
      return new ActivityBadgeImageError(
        'ACTIVITY_BADGE_DECODE_FAILED',
        '图片无法解码，请重新导出后再试。'
      );
    default:
      return new ActivityBadgeImageError(
        'ACTIVITY_BADGE_PROCESSING_FAILED',
        '图片处理失败，当前徽章没有改变，请稍后重试。'
      );
  }
}
