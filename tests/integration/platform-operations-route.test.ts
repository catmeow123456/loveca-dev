import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  previewReplayRetention: vi.fn(),
  applyReplayRetention: vi.fn(),
  generateRankedVolatilityReport: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('../../src/server/services/platform-operations-service.js', () => ({
  PlatformOperationsServiceError: class PlatformOperationsServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
  platformOperationsService: {
    previewReplayRetention: mocks.previewReplayRetention,
    applyReplayRetention: mocks.applyReplayRetention,
    generateRankedVolatilityReport: mocks.generateRankedVolatilityReport,
  },
}));

import { platformOperationsRouter } from '../../src/server/routes/platform-operations';

type RouteMethod = 'get' | 'post';

interface RouterLayer {
  readonly handle: RequestHandler;
  readonly route?: {
    readonly path: string;
    readonly methods: Partial<Record<RouteMethod, boolean>>;
    readonly stack: readonly RouterLayer[];
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as Response & {
    statusCode: number;
    body: { data?: unknown; error?: { code?: string } | null } | null;
  };
}

async function invoke(path: string, method: RouteMethod, options: Partial<Request> = {}) {
  const layer = (platformOperationsRouter.stack as unknown as RouterLayer[]).find(
    (candidate) => candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);

  const request = {
    body: undefined,
    params: {},
    query: {},
    user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin' },
    ...options,
  } as Request;
  const response = createResponse();
  for (const routeLayer of layer.route.stack) {
    if (response.body !== null) break;
    await runHandler(routeLayer.handle, request, response);
  }
  return response;
}

async function runHandler(handler: RequestHandler, req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const complete = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error instanceof Error ? error : new Error('Route middleware failed'));
      else resolve();
    };
    const next: NextFunction = (error?: unknown) => complete(error);
    try {
      const result = handler(req, res, next);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).then(() => complete(), complete);
      } else if ((res as ReturnType<typeof createResponse>).body !== null) {
        complete();
      }
    } catch (error) {
      complete(error);
    }
  });
}

describe('platformOperationsRouter', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('protects the entire router with current platform-admin authorization', () => {
    const requireAdmin = platformOperationsRouter.stack[1];
    const response = createResponse();
    const next = vi.fn();

    requireAdmin.handle({ user: { id: 'user-1', role: 'user' } } as Request, response, next);

    expect(response.statusCode).toBe(403);
    expect(response.body?.error?.code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('passes the validated confirmation to the destructive operation', async () => {
    mocks.applyReplayRetention.mockResolvedValue({ metadataRowsUpdated: 2 });

    const response = await invoke('/replay-retention/apply', 'post', {
      body: { confirmation: '清理10天前回放数据' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.applyReplayRetention).toHaveBeenCalledWith(
      '清理10天前回放数据',
      '11111111-1111-4111-8111-111111111111'
    );
    expect(response.body).toMatchObject({ data: { metadataRowsUpdated: 2 }, error: null });
  });

  it('rejects an invalid season identifier before generating a report', async () => {
    const response = await invoke('/ranked-volatility-report', 'post', {
      body: { seasonId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.generateRankedVolatilityReport).not.toHaveBeenCalled();
  });
});
