/**
 * Card image upload service
 *
 * Provides card image compression and upload via API.
 * Browser-side compression using Canvas API.
 */

import { apiClient, isApiConfigured } from './apiClient';

// ============================================
// Configuration
// ============================================

/** Supported image formats */
const SUPPORTED_FORMATS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/** Max file size (10MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Size configuration */
const SIZE_CONFIG = {
  thumb: { width: 100, quality: 0.75 },
  medium: { width: 300, quality: 0.80 },
  large: { width: 600, quality: 0.85 },
} as const;

type ImageSize = keyof typeof SIZE_CONFIG;

// ============================================
// Types
// ============================================

export interface UploadResult {
  success: boolean;
  imageFilename: string;
  error?: string;
}

export interface UploadProgress {
  status: 'compressing' | 'uploading' | 'done' | 'error';
  progress: number;
  message: string;
}

export type ProgressCallback = (progress: UploadProgress) => void;

// ============================================
// Validation
// ============================================

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!SUPPORTED_FORMATS.includes(file.type)) {
    return {
      valid: false,
      error: `不支持的图片格式: ${file.type}。支持: JPG, PNG, WebP`,
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `文件过大: ${(file.size / 1024 / 1024).toFixed(2)}MB。最大: 10MB`,
    };
  }

  return { valid: true };
}

// ============================================
// Image compression
// ============================================

async function compressImage(
  file: File,
  targetWidth: number,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const aspectRatio = img.height / img.width;
      const width = targetWidth;
      const height = Math.round(targetWidth * aspectRatio);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建 Canvas 上下文'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('图片压缩失败'));
          }
        },
        'image/webp',
        quality
      );
    };

    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = URL.createObjectURL(file);
  });
}

async function compressAllSizes(
  file: File,
  onProgress?: ProgressCallback
): Promise<Map<ImageSize, Blob>> {
  const results = new Map<ImageSize, Blob>();
  const sizes = Object.keys(SIZE_CONFIG) as ImageSize[];
  let completed = 0;

  for (const size of sizes) {
    const config = SIZE_CONFIG[size];
    const blob = await compressImage(file, config.width, config.quality);
    results.set(size, blob);

    completed++;
    onProgress?.({
      status: 'compressing',
      progress: Math.round((completed / sizes.length) * 50),
      message: `压缩中... ${size} (${config.width}px)`,
    });
  }

  return results;
}

// ============================================
// Upload
// ============================================

/**
 * Upload card image (compress to 3 sizes and upload via API)
 */
export async function uploadCardImage(
  file: File,
  cardCode: string,
  onProgress?: ProgressCallback
): Promise<UploadResult> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    return { success: false, imageFilename: '', error: validation.error };
  }

  if (!isApiConfigured) {
    return { success: false, imageFilename: '', error: 'API 未配置，无法上传图片' };
  }

  try {
    onProgress?.({ status: 'compressing', progress: 0, message: '开始压缩图片...' });

    const compressedImages = await compressAllSizes(file, onProgress);

    onProgress?.({ status: 'uploading', progress: 50, message: '开始上传图片...' });

    // Build FormData with all sizes
    const formData = new FormData();
    for (const [size, blob] of compressedImages) {
      formData.append(size, blob, `${size}.webp`);
    }

    const result = await apiClient.post<{ success: boolean; uploaded: string[] }>(
      `/api/images/${encodeURIComponent(cardCode)}`,
      formData
    );

    if (result.error) {
      onProgress?.({ status: 'error', progress: 0, message: result.error.message });
      return { success: false, imageFilename: '', error: result.error.message };
    }

    onProgress?.({ status: 'done', progress: 100, message: '上传完成！' });

    return { success: true, imageFilename: `${cardCode}.webp` };
  } catch (err) {
    const message = err instanceof Error ? err.message : '上传失败';
    onProgress?.({ status: 'error', progress: 0, message });
    return { success: false, imageFilename: '', error: message };
  }
}

/**
 * Delete card image (all sizes)
 */
export async function deleteCardImage(cardCode: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await apiClient.delete(`/api/images/${encodeURIComponent(cardCode)}`);
    if (result.error) {
      return { success: false, error: result.error.message };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '删除失败' };
  }
}

/**
 * Check if image exists (via HEAD request to Nginx/MinIO)
 */
export async function checkImageExists(cardCode: string): Promise<boolean> {
  if (!import.meta.env.VITE_API_BASE_URL) return false;
  try {
    const url = `${import.meta.env.VITE_API_BASE_URL}/images/medium/${encodeURIComponent(cardCode)}.webp`;
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

export function getImagePreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}

export function revokeImagePreviewUrl(url: string): void {
  URL.revokeObjectURL(url);
}
