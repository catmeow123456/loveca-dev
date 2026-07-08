import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/server/services/site-announcement-service.js', () => ({
  siteAnnouncementService: {
    getPublicSiteStatus: vi.fn(),
  },
}));

import { appConfigRouter } from '../../src/server/routes/app-config';
import { siteAnnouncementService } from '../../src/server/services/site-announcement-service';

function createMockResponse() {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    body: null as unknown,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
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
    getHeader(name: string): string | undefined;
  };
}

function findRouteHandler(path: string, method: 'get') {
  const layer = appConfigRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  return layer.route.stack.at(-1)?.handle as (req: Request, res: Response) => void | Promise<void>;
}

async function invokeRoute(path: string, method: 'get', options: Partial<Request> = {}) {
  const handler = findRouteHandler(path, method);
  const response = createMockResponse();
  const request = {
    params: {},
    query: {},
    ...options,
  } as Request;

  await handler(request, response);
  return response;
}

describe('appConfigRouter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns public config with no-store cache control', async () => {
    vi.mocked(siteAnnouncementService.getPublicSiteStatus).mockResolvedValue({
      lifecycle: 'NORMAL',
      generatedAt: '2026-07-08T08:00:00.000Z',
      maintenance: null,
      announcements: [],
    });

    const response = await invokeRoute('/', 'get');

    expect(response.statusCode).toBe(200);
    expect(response.getHeader('Cache-Control')).toBe('no-store, max-age=0');
    expect(response.body?.error).toBeNull();
    expect(response.body?.data).toMatchObject({
      siteStatus: {
        lifecycle: 'NORMAL',
        announcements: [],
      },
    });
  });
});
