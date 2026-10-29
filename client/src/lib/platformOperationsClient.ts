import { ApiClientError, apiClient, toApiClientError } from './apiClient';

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
  processedMatchCount: number;
}
export type ReplayRetentionJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type ReplayRetentionProgressPhase = 'preparing' | 'purging' | 'completed';
export interface ReplayRetentionProgress {
  phase: ReplayRetentionProgressPhase;
  candidateMatchCount: number;
  processedMatchCount: number;
  metadataRowsUpdated: number;
  replayRows: number;
  checkpointRows: number;
  eventRows: number;
  decisionRows: number;
  blockedRankedMatchCount: number;
}
export interface ReplayRetentionJob {
  id: string;
  status: ReplayRetentionJobStatus;
  progress: ReplayRetentionProgress;
  report: ReplayRetentionReport | null;
  error: { code: string; message: string } | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}
export async function previewReplayRetention(): Promise<ReplayRetentionReport> {
  const response = await apiClient.get<ReplayRetentionReport>(
    '/api/admin/platform-operations/replay-retention/preview'
  );
  if (!response.data) throw new Error(response.error?.message ?? '读取回放清理预览失败');
  return response.data;
}
export async function applyReplayRetention(confirmation: string): Promise<ReplayRetentionJob> {
  const response = await apiClient.post<ReplayRetentionJob>(
    '/api/admin/platform-operations/replay-retention/apply',
    { confirmation }
  );
  if (!response.data) throw new Error(response.error?.message ?? '清理回放数据失败');
  return response.data;
}
export async function fetchReplayRetentionJob(jobId: string): Promise<ReplayRetentionJob> {
  const response = await apiClient.get<ReplayRetentionJob>(
    `/api/admin/platform-operations/replay-retention/apply/${encodeURIComponent(jobId)}`
  );
  if (!response.data) throw toApiClientError(response, '读取回放清理进度失败');
  return response.data;
}
export function isTerminalReplayRetentionPollError(error: unknown): boolean {
  if (!(error instanceof ApiClientError) || error.status === undefined) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
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
