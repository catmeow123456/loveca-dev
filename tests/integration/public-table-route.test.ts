import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../../src/server/services/public-table-service.js', () => ({
  PublicTableServiceError: class PublicTableServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode = 400
    ) {
      super(message);
    }
  },
  publicTableService: {
    getSummary: vi.fn(),
    getStatus: vi.fn(),
    join: vi.fn(),
    heartbeat: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock('../../src/server/services/site-announcement-service.js', () => ({
  siteAnnouncementService: {
    getGameplayRestriction: vi.fn(() => Promise.resolve(null)),
  },
}));

import { publicTableRouter } from '../../src/server/routes/public-table';
import { publicTableService } from '../../src/server/services/public-table-service';

type RouteMethod = 'get' | 'post';

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
  const layer = publicTableRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route;
}

async function invokeRoute(path: string, method: RouteMethod, options: Partial<Request> = {}) {
  const route = findRoute(path, method);
  const response = createMockResponse();
  const request = {
    params: {},
    query: {},
    body: undefined,
    user: { id: '22222222-2222-4222-8222-222222222222', role: 'user' },
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
        }
      } catch (error) {
        reject(error);
      }
    });
  }
  return response;
}

describe('publicTableRouter', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns the public coarse availability summary', async () => {
    vi.mocked(publicTableService.getSummary).mockResolvedValue({
      open: true,
      hasWaitingPlayer: true,
      unavailableReason: null,
    });

    const response = await invokeRoute('/summary', 'get', { user: undefined });

    expect(response.statusCode).toBe(200);
    expect(response.body?.data).toEqual({
      open: true,
      hasWaitingPlayer: true,
      unavailableReason: null,
    });
  });

  it('joins with the authenticated user and selected cloud deck', async () => {
    vi.mocked(publicTableService.join).mockResolvedValue({
      state: 'WAITING',
      ticketId: 'ticket-1',
      joinedAt: 1000,
      deckName: '测试卡组',
      reservationId: null,
      confirmationExpiresAt: null,
      confirmed: false,
      roomCode: null,
      roomGeneration: null,
      message: null,
    });
    const deckId = '11111111-1111-4111-8111-111111111111';

    const response = await invokeRoute('/join', 'post', {
      body: { deckId, entrySource: 'SHARED_LINK' },
    });

    expect(response.statusCode).toBe(201);
    expect(publicTableService.join).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      deckId,
      'SHARED_LINK'
    );
  });

  it('rejects an invalid deck id before calling the service', async () => {
    const response = await invokeRoute('/join', 'post', {
      body: { deckId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('INVALID_REQUEST');
    expect(publicTableService.join).not.toHaveBeenCalled();
  });

  it('does not expose unexpected service error details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(publicTableService.getSummary).mockRejectedValue(
      new Error('database password must stay private')
    );

    const response = await invokeRoute('/summary', 'get', { user: undefined });

    expect(response.statusCode).toBe(500);
    expect(response.body?.error).toEqual({
      code: 'PUBLIC_TABLE_INTERNAL_ERROR',
      message: '公共牌桌服务暂时不可用',
    });
    expect(consoleError).toHaveBeenCalled();
  });
});
