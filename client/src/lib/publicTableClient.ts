import { apiClient } from '@/lib/apiClient';
import type {
  PublicTableStatusView,
  PublicTableSummaryView,
} from '@game/online/public-table-types';

async function requireData<T>(
  request: Promise<{ data: T | null; error: { message: string } | null }>,
  fallback: string
): Promise<T> {
  const response = await request;
  if (!response.data) {
    throw new Error(response.error?.message ?? fallback);
  }
  return response.data;
}

export function fetchPublicTableSummary(): Promise<PublicTableSummaryView> {
  return requireData(apiClient.get('/api/public-table/summary'), '读取公共牌桌状态失败');
}

export function fetchPublicTableStatus(): Promise<PublicTableStatusView> {
  return requireData(apiClient.get('/api/public-table/me'), '读取找对手状态失败');
}

export function joinPublicTable(
  deckId: string,
  entrySource: 'DIRECT' | 'SHARED_LINK' = 'DIRECT'
): Promise<PublicTableStatusView> {
  return requireData(
    apiClient.post('/api/public-table/join', { deckId, entrySource }),
    '开始找对手失败'
  );
}

export function heartbeatPublicTable(): Promise<PublicTableStatusView> {
  return requireData(apiClient.post('/api/public-table/heartbeat'), '更新找对手状态失败');
}

export function confirmPublicTable(): Promise<PublicTableStatusView> {
  return requireData(apiClient.post('/api/public-table/confirm'), '确认对局失败');
}

export function cancelPublicTable(): Promise<PublicTableStatusView> {
  return requireData(apiClient.post('/api/public-table/cancel'), '结束等待失败');
}
