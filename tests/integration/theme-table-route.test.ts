import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../../src/server/services/theme-table-player-service.js', () => ({
  isThemeTablePlayerError: (error: unknown) =>
    error instanceof Error && 'statusCode' in error && 'code' in error,
  themeTablePlayerService: {
    getOverview: vi.fn(),
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

import { themeTableRouter } from '../../src/server/routes/theme-table';
import { themeTablePlayerService } from '../../src/server/services/theme-table-player-service';

function findRoute(path: string, method: 'get' | 'post') {
  const layer = themeTableRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route;
}

async function invoke(path: string, method: 'get' | 'post') {
  const route = findRoute(path, method);
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
  } as Response & { statusCode: number; body: unknown };
  const request = {
    user: { id: '22222222-2222-4222-8222-222222222222', role: 'user' },
    body: {},
    query: {},
    params: {},
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

describe('themeTableRouter', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns the event, full prebuilt deck list and player queue together', async () => {
    const overview = {
      event: { id: 'theme-1', prebuiltDecks: [{ id: 'deck-1', mainDeck: [], energyDeck: [] }] },
      availability: { state: 'OPEN', canJoin: true, message: '可以加入主题牌桌' },
      queue: { state: 'IDLE' },
    } as never;
    vi.mocked(themeTablePlayerService.getOverview).mockResolvedValue(overview);

    const response = await invoke('/overview', 'get');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ data: overview, error: null });
    expect(themeTablePlayerService.getOverview).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('joins without accepting a personal deck id', async () => {
    vi.mocked(themeTablePlayerService.join).mockResolvedValue({ state: 'WAITING' } as never);

    const response = await invoke('/queue/join', 'post');

    expect(response.statusCode).toBe(201);
    expect(themeTablePlayerService.join).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222'
    );
  });
});
