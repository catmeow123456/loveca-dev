/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/unbound-method */
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/services/ranked-admin-service.js', () => ({
  RankedAdminServiceError: class RankedAdminServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  rankedAdminService: {
    getEnvironmentPreview: vi.fn(),
    listSeasons: vi.fn(),
    getSeason: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    updateActiveOperations: vi.fn(),
    activateSeason: vi.fn(),
    setQueueAdmission: vi.fn(),
    beginFinalizing: vi.fn(),
    closeSeason: vi.fn(),
    listMatches: vi.fn(),
    getMatch: vi.fn(),
    settleMatch: vi.fn(),
    previewCorrection: vi.fn(),
    executeCorrection: vi.fn(),
    getMonitoringSummary: vi.fn(),
  },
}));

vi.mock('../../src/server/services/ranked-rating-revision-service.js', () => ({
  RankedRatingRevisionServiceError: class RankedRatingRevisionServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  rankedRatingRevisionService: {
    listHistory: vi.fn(),
    preview: vi.fn(),
    apply: vi.fn(),
  },
}));

import { rankedAdminRouter } from '../../src/server/routes/ranked-admin';
import { rankedAdminService } from '../../src/server/services/ranked-admin-service';
import { rankedRatingRevisionService } from '../../src/server/services/ranked-rating-revision-service';

type RouteMethod = 'get' | 'post' | 'put';

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
      total?: number;
      error: { code: string; message: string } | null;
    } | null;
  };
}

