/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-promise-reject-errors */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  getAdmin: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  getCurrentSource: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('../../src/server/services/activity-cover-service.js', () => ({
  ActivityCoverServiceError: class ActivityCoverServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode = 400
    ) {
      super(message);
    }
  },
  activityCoverService: {
    getAdmin: mocks.getAdmin,
    save: mocks.save,
    remove: mocks.remove,
    getCurrentSource: mocks.getCurrentSource,
  },
}));

import { activityCoverAdminRouter } from '../../src/server/routes/activity-covers';

type RouteMethod = 'delete' | 'get' | 'post';

function createMockResponse() {
  const response = {
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
  };
  return response as Response & {
    statusCode: number;
    body: {
      data: unknown;
      error: { code: string; message: string } | null;
    } | null;
  };
}

function findRoute(path: string, method: RouteMethod) {
  const layer = activityCoverAdminRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route;
}

async function invokeRoute(path: string, method: RouteMethod, options: Partial<Request> = {}) {
  const route = findRoute(path, method);
  const response = createMockResponse();
  const request = {
    params: {},
    query: {},
    body: undefined,
    requestId: 'request-cover-1',
    user: { id: '22222222-2222-4222-8222-222222222222', role: 'season_admin' },
    ...options,
  } as Request;

  for (const layer of route.stack) {
    if (response.body !== null) break;
    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (error?: unknown) => (error ? reject(error) : resolve());
      try {
        const result = layer.handle(request, response, next);
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>).then(resolve, reject);
        } else if (response.body !== null) {
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
  }
  return response;
}

describe('activityCoverAdminRouter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication at the shared router boundary', () => {
    const response = createMockResponse();
    const next = vi.fn();
    activityCoverAdminRouter.stack[0]?.handle({} as Request, response, next);

    expect(response.statusCode).toBe(401);
    expect(response.body?.error.code).toBe('UNAUTHORIZED');
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['RANKED', 'THEME'] as const)(
    'allows a current season administrator to read a %s cover',
    async (activityType) => {
      const activityId = '11111111-1111-4111-8111-111111111111';
      mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'season_admin' }], rowCount: 1 });
      mocks.getAdmin.mockResolvedValue({ activityType, activityId, mode: 'DEFAULT', revision: 0 });

      const response = await invokeRoute('/:activityType/:activityId', 'get', {
        params: { activityType, activityId },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.getAdmin).toHaveBeenCalledWith(activityType, activityId);
    }
  );

  it('rejects a stale privileged token before reading cover data', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'user' }], rowCount: 1 });

    const response = await invokeRoute('/:activityType/:activityId', 'get', {
      params: {
        activityType: 'RANKED',
        activityId: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body?.error.code).toBe('AUTHORIZATION_STALE');
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it('requires a non-empty reason before removing a published cover', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'season_admin' }], rowCount: 1 });

    const response = await invokeRoute('/:activityType/:activityId', 'delete', {
      params: {
        activityType: 'THEME',
        activityId: '11111111-1111-4111-8111-111111111111',
      },
      body: {
        expectedRevision: 2,
        idempotencyKey: 'remove-cover-request',
        reason: '   ',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error.code).toBe('ACTIVITY_COVER_INVALID_REQUEST');
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('accepts one config field and one image file as a valid multipart upload', async () => {
    const activityId = '11111111-1111-4111-8111-111111111111';
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'season_admin' }], rowCount: 1 });
    mocks.save.mockResolvedValue({ cover: { mode: 'CUSTOM', revision: 1 }, changed: true });

    const app = express();
    app.use((req, _res, next) => {
      req.user = {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'season-admin@example.com',
        emailVerified: true,
        role: 'season_admin',
      };
      req.requestId = 'request-cover-multipart';
      next();
    });
    app.use(activityCoverAdminRouter);
    const server = app.listen(0);

    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address() as AddressInfo;
      const body = new FormData();
      body.append(
        'config',
        JSON.stringify({
          expectedRevision: 0,
          idempotencyKey: 'save-cover-multipart',
          source: 'UPLOAD',
          maskLevel: 'STANDARD',
          wide: {
            crop: { x: 0, y: 0, width: 1, height: 1 },
            focus: { x: 0.5, y: 0.5 },
          },
          compact: {
            crop: { x: 0, y: 0, width: 1, height: 1 },
            focus: { x: 0.5, y: 0.5 },
          },
        })
      );
      body.append('image', new Blob(['image-bytes'], { type: 'image/png' }), 'cover.png');

      const response = await globalThis.fetch(
        `http://127.0.0.1:${address.port}/RANKED/${activityId}`,
        {
          method: 'POST',
          body,
        }
      );

      expect(response.status).toBe(200);
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          activityType: 'RANKED',
          activityId,
          source: 'UPLOAD',
          upload: Buffer.from('image-bytes'),
        })
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
