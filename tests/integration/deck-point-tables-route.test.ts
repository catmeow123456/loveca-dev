import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentTable: vi.fn(),
  listTables: vi.fn(),
  updateTable: vi.fn(),
  publish: vi.fn(),
  discardTable: vi.fn(),
  deleteTable: vi.fn(),
}));

vi.mock('../../src/server/services/deck-point-table-service.js', () => ({
  DeckPointTableServiceError: class DeckPointTableServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  deckPointTableService: {
    getCurrentTable: mocks.getCurrentTable,
    listTables: mocks.listTables,
    updateTable: mocks.updateTable,
    publish: mocks.publish,
    discardTable: mocks.discardTable,
    deleteTable: mocks.deleteTable,
  },
}));

import {
  deckPointTablesAdminRouter,
  deckPointTablesRouter,
} from '../../src/server/routes/deck-point-tables';

type RouteMethod = 'get' | 'put' | 'post' | 'delete';

interface RouterLayer {
  handle: RequestHandler;
  name?: string;
  route?: {
    path: string;
    methods: Partial<Record<RouteMethod, boolean>>;
    stack: RouterLayer[];
  };
}

interface MockResponse extends Response {
  statusCode: number;
  body: {
    data: unknown;
    total?: number;
    error: { code: string; message: string } | null;
  } | null;
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: MockResponse['body']) {
      this.body = payload;
      return this;
    },
  } as MockResponse;
}

function findRoute(router: { stack: RouterLayer[] }, path: string, method: RouteMethod) {
  const layer = router.stack.find(
    (candidate) => candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('Route middleware failed');
}

async function invokeRoute(
  router: { stack: RouterLayer[] },
  path: string,
  method: RouteMethod,
  options: Partial<Request> = {}
) {
  const route = findRoute(router, path, method);
  const response = createMockResponse();
  const request = {
    params: {},
    query: {},
    body: undefined,
    user: { id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
    ...options,
  } as Request;

  for (const layer of route.stack) {
    if (response.body !== null) break;
    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (error?: unknown) => (error ? reject(toError(error)) : resolve());
      try {
        const result = layer.handle(request, response, next);
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>).then(resolve, reject);
        }
      } catch (error) {
        reject(toError(error));
      }
    });
  }

  return response;
}

function runMiddleware(
  middleware: RequestHandler,
  user: Request['user']
): { response: MockResponse; next: ReturnType<typeof vi.fn> } {
  const response = createMockResponse();
  const next = vi.fn();
  middleware({ user } as Request, response, next);
  return { response, next };
}

