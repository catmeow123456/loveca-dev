import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  listUsers: vi.fn(),
  changeRole: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('../../src/server/services/admin-user-service.js', () => ({
  AdminUserServiceError: class AdminUserServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  adminUserService: {
    listUsers: mocks.listUsers,
    changeRole: mocks.changeRole,
  },
}));

import { adminUsersRouter } from '../../src/server/routes/admin-users';

type RouteMethod = 'get' | 'put';

interface RouterLayer {
  handle: RequestHandler;
  route?: {
    path: string;
    methods: Partial<Record<RouteMethod, boolean>>;
    stack: RouterLayer[];
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
    body: { data?: unknown; total?: number; error?: { code?: string } | null } | null;
  };
}

async function invoke(path: string, method: RouteMethod, options: Partial<Request> = {}) {
  const layer = (adminUsersRouter.stack as unknown as RouterLayer[]).find(
    (candidate) => candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);

  const request = {
    params: {},
    query: {},
    body: undefined,
    user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin' },
    requestId: 'request-admin-users-1',
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

describe('adminUsersRouter', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('returns a server-paginated user page to a current platform administrator', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'admin' }], rowCount: 1 });
    mocks.listUsers.mockResolvedValue({ data: [{ id: 'user-1' }], total: 123 });

    const response = await invoke('/', 'get', {
      query: { q: 'maki', role: 'season_admin', limit: '25', offset: '50' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.listUsers).toHaveBeenCalledWith({
      query: 'maki',
      role: 'season_admin',
      limit: 25,
      offset: 50,
    });
    expect(response.body).toMatchObject({ data: [{ id: 'user-1' }], total: 123, error: null });
  });

  it('rejects season administrators before reading private account summaries', async () => {
    const response = await invoke('/', 'get', {
      user: { id: 'season-admin-1', role: 'season_admin' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body?.error?.code).toBe('FORBIDDEN');
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it('passes the target, actor, and optimistic role state to the transaction', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'admin' }], rowCount: 1 });
    mocks.changeRole.mockResolvedValue({ changed: true, user: { id: 'user-2' } });

    const response = await invoke('/:userId/role', 'put', {
      params: { userId: '22222222-2222-4222-8222-222222222222' },
      body: {
        role: 'season_admin',
        expectedRole: 'user',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.changeRole).toHaveBeenCalledWith({
      targetUserId: '22222222-2222-4222-8222-222222222222',
      actorUserId: '11111111-1111-4111-8111-111111111111',
      nextRole: 'season_admin',
      expectedRole: 'user',
    });
  });
});
