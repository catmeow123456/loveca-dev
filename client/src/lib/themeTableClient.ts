import type { PublicTableStatusView } from '@game/online/public-table-types';
import type { ThemeTableOverviewView } from '@game/online/theme-table-types';
import { apiClient } from '@/lib/apiClient';

async function requireData<T>(
  request: Promise<{ data: T | null; error: { message: string } | null }>,
  fallback: string
): Promise<T> {
  const response = await request;
  if (!response.data) throw new Error(response.error?.message ?? fallback);
  return response.data;
}

export const fetchThemeTableOverview = () =>
  requireData<ThemeTableOverviewView>(
    apiClient.get('/api/theme-table/overview'),
    '读取主题牌桌失败'
  );

export const joinThemeTable = () =>
  requireData<PublicTableStatusView>(
    apiClient.post('/api/theme-table/queue/join'),
    '加入主题牌桌失败'
  );

export const heartbeatThemeTable = () =>
  requireData<PublicTableStatusView>(
    apiClient.post('/api/theme-table/queue/heartbeat'),
    '更新主题牌桌候场状态失败'
  );

export const confirmThemeTable = (deckVersionId?: string) =>
  requireData<PublicTableStatusView>(
    apiClient.post('/api/theme-table/queue/confirm', deckVersionId ? { deckVersionId } : {}),
    '确认主题牌桌对局失败'
  );

export const cancelThemeTable = () =>
  requireData<PublicTableStatusView>(
    apiClient.post('/api/theme-table/queue/cancel'),
    '退出主题牌桌失败'
  );
