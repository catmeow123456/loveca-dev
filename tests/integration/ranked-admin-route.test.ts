/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/unbound-method */
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const permissionMocks = vi.hoisted(() => ({ poolQuery: vi.fn() }));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: permissionMocks.poolQuery },
}));

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
    deleteDraft: vi.fn(),
    updateActiveOperations: vi.fn(),
    activateSeason: vi.fn(),
    setQueueAdmission: vi.fn(),
    beginFinalizing: vi.fn(),
    closeSeason: vi.fn(),
    getOverview: vi.fn(),
    getDeckStatistics: vi.fn(),
    listPlayers: vi.fn(),
    searchPlayers: vi.fn(),
    getPlayerContext: vi.fn(),
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

type RouteMethod = 'delete' | 'get' | 'post' | 'put';

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

  it('allows a current season administrator through the ranked router boundary', async () => {
    permissionMocks.poolQuery.mockResolvedValue({
      rows: [{ role: 'season_admin' }],
      rowCount: 1,
    });
    const requireRankedPermission = rankedAdminRouter.stack[1];
    const response = createMockResponse();
    const next = vi.fn();

    await requireRankedPermission.handle(
      { user: { id: 'season-admin-1', role: 'season_admin' } } as Request,
      response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.body).toBeNull();
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

  it('binds draft deletion to the route season and current admin', async () => {
    vi.mocked(rankedAdminService.deleteDraft).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      lifecycle: 'DRAFT',
    } as never);

    const response = await invokeRoute('/seasons/:seasonId', 'delete', {
      params: { seasonId: '11111111-1111-4111-8111-111111111111' },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.deleteDraft).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
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
      matches: [
        {
          matchId: 'match-21',
          firstRatingDelta: 12.5,
          secondRatingDelta: -12.5,
        },
      ],
      total: 47,
    } as never);

    const response = await invokeRoute('/matches', 'get', {
      query: {
        ratingStatus: 'SETTLED',
        userQuery: ' 小能苗 ',
        limit: '20',
        offset: '20',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.listMatches).toHaveBeenCalledWith({
      ratingStatus: 'SETTLED',
      userQuery: '小能苗',
      limit: 20,
      offset: 20,
    });
    expect(response.body).toMatchObject({
      data: [
        {
          matchId: 'match-21',
          firstRatingDelta: 12.5,
          secondRatingDelta: -12.5,
        },
      ],
      total: 47,
      error: null,
    });
  });

  it('returns long-lived main deck observations with ranked match detail', async () => {
    vi.mocked(rankedAdminService.getMatch).mockResolvedValue({
      matchId: 'match-with-decks',
      decks: [
        {
          seat: 'FIRST',
          sourceDeckName: '先攻卡组',
          mainDeckCards: [{ baseCardCode: 'LL-test-001', count: 4 }],
        },
      ],
    } as never);

    const response = await invokeRoute('/matches/:matchId', 'get', {
      params: { matchId: 'match-with-decks' },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.getMatch).toHaveBeenCalledWith('match-with-decks');
    expect(response.body).toMatchObject({
      data: {
        matchId: 'match-with-decks',
        decks: [
          {
            seat: 'FIRST',
            sourceDeckName: '先攻卡组',
            mainDeckCards: [{ baseCardCode: 'LL-test-001', count: 4 }],
          },
        ],
      },
      error: null,
    });
  });

  it('requires one strictly valid season ID for the ranked overview', async () => {
    const invalidQueries = [
      {},
      { seasonId: 'not-a-uuid' },
      {
        seasonId: '11111111-1111-4111-8111-111111111111',
        unexpected: 'field',
      },
    ];

    for (const query of invalidQueries) {
      const response = await invokeRoute('/overview', 'get', { query });
      expect(response.statusCode).toBe(400);
      expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    }
    expect(rankedAdminService.getOverview).not.toHaveBeenCalled();
  });

  it('returns the overview for the requested season', async () => {
    const seasonId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(rankedAdminService.getOverview).mockResolvedValue({
      seasonId,
      generatedAt: new Date('2026-08-09T12:00:00.000Z'),
    } as never);

    const response = await invokeRoute('/overview', 'get', {
      query: { seasonId },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.getOverview).toHaveBeenCalledWith(seasonId);
    expect(response.body).toMatchObject({
      data: { seasonId },
      error: null,
    });
  });

  it('validates and returns deck statistics for one season', async () => {
    const seasonId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(rankedAdminService.getDeckStatistics).mockResolvedValue({
      seasonId,
      available: true,
      release: { id: '22222222-2222-4222-8222-222222222222', version: 3 },
      categories: [],
    } as never);

    const response = await invokeRoute('/deck-statistics', 'get', {
      query: { seasonId },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.getDeckStatistics).toHaveBeenCalledWith(seasonId);
    expect(response.body).toMatchObject({
      data: { seasonId, available: true, categories: [] },
      error: null,
    });

    for (const query of [{}, { seasonId: 'not-a-uuid' }, { seasonId, unexpected: 'field' }]) {
      const invalid = await invokeRoute('/deck-statistics', 'get', { query });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.body?.error?.code).toBe('VALIDATION_ERROR');
    }
  });

  it('validates and forwards the complete ranked-player page query', async () => {
    const seasonId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(rankedAdminService.listPlayers).mockResolvedValue({
      seasonId,
      ledgerRevision: 17,
      total: 120,
      limit: 50,
      offset: 50,
      players: [{ listPosition: 54 }],
    } as never);

    const response = await invokeRoute('/players', 'get', {
      query: { seasonId, q: ' player_100% ', limit: '50', offset: '50' },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.listPlayers).toHaveBeenCalledWith(seasonId, 'player_100%', 50, 50);
    expect(response.body).toMatchObject({
      data: { seasonId, ledgerRevision: 17, total: 120, players: [{ listPosition: 54 }] },
      error: null,
    });

    const defaults = await invokeRoute('/players', 'get', { query: { seasonId } });
    expect(defaults.statusCode).toBe(200);
    expect(rankedAdminService.listPlayers).toHaveBeenLastCalledWith(seasonId, undefined, 50, 0);
  });

  it('rejects invalid or extra complete-player page query fields', async () => {
    const seasonId = '11111111-1111-4111-8111-111111111111';
    for (const query of [
      { seasonId, q: '' },
      { seasonId, q: 'x'.repeat(101) },
      { seasonId, limit: '0' },
      { seasonId, limit: '101' },
      { seasonId, offset: '-1' },
      { seasonId, unexpected: 'field' },
    ]) {
      const response = await invokeRoute('/players', 'get', { query });
      expect(response.statusCode).toBe(400);
      expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    }
  });

  it('validates and forwards bounded season player search', async () => {
    const seasonId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(rankedAdminService.searchPlayers).mockResolvedValue([
      {
        userId: '22222222-2222-4222-8222-222222222222',
        username: 'player_one',
        displayName: '玩家一',
      },
    ] as never);

    const response = await invokeRoute('/players/search', 'get', {
      query: { seasonId, q: ' player ', limit: '5' },
    });

    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.searchPlayers).toHaveBeenCalledWith(seasonId, 'player', 5);
    expect(response.body).toMatchObject({
      data: [
        {
          userId: '22222222-2222-4222-8222-222222222222',
          username: 'player_one',
        },
      ],
      error: null,
    });
  });

  it('rejects missing, unbounded, or extra player search query fields', async () => {
    const seasonId = '11111111-1111-4111-8111-111111111111';
    for (const query of [
      { seasonId, q: '' },
      { seasonId, q: 'player', limit: '11' },
      { seasonId, q: 'player', unexpected: 'field' },
    ]) {
      const response = await invokeRoute('/players/search', 'get', { query });
      expect(response.statusCode).toBe(400);
      expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    }
    expect(rankedAdminService.searchPlayers).not.toHaveBeenCalled();
  });

  it('validates player and season IDs before returning ranking context', async () => {
    const seasonId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    vi.mocked(rankedAdminService.getPlayerContext).mockResolvedValue({
      seasonId,
      player: {
        userId,
        status: 'RANKED',
        rank: 7,
        wins: 8,
        losses: 4,
        deckClassification: {
          release: { id: '33333333-3333-4333-8333-333333333333', version: 3 },
          observedMatchCount: 12,
          classifiedMatchCount: 10,
          coverageStatus: 'PARTIAL',
          isTied: false,
          leaders: [
            {
              archetypeId: '44444444-4444-4444-8444-444444444444',
              name: '测试分类',
              matchCount: 6,
            },
          ],
        },
      },
      neighbors: { rows: [] },
    } as never);

    const response = await invokeRoute('/players/:userId/context', 'get', {
      params: { userId },
      query: { seasonId },
    });
    expect(response.statusCode).toBe(200);
    expect(rankedAdminService.getPlayerContext).toHaveBeenCalledWith(seasonId, userId);
    expect(response.body).toMatchObject({
      data: {
        player: {
          wins: 8,
          losses: 4,
          deckClassification: {
            coverageStatus: 'PARTIAL',
            leaders: [{ name: '测试分类', matchCount: 6 }],
          },
        },
      },
    });

    const invalidUser = await invokeRoute('/players/:userId/context', 'get', {
      params: { userId: 'not-a-uuid' },
      query: { seasonId },
    });
    expect(invalidUser.statusCode).toBe(400);
    expect(invalidUser.body?.error?.code).toBe('INVALID_REQUEST');

    const invalidSeason = await invokeRoute('/players/:userId/context', 'get', {
      params: { userId },
      query: { seasonId: 'not-a-uuid', unexpected: 'field' },
    });
    expect(invalidSeason.statusCode).toBe(400);
    expect(invalidSeason.body?.error?.code).toBe('VALIDATION_ERROR');
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
