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
    '读取娱乐模式失败'
  );

export const joinThemeTable = () =>
  requireData<PublicTableStatusView>(
    apiClient.post('/api/theme-table/queue/join'),
    '加入娱乐模式失败'
  );

export const heartbeatThemeTable = () =>
  requireData<PublicTableStatusView>(
    apiClient.post('/api/theme-table/queue/heartbeat'),
    '更新娱乐模式候场状态失败'
  );

export const confirmThemeTable = (deckVersionId?: string) =>
  requireData<PublicTableStatusView>(
    apiClient.post('/api/theme-table/queue/confirm', deckVersionId ? { deckVersionId } : {}),
    '确认娱乐模式对局失败'
  );

export const cancelThemeTable = () =>
  requireData<PublicTableStatusView>(
    apiClient.post('/api/theme-table/queue/cancel'),
    '退出娱乐模式失败'
  );
