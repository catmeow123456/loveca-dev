/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  getAdmin: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('../../src/server/services/activity-badge-service.js', () => ({
  ActivityBadgeServiceError: class ActivityBadgeServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode = 400
    ) {
      super(message);
    }
  },
  activityBadgeService: {
    getAdmin: mocks.getAdmin,
    save: mocks.save,
  },
}));

import { activityBadgeAdminRouter } from '../../src/server/routes/activity-badges';

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
    body: { data: unknown; error: { code: string; message: string } | null } | null;
  };
}

function findGetRoute() {
  const layer = activityBadgeAdminRouter.stack.find(
    (candidate) =>
      'route' in candidate &&
      candidate.route?.path === '/:activityType/:activityId' &&
      candidate.route.methods.get
  );
  if (!layer?.route) throw new Error('GET activity badge route not found');
  return layer.route;
}

async function invokeGet(options: Partial<Request>) {
  const route = findGetRoute();
  const response = createMockResponse();
  const request = {
    params: {},
    requestId: 'request-badge-1',
    user: { id: '22222222-2222-4222-8222-222222222222', role: 'season_admin' },
    ...options,
  } as Request;
  for (const layer of route.stack) {
    if (response.body !== null) break;
    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (error?: unknown) =>
        error ? reject(error instanceof Error ? error : new Error('middleware failed')) : resolve();
      const result = layer.handle(request, response, next);
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).then(resolve, reject);
      } else if (response.body !== null) {
        resolve();
      }
    });
  }
  return response;
}

describe('activityBadgeAdminRouter', () => {
  afterEach(() => vi.clearAllMocks());

  it.each(['RANKED', 'THEME'] as const)(
    'allows a current season administrator to read a %s badge',
    async (activityType) => {
      const activityId = '11111111-1111-4111-8111-111111111111';
      mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'season_admin' }], rowCount: 1 });
      mocks.getAdmin.mockResolvedValue({ activityType, activityId, badge: null });

      const response = await invokeGet({ params: { activityType, activityId } });

      expect(response.statusCode).toBe(200);
      expect(mocks.getAdmin).toHaveBeenCalledWith(activityType, activityId);
    }
  );

  it('rejects stale season-admin authority before reading badge data', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'user' }], rowCount: 1 });

    const response = await invokeGet({
      params: {
        activityType: 'RANKED',
        activityId: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body?.error.code).toBe('AUTHORIZATION_STALE');
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it('accepts one config field and one image file', async () => {
    const activityId = '11111111-1111-4111-8111-111111111111';
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'season_admin' }], rowCount: 1 });
    mocks.save.mockResolvedValue({ badge: { badge: { revision: 1 } }, changed: true });
    const app = express();
    app.use((req, _res, next) => {
      req.user = {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'season-admin@example.com',
        emailVerified: true,
        role: 'season_admin',
      };
      req.requestId = 'request-badge-multipart';
      next();
    });
    app.use(activityBadgeAdminRouter);
    const server = app.listen(0);

    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address() as AddressInfo;
      const body = new FormData();
      body.append(
        'config',
        JSON.stringify({ expectedRevision: 0, idempotencyKey: 'save-badge-multipart' })
      );
      body.append('image', new Blob(['badge-bytes'], { type: 'image/png' }), 'badge.png');

      const response = await globalThis.fetch(
        `http://127.0.0.1:${address.port}/THEME/${activityId}`,
        { method: 'POST', body }
      );

      expect(response.status).toBe(200);
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          activityType: 'THEME',
          activityId,
          upload: Buffer.from('badge-bytes'),
        })
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
