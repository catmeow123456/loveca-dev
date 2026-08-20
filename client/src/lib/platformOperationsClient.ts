import { apiClient } from './apiClient';

export interface ReplayRetentionReport {
  retentionDays: number;
  cutoff: string;
  candidateMatchCount: number;
  replayRows: number;
  checkpointRows: number;
  eventRows: number;
  decisionRows: number;
  blockedRankedMatchCount: number;
  metadataRowsUpdated: number;
}
export async function previewReplayRetention(): Promise<ReplayRetentionReport> {
  const response = await apiClient.get<ReplayRetentionReport>(
    '/api/admin/platform-operations/replay-retention/preview'
  );
  if (!response.data) throw new Error(response.error?.message ?? '读取回放清理预览失败');
  return response.data;
}
export async function applyReplayRetention(confirmation: string): Promise<ReplayRetentionReport> {
  const response = await apiClient.post<ReplayRetentionReport>(
    '/api/admin/platform-operations/replay-retention/apply',
    { confirmation }
  );
  if (!response.data) throw new Error(response.error?.message ?? '清理回放数据失败');
  return response.data;
}
export async function generateRankedVolatilityReport(
  seasonId?: string
): Promise<{ report: unknown; markdown: string }> {
  const response = await apiClient.post<{ report: unknown; markdown: string }>(
    '/api/admin/platform-operations/ranked-volatility-report',
    seasonId ? { seasonId } : {}
  );
  if (!response.data) throw new Error(response.error?.message ?? '生成赛季报告失败');
  return response.data;
}
