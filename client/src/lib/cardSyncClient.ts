import { apiClient } from '@/lib/apiClient';

const CARD_SYNC_PREVIEW_TIMEOUT_MS = 60_000;

export type CardSyncConfiguration = 'READY' | 'NOT_CONFIGURED';
export type CardSyncImageCheckMode = 'NONE' | 'LINK' | 'DECODE';
export type CardSyncRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type CardSyncRunItemStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export interface CardSyncCandidate {
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: string;
  readonly cost?: number | null;
  readonly score?: number | null;
  readonly warnings: readonly string[];
}

export interface CardSyncForceImport {
  readonly sourceKey: string;
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: 'MEMBER' | 'LIVE' | 'ENERGY';
  readonly skipImage?: boolean;
}
export interface CardSyncBlockedItem {
  readonly sourceKey?: string;
  readonly suggestedCardCode?: string;
  readonly cardType?: string | null;
  readonly imageIssue?: boolean;
  readonly cardCode?: string | null;
  readonly name?: string | null;
  readonly reasons: readonly string[];
}

export interface CardSyncPreview {
  readonly id: string;
  readonly imageCheck: CardSyncImageCheckMode;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly summary: {
    readonly sourceCount: number;
    readonly existingCount: number;
    readonly candidateCount: number;
    readonly blockedCount: number;
    readonly warningCount: number;
  };
  readonly candidates: readonly CardSyncCandidate[];
  readonly blocked: readonly CardSyncBlockedItem[];
}

export interface CardSyncRunItem {
  readonly cardCode: string;
  readonly name: string;
  readonly status: CardSyncRunItemStatus;
  /** The server must only return an operator-safe, redacted message. */
  readonly message?: string | null;
}

export interface CardSyncRun {
  readonly id: string;
  readonly previewId: string;
  readonly status: CardSyncRunStatus;
  readonly createdAt: string;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly summary: {
    readonly totalCount: number;
    readonly succeededCount: number;
    readonly failedCount: number;
    readonly pendingCount: number;
  };
  readonly items: readonly CardSyncRunItem[];
  /** The server must only return an operator-safe, redacted message. */
  readonly message?: string | null;
}

export interface CardSyncStatus {
  readonly configuration: CardSyncConfiguration;
  readonly activeRun: CardSyncRun | null;
  readonly latestRun: CardSyncRun | null;
}

async function requireData<T>(
  request: Promise<{ data: T | null; error: { message: string } | null }>,
  fallback: string
): Promise<T> {
  const response = await request;
  if (!response.data) throw new Error(response.error?.message ?? fallback);
  return response.data;
}

export function isCardSyncRunActive(status: CardSyncRunStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}

export function newCardSyncIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function fetchCardSyncStatus(): Promise<CardSyncStatus> {
  return requireData(
    apiClient.get<CardSyncStatus>('/api/admin/card-sync/status'),
    '读取新卡同步状态失败'
  );
}

export async function createCardSyncPreview(
  idempotencyKey = newCardSyncIdempotencyKey(),
  options: {
    imageCheck?: CardSyncImageCheckMode;
    onProgress?: (progress: { checked: number; total: number }) => void;
    signal?: AbortSignal;
  } = {}
): Promise<CardSyncPreview> {
  type Pending = { id: string; status: 'RUNNING'; progress: { checked: number; total: number } };
  let result = await requireData(
    apiClient.post<CardSyncPreview | Pending>(
      '/api/admin/card-sync/previews',
      { idempotencyKey, ...(options.imageCheck ? { imageCheck: options.imageCheck } : {}) },
      CARD_SYNC_PREVIEW_TIMEOUT_MS
    ),
    '检查上游新卡失败'
  );
  const deadline = Date.now() + 30 * 60_000;
  while ('status' in result && result.status === 'RUNNING') {
    if (options.signal?.aborted) throw new Error('已停止等待检查结果');
    if (Date.now() > deadline) throw new Error('检查尚未完成，请稍后重新检查');
    options.onProgress?.(result.progress);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (options.signal?.aborted) throw new Error('已停止等待检查结果');
    result = await requireData(
      apiClient.get<CardSyncPreview | Pending>(
        `/api/admin/card-sync/previews/${encodeURIComponent(result.id)}`
      ),
      '读取检查进度失败'
    );
  }
  return result as CardSyncPreview;
}

export function startCardSyncRun(
  previewId: string,
  cardCodes: readonly string[],
  idempotencyKey: string,
  options: { forceImport?: boolean; forceImports?: readonly CardSyncForceImport[] } = {}
): Promise<CardSyncRun> {
  return requireData(
    apiClient.post<CardSyncRun>('/api/admin/card-sync/runs', {
      previewId,
      cardCodes,
      idempotencyKey,
      ...options,
    }),
    '创建新卡同步任务失败'
  );
}

export function fetchCardSyncRun(runId: string): Promise<CardSyncRun> {
  return requireData(
    apiClient.get<CardSyncRun>(`/api/admin/card-sync/runs/${encodeURIComponent(runId)}`),
    '读取新卡同步任务失败'
  );
}
