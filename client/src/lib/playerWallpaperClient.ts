import { ApiClientError, apiClient, toApiClientError } from './apiClient';
import type {
  CompactWallpaperMode,
  PlayerWallpaperSolidPreset,
  PlayerWallpaperAssetView,
  PlayerWallpaperPublishResult,
  PlayerWallpaperView,
  WallpaperCrop,
  WallpaperFocus,
  WideWallpaperMode,
} from '@game/online/player-wallpaper-types';

export interface WallpaperLayoutSubmission {
  readonly source?: 'UPLOAD' | 'CURRENT';
  readonly crop: WallpaperCrop;
  readonly focus: WallpaperFocus;
}

export interface PublishPlayerWallpaperSubmission {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly wideMode: WideWallpaperMode;
  readonly compactMode: CompactWallpaperMode;
  readonly wideSolidPreset: PlayerWallpaperSolidPreset | null;
  readonly compactSolidPreset: PlayerWallpaperSolidPreset | null;
  readonly wide: WallpaperLayoutSubmission | null;
  readonly compact: WallpaperLayoutSubmission | null;
  readonly wideFile?: File;
  readonly compactFile?: File;
}

const PLAYER_WALLPAPER_UPLOAD_TIMEOUT_MS = 90_000;

export async function fetchPlayerWallpaper(includeSources = false): Promise<PlayerWallpaperView> {
  const query = includeSources ? '?includeSources=true' : '';
  const response = await apiClient.get<PlayerWallpaperView>(`/api/player-wallpapers${query}`);
  if (!response.data || response.error) {
    throw toApiClientError(response, '读取游戏桌壁纸失败');
  }
  return response.data;
}

export async function publishPlayerWallpaper(
  submission: PublishPlayerWallpaperSubmission
): Promise<PlayerWallpaperPublishResult> {
  const formData = new FormData();
  formData.append(
    'config',
    JSON.stringify({
      expectedVersion: submission.expectedVersion,
      idempotencyKey: submission.idempotencyKey,
      wideMode: submission.wideMode,
      compactMode: submission.compactMode,
      wideSolidPreset: submission.wideSolidPreset,
      compactSolidPreset: submission.compactSolidPreset,
      wide: submission.wide,
      compact: submission.compact,
    })
  );
  if (submission.wideFile) formData.append('wide', submission.wideFile);
  if (submission.compactFile) formData.append('compact', submission.compactFile);

  const response = await apiClient.post<PlayerWallpaperPublishResult>(
    '/api/player-wallpapers',
    formData,
    PLAYER_WALLPAPER_UPLOAD_TIMEOUT_MS
  );
  if (!response.data || response.error) {
    throw toApiClientError(response, '保存壁纸失败');
  }
  return response.data;
}

export function getPlayerWallpaperErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof ApiClientError)) {
    return error instanceof Error ? error.message : fallbackMessage;
  }

  if (error.code === 'WALLPAPER_PIXELS_TOO_SMALL' || error.code === 'WALLPAPER_CROP_TOO_SMALL') {
    return '图片分辨率不足，请换一张尺寸更大的图片。';
  }
  if (error.code === 'TIMEOUT') {
    return '壁纸处理超时，请稍后重试，也可以先压缩图片。';
  }
  if (error.code === 'INVALID_RESPONSE' || (error.status !== undefined && error.status >= 500)) {
    return '服务器暂时无法处理壁纸，请稍后重试。';
  }
  return error.message || fallbackMessage;
}

export async function resetPlayerWallpaper(
  expectedVersion: number,
  idempotencyKey: string
): Promise<PlayerWallpaperPublishResult> {
  const response = await apiClient.post<PlayerWallpaperPublishResult>(
    '/api/player-wallpapers/reset',
    { expectedVersion, idempotencyKey }
  );
  if (!response.data || response.error) {
    throw toApiClientError(response, '恢复默认壁纸失败');
  }
  return response.data;
}

export async function downloadPlayerWallpaperAsset(
  asset: Pick<PlayerWallpaperAssetView, 'url'>
): Promise<string> {
  const response = await apiClient.getBlob(asset.url);
  if (!response.data || response.error) {
    throw toApiClientError(response, '壁纸资源暂时无法加载');
  }
  await decodeImage(response.data);
  return URL.createObjectURL(response.data);
}

async function decodeImage(blob: Blob): Promise<void> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('壁纸资源解码失败'));
    };
    image.src = url;
  });
}
