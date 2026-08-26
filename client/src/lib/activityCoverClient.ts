import type {
  ActivityCoverActivityType,
  ActivityCoverAdminView,
  ActivityCoverCrop,
  ActivityCoverFocus,
  ActivityCoverMaskLevel,
  ActivityCoverSaveResult,
} from '@game/online/activity-cover-types';
import { apiClient, toApiClientError } from './apiClient';

export interface SaveActivityCoverSubmission {
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly source: 'UPLOAD' | 'CURRENT';
  readonly maskLevel: ActivityCoverMaskLevel;
  readonly wide: { readonly crop: ActivityCoverCrop; readonly focus: ActivityCoverFocus };
  readonly compact: { readonly crop: ActivityCoverCrop; readonly focus: ActivityCoverFocus };
  readonly file?: File;
}

export async function fetchActivityCoverAdmin(
  activityType: ActivityCoverActivityType,
  activityId: string
): Promise<ActivityCoverAdminView> {
  const response = await apiClient.get<ActivityCoverAdminView>(coverPath(activityType, activityId));
  if (!response.data || response.error) {
    throw toApiClientError(response, '读取活动封面失败');
  }
  return response.data;
}

export async function saveActivityCover(
  activityType: ActivityCoverActivityType,
  activityId: string,
  submission: SaveActivityCoverSubmission
): Promise<ActivityCoverSaveResult> {
  const formData = new FormData();
  formData.append(
    'config',
    JSON.stringify({
      expectedRevision: submission.expectedRevision,
      idempotencyKey: submission.idempotencyKey,
      source: submission.source,
      maskLevel: submission.maskLevel,
      wide: submission.wide,
      compact: submission.compact,
    })
  );
  if (submission.file) formData.append('image', submission.file);
  const response = await apiClient.post<ActivityCoverSaveResult>(
    coverPath(activityType, activityId),
    formData,
    60_000
  );
  if (!response.data || response.error) {
    throw toApiClientError(response, '保存活动封面失败');
  }
  return response.data;
}

export async function removeActivityCover(
  activityType: ActivityCoverActivityType,
  activityId: string,
  input: {
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly reason: string;
  }
): Promise<ActivityCoverSaveResult> {
  const response = await apiClient.delete<ActivityCoverSaveResult>(
    coverPath(activityType, activityId),
    input
  );
  if (!response.data || response.error) {
    throw toApiClientError(response, '移除活动封面失败');
  }
  return response.data;
}

export async function downloadActivityCoverSource(url: string): Promise<string> {
  const response = await apiClient.getBlob(url);
  if (!response.data || response.error) {
    throw toApiClientError(response, '活动封面母图暂时无法加载');
  }
  await decodeImage(response.data);
  return URL.createObjectURL(response.data);
}

function coverPath(activityType: ActivityCoverActivityType, activityId: string): string {
  return `/api/admin/activity-covers/${activityType}/${activityId}`;
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
      reject(new Error('活动封面母图解码失败'));
    };
    image.src = url;
  });
}