describe('deck point table routes', () => {
  afterEach(() => vi.clearAllMocks());

  it('public current response exposes only the player contract', async () => {
    mocks.getCurrentTable.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      version: '2026-08-08',
      displayName: '2026年8月PT限制表',
      pointLimit: 10,
      lifecycle: 'ACTIVE',
      revision: 3,
      effectiveFrom: '2026-08-07T16:00:00.000Z',
      platformTimeZone: 'Asia/Shanghai',
      createdBy: 'admin-secret',
      entries: [{ id: 'entry-secret', baseCardCode: 'LL-bp2-001', points: 5, createdAt: 'secret' }],
    });

    const response = await invokeRoute(deckPointTablesRouter, '/current', 'get');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      data: {
        version: '2026-08-08',
        displayName: '2026年8月PT限制表',
        pointLimit: 10,
        effectiveFrom: '2026-08-07T16:00:00.000Z',
        platformTimeZone: 'Asia/Shanghai',
        entries: [{ baseCardCode: 'LL-bp2-001', points: 5 }],
      },
      error: null,
    });
    expect(JSON.stringify(response.body)).not.toContain('admin-secret');
    expect(JSON.stringify(response.body)).not.toContain('entry-secret');
  });

  it('admin router rejects unauthenticated and non-admin requests before route handlers', () => {
    const middleware = (deckPointTablesAdminRouter.stack as RouterLayer[])
      .filter((layer) => !layer.route)
      .map((layer) => layer.handle);
    expect(middleware).toHaveLength(2);

    const unauthenticated = runMiddleware(middleware[0]!, undefined);
    expect(unauthenticated.response.statusCode).toBe(401);
    expect(unauthenticated.response.body?.error?.code).toBe('UNAUTHORIZED');
    expect(unauthenticated.next).not.toHaveBeenCalled();

    const authenticated = runMiddleware(middleware[0]!, {
      id: 'user-1',
      role: 'user',
    });
    expect(authenticated.next).toHaveBeenCalledOnce();

    const nonAdmin = runMiddleware(middleware[1]!, {
      id: 'user-1',
      role: 'user',
    });
    expect(nonAdmin.response.statusCode).toBe(403);
    expect(nonAdmin.response.body?.error?.code).toBe('FORBIDDEN');
    expect(nonAdmin.next).not.toHaveBeenCalled();
  });

  it('admin list keeps operational metadata for authorized management', async () => {
    mocks.listTables.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        version: '2026-08-08',
        lifecycle: 'SCHEDULED',
        revision: 2,
        retirementReason: null,
        entries: [],
      },
    ]);

    const response = await invokeRoute(deckPointTablesAdminRouter, '/', 'get');

    expect(response.body).toEqual({
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          version: '2026-08-08',
          lifecycle: 'SCHEDULED',
          revision: 2,
          retirementReason: null,
          entries: [],
        },
      ],
      total: 1,
      error: null,
    });
  });

  it('accepts the general update contract with a second-precision Beijing effective time', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const body = {
      version: '2026-08-08-edited',
      displayName: '修订表',
      pointLimit: 10,
      entries: [{ baseCardCode: 'LL-bp2-001', points: 5 }],
      effectiveDateTime: '2026-08-08T12:34:56',
      expectedRevision: 3,
    };
    mocks.updateTable.mockResolvedValue({ id, revision: 4 });

    const response = await invokeRoute(deckPointTablesAdminRouter, '/:id', 'put', {
      params: { id },
      body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ data: { id, revision: 4 }, error: null });
    expect(mocks.updateTable).toHaveBeenCalledWith(
      id,
      body,
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('accepts effectiveDateTime for scheduled publication', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const body = {
      mode: 'SCHEDULED',
      effectiveDateTime: '2026-08-08T00:00:00',
      expectedRevision: 3,
      expectedActiveTableId: '33333333-3333-4333-8333-333333333333',
    };
    mocks.publish.mockResolvedValue({ id, lifecycle: 'SCHEDULED' });
    const response = await invokeRoute(deckPointTablesAdminRouter, '/:id/publish', 'post', {
      params: { id },
      body,
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith(id, body, '22222222-2222-4222-8222-222222222222');
  });

  it('validates paired active replacement revisions and exposes retired deletion', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const discardBody = {
      expectedRevision: 3,
      replacementTableId: '33333333-3333-4333-8333-333333333333',
      replacementExpectedRevision: 2,
    };
    mocks.discardTable.mockResolvedValue({ id, lifecycle: 'RETIRED' });
    const discarded = await invokeRoute(deckPointTablesAdminRouter, '/:id/discard', 'post', {
      params: { id },
      body: discardBody,
    });
    expect(discarded.statusCode).toBe(200);
    expect(mocks.discardTable).toHaveBeenCalledWith(
      id,
      discardBody,
      '22222222-2222-4222-8222-222222222222'
    );

    mocks.deleteTable.mockResolvedValue({ id, deleted: true });
    const deleted = await invokeRoute(deckPointTablesAdminRouter, '/:id', 'delete', {
      params: { id },
      body: { expectedRevision: 4 },
    });
    expect(deleted.body).toEqual({ data: { id, deleted: true }, error: null });
    expect(mocks.deleteTable).toHaveBeenCalledWith(id, 4);
  });
});
