import { apiClient } from '@/lib/apiClient';
import type {
  PlayerBattleEntryVisibility,
  PublicSiteAnnouncement,
  PublicSiteStatus,
  SiteAnnouncementType,
  SiteStatusLifecycle,
} from '@/lib/appConfig';
import type { BattleTimeoutConfig } from '@game/online';

export type SiteAnnouncementStatus = 'DRAFT' | 'PUBLISHED';

export interface AdminSiteAnnouncement extends PublicSiteAnnouncement {
  status: SiteAnnouncementStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export async function updatePlayerBattleEntryVisibility(
  input: PlayerBattleEntryVisibility
): Promise<PlayerBattleEntryVisibility> {
  const response = await apiClient.put<PlayerBattleEntryVisibility>(
    '/api/site-announcements/admin/player-battle-entries',
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '保存玩家对战入口失败');
  }
  return response.data;
}

export async function fetchAdminBattleTimeoutConfig(): Promise<BattleTimeoutConfig> {
  const response = await apiClient.get<BattleTimeoutConfig>(
    '/api/site-announcements/admin/battle-timeouts'
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取对战时限配置失败');
  }
  return response.data;
}

export async function updateAdminBattleTimeoutConfig(
  input: BattleTimeoutConfig
): Promise<BattleTimeoutConfig> {
  const response = await apiClient.put<BattleTimeoutConfig>(
    '/api/site-announcements/admin/battle-timeouts',
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '保存对战时限配置失败');
  }
  return response.data;
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
  maintenanceConfirmed?: boolean;
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

export interface PublicSnapshotInspection {
  status: 'SYNCED' | 'FAILED' | 'UNVERIFIED';
  availability: 'OPEN' | 'MAINTENANCE' | null;
  generatedAt: string | null;
  error: string | null;
}

export interface AdminSiteStatusView {
  siteStatus: PublicSiteStatus;
  publicSnapshot: PublicSnapshotInspection;
}

export async function fetchAdminSiteStatus(): Promise<AdminSiteStatusView> {
  const response = await apiClient.get<AdminSiteStatusView>(
    '/api/site-announcements/admin/site-status'
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取平台状态失败');
  }
  return response.data;
}

export async function updateAdminSiteStatusConfig(
  input: SiteStatusConfigInput
): Promise<AdminSiteStatusView> {
  const response = await apiClient.put<AdminSiteStatusView>(
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
