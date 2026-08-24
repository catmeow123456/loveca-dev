import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock('../../src/server/middleware/require-permission.js', () => ({
  readCurrentAuthorizedRole: vi.fn((_userId: string, role: string) =>
    Promise.resolve(role === 'admin' ? 'admin' : null)
  ),
  requirePermission: () => (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role === 'admin') {
      next();
      return;
    }
    res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: '无权访问' } });
  },
}));

import { cardsRouter } from '../../src/server/routes/cards';
import { pool } from '../../src/server/db/pool';

// pool.query relies on its owning Pool at runtime; the test mock itself is safe to retain.
// eslint-disable-next-line @typescript-eslint/unbound-method
const poolQueryMock = vi.mocked(pool.query);

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

type RouteMethod = 'get' | 'post' | 'put';

interface TestRouteLayer {
  readonly route?: {
    readonly path: string;
    readonly methods: Partial<Record<RouteMethod, boolean>>;
    readonly stack: ReadonlyArray<{
      readonly handle: (request: Request, response: Response, next: NextFunction) => unknown;
    }>;
  };
}

function findRouteLayer(path: string, method: RouteMethod) {
  const layer = (cardsRouter.stack as unknown as TestRouteLayer[]).find(
    (candidate) => candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route;
}

async function invokeRoute(path: string, method: RouteMethod, options: Partial<Request> = {}) {
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
      const rejectWithError = (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const next: NextFunction = (error?: unknown) => {
        if (error) {
          rejectWithError(error);
          return;
        }
        resolve();
      };

      try {
        const result = layer.handle(request, response, next);
        if (result instanceof Promise) {
          void result.then(() => resolve(), rejectWithError);
        }
      } catch (error) {
        rejectWithError(error);
      }
    });
  }

  return response;
}

