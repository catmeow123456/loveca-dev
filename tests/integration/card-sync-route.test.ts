/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createCardSyncRouter } from '../../src/server/routes/card-sync';
import type { CardSyncRunView } from '../../src/server/services/card-sync-service';

type RouteMethod = 'get' | 'post';

const PREVIEW_ID = '11111111-1111-4111-8111-111111111111';
const APPLY_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

function previewRun(): CardSyncRunView {
  return {
    id: PREVIEW_ID,
    kind: 'PREVIEW',
    status: 'SUCCEEDED',
    actorUserId: ACTOR_ID,
    requestId: 'request-preview-1',
    previewRunId: null,
    sourceCollection: 'loveca',
    sourceHash: 'a'.repeat(64),
    sourceSummary: {
      generatedAt: '2026-08-22T10:00:00.000Z',
      counts: { source: 100, existing: 96, candidates: 2, blocked: 1 },
    },
    resultSummary: null,
    error: null,
    previewExpiresAt: '2026-08-22T10:15:00.000Z',
    startedAt: '2026-08-22T10:00:00.000Z',
    finishedAt: '2026-08-22T10:00:01.000Z',
    createdAt: '2026-08-22T10:00:00.000Z',
    updatedAt: '2026-08-22T10:00:01.000Z',
    items: [
      {
        id: 'candidate-1',
        ordinal: 0,
        kind: 'CANDIDATE',
        cardCode: 'PL!TEST-001',
        result: 'READY',
        summary: {
          name: '测试卡',
          cardType: 'MEMBER',
          warnings: ['缺少部分规则字段'],
        },
        message: null,
        startedAt: null,
        finishedAt: null,
        createdAt: '2026-08-22T10:00:00.000Z',
        updatedAt: '2026-08-22T10:00:00.000Z',
      },
      {
        id: 'blocked-1',
        ordinal: 1,
        kind: 'BLOCKED',
        cardCode: 'PL!TEST-002',
        result: 'BLOCKED',
        summary: { code: 'MISSING_IMAGE' },
        message: '上游未提供可同步的卡图',
        startedAt: null,
        finishedAt: null,
        createdAt: '2026-08-22T10:00:00.000Z',
        updatedAt: '2026-08-22T10:00:00.000Z',
      },
    ],
  };
}

function applyRun(status: CardSyncRunView['status'] = 'QUEUED'): CardSyncRunView {
  return {
    ...previewRun(),
    id: APPLY_ID,
    kind: 'APPLY',
    status,
    requestId: 'request-apply-1',
    previewRunId: PREVIEW_ID,
    previewExpiresAt: null,
    items: [
      {
        ...previewRun().items[0]!,
        id: 'apply-item-1',
        kind: 'APPLY_RESULT',
        result: status === 'SUCCEEDED' ? 'SUCCEEDED' : 'PENDING',
      },
    ],
  };
}

function createResponse() {
  const response = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return response as Response & {
    statusCode: number;
    body: { data: any; error: { code: string; message: string } | null } | null;
  };
}

function findRoute(
  router: ReturnType<typeof createCardSyncRouter>,
  path: string,
  method: RouteMethod
) {
  const layer = router.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route;
}

async function invokeRoute(
  router: ReturnType<typeof createCardSyncRouter>,
  path: string,
  method: RouteMethod,
  options: Partial<Request> = {}
) {
  const route = findRoute(router, path, method);
  const response = createResponse();
  const request = {
    params: {},
    query: {},
    body: undefined,
    requestId: 'request-route-1',
    user: { id: ACTOR_ID, role: 'admin' },
    ...options,
  } as Request;
  for (const layer of route.stack) {
    if (response.body !== null) break;
    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (error?: unknown) => {
        if (!error) {
          resolve();
          return;
        }
        reject(error instanceof Error ? error : new Error('route middleware rejected'));
      };
      try {
        const result = layer.handle(request, response, next);
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>).then(resolve, reject);
        } else if (response.body !== null) {
          resolve();
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error('route handler rejected'));
      }
    });
  }
  return response;
}

