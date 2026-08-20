import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const permissionMocks = vi.hoisted(() => ({ poolQuery: vi.fn() }));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: permissionMocks.poolQuery },
}));

vi.mock('../../src/server/services/site-announcement-service.js', () => ({
  SiteAnnouncementServiceError: class SiteAnnouncementServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  siteAnnouncementService: {
    listAdminAnnouncements: vi.fn(),
    getConfiguredSiteStatus: vi.fn(),
    updateSiteStatusConfig: vi.fn(),
    updatePlayerBattleEntryVisibility: vi.fn(),
    createAnnouncement: vi.fn(),
    updateAnnouncement: vi.fn(),
    publishAnnouncement: vi.fn(),
    deleteAnnouncement: vi.fn(),
  },
}));

import { siteAnnouncementsRouter } from '../../src/server/routes/site-announcements';
import { siteAnnouncementService } from '../../src/server/services/site-announcement-service';

type RouteMethod = 'get' | 'post' | 'put' | 'delete';

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
  const layer = siteAnnouncementsRouter.stack.find(
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
    user: { id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
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

describe('siteAnnouncementsRouter', () => {
  beforeEach(() => {
    permissionMocks.poolQuery.mockResolvedValue({ rows: [{ role: 'admin' }], rowCount: 1 });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('requires platform admin role for announcement and maintenance routes', () => {
    const adminRoutes: readonly [string, RouteMethod][] = [
      ['/admin', 'get'],
      ['/admin/site-status', 'get'],
      ['/admin/site-status', 'put'],
      ['/admin', 'post'],
      ['/admin/:id', 'put'],
      ['/admin/:id/publish', 'post'],
      ['/admin/:id', 'delete'],
    ];

    for (const [path, method] of adminRoutes) {
      const route = findRoute(path, method);
      const requireAdmin = route.stack.at(1)?.handle as (
        req: Request,
        res: Response,
        next: () => void
      ) => void;
      const response = createMockResponse();
      const next = vi.fn();

      requireAdmin({ user: { id: 'u1', role: 'user' } } as Request, response, next);

      expect(response.statusCode, `${method.toUpperCase()} ${path}`).toBe(403);
      expect(response.body?.error?.code, `${method.toUpperCase()} ${path}`).toBe('FORBIDDEN');
      expect(next, `${method.toUpperCase()} ${path}`).not.toHaveBeenCalled();
    }
  });

  it('allows a current season administrator to update only player season entry visibility', async () => {
    permissionMocks.poolQuery.mockResolvedValue({
      rows: [{ role: 'season_admin' }],
      rowCount: 1,
    });
    const route = findRoute('/admin/player-battle-entries', 'put');
    const response = createMockResponse();
    const next = vi.fn();

    await route.stack
      .at(1)
      ?.handle({ user: { id: 'season-admin-1', role: 'season_admin' } } as Request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(response.body).toBeNull();
  });

  it('updates site maintenance status for the current admin', async () => {
    vi.mocked(siteAnnouncementService.updateSiteStatusConfig).mockResolvedValue({
      lifecycle: 'MAINTENANCE',
      generatedAt: '2026-07-08T08:00:00.000Z',
      maintenance: {
        id: 'default',
        title: '今晚维护',
        summary: '维护期间限制新对局。',
        detail: null,
        startsAt: '2026-07-08T13:00:00.000Z',
        estimatedEndsAt: '2026-07-08T14:00:00.000Z',
        restrictsNewGamesAt: null,
        impactScopes: ['正式联机'],
        restrictions: ['限制新对局'],
        action: '请稍后再开始对局',
        updatedAt: '2026-07-08T08:00:00.000Z',
      },
      announcements: [],
    });

    const response = await invokeRoute('/admin/site-status', 'put', {
      body: {
        lifecycle: 'MAINTENANCE',
        title: '今晚维护',
        summary: '维护期间限制新对局。',
        startsAt: '2026-07-08T13:00:00.000Z',
        estimatedEndsAt: '2026-07-08T14:00:00.000Z',
        impactScopes: ['正式联机'],
        restrictions: ['限制新对局'],
        action: '请稍后再开始对局',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(siteAnnouncementService.updateSiteStatusConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle: 'MAINTENANCE',
        title: '今晚维护',
      }),
      '22222222-2222-4222-8222-222222222222'
    );
    expect(response.body?.data).toMatchObject({
      lifecycle: 'MAINTENANCE',
      maintenance: { title: '今晚维护' },
    });
  });

  it('publishes an existing announcement for the current admin', async () => {
    vi.mocked(siteAnnouncementService.publishAnnouncement).mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      type: 'MAINTENANCE',
      title: '今晚维护',
      summary: '19:00 起进行短维护。',
      detail: null,
      publishedAt: '2026-07-08T08:00:00.000Z',
      startsAt: null,
      endsAt: null,
      priority: 0,
      impactScopes: [],
      status: 'PUBLISHED',
      createdAt: '2026-07-08T08:00:00.000Z',
      updatedAt: '2026-07-08T08:00:00.000Z',
      createdBy: '22222222-2222-4222-8222-222222222222',
      updatedBy: '22222222-2222-4222-8222-222222222222',
    });

    const response = await invokeRoute('/admin/:id/publish', 'post', {
      params: { id: '33333333-3333-4333-8333-333333333333' },
    });

    expect(response.statusCode).toBe(200);
    expect(siteAnnouncementService.publishAnnouncement).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222'
    );
    expect(response.body?.data).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'PUBLISHED',
    });
  });

  it('updates player battle entry visibility for the current admin', async () => {
    vi.mocked(siteAnnouncementService.updatePlayerBattleEntryVisibility).mockResolvedValue({
      ranked: false,
      themeTable: true,
    });

    const response = await invokeRoute('/admin/player-battle-entries', 'put', {
      body: { ranked: false, themeTable: true },
    });

    expect(response.statusCode).toBe(200);
    expect(siteAnnouncementService.updatePlayerBattleEntryVisibility).toHaveBeenCalledWith(
      { ranked: false, themeTable: true },
      '22222222-2222-4222-8222-222222222222'
    );
    expect(response.body?.data).toEqual({ ranked: false, themeTable: true });
  });
});
