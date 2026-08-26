import sharp from 'sharp';

export type StaticImageProcessingErrorCode =
  | 'DECODE_FAILED'
  | 'UNSUPPORTED_FORMAT'
  | 'ANIMATED_IMAGE'
  | 'DIMENSIONS_TOO_LARGE'
  | 'PIXELS_TOO_SMALL'
  | 'INVALID_CROP'
  | 'INVALID_CROP_ASPECT'
  | 'CROP_TOO_SMALL'
  | 'INVALID_FOCUS'
  | 'PROCESSING_FAILED';

export class StaticImageProcessingError extends Error {
  constructor(public readonly code: StaticImageProcessingErrorCode) {
    super(code);
    this.name = 'StaticImageProcessingError';
  }
}

export interface NormalizedImageCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NormalizedImageFocus {
  readonly x: number;
  readonly y: number;
}

export interface ProcessedStaticImage {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface StaticImageProcessingLimits {
  readonly maxInputPixels: number;
  readonly maxInputEdge: number;
  readonly minimumSourceEdge: number;
  readonly normalizedMasterMaxEdge: number;
  readonly processingTimeoutSeconds: number;
  readonly masterWebpQuality: number;
  readonly displayWebpQuality: number;
}

export interface StaticImageLayoutSpecification {
  readonly aspect: number;
  readonly minimumWidth: number;
  readonly minimumHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
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

const processingSemaphores = new Map<number, ProcessingSemaphore>();

export function withStaticImageProcessingSlot<T>(
  concurrency: number,
  operation: () => Promise<T>
): Promise<T> {
  let semaphore = processingSemaphores.get(concurrency);
  if (!semaphore) {
    semaphore = new ProcessingSemaphore(concurrency);
    processingSemaphores.set(concurrency, semaphore);
  }
  return semaphore.run(operation);
}

export async function normalizeStaticImageSource(
  input: Buffer,
  limits: StaticImageProcessingLimits
): Promise<ProcessedStaticImage> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, {
      animated: true,
      failOn: 'error',
      limitInputPixels: limits.maxInputPixels,
    })
      .timeout({ seconds: limits.processingTimeoutSeconds })
      .metadata();
  } catch {
    throw new StaticImageProcessingError('DECODE_FAILED');
  }

  if (!metadata.format || !new Set(['jpeg', 'png', 'webp']).has(metadata.format)) {
    throw new StaticImageProcessingError('UNSUPPORTED_FORMAT');
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new StaticImageProcessingError('ANIMATED_IMAGE');
  }
  if (!metadata.width || !metadata.height) {
    throw new StaticImageProcessingError('DECODE_FAILED');
  }

  const swapsDimensions = (metadata.orientation ?? 1) >= 5;
  const orientedWidth = swapsDimensions ? metadata.height : metadata.width;
  const orientedHeight = swapsDimensions ? metadata.width : metadata.height;
  if (Math.max(orientedWidth, orientedHeight) > limits.maxInputEdge) {
    throw new StaticImageProcessingError('DIMENSIONS_TOO_LARGE');
  }
  if (orientedWidth < limits.minimumSourceEdge || orientedHeight < limits.minimumSourceEdge) {
    throw new StaticImageProcessingError('PIXELS_TOO_SMALL');
  }

  try {
    const result = await sharp(input, {
      failOn: 'error',
      limitInputPixels: limits.maxInputPixels,
    })
      .timeout({ seconds: limits.processingTimeoutSeconds })
      .rotate()
      .toColourspace('srgb')
      .resize({
        width: limits.normalizedMasterMaxEdge,
        height: limits.normalizedMasterMaxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: limits.masterWebpQuality, alphaQuality: 100, effort: 5 })
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
    if (error instanceof StaticImageProcessingError) throw error;
    throw new StaticImageProcessingError('PROCESSING_FAILED');
  }
}

export async function renderStaticImageCrop(
  master: ProcessedStaticImage,
  crop: NormalizedImageCrop,
  specification: StaticImageLayoutSpecification,
  limits: StaticImageProcessingLimits
): Promise<ProcessedStaticImage> {
  validateNormalizedImageCrop(crop, master.width, master.height, specification);

  const left = Math.round(crop.x * master.width);
  const top = Math.round(crop.y * master.height);
  const width = Math.min(master.width - left, Math.round(crop.width * master.width));
  const height = Math.min(master.height - top, Math.round(crop.height * master.height));

  try {
    const result = await sharp(master.buffer, {
      failOn: 'error',
      limitInputPixels: limits.maxInputPixels,
    })
      .timeout({ seconds: limits.processingTimeoutSeconds })
      .extract({ left, top, width, height })
      .resize({
        width: specification.outputWidth,
        height: specification.outputHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: limits.displayWebpQuality, alphaQuality: 100, effort: 6 })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  } catch {
    throw new StaticImageProcessingError('PROCESSING_FAILED');
  }
}

export function validateNormalizedImageCrop(
  crop: NormalizedImageCrop,
  sourceWidth: number,
  sourceHeight: number,
  specification: StaticImageLayoutSpecification
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
    throw new StaticImageProcessingError('INVALID_CROP');
  }

  const cropWidth = crop.width * sourceWidth;
  const cropHeight = crop.height * sourceHeight;
  const aspect = cropWidth / cropHeight;
  if (Math.abs(aspect - specification.aspect) / specification.aspect > 0.01) {
    throw new StaticImageProcessingError('INVALID_CROP_ASPECT');
  }
  if (cropWidth < specification.minimumWidth || cropHeight < specification.minimumHeight) {
    throw new StaticImageProcessingError('CROP_TOO_SMALL');
  }
}

export function validateNormalizedImageFocus(focus: NormalizedImageFocus): void {
  if (
    !Number.isFinite(focus.x) ||
    !Number.isFinite(focus.y) ||
    focus.x < 0 ||
    focus.x > 1 ||
    focus.y < 0 ||
    focus.y > 1
  ) {
    throw new StaticImageProcessingError('INVALID_FOCUS');
  }
}