describe('cardSyncRouter', () => {
  it('does not grant the card sync boundary to a season administrator', async () => {
    const service = {
      getStatus: vi.fn(),
      listRuns: vi.fn(),
      getRun: vi.fn(),
      createPreview: vi.fn(),
      enqueueApply: vi.fn(),
    };
    const router = createCardSyncRouter(service as never, { notify: vi.fn() });
    const permissionLayer = router.stack[1]!;
    const response = createResponse();
    const next = vi.fn();

    await permissionLayer.handle(
      { user: { id: ACTOR_ID, role: 'season_admin' } } as Request,
      response,
      next
    );

    expect(response.statusCode).toBe(403);
    expect(response.body?.error.code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
    expect(service.getStatus).not.toHaveBeenCalled();
  });

  it('returns the browser DTO without upstream hashes or configuration key names', async () => {
    const service = {
      getStatus: vi.fn().mockResolvedValue({
        policy: {},
        configuration: { configured: true, missing: [] },
        activeRun: null,
        latestRun: applyRun('SUCCEEDED'),
      }),
      listRuns: vi.fn(),
      getRun: vi.fn(),
      createPreview: vi.fn(),
      enqueueApply: vi.fn(),
    };
    const router = createCardSyncRouter(service as never, { notify: vi.fn() });
    const response = await invokeRoute(router, '/status', 'get');

    expect(response.body?.data.configuration).toBe('READY');
    expect(response.body?.data.latestRun).toEqual(
      expect.objectContaining({ id: APPLY_ID, previewId: PREVIEW_ID, status: 'SUCCEEDED' })
    );
    expect(JSON.stringify(response.body)).not.toContain('sourceHash');
    expect(JSON.stringify(response.body)).not.toContain('CLOUDBASE_');
  });

  it('creates a persistent preview for the authenticated administrator', async () => {
    const service = {
      getStatus: vi.fn(),
      listRuns: vi.fn(),
      getRun: vi.fn(),
      createPreview: vi.fn().mockResolvedValue(previewRun()),
      enqueueApply: vi.fn(),
    };
    const router = createCardSyncRouter(service as never, { notify: vi.fn() });
    const response = await invokeRoute(router, '/previews', 'post', {
      body: { idempotencyKey: 'preview-idempotency-1' },
    });

    expect(response.statusCode).toBe(201);
    expect(service.createPreview).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      requestId: 'request-route-1',
      idempotencyKey: 'preview-idempotency-1',
    });
    expect(response.body?.data.summary).toEqual({
      sourceCount: 100,
      existingCount: 96,
      candidateCount: 2,
      blockedCount: 1,
      warningCount: 1,
    });
    expect(response.body?.data.blocked[0].reasons).toEqual(['上游未提供可同步的卡图']);
  });

  it('enqueues only a preview id plus idempotency key and wakes the worker', async () => {
    const worker = { notify: vi.fn() };
    const service = {
      getStatus: vi.fn(),
      listRuns: vi.fn(),
      getRun: vi.fn(),
      createPreview: vi.fn(),
      enqueueApply: vi.fn().mockResolvedValue(applyRun()),
    };
    const router = createCardSyncRouter(service as never, worker);
    const response = await invokeRoute(router, '/runs', 'post', {
      body: { previewId: PREVIEW_ID, idempotencyKey: 'apply-idempotency-1' },
    });

    expect(response.statusCode).toBe(202);
    expect(service.enqueueApply).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      requestId: 'request-route-1',
      previewRunId: PREVIEW_ID,
      idempotencyKey: 'apply-idempotency-1',
    });
    expect(worker.notify).toHaveBeenCalledOnce();
    expect(response.body?.data.summary.pendingCount).toBe(1);
  });

  it('rejects dangerous apply parameters at validation', async () => {
    const service = {
      getStatus: vi.fn(),
      listRuns: vi.fn(),
      getRun: vi.fn(),
      createPreview: vi.fn(),
      enqueueApply: vi.fn(),
    };
    const router = createCardSyncRouter(service as never, { notify: vi.fn() });
    const response = await invokeRoute(router, '/runs', 'post', {
      body: {
        previewId: PREVIEW_ID,
        idempotencyKey: 'apply-idempotency-2',
        collection: 'other',
        status: 'PUBLISHED',
        overwriteImages: true,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error.code).toBe('VALIDATION_ERROR');
    expect(service.enqueueApply).not.toHaveBeenCalled();
  });
});
