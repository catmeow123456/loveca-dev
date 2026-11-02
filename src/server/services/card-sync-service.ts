import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import {
  CARD_SYNC_POLICY,
  CardSyncEngineError,
  type CardSyncEngine,
  type CardSyncEnginePreview,
  type CardSyncForceImport,
} from './card-sync-engine.js';

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_DIAGNOSTIC_LENGTH = 500;

export type CardSyncRunKind = 'PREVIEW' | 'APPLY';
export type CardSyncRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type CardSyncRunItemResult =
  'READY' | 'BLOCKED' | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'SKIPPED' | 'FAILED';

interface CardSyncRunRow {
  readonly id: string;
  readonly kind: CardSyncRunKind;
  readonly status: CardSyncRunStatus;
  readonly actor_user_id: string | null;
  readonly request_id: string;
  readonly idempotency_key: string;
  readonly preview_run_id: string | null;
  readonly source_collection: string;
  readonly source_hash: string | null;
  readonly source_summary: Record<string, unknown> | null;
  readonly result_summary: Record<string, unknown> | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly preview_expires_at: Date | string | null;
  readonly started_at: Date | string | null;
  readonly finished_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface CardSyncRunItemRow {
  readonly id: string;
  readonly ordinal: number;
  readonly kind: 'CANDIDATE' | 'BLOCKED' | 'APPLY_RESULT';
  readonly card_code: string | null;
  readonly result: CardSyncRunItemResult;
  readonly summary: Record<string, unknown> | null;
  readonly message: string | null;
  readonly started_at: Date | string | null;
  readonly finished_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

export interface CardSyncRunItemView {
  readonly id: string;
  readonly ordinal: number;
  readonly kind: CardSyncRunItemRow['kind'];
  readonly cardCode: string | null;
  readonly result: CardSyncRunItemResult;
  readonly summary: Record<string, unknown> | null;
  readonly message: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CardSyncRunView {
  readonly id: string;
  readonly kind: CardSyncRunKind;
  readonly status: CardSyncRunStatus;
  readonly actorUserId: string | null;
  readonly requestId: string;
  readonly previewRunId: string | null;
  readonly sourceCollection: 'loveca';
  readonly sourceHash: string | null;
  readonly sourceSummary: Record<string, unknown> | null;
  readonly resultSummary: Record<string, unknown> | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly previewExpiresAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly CardSyncRunItemView[];
}

export class CardSyncServiceError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'CONFIGURATION_MISSING'
      | 'PREVIEW_FAILED'
      | 'PREVIEW_INVALID'
      | 'PREVIEW_EXPIRED'
      | 'PREVIEW_FORBIDDEN'
      | 'NO_CANDIDATES'
      | 'SELECTION_INVALID'
      | 'IDEMPOTENCY_CONFLICT'
      | 'ACTIVE_RUN_EXISTS',
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export class CardSyncService {
  constructor(private readonly engine: CardSyncEngine) {}

  getConfigurationStatus() {
    return this.engine.getConfigurationStatus();
  }

  async getStatus(): Promise<{
    readonly policy: typeof CARD_SYNC_POLICY;
    readonly configuration: ReturnType<CardSyncEngine['getConfigurationStatus']>;
    readonly activeRun: CardSyncRunView | null;
    readonly latestRun: CardSyncRunView | null;
  }> {
    const runs = await pool.query<CardSyncRunRow>(
      `SELECT *
         FROM card_sync_runs
        WHERE (kind = 'APPLY' AND status IN ('QUEUED', 'RUNNING'))
           OR id = (
             SELECT id FROM card_sync_runs
              WHERE kind = 'APPLY'
              ORDER BY created_at DESC, id DESC
              LIMIT 1
           )
        ORDER BY created_at DESC, id DESC`
    );
    const active = runs.rows.find(
      (run) => run.kind === 'APPLY' && (run.status === 'QUEUED' || run.status === 'RUNNING')
    );
    const latest = runs.rows[0];
    return {
      policy: CARD_SYNC_POLICY,
      configuration: this.engine.getConfigurationStatus(),
      activeRun: active ? await this.getRun(active.id) : null,
      latestRun: latest ? await this.getRun(latest.id) : null,
    };
  }

  async listRuns(limit = 20): Promise<readonly CardSyncRunView[]> {
    const normalizedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    const result = await pool.query<CardSyncRunRow>(
      `SELECT * FROM card_sync_runs ORDER BY created_at DESC, id DESC LIMIT $1`,
      [normalizedLimit]
    );
    return Promise.all(result.rows.map((row) => this.getRun(row.id)));
  }

  async getRun(runId: string): Promise<CardSyncRunView> {
    const [runResult, itemResult] = await Promise.all([
      pool.query<CardSyncRunRow>('SELECT * FROM card_sync_runs WHERE id = $1', [runId]),
      pool.query<CardSyncRunItemRow>(
        `SELECT * FROM card_sync_run_items WHERE run_id = $1 ORDER BY ordinal ASC`,
        [runId]
      ),
    ]);
    const row = runResult.rows[0];
    if (!row) {
      throw new CardSyncServiceError('NOT_FOUND', '同步记录不存在', 404);
    }
    return mapRun(row, itemResult.rows);
  }

  async createPreview(input: {
    readonly actorUserId: string;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly now?: Date;
    readonly imageCheck?: 'NONE' | 'LINK' | 'DECODE';
  }): Promise<CardSyncRunView> {
    const now = input.now ?? new Date();
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO card_sync_runs (
         kind, status, actor_user_id, request_id, idempotency_key,
         source_collection, started_at, created_at, updated_at
       ) VALUES ('PREVIEW', 'RUNNING', $1, $2, $3, 'loveca', $4, $4, $4)
       ON CONFLICT (actor_user_id, kind, idempotency_key) DO NOTHING
       RETURNING id`,
      [input.actorUserId, input.requestId, input.idempotencyKey, now]
    );
    if (!inserted.rows[0]) {
      return this.readIdempotentRun(input.actorUserId, 'PREVIEW', input.idempotencyKey);
    }
    const runId = inserted.rows[0].id;

    // Preview performs read-only probes in the background; HTTP requests remain short.
    void this.finishPreview(runId, input.imageCheck ?? 'LINK').catch(() => undefined);
    return this.getRun(runId);
  }

  private async finishPreview(
    runId: string,
    imageCheck: 'NONE' | 'LINK' | 'DECODE'
  ): Promise<void> {
    try {
      const configuration = this.engine.getConfigurationStatus();
      if (!configuration.configured) {
        throw new CardSyncServiceError(
          'CONFIGURATION_MISSING',
          '服务器尚未配置小能苗读取凭据',
          503
        );
      }
      const preview = normalizePreview(
        await this.engine.preview(async (progress) => {
          await pool.query(
            `UPDATE card_sync_runs SET source_summary = $2, updated_at = NOW() WHERE id = $1 AND status = 'RUNNING'`,
            [runId, { progress, imageCheck }]
          );
        }, imageCheck)
      );
      const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE card_sync_runs
              SET status = 'SUCCEEDED', source_hash = $2, source_summary = $3,
                  preview_expires_at = $4, finished_at = $5, updated_at = $5
            WHERE id = $1 AND status = 'RUNNING'`,
          [
            runId,
            preview.sourceHash,
            {
              generatedAt: preview.generatedAt,
              imageCheck,
              counts: preview.counts,
              policy: CARD_SYNC_POLICY,
            },
            expiresAt,
            new Date(),
          ]
        );
        await insertPreviewItems(client, runId, preview);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      const serviceError = toPreviewServiceError(error);
      await this.markRunFailed(runId, serviceError.code, serviceError.message);
    }
  }

  async enqueueApply(input: {
    readonly actorUserId: string;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly previewRunId: string;
    readonly cardCodes: readonly string[];
    readonly forceImports?: readonly CardSyncForceImport[];
    readonly forceImport?: boolean;
    readonly now?: Date;
  }): Promise<CardSyncRunView> {
    const now = input.now ?? new Date();
    const client = await pool.connect();
    let runId: string | null = null;
    try {
      await client.query('BEGIN');
      const preview = (
        await client.query<CardSyncRunRow>(`SELECT * FROM card_sync_runs WHERE id = $1 FOR SHARE`, [
          input.previewRunId,
        ])
      ).rows[0];
      validatePreviewForApply(preview, input.actorUserId, now);
      const candidates = await client.query<CardSyncRunItemRow>(
        `SELECT *
           FROM card_sync_run_items
          WHERE run_id = $1 AND kind = 'CANDIDATE' AND result = 'READY'
          ORDER BY ordinal ASC`,
        [input.previewRunId]
      );
      const forceImports = input.forceImports ?? [];
      if (forceImports.length && !input.forceImport)
        throw new CardSyncServiceError('SELECTION_INVALID', '请确认强制导入提示', 400);
      if (candidates.rows.length === 0 && forceImports.length === 0) {
        throw new CardSyncServiceError('NO_CANDIDATES', '当前预览没有可同步的新卡', 409);
      }
      const candidateCodes = candidates.rows.map((candidate) => candidate.card_code);
      if (candidateCodes.some((cardCode) => !cardCode)) {
        throw new CardSyncServiceError('PREVIEW_INVALID', '预览包含无效候选卡号', 409);
      }
      const selectedCodes = input.cardCodes.map((cardCode) => cardCode.trim());
      const selectedCodeSet = new Set(selectedCodes);
      if (
        (selectedCodes.length === 0 && forceImports.length === 0) ||
        selectedCodeSet.size !== selectedCodes.length
      ) {
        throw new CardSyncServiceError(
          'SELECTION_INVALID',
          '请至少选择一张新卡，且不要重复选择',
          400
        );
      }
      const selectedCandidates = candidates.rows.filter(
        (candidate) => candidate.card_code && selectedCodeSet.has(candidate.card_code)
      );
      if (selectedCandidates.length !== selectedCodes.length) {
        throw new CardSyncServiceError(
          'SELECTION_INVALID',
          '所选卡牌不属于当前预览，请重新检查新卡',
          409
        );
      }
      if (forceImports.length) {
        const review = await client.query<CardSyncRunItemRow>(
          `SELECT * FROM card_sync_run_items WHERE run_id = $1 AND kind = 'BLOCKED' ORDER BY ordinal ASC`,
          [input.previewRunId]
        );
        const seenSources = new Set<string>();
        for (const choice of forceImports) {
          const item = review.rows.find((item) => item.summary?.sourceKey === choice.sourceKey);
          if (!item || seenSources.has(choice.sourceKey) || selectedCodeSet.has(choice.cardCode)) {
            throw new CardSyncServiceError(
              'SELECTION_INVALID',
              '所选记录已变化或导入编号重复；请核对编号后重试',
              409
            );
          }
          seenSources.add(choice.sourceKey);
          selectedCodeSet.add(choice.cardCode);
          selectedCandidates.push({
            ...item,
            card_code: choice.cardCode,
            summary: {
              ...item.summary,
              name: choice.name,
              cardType: choice.cardType,
              forceImport: true,
            },
          });
        }
      }
      const applySourceSummary = {
        ...(preview!.source_summary ?? {}),
        previewCandidateCardCodes: candidateCodes,
        forceImports,
        forceImport: input.forceImport === true,
        selectedCardCodes: selectedCandidates.map((candidate) => candidate.card_code),
      };

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO card_sync_runs (
           kind, status, actor_user_id, request_id, idempotency_key, preview_run_id,
           source_collection, source_hash, source_summary, created_at, updated_at
         ) VALUES ('APPLY', 'QUEUED', $1, $2, $3, $4, 'loveca', $5, $6, $7, $7)
         ON CONFLICT (actor_user_id, kind, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          input.actorUserId,
          input.requestId,
          input.idempotencyKey,
          input.previewRunId,
          preview!.source_hash,
          applySourceSummary,
          now,
        ]
      );
      if (!inserted.rows[0]) {
        const existing = (
          await client.query<CardSyncRunRow>(
            `SELECT * FROM card_sync_runs
              WHERE actor_user_id = $1 AND kind = 'APPLY' AND idempotency_key = $2`,
            [input.actorUserId, input.idempotencyKey]
          )
        ).rows[0];
        const existingSelectedCodes = readSummaryCardCodes(
          existing?.source_summary,
          'selectedCardCodes'
        );
        if (
          !existing ||
          existing.preview_run_id !== input.previewRunId ||
          !existingSelectedCodes ||
          (existing.source_summary?.forceImport === true) !== (input.forceImport === true) ||
          JSON.stringify(existing.source_summary?.forceImports ?? []) !==
            JSON.stringify(forceImports) ||
          !sameCardCodes(
            existingSelectedCodes,
            selectedCandidates.map((item) => item.card_code!)
          )
        ) {
          throw new CardSyncServiceError('IDEMPOTENCY_CONFLICT', '该幂等键已用于其他同步请求', 409);
        }
        runId = existing.id;
      } else {
        runId = inserted.rows[0].id;
        for (const [ordinal, candidate] of selectedCandidates.entries()) {
          await client.query(
            `INSERT INTO card_sync_run_items (
               run_id, ordinal, kind, card_code, result, summary, created_at, updated_at
             ) VALUES ($1, $2, 'APPLY_RESULT', $3, 'PENDING', $4, $5, $5)`,
            [runId, ordinal, candidate.card_code, candidate.summary, now]
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (isUniqueViolation(error)) {
        throw new CardSyncServiceError(
          'ACTIVE_RUN_EXISTS',
          '已有新卡同步任务在等待或执行，请稍后重试',
          409
        );
      }
      throw error;
    } finally {
      client.release();
    }
    return this.getRun(runId!);
  }

  private async readIdempotentRun(
    actorUserId: string,
    kind: CardSyncRunKind,
    idempotencyKey: string
  ): Promise<CardSyncRunView> {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM card_sync_runs
        WHERE actor_user_id = $1 AND kind = $2 AND idempotency_key = $3`,
      [actorUserId, kind, idempotencyKey]
    );
    const id = existing.rows[0]?.id;
    if (!id) {
      throw new CardSyncServiceError('IDEMPOTENCY_CONFLICT', '无法恢复幂等同步请求', 409);
    }
    return this.getRun(id);
  }

  private async markRunFailed(runId: string, code: string, message: string): Promise<void> {
    const now = new Date();
    await pool.query(
      `UPDATE card_sync_runs
          SET status = 'FAILED', error_code = $2, error_message = $3,
              finished_at = $4, updated_at = $4
        WHERE id = $1 AND status IN ('QUEUED', 'RUNNING')`,
      [runId, safeCode(code), sanitizeDiagnostic(message), now]
    );
  }
}

async function insertPreviewItems(
  client: PoolClient,
  runId: string,
  preview: CardSyncEnginePreview
): Promise<void> {
  let ordinal = 0;
  for (const candidate of preview.candidates) {
    await client.query(
      `INSERT INTO card_sync_run_items (
         run_id, ordinal, kind, card_code, result, summary, created_at, updated_at
       ) VALUES ($1, $2, 'CANDIDATE', $3, 'READY', $4, NOW(), NOW())`,
      [
        runId,
        ordinal++,
        candidate.cardCode,
        {
          name: candidate.name,
          cardType: candidate.cardType,
          imageFilename: candidate.imageFilename,
          warnings: candidate.warnings.map(sanitizeDiagnostic),
        },
      ]
    );
  }
  for (const blocked of preview.blocked) {
    await client.query(
      `INSERT INTO card_sync_run_items (
         run_id, ordinal, kind, card_code, result, summary, message, created_at, updated_at
       ) VALUES ($1, $2, 'BLOCKED', $3, 'BLOCKED', $4, $5, NOW(), NOW())`,
      [
        runId,
        ordinal++,
        blocked.cardCode,
        {
          code: safeCode(blocked.code),
          name: blocked.name,
          sourceKey: blocked.sourceKey,
          cardType: blocked.cardType,
          suggestedCardCode: blocked.suggestedCardCode,
          imageIssue: blocked.imageIssue,
        },
        sanitizeDiagnostic(blocked.message),
      ]
    );
  }
}

function validatePreviewForApply(
  preview: CardSyncRunRow | undefined,
  actorUserId: string,
  now: Date
): asserts preview is CardSyncRunRow {
  if (!preview || preview.kind !== 'PREVIEW') {
    throw new CardSyncServiceError('PREVIEW_INVALID', '预览记录不存在或类型无效', 404);
  }
  if (preview.actor_user_id !== actorUserId) {
    throw new CardSyncServiceError('PREVIEW_FORBIDDEN', '只能执行自己创建的预览', 403);
  }
  if (preview.status !== 'SUCCEEDED' || !preview.source_hash || !preview.preview_expires_at) {
    throw new CardSyncServiceError('PREVIEW_INVALID', '预览尚未成功完成', 409);
  }
  if (new Date(preview.preview_expires_at).getTime() <= now.getTime()) {
    throw new CardSyncServiceError('PREVIEW_EXPIRED', '预览已过期，请重新检查新卡', 409);
  }
}

function normalizePreview(preview: CardSyncEnginePreview): CardSyncEnginePreview {
  if (!/^[a-f0-9]{32,128}$/i.test(preview.sourceHash)) {
    throw new CardSyncServiceError('PREVIEW_FAILED', '上游预览缺少有效摘要', 502);
  }
  if (!Number.isFinite(Date.parse(preview.generatedAt))) {
    throw new CardSyncServiceError('PREVIEW_FAILED', '上游预览时间无效', 502);
  }
  const seen = new Set<string>();
  for (const candidate of preview.candidates) {
    if (!candidate.cardCode.trim() || seen.has(candidate.cardCode)) {
      throw new CardSyncServiceError('PREVIEW_FAILED', '上游预览包含重复或空卡号', 502);
    }
    seen.add(candidate.cardCode);
  }
  if (
    preview.counts.candidates !== preview.candidates.length ||
    preview.counts.blocked !== preview.blocked.length
  ) {
    throw new CardSyncServiceError('PREVIEW_FAILED', '上游预览统计不一致', 502);
  }
  return preview;
}

function toPreviewServiceError(error: unknown): CardSyncServiceError {
  if (error instanceof CardSyncServiceError) {
    return error;
  }
  if (error instanceof CardSyncEngineError) {
    return new CardSyncServiceError('PREVIEW_FAILED', sanitizeDiagnostic(error.message), 502);
  }
  console.error('[CardSync] Preview failed', safeErrorForLog(error));
  return new CardSyncServiceError('PREVIEW_FAILED', '读取上游新卡失败，请稍后重试', 502);
}

function mapRun(run: CardSyncRunRow, items: readonly CardSyncRunItemRow[]): CardSyncRunView {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    actorUserId: run.actor_user_id,
    requestId: run.request_id,
    previewRunId: run.preview_run_id,
    sourceCollection: 'loveca',
    sourceHash: run.source_hash,
    sourceSummary: run.source_summary,
    resultSummary: run.result_summary,
    error:
      run.error_code && run.error_message
        ? { code: run.error_code, message: run.error_message }
        : null,
    previewExpiresAt: toIso(run.preview_expires_at),
    startedAt: toIso(run.started_at),
    finishedAt: toIso(run.finished_at),
    createdAt: toIso(run.created_at)!,
    updatedAt: toIso(run.updated_at)!,
    items: items.map((item) => ({
      id: item.id,
      ordinal: item.ordinal,
      kind: item.kind,
      cardCode: item.card_code,
      result: item.result,
      summary: item.summary,
      message: item.message,
      startedAt: toIso(item.started_at),
      finishedAt: toIso(item.finished_at),
      createdAt: toIso(item.created_at)!,
      updatedAt: toIso(item.updated_at)!,
    })),
  };
}

export function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/\b(?:https?|cloud):\/\/\S+/gi, '[已脱敏地址]')
    .replace(/\b(secret(?:id|key)?|credential|token)\s*[:=]\s*\S+/gi, '$1=[已脱敏]')
    .slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function safeCode(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .slice(0, 80);
  return normalized || 'UNKNOWN';
}

function safeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: sanitizeDiagnostic(error.message) };
  }
  return { name: 'UnknownError' };
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505';
}

function readSummaryCardCodes(
  summary: Record<string, unknown> | null | undefined,
  key: string
): string[] | null {
  const value = summary?.[key];
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
    ? value
    : null;
}

function sameCardCodes(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedLeft = [...left].sort((a, b) => a.localeCompare(b, 'en'));
  const normalizedRight = [...right].sort((a, b) => a.localeCompare(b, 'en'));
  return normalizedLeft.every((cardCode, index) => cardCode === normalizedRight[index]);
}