describe('cardsRouter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('赛季管理员通过公开列表仍只能读取已发布卡牌', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] } as never);

    const response = await invokeRoute('/', 'get', {
      user: { id: 'season-admin-1', role: 'season_admin' },
      query: { status: 'all' },
    });

    expect(response.statusCode).toBe(200);
    expect(poolQueryMock.mock.calls[0]?.[0]).toContain("WHERE status = 'PUBLISHED'");
  });

  it('赛季管理员不能通过单卡公开接口读取草稿', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ card_code: 'DRAFT-1', card_type: 'MEMBER', status: 'DRAFT' }],
    } as never);

    const response = await invokeRoute('/:code', 'get', {
      user: { id: 'season-admin-1', role: 'season_admin' },
      params: { code: 'DRAFT-1' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body?.error?.code).toBe('NOT_FOUND');
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
  });

  it('管理列表在服务端分页、筛选并只返回轻量字段', async () => {
    const updatedAt = new Date('2026-08-14T08:00:00.000Z');
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ total: '29' }] } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            cardCode: 'PL!-sd1-007-SD',
            cardType: 'MEMBER',
            nameJp: '東條 希',
            nameCn: '东条希',
            imageFilename: 'PL!-sd1-007-SD.png',
            rare: 'SD',
            status: 'DRAFT',
            updatedAt,
          },
        ],
      } as never);

    const response = await invokeRoute('/admin', 'get', {
      query: {
        page: '2',
        pageSize: '28',
        query: '%_',
        cardType: 'MEMBER',
        status: 'DRAFT',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      data: {
        items: [
          {
            cardCode: 'PL!-sd1-007-SD',
            cardType: 'MEMBER',
            nameJp: '東條 希',
            nameCn: '东条希',
            imageFilename: 'PL!-sd1-007-SD.png',
            rare: 'SD',
            status: 'DRAFT',
            updatedAt: updatedAt.toISOString(),
          },
        ],
        page: 2,
        pageSize: 28,
        total: 29,
        totalPages: 2,
      },
      error: null,
    });
    expect(poolQueryMock).toHaveBeenCalledTimes(2);
    const [countSql, countValues] = poolQueryMock.mock.calls[0] ?? [];
    const [listSql, listValues] = poolQueryMock.mock.calls[1] ?? [];
    expect(countSql).toContain('SELECT COUNT(*)');
    expect(countValues).toEqual(['MEMBER', 'DRAFT', '%\\%\\_%']);
    expect(listSql).not.toContain('SELECT *');
    expect(listSql).toContain('LIMIT $4 OFFSET $5');
    expect(listValues).toEqual(['MEMBER', 'DRAFT', '%\\%\\_%', 28, 28]);
  });

  it('管理列表拒绝超出上限的分页大小', async () => {
    const response = await invokeRoute('/admin', 'get', {
      query: { page: '1', pageSize: '101' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it('批量状态切换使用一次集合更新并沿用当前筛选', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ card_code: 'PL!-sd1-007-SD' }],
      rowCount: 1,
    } as never);

    const response = await invokeRoute('/admin/status', 'put', {
      body: {
        targetStatus: 'PUBLISHED',
        cardType: 'MEMBER',
        status: 'DRAFT',
        query: '东条',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ data: { updated: 1 }, error: null });
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
    const [sql, values] = poolQueryMock.mock.calls[0] ?? [];
    expect(sql).toContain('UPDATE cards');
    expect(sql).toContain('updated_at = now()');
    expect(sql).toContain('WHERE status <> $1');
    expect(values).toEqual(['PUBLISHED', 'admin-1', 'MEMBER', 'DRAFT', '%东条%']);
  });

  it('读取单卡详情时只查询同基础编号的同型卡牌用于继承', async () => {
    const card = {
      card_code: 'PL!_-sd1-007-SD',
      card_type: 'MEMBER',
      name_jp: '東條 希',
      status: 'PUBLISHED',
      blade_hearts: null,
    };
    poolQueryMock
      .mockResolvedValueOnce({ rows: [card] } as never)
      .mockResolvedValueOnce({ rows: [card] } as never);

    const response = await invokeRoute('/:code', 'get', {
      params: { code: card.card_code },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ data: card, error: null });
    expect(poolQueryMock).toHaveBeenCalledTimes(2);
    const [inheritanceSql, inheritanceValues] = poolQueryMock.mock.calls[1] ?? [];
    expect(inheritanceSql).toContain('card_type = $1');
    expect(inheritanceSql).toContain("card_code = $2 OR card_code LIKE $3 ESCAPE '\\'");
    expect(inheritanceValues).toEqual(['MEMBER', 'PL!_-sd1-007', 'PL!\\_-sd1-007-%']);
  });

  it('更新卡牌时允许清空一个名称字段，只要另一个名称仍存在', async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ name_jp: '日文名', name_cn: '中文名' }] } as never)
      .mockResolvedValueOnce({
        rows: [{ card_code: 'CARD-1', name_jp: '日文名', name_cn: null }],
      } as never);

    const response = await invokeRoute('/:code', 'put', {
      params: { code: 'CARD-1' },
      body: { name_cn: '   ' },
    });

    expect(response.statusCode).toBe(200);
    expect(poolQueryMock).toHaveBeenCalledTimes(2);
    expect(poolQueryMock.mock.calls[1]?.[1]).toEqual([null, 'admin-1', 'CARD-1']);
  });

  it('更新卡牌时拒绝同时清空日文名和中文名', async () => {
    poolQueryMock.mockResolvedValueOnce({
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
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
  });

  it('管理中心换图时清除与新图不再对应的版本化标记', async () => {
    poolQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            name_jp: '日文名',
            name_cn: '中文名',
            image_filename: 'source-abcdefabcdefabcdefabcdef.webp',
            source_flags: {
              imageObjectVersioned: true,
              imageOriginalBaseName: 'source',
              fieldConflict: true,
            },
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ card_code: 'CARD-1', image_filename: 'CARD-1.webp' }],
      } as never);

    const response = await invokeRoute('/:code', 'put', {
      params: { code: 'CARD-1' },
      body: {
        image_filename: 'CARD-1.webp',
        source_flags: {
          imageObjectVersioned: true,
          imageOriginalBaseName: 'source',
          fieldConflict: true,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const [sql, values] = poolQueryMock.mock.calls[1] ?? [];
    expect(sql).toContain('image_filename = $1');
    expect(sql).toContain('source_flags = $2');
    expect(values).toEqual([
      'CARD-1.webp',
      JSON.stringify({ fieldConflict: true }),
      'admin-1',
      'CARD-1',
    ]);
  });

  it('管理中心未换图时保留与当前图片一致的服务端版本化标记', async () => {
    poolQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            name_jp: '日文名',
            name_cn: '中文名',
            image_filename: 'source-abcdefabcdefabcdefabcdef.webp',
            source_flags: {
              imageObjectVersioned: true,
              imageOriginalBaseName: 'source',
              fieldConflict: true,
            },
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [{ card_code: 'CARD-1' }] } as never);

    const response = await invokeRoute('/:code', 'put', {
      params: { code: 'CARD-1' },
      body: {
        source_flags: {
          imageObjectVersioned: false,
          imageOriginalBaseName: 'spoofed',
          upstreamNote: 'keep',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const [sql, values] = poolQueryMock.mock.calls[1] ?? [];
    expect(sql).toContain('source_flags = $1');
    expect(values).toEqual([
      JSON.stringify({
        upstreamNote: 'keep',
        imageObjectVersioned: true,
        imageOriginalBaseName: 'source',
      }),
      'admin-1',
      'CARD-1',
    ]);
  });

  it('卡牌创建 API 不接受外部伪造的内部图片版本标记', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ card_code: 'CARD-2', name_jp: '日文名' }],
    } as never);

    const response = await invokeRoute('/', 'post', {
      body: {
        card_code: 'CARD-2',
        card_type: 'ENERGY',
        name_jp: '日文名',
        source_flags: {
          imageObjectVersioned: true,
          imageOriginalBaseName: 'spoofed',
          upstreamNote: 'keep',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const [, values] = poolQueryMock.mock.calls[0] ?? [];
    expect(values?.[22]).toBe(JSON.stringify({ upstreamNote: 'keep' }));
  });
});
