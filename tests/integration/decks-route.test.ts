import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  prepareDeckPayloadForStorage: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('../../src/server/services/deck-storage-service.js', () => ({
  DeckPayloadValidationError: class DeckPayloadValidationError extends Error {
    readonly errors: readonly string[];

    constructor(errors: readonly string[]) {
      super(errors.join('; '));
      this.errors = errors;
    }
  },
  prepareDeckPayloadForStorage: mocks.prepareDeckPayloadForStorage,
}));

vi.mock('../../src/server/services/decklog-scraper.js', () => ({
  extractDecklogInput: vi.fn(),
  scrapeDecklog: vi.fn(),
}));

import { decksRouter } from '../../src/server/routes/decks';

type RouteMethod = 'post';

interface RouterLayer {
  handle: RequestHandler;
  route?: {
    path: string;
    methods: Partial<Record<RouteMethod, boolean>>;
    stack: RouterLayer[];
  };
}

interface MockResponse extends Response {
  statusCode: number;
  body: {
    data: Record<string, unknown> | null;
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

function findRoute(path: string, method: RouteMethod) {
  const layer = (decksRouter.stack as RouterLayer[]).find(
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

async function invokePost(path: string, options: Partial<Request> = {}) {
  const route = findRoute(path, 'post');
  const response = createMockResponse();
  const request = {
    params: {},
    query: {},
    body: undefined,
    user: { id: 'user-1', role: 'user' },
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

describe('decksRouter', () => {
  afterEach(() => vi.clearAllMocks());

  it('创建请求未提供能量卡时自动补齐默认 12 张', async () => {
    mocks.prepareDeckPayloadForStorage.mockResolvedValue({
      main_deck: [],
      energy_deck: [{ card_code: 'LL-E-001-SD', count: 12 }],
      validation: { valid: false, errors: ['主卡组不完整'] },
    });
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: 'created-deck' }] });

    const response = await invokePost('/', {
      body: { name: '新卡组' },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.prepareDeckPayloadForStorage).toHaveBeenCalledWith({
      name: '新卡组',
      description: null,
      main_deck: [],
      energy_deck: [{ card_code: 'LL-E-001-SD', count: 12 }],
    });
  });

  it('创建请求显式提供空能量卡组时保留用户选择', async () => {
    mocks.prepareDeckPayloadForStorage.mockResolvedValue({
      main_deck: [],
      energy_deck: [],
      validation: { valid: false, errors: ['能量卡组不完整'] },
    });
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: 'created-empty-energy-deck' }] });

    const response = await invokePost('/', {
      body: { name: '自定义能量卡组', energy_deck: [] },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.prepareDeckPayloadForStorage).toHaveBeenCalledWith({
      name: '自定义能量卡组',
      description: null,
      main_deck: [],
      energy_deck: [],
    });
  });

  it('复制自己的卡组为下一个版本并保持副本关闭分享', async () => {
    const source = {
      id: 'deck-1',
      user_id: 'user-1',
      name: '莲之空',
      description: '原始说明',
      main_deck: [{ card_code: 'LL-card', count: 4, card_type: 'MEMBER' }],
      energy_deck: [{ card_code: 'LL-E-001-SD', count: 12 }],
      is_valid: true,
      validation_errors: [],
    };
    mocks.prepareDeckPayloadForStorage.mockResolvedValue({
      main_deck: source.main_deck,
      energy_deck: source.energy_deck,
      validation: { valid: true, errors: [] },
    });
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [source] })
      .mockResolvedValueOnce({ rows: [{ name: '莲之空' }, { name: '莲之空 v2' }] })
      .mockResolvedValueOnce({ rows: [{ ...source, id: 'deck-2', name: '莲之空 v3' }] });

    const response = await invokePost('/:id/copy', { params: { id: 'deck-1' } });

    expect(response.statusCode).toBe(201);
    expect(response.body?.data).toMatchObject({ id: 'deck-2', name: '莲之空 v3' });
    expect(mocks.prepareDeckPayloadForStorage).toHaveBeenCalledWith({
      name: '莲之空 v3',
      description: '原始说明',
      main_deck: source.main_deck,
      energy_deck: source.energy_deck,
    });
    expect(mocks.poolQuery.mock.calls[2]?.[1]).toEqual([
      'user-1',
      '莲之空 v3',
      '原始说明',
      JSON.stringify(source.main_deck),
      JSON.stringify(source.energy_deck),
      true,
      JSON.stringify([]),
      'deck-1',
    ]);
    expect(mocks.poolQuery.mock.calls[2]?.[0]).toContain('false, false');
  });

  it('长卡组名多次复制时仍按同系列版本递增', async () => {
    const sourceName = '莲'.repeat(100);
    const truncatedBaseName = '莲'.repeat(97);
    const source = {
      id: 'deck-long-name',
      user_id: 'user-1',
      name: sourceName,
      description: null,
      main_deck: [],
      energy_deck: [],
    };
    mocks.prepareDeckPayloadForStorage.mockResolvedValue({
      main_deck: [],
      energy_deck: [],
      validation: { valid: false, errors: [] },
    });
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [source] })
      .mockResolvedValueOnce({ rows: [{ name: sourceName }, { name: `${truncatedBaseName} v2` }] })
      .mockResolvedValueOnce({
        rows: [{ ...source, id: 'deck-long-name-copy', name: `${truncatedBaseName} v3` }],
      });

    const response = await invokePost('/:id/copy', { params: { id: source.id } });

    expect(response.statusCode).toBe(201);
    expect(response.body?.data?.name).toBe(`${truncatedBaseName} v3`);
    expect(mocks.poolQuery.mock.calls[2]?.[1]?.[1]).toBe(`${truncatedBaseName} v3`);
  });

  it('拒绝普通用户复制其他用户的私有卡组', async () => {
    mocks.poolQuery.mockResolvedValueOnce({
      rows: [{ id: 'deck-1', user_id: 'user-2', name: '其他用户卡组' }],
    });

    const response = await invokePost('/:id/copy', { params: { id: 'deck-1' } });

    expect(response.statusCode).toBe(403);
    expect(response.body?.error?.code).toBe('FORBIDDEN');
    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
  });

  it('拒绝管理员通过自有卡组入口复制其他用户的卡组', async () => {
    mocks.poolQuery.mockResolvedValueOnce({
      rows: [{ id: 'deck-1', user_id: 'user-2', name: '其他用户卡组' }],
    });

    const response = await invokePost('/:id/copy', {
      params: { id: 'deck-1' },
      user: { id: 'admin-1', role: 'admin' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body?.error?.code).toBe('FORBIDDEN');
    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
  });
});
