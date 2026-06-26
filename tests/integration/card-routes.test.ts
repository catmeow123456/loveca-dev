import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { cardsRouter } from '../../src/server/routes/cards';
import { pool } from '../../src/server/db/pool';

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

function findRouteLayer(path: string, method: 'put') {
  const layer = cardsRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route;
}

async function invokeRoute(path: string, method: 'put', options: Partial<Request> = {}) {
  const route = findRouteLayer(path, method);
  const response = createMockResponse();
  const request = {
    params: {},
    query: {},
    body: undefined,
    user: { id: 'admin-1', role: 'admin' },
    ...options,
  } as Request;

  for (const layer of route.stack) {
    if (response.body !== null) {
      break;
    }

    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (error?: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };

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

describe('cardsRouter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('更新卡牌时允许清空一个名称字段，只要另一个名称仍存在', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ name_jp: '日文名', name_cn: '中文名' }] } as never)
      .mockResolvedValueOnce({
        rows: [{ card_code: 'CARD-1', name_jp: '日文名', name_cn: null }],
      } as never);

    const response = await invokeRoute('/:code', 'put', {
      params: { code: 'CARD-1' },
      body: { name_cn: '   ' },
    });

    expect(response.statusCode).toBe(200);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(vi.mocked(pool.query).mock.calls[1]?.[1]).toEqual([null, 'admin-1', 'CARD-1']);
  });

  it('更新卡牌时拒绝同时清空日文名和中文名', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ name_jp: '日文名', name_cn: '中文名' }],
    } as never);

    const response = await invokeRoute('/:code', 'put', {
      params: { code: 'CARD-1' },
      body: { name_jp: '', name_cn: '   ' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'name_jp 或 name_cn 至少需要一个' },
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
