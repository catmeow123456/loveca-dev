import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import {
  CardSyncEngineError,
  CardSyncLeaseLostError,
  CardSyncPreviewStaleError,
  type CardSyncEngine,
  type CardSyncEngineApplyItem,
} from './card-sync-engine.js';
import {
  CARD_SYNC_LEASE_DURATION_SECONDS,
  assertCardSyncLease,
  leaseIdentity,
  lockAndRenewCardSyncLease,
  renewCardSyncLease,
} from './card-sync-lease.js';
import { sanitizeDiagnostic, type CardSyncRunStatus } from './card-sync-service.js';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const RUN_HEARTBEAT_INTERVAL_MS = 15_000;

interface ClaimedApplyRun {
  readonly id: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly sourceHash: string;
  readonly cardCodes: readonly string[];
  readonly leaseToken: string;
  readonly leaseGeneration: number;
}

export class CardSyncWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeController: AbortController | null = null;
  private working = false;

  constructor(
    private readonly engine: CardSyncEngine,
    private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.pollIntervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.activeController?.abort(new CardSyncLeaseLostError('同步服务正在停止'));
  }

  notify(): void {
    void this.runOnce();
  }

  async runOnce(): Promise<boolean> {
    if (this.working) return false;
    this.working = true;
    try {
      const recovered = await recoverInterruptedApplyRuns();
      if (recovered > 0) {
        console.warn('[CardSync] Marked interrupted apply run as failed', { count: recovered });
      }
      const run = await claimNextApplyRun();
      if (!run) return false;
      await this.execute(run);
      return true;
    } catch (error) {
      console.error('[CardSync] Worker loop failed', safeErrorForLog(error));
      return false;
    } finally {
      this.working = false;
    }
  }

  private async execute(run: ClaimedApplyRun): Promise<void> {
    const controller = new AbortController();
    this.activeController = controller;
    const identity = leaseIdentity(run.id, {
      token: run.leaseToken,
      generation: run.leaseGeneration,
    });
    const loseLease = (error: unknown): void => {
      if (!controller.signal.aborted) {
        controller.abort(
          error instanceof CardSyncLeaseLostError ? error : new CardSyncLeaseLostError()
        );
      }
    };
    let heartbeatActive = true;
    const heartbeat = setInterval(() => {
      void renewCardSyncLease(pool, identity).catch((error) => {
        if (!heartbeatActive) return;
        loseLease(error);
        console.error('[CardSync] Run heartbeat failed; execution fenced', {
          runId: run.id,
          ...safeErrorForLog(error),
        });
      });
    }, RUN_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    const stopHeartbeat = (): void => {
      if (!heartbeatActive) return;
      heartbeatActive = false;
      clearInterval(heartbeat);
    };
    const assertCurrent = async (): Promise<void> => {
      await assertCardSyncLease(pool, identity, controller.signal);
    };
    try {
      const result = await this.engine.apply({
        runId: run.id,
        actorUserId: run.actorUserId,
        requestId: run.requestId,
        expectedSourceHash: run.sourceHash,
        expectedCandidateCardCodes: run.cardCodes,
        execution: {
          token: run.leaseToken,
          generation: run.leaseGeneration,
          signal: controller.signal,
          assertCurrent,
        },
      });
      await assertCurrent();
      if (result.sourceHash !== run.sourceHash) {
        throw new CardSyncPreviewStaleError();
      }
      stopHeartbeat();
      await persistApplyResult(run, result.items);
    } catch (error) {
      stopHeartbeat();
      await persistApplyFailure(run, error);
    } finally {
      stopHeartbeat();
      if (this.activeController === controller) this.activeController = null;
    }
  }
}

