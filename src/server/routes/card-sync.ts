import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import { validate } from '../middleware/validate.js';
import { cardSyncService, cardSyncWorker } from '../services/card-sync-runtime.js';
import {
  CardSyncServiceError,
  type CardSyncRunItemView,
  type CardSyncRunView,
  type CardSyncService,
} from '../services/card-sync-service.js';
import type { CardSyncWorker } from '../services/card-sync-worker.js';

const idempotencyKeySchema = z.string().trim().min(8).max(160);
const createPreviewSchema = z.object({ idempotencyKey: idempotencyKeySchema }).strict();
const createRunSchema = z
  .object({ previewId: z.string().uuid(), idempotencyKey: idempotencyKeySchema })
  .strict();

type CardSyncRouteService = Pick<
  CardSyncService,
  'getStatus' | 'listRuns' | 'getRun' | 'createPreview' | 'enqueueApply'
>;

type CardSyncRouteWorker = Pick<CardSyncWorker, 'notify'>;

export function createCardSyncRouter(
  service: CardSyncRouteService = cardSyncService,
  worker: CardSyncRouteWorker = cardSyncWorker
): Router {
  const router = Router();
  router.use(requireAuth, requirePermission('cards.sync'));

  router.get('/status', async (_req, res) => {
    try {
      const status = await service.getStatus();
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        data: {
          configuration: status.configuration.configured ? 'READY' : 'NOT_CONFIGURED',
          activeRun: status.activeRun ? toRunDto(status.activeRun) : null,
          latestRun: status.latestRun ? toRunDto(status.latestRun) : null,
        },
        error: null,
      });
    } catch (error) {
      respond(res, error, '读取新卡同步状态失败');
    }
  });

  router.get('/runs', async (req, res) => {
    try {
      const parsed = z.coerce.number().int().min(1).max(50).default(20).safeParse(req.query.limit);
      if (!parsed.success) {
        res.status(400).json({
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'limit 必须为 1 至 50 的整数' },
        });
        return;
      }
      const runs = (await service.listRuns(parsed.data))
        .filter((run) => run.kind === 'APPLY')
        .map(toRunDto);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: runs, error: null });
    } catch (error) {
      respond(res, error, '读取新卡同步记录失败');
    }
  });

  router.get('/runs/:runId', async (req, res) => {
    try {
      const parsed = z.string().uuid().safeParse(req.params.runId);
      if (!parsed.success) {
        res.status(400).json({
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'runId 格式无效' },
        });
        return;
      }
      const run = await service.getRun(parsed.data);
      if (run.kind !== 'APPLY') {
        throw new CardSyncServiceError('NOT_FOUND', '同步任务不存在', 404);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: toRunDto(run), error: null });
    } catch (error) {
      respond(res, error, '读取新卡同步任务失败');
    }
  });

  router.post('/previews', validate(createPreviewSchema), async (req, res) => {
    try {
      const { idempotencyKey } = req.body as z.infer<typeof createPreviewSchema>;
      const run = await service.createPreview({
        actorUserId: req.user!.id,
        requestId: req.requestId ?? randomUUID(),
        idempotencyKey,
      });
      res.status(201).json({ data: toPreviewDto(run), error: null });
    } catch (error) {
      respond(res, error, '检查上游新卡失败');
    }
  });

  router.post('/runs', validate(createRunSchema), async (req, res) => {
    try {
      const { previewId, idempotencyKey } = req.body as z.infer<typeof createRunSchema>;
      const run = await service.enqueueApply({
        actorUserId: req.user!.id,
        requestId: req.requestId ?? randomUUID(),
        idempotencyKey,
        previewRunId: previewId,
      });
      worker.notify();
      res.status(202).json({ data: toRunDto(run), error: null });
    } catch (error) {
      respond(res, error, '创建新卡同步任务失败');
    }
  });

  return router;
}

export const cardSyncRouter = createCardSyncRouter();

export function toPreviewDto(run: CardSyncRunView) {
  if (run.kind !== 'PREVIEW' || run.status !== 'SUCCEEDED' || !run.previewExpiresAt) {
    throw new CardSyncServiceError('PREVIEW_INVALID', '预览尚未成功完成', 409);
  }
  const counts = readCounts(run.sourceSummary);
  const candidates = run.items
    .filter((item) => item.kind === 'CANDIDATE')
    .map((item) => ({
      cardCode: item.cardCode ?? '',
      name: readString(item.summary, 'name') ?? '',
      cardType: readString(item.summary, 'cardType') ?? '',
      warnings: readStringArray(item.summary, 'warnings'),
    }));
  const blocked = run.items
    .filter((item) => item.kind === 'BLOCKED')
    .map((item) => ({
      cardCode: item.cardCode,
      reasons: item.message ? [item.message] : ['上游数据校验未通过'],
    }));
  return {
    id: run.id,
    createdAt: run.createdAt,
    expiresAt: run.previewExpiresAt,
    summary: {
      sourceCount: counts.source,
      existingCount: counts.existing,
      candidateCount: counts.candidates,
      blockedCount: counts.blocked,
      warningCount: candidates.reduce((sum, item) => sum + item.warnings.length, 0),
    },
    candidates,
    blocked,
  };
}

export function toRunDto(run: CardSyncRunView) {
  if (run.kind !== 'APPLY') {
    throw new CardSyncServiceError('NOT_FOUND', '同步任务不存在', 404);
  }
  const items = run.items
    .filter((item) => item.kind === 'APPLY_RESULT')
    .map((item) => ({
      cardCode: item.cardCode ?? '',
      name: readString(item.summary, 'name') ?? '',
      status: normalizeRunItemStatus(item),
      message: item.message,
    }));
  return {
    id: run.id,
    previewId: run.previewRunId!,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: {
      totalCount: items.length,
      succeededCount: items.filter(
        (item) => item.status === 'SUCCEEDED' || item.status === 'SKIPPED'
      ).length,
      failedCount: items.filter((item) => item.status === 'FAILED').length,
      pendingCount: items.filter((item) => item.status === 'PENDING' || item.status === 'RUNNING')
        .length,
    },
    items,
    message: run.error?.message ?? null,
  };
}

function normalizeRunItemStatus(
  item: CardSyncRunItemView
): 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' {
  if (
    item.result === 'PENDING' ||
    item.result === 'RUNNING' ||
    item.result === 'SUCCEEDED' ||
    item.result === 'FAILED' ||
    item.result === 'SKIPPED'
  ) {
    return item.result;
  }
  return 'FAILED';
}

function readCounts(summary: Record<string, unknown> | null): {
  source: number;
  existing: number;
  candidates: number;
  blocked: number;
} {
  const counts = summary?.counts;
  const value = counts && typeof counts === 'object' ? (counts as Record<string, unknown>) : {};
  return {
    source: readNonNegativeInt(value.source),
    existing: readNonNegativeInt(value.existing),
    candidates: readNonNegativeInt(value.candidates),
    blocked: readNonNegativeInt(value.blocked),
  };
}

function readNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readString(summary: Record<string, unknown> | null, key: string): string | null {
  const value = summary?.[key];
  return typeof value === 'string' ? value : null;
}

function readStringArray(summary: Record<string, unknown> | null, key: string): readonly string[] {
  const value = summary?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function respond(res: Response, error: unknown, fallback: string): void {
  if (error instanceof CardSyncServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('[CardSync] Route error:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({
    data: null,
    error: { code: 'INTERNAL_ERROR', message: fallback },
  });
}
