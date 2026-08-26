import type {
  ActivityBadgeActivityType,
  ActivityBadgeAdminView,
  ActivityBadgeSaveResult,
} from '@game/online/activity-badge-types';
import { apiClient, toApiClientError } from './apiClient';

export async function fetchActivityBadgeAdmin(
  activityType: ActivityBadgeActivityType,
  activityId: string
): Promise<ActivityBadgeAdminView> {
  const response = await apiClient.get<ActivityBadgeAdminView>(badgePath(activityType, activityId));
  if (!response.data || response.error) {
    throw toApiClientError(response, '读取活动徽章失败');
  }
  return response.data;
}

export async function saveActivityBadge(
  activityType: ActivityBadgeActivityType,
  activityId: string,
  input: {
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly file: File;
  }
): Promise<ActivityBadgeSaveResult> {
  const formData = new FormData();
  formData.append(
    'config',
    JSON.stringify({
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    })
  );
  formData.append('image', input.file);
  const response = await apiClient.post<ActivityBadgeSaveResult>(
    badgePath(activityType, activityId),
    formData,
    60_000
  );
  if (!response.data || response.error) {
    throw toApiClientError(response, '保存活动徽章失败');
  }
  return response.data;
}

function badgePath(activityType: ActivityBadgeActivityType, activityId: string): string {
  return `/api/admin/activity-badges/${activityType}/${activityId}`;
}