export async function recoverInterruptedApplyRuns(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const interrupted = await client.query<{ id: string }>(
      `SELECT id
         FROM card_sync_runs
        WHERE kind = 'APPLY' AND status = 'RUNNING'
          AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
        FOR UPDATE`
    );
    const runIds = interrupted.rows.map((row) => row.id);
    if (runIds.length === 0) {
      await client.query('COMMIT');
      return 0;
    }
    const message = '同步服务曾中断，请重新检查；中断前已写入的草稿不会自动回滚';
    await client.query(
      `UPDATE card_sync_run_items
          SET result = 'FAILED', message = $2, finished_at = NOW(), updated_at = NOW()
        WHERE run_id = ANY($1::uuid[]) AND kind = 'APPLY_RESULT'
          AND result IN ('PENDING', 'RUNNING')`,
      [runIds, message]
    );
    await client.query(
      `UPDATE card_sync_runs AS run
          SET status = 'FAILED', error_code = 'WORKER_INTERRUPTED', error_message = $2,
              lease_generation = lease_generation + 1,
              lease_token = NULL, lease_expires_at = NULL,
              result_summary = jsonb_build_object(
                'succeeded', 0,
                'skipped', 0,
                'failed', (
                  SELECT count(*) FROM card_sync_run_items AS item
                   WHERE item.run_id = run.id AND item.kind = 'APPLY_RESULT'
                )
              ),
              finished_at = NOW(), updated_at = NOW()
        WHERE id = ANY($1::uuid[]) AND status = 'RUNNING'`,
      [runIds, message]
    );
    await client.query('COMMIT');
    return runIds.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextApplyRun(): Promise<ClaimedApplyRun | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query<{
      id: string;
      actor_user_id: string | null;
      request_id: string;
      source_hash: string | null;
      lease_generation: number;
    }>(
      `SELECT id, actor_user_id, request_id, source_hash, lease_generation
         FROM card_sync_runs
        WHERE kind = 'APPLY' AND status = 'QUEUED'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    if (!row.actor_user_id || !row.source_hash) {
      await client.query(
        `UPDATE card_sync_runs
            SET status = 'FAILED', error_code = 'RUN_CONTEXT_INVALID',
                error_message = '同步任务缺少必要的执行上下文',
                finished_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [row.id]
      );
      await client.query('COMMIT');
      return null;
    }
    const items = await client.query<{ card_code: string | null }>(
      `SELECT card_code
         FROM card_sync_run_items
        WHERE run_id = $1 AND kind = 'APPLY_RESULT' AND result = 'PENDING'
        ORDER BY ordinal ASC`,
      [row.id]
    );
    const cardCodes = items.rows.flatMap((item) => (item.card_code ? [item.card_code] : []));
    if (cardCodes.length !== items.rows.length || cardCodes.length === 0) {
      await client.query(
        `UPDATE card_sync_runs
            SET status = 'FAILED', error_code = 'RUN_ITEMS_INVALID',
                error_message = '同步任务没有有效的待处理卡牌',
                finished_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [row.id]
      );
      await client.query('COMMIT');
      return null;
    }
    const leaseToken = randomUUID();
    const leaseGeneration = (row.lease_generation ?? 0) + 1;
    const claimed = await client.query(
      `UPDATE card_sync_runs
          SET status = 'RUNNING', started_at = NOW(), updated_at = NOW(),
              lease_token = $2, lease_generation = $3,
              lease_expires_at = NOW() + ($4 * INTERVAL '1 second')
        WHERE id = $1 AND status = 'QUEUED'
        RETURNING id`,
      [row.id, leaseToken, leaseGeneration, CARD_SYNC_LEASE_DURATION_SECONDS]
    );
    if (claimed.rowCount !== 1) throw new CardSyncLeaseLostError('同步任务认领失败');
    await client.query(
      `UPDATE card_sync_run_items
          SET result = 'RUNNING', started_at = NOW(), updated_at = NOW()
        WHERE run_id = $1 AND kind = 'APPLY_RESULT' AND result = 'PENDING'`,
      [row.id]
    );
    await client.query('COMMIT');
    return {
      id: row.id,
      actorUserId: row.actor_user_id,
      requestId: row.request_id,
      sourceHash: row.source_hash,
      cardCodes,
      leaseToken,
      leaseGeneration,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function persistApplyResult(
  run: ClaimedApplyRun,
  engineItems: readonly CardSyncEngineApplyItem[]
): Promise<void> {
  const byCardCode = new Map<string, CardSyncEngineApplyItem>();
  for (const item of engineItems) {
    if (!run.cardCodes.includes(item.cardCode) || byCardCode.has(item.cardCode)) {
      throw new CardSyncEngineError('ENGINE_RESULT_INVALID', '同步引擎返回了预览外的卡牌结果');
    }
    byCardCode.set(item.cardCode, item);
  }

  const normalized = run.cardCodes.map(
    (cardCode): CardSyncEngineApplyItem =>
      byCardCode.get(cardCode) ?? {
        cardCode,
        result: 'FAILED',
        message: '同步引擎未返回该卡牌的处理结果',
      }
  );
  const counts = countResults(normalized);
  const status: CardSyncRunStatus =
    counts.failed === 0
      ? 'SUCCEEDED'
      : counts.succeeded + counts.skipped > 0
        ? 'PARTIAL'
        : 'FAILED';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAndRenewCardSyncLease(
      client,
      leaseIdentity(run.id, { token: run.leaseToken, generation: run.leaseGeneration })
    );
    for (const item of normalized) {
      const updated = await client.query(
        `UPDATE card_sync_run_items
            SET result = $3, message = $4, finished_at = NOW(), updated_at = NOW()
          WHERE run_id = $1 AND card_code = $2 AND kind = 'APPLY_RESULT'
            AND result = 'RUNNING'`,
        [run.id, item.cardCode, item.result, item.message ? sanitizeDiagnostic(item.message) : null]
      );
      if (updated.rowCount !== 1) {
        throw new CardSyncEngineError('RUN_ITEM_STATE_INVALID', '同步任务逐卡状态已经变化');
      }
    }
    const finalized = await client.query(
      `UPDATE card_sync_runs
          SET status = $2, result_summary = $3, finished_at = NOW(), updated_at = NOW(),
              lease_token = NULL, lease_expires_at = NULL
        WHERE id = $1 AND status = 'RUNNING'
          AND lease_token = $4 AND lease_generation = $5`,
      [run.id, status, counts, run.leaseToken, run.leaseGeneration]
    );
    if (finalized.rowCount !== 1) throw new CardSyncLeaseLostError();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function persistApplyFailure(run: ClaimedApplyRun, error: unknown): Promise<void> {
  const code = error instanceof CardSyncEngineError ? error.code : 'APPLY_FAILED';
  const message =
    error instanceof CardSyncPreviewStaleError
      ? error.message
      : error instanceof CardSyncEngineError
        ? error.message
        : '同步新卡失败，请重新检查后再试';
  if (!(error instanceof CardSyncEngineError)) {
    console.error('[CardSync] Apply failed', { runId: run.id, ...safeErrorForLog(error) });
  }
  const safeMessage = sanitizeDiagnostic(message);
  const safeCode = sanitizeCode(code);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAndRenewCardSyncLease(
      client,
      leaseIdentity(run.id, { token: run.leaseToken, generation: run.leaseGeneration })
    );
    await client.query(
      `UPDATE card_sync_run_items
          SET result = 'FAILED', message = $2, finished_at = NOW(), updated_at = NOW()
        WHERE run_id = $1 AND kind = 'APPLY_RESULT' AND result = 'RUNNING'`,
      [run.id, safeMessage]
    );
    const finalized = await client.query(
      `UPDATE card_sync_runs
          SET status = 'FAILED', error_code = $2, error_message = $3,
              result_summary = $4, finished_at = NOW(), updated_at = NOW(),
              lease_token = NULL, lease_expires_at = NULL
        WHERE id = $1 AND status = 'RUNNING'
          AND lease_token = $5 AND lease_generation = $6`,
      [
        run.id,
        safeCode,
        safeMessage,
        { succeeded: 0, skipped: 0, failed: run.cardCodes.length },
        run.leaseToken,
        run.leaseGeneration,
      ]
    );
    if (finalized.rowCount !== 1) throw new CardSyncLeaseLostError();
    await client.query('COMMIT');
  } catch (persistError) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (persistError instanceof CardSyncLeaseLostError) return;
    console.error('[CardSync] Failed to persist apply failure', {
      runId: run.id,
      ...safeErrorForLog(persistError),
    });
  } finally {
    client.release();
  }
}

export function countResults(items: readonly CardSyncEngineApplyItem[]): {
  readonly succeeded: number;
  readonly skipped: number;
  readonly failed: number;
} {
  return items.reduce(
    (counts, item) => {
      if (item.result === 'SUCCEEDED') counts.succeeded += 1;
      else if (item.result === 'SKIPPED') counts.skipped += 1;
      else counts.failed += 1;
      return counts;
    },
    { succeeded: 0, skipped: 0, failed: 0 }
  );
}

function sanitizeCode(value: string): string {
  return (
    value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '_')
      .slice(0, 80) || 'APPLY_FAILED'
  );
}

function safeErrorForLog(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: sanitizeDiagnostic(error.message) }
    : { name: 'UnknownError' };
}