function findRoute(path: string, method: RouteMethod) {
  const layer = rankedAdminRouter.stack.find(
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

describe('rankedAdminRouter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('protects the whole router with authentication and admin authorization', () => {
    const requireAdminLayer = rankedAdminRouter.stack[1];
    const response = createMockResponse();
    const next = vi.fn();

    requireAdminLayer.handle({ user: { id: 'user-1', role: 'user' } } as Request, response, next);

    expect(response.statusCode).toBe(403);
    expect(response.body?.error?.code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('coerces season schedule timestamps and uses the authenticated admin identity', async () => {
    vi.mocked(rankedAdminService.createDraft).mockResolvedValue({
      id: 'season-1',
    } as never);

    const response = await invokeRoute('/seasons', 'post', {
      body: {
        seasonKey: 'season-2026-01',
        name: '2026 第一赛季',
        announcement: '欢迎参加第一赛季',
        platformTimeZone: 'Asia/Shanghai',
        openWindows: [{ weekdays: [1], startMinute: 1200, endMinute: 1320 }],
        startsAt: '2026-08-01T00:00:00.000Z',
        scheduledEndsAt: '2026-09-01T00:00:00.000Z',
        finalizingDeadlineAt: '2026-09-03T00:00:00.000Z',
        ratingAlgorithmVersion: 'GLICKO1_PER_MATCH_V1',
        softReset: {
          mode: 'RETAIN_TOWARD_CENTER',
          center: 1600,
          retention: 0.25,
          minimumDeviation: 220,
        },
        leaderboardMinimumMatchCount: 12,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(rankedAdminService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: expect.any(Date),
        announcement: '欢迎参加第一赛季',
        ratingAlgorithmVersion: 'GLICKO1_PER_MATCH_V1',
        softReset: {
          mode: 'RETAIN_TOWARD_CENTER',
          center: 1600,
          retention: 0.25,
          minimumDeviation: 220,
        },
        leaderboardMinimumMatchCount: 12,
      }),
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('binds active season operational edits to the current admin', async () => {
    vi.mocked(rankedAdminService.updateActiveOperations).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      lifecycle: 'ACTIVE',
    } as never);

    const response = await invokeRoute('/seasons/:seasonId/operations', 'put', {
      params: { seasonId: '11111111-1111-4111-8111-111111111111' },
      body: {
        name: '晚间排位',
        announcement: '周末开放时间有所调整',
        openWindows: [{ weekdays: [5, 6], startMinute: 1140, endMinute: 1320 }],
        leaderboardMinimumMatchCount: 8,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.updateActiveOperations).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      {
        name: '晚间排位',
        announcement: '周末开放时间有所调整',
        openWindows: [{ weekdays: [5, 6], startMinute: 1140, endMinute: 1320 }],
        leaderboardMinimumMatchCount: 8,
      },
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('rejects an overlong season announcement', async () => {
    const response = await invokeRoute('/seasons/:seasonId/operations', 'put', {
      params: { seasonId: '11111111-1111-4111-8111-111111111111' },
      body: {
        name: '晚间排位',
        announcement: '公'.repeat(2001),
        openWindows: [{ weekdays: [5, 6], startMinute: 1140, endMinute: 1320 }],
        leaderboardMinimumMatchCount: 8,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(rankedAdminService.updateActiveOperations).not.toHaveBeenCalled();
  });

  it('rejects frozen fields in active season operational edits', async () => {
    const response = await invokeRoute('/seasons/:seasonId/operations', 'put', {
      params: { seasonId: '11111111-1111-4111-8111-111111111111' },
      body: {
        name: '晚间排位',
        openWindows: [{ weekdays: [5, 6], startMinute: 1140, endMinute: 1320 }],
        leaderboardMinimumMatchCount: 8,
        ratingAlgorithmVersion: 'UNSAFE_OVERRIDE',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(rankedAdminService.updateActiveOperations).not.toHaveBeenCalled();
  });

  it('validates and forwards a bounded rating revision preview with the current admin', async () => {
    vi.mocked(rankedRatingRevisionService.preview).mockResolvedValue({
      previewToken: 'signed-preview',
    } as never);
    const seasonId = '11111111-1111-4111-8111-111111111111';
    const parameters = {
      ratingScale: 1000,
      minimumRatingDeviation: 100,
      placementMatchCount: 5,
      growthPool: {
        enabled: true,
        centerRating: 1800,
        maximumTotalAdjustment: 16,
        transitionWidth: 250,
        negativeWinnerShare: 0.75,
      },
    };

    const response = await invokeRoute('/seasons/:seasonId/rating-revisions/preview', 'post', {
      params: { seasonId },
      body: { parameters, reason: '调整本赛季积分参数' },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedRatingRevisionService.preview).toHaveBeenCalledWith({
      seasonId,
      parameters,
      reason: '调整本赛季积分参数',
      adminUserId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('rejects out-of-range or arbitrary rating revision fields', async () => {
    const response = await invokeRoute('/seasons/:seasonId/rating-revisions/preview', 'post', {
      params: { seasonId: '11111111-1111-4111-8111-111111111111' },
      body: {
        parameters: {
          ratingScale: 10_000,
          minimumRatingDeviation: 100,
          placementMatchCount: 5,
          arbitraryFormula: 'return 9999',
        },
        reason: '尝试提交非白名单参数',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(rankedRatingRevisionService.preview).not.toHaveBeenCalled();
  });

  it('binds rating revision application to the route season and current admin', async () => {
    vi.mocked(rankedRatingRevisionService.apply).mockResolvedValue({
      seasonId: '11111111-1111-4111-8111-111111111111',
    } as never);

    const response = await invokeRoute('/seasons/:seasonId/rating-revisions/apply', 'post', {
      params: { seasonId: '11111111-1111-4111-8111-111111111111' },
      body: { previewToken: 'a'.repeat(128) },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedRatingRevisionService.apply).toHaveBeenCalledWith({
      seasonId: '11111111-1111-4111-8111-111111111111',
      previewToken: 'a'.repeat(128),
      adminUserId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('validates and forwards paginated user search for all ranked matches', async () => {
    vi.mocked(rankedAdminService.listMatches).mockResolvedValue({
      matches: [{ matchId: 'match-21' }],
      total: 47,
    } as never);

    const response = await invokeRoute('/matches', 'get', {
      query: {
        userQuery: ' 小能苗 ',
        limit: '20',
        offset: '20',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.listMatches).toHaveBeenCalledWith({
      userQuery: '小能苗',
      limit: 20,
      offset: 20,
    });
    expect(response.body).toMatchObject({
      data: [{ matchId: 'match-21' }],
      total: 47,
      error: null,
    });
  });

  it('requires preview-before-execute payloads to express a valid correction choice', async () => {
    const response = await invokeRoute('/matches/:matchId/corrections/preview', 'post', {
      params: { matchId: 'match-1' },
      body: {
        seasonId: '11111111-1111-4111-8111-111111111111',
        action: 'VOID',
        replacementWinnerSeat: 'FIRST',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(rankedAdminService.previewCorrection).not.toHaveBeenCalled();
  });

  it('binds correction execution to the route match and current admin', async () => {
    vi.mocked(rankedAdminService.executeCorrection).mockResolvedValue({
      eventType: 'REPLACEMENT',
    } as never);

    const response = await invokeRoute('/matches/:matchId/corrections', 'post', {
      params: { matchId: 'match-1' },
      body: {
        seasonId: '11111111-1111-4111-8111-111111111111',
        action: 'REPLACE',
        replacementWinnerSeat: 'SECOND',
        replacementResultType: 'NORMAL',
        reason: '裁定原胜方记录错误',
        idempotencyKey: 'correction-match-1-001',
        expectedLedgerRevision: 7,
        expectedTargetEventId: '33333333-3333-4333-8333-333333333333',
        previewToken: 'a'.repeat(43),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.executeCorrection).toHaveBeenCalledWith({
      seasonId: '11111111-1111-4111-8111-111111111111',
      matchId: 'match-1',
      action: 'REPLACE',
      replacementWinnerSeat: 'SECOND',
      replacementResultType: 'NORMAL',
      reason: '裁定原胜方记录错误',
      idempotencyKey: 'correction-match-1-001',
      expectedLedgerRevision: 7,
      expectedTargetEventId: '33333333-3333-4333-8333-333333333333',
      previewToken: 'a'.repeat(43),
      adminUserId: '22222222-2222-4222-8222-222222222222',
    });
  });
});
