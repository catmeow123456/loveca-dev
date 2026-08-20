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
export async function exportRankedAnalysis(seasonId: string): Promise<Blob> {
  const response = await apiClient.postBlob(
    '/api/admin/platform-operations/ranked-analysis-export',
    { seasonId },
    120_000
  );
  if (!response.data) throw new Error(response.error?.message ?? '生成赛季分析数据失败');
  return response.data;
}
