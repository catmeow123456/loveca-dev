import { apiClient } from '@/lib/apiClient';
import type {
  PublicSiteAnnouncement,
  PublicSiteStatus,
  SiteAnnouncementType,
  SiteStatusLifecycle,
} from '@/lib/appConfig';

export type SiteAnnouncementStatus = 'DRAFT' | 'PUBLISHED';

export interface AdminSiteAnnouncement extends PublicSiteAnnouncement {
  status: SiteAnnouncementStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SiteAnnouncementInput {
  type: SiteAnnouncementType;
  title: string;
  summary: string;
  detail?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: number;
  impactScopes?: readonly string[];
  publish?: boolean;
  publishedAt?: string | null;
}

export interface SiteStatusConfigInput {
  lifecycle: SiteStatusLifecycle;
  title?: string | null;
  summary?: string | null;
  detail?: string | null;
  startsAt?: string | null;
  estimatedEndsAt?: string | null;
  restrictsNewGamesAt?: string | null;
  impactScopes?: readonly string[];
  restrictions?: readonly string[];
  action?: string | null;
}

export async function updateAdminSiteStatusConfig(
  input: SiteStatusConfigInput
): Promise<PublicSiteStatus> {
  const response = await apiClient.put<PublicSiteStatus>(
    '/api/site-announcements/admin/site-status',
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '保存平台状态失败');
  }

  return response.data;
}

export async function fetchAdminSiteAnnouncements(): Promise<readonly AdminSiteAnnouncement[]> {
  const response = await apiClient.get<readonly AdminSiteAnnouncement[]>(
    '/api/site-announcements/admin'
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取公告失败');
  }

  return response.data;
}

export async function createAdminSiteAnnouncement(
  input: SiteAnnouncementInput
): Promise<AdminSiteAnnouncement> {
  const response = await apiClient.post<AdminSiteAnnouncement>(
    '/api/site-announcements/admin',
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '保存公告失败');
  }

  return response.data;
}

export async function updateAdminSiteAnnouncement(
  id: string,
  input: SiteAnnouncementInput
): Promise<AdminSiteAnnouncement> {
  const response = await apiClient.put<AdminSiteAnnouncement>(
    `/api/site-announcements/admin/${encodeURIComponent(id)}`,
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '更新公告失败');
  }

  return response.data;
}

export async function publishAdminSiteAnnouncement(id: string): Promise<AdminSiteAnnouncement> {
  const response = await apiClient.post<AdminSiteAnnouncement>(
    `/api/site-announcements/admin/${encodeURIComponent(id)}/publish`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '发布公告失败');
  }

  return response.data;
}

export async function deleteAdminSiteAnnouncement(id: string): Promise<void> {
  const response = await apiClient.delete<{ deleted: boolean }>(
    `/api/site-announcements/admin/${encodeURIComponent(id)}`
  );
  if (!response.data?.deleted) {
    throw new Error(response.error?.message ?? '删除公告失败');
  }
}
