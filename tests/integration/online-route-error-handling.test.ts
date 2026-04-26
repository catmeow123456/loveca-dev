import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/server/services/online-room-service.js', () => ({
  OnlineRoomServiceError: class OnlineRoomServiceError extends Error {
    code = 'ONLINE_ROOM_ERROR';
    statusCode = 400;
  },
  onlineRoomService: {
    touchInGameMemberByMatch: vi.fn(),
  },
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { onlineRouter } from '../../src/server/routes/online';
import { onlineMatchService } from '../../src/server/services/online-match-service';

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

function findRouteHandler(path: string, method: 'get' | 'post') {
  const layer = onlineRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  return layer.route.stack.at(-1)?.handle as (req: Request, res: Response) => void | Promise<void>;
}

async function invokeRoute(path: string, method: 'get' | 'post', options: Partial<Request> = {}) {
  const handler = findRouteHandler(path, method);
  const response = createMockResponse();
  const request = {
    params: {},
    body: undefined,
    user: { id: 'u1' },
    ...options,
  } as Request;

  await handler(request, response);
  return response;
}

describe('onlineRouter error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('match snapshot 内部抛错时应返回统一 500 错误', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'getMatchSnapshot').mockImplementation(() => {
      throw new Error('snapshot blew up');
    });

    const response = await invokeRoute('/matches/:matchId/snapshot', 'get', {
      params: { matchId: 'm1' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'ONLINE_INTERNAL_ERROR',
        message: 'snapshot blew up',
      },
    });
  });

  it('match command 内部抛错时应返回统一 500 错误', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'executeCommand').mockImplementation(() => {
      throw new Error('command blew up');
    });

    const response = await invokeRoute('/matches/:matchId/command', 'post', {
      params: { matchId: 'm1' },
      body: { command: { type: 'END_PHASE' } },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'ONLINE_INTERNAL_ERROR',
        message: 'command blew up',
      },
    });
  });

  it('match advance 内部抛错时应返回统一 500 错误', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'advancePhase').mockImplementation(() => {
      throw new Error('advance blew up');
    });

    const response = await invokeRoute('/matches/:matchId/advance', 'post', {
      params: { matchId: 'm1' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'ONLINE_INTERNAL_ERROR',
        message: 'advance blew up',
      },
    });
  });
});
