import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const permissionMocks = vi.hoisted(() => ({ poolQuery: vi.fn() }));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: permissionMocks.poolQuery },
}));

vi.mock('../../src/server/services/solitaire-match-service.js', () => ({
  SolitaireMatchServiceError: class SolitaireMatchServiceError extends Error {
    code = 'SOLITAIRE_MATCH_ERROR';
    statusCode = 400;
  },
  solitaireMatchService: {
    createMatch: vi.fn(),
    getMatchSnapshot: vi.fn(),
    executeCommand: vi.fn(),
    advancePhase: vi.fn(),
    undoLatest: vi.fn(),
    restartMatch: vi.fn(),
    leaveMatch: vi.fn(),
  },
}));

vi.mock('../../src/server/services/match-replay-read-service.js', () => ({
  MatchReplayReadServiceError: class MatchReplayReadServiceError extends Error {
    code = 'MATCH_REPLAY_ERROR';
    statusCode = 400;
  },
  matchReplayReadService: {
    listMatchRecordsForUser: vi.fn(),
    listMatchRecordsForAdmin: vi.fn(),
    getMatchRecordTimeline: vi.fn(),
    getMatchRecordTimelineForAdmin: vi.fn(),
    getMatchRecordReplay: vi.fn(),
    getMatchRecordReplayForAdmin: vi.fn(),
    getMatchRecordDetail: vi.fn(),
    getMatchRecordDetailForAdmin: vi.fn(),
    exportMatchRecordBundleForAdmin: vi.fn(),
  },
}));

import { battleRouter } from '../../src/server/routes/battle';
import { matchReplayReadService } from '../../src/server/services/match-replay-read-service';
import { solitaireMatchService } from '../../src/server/services/solitaire-match-service';

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
  const layer = battleRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  return layer.route.stack.at(-1)?.handle as (req: Request, res: Response) => void | Promise<void>;
}

function findRoute(path: string, method: 'get' | 'post') {
  const layer = battleRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  return layer.route;
}

async function invokeRoute(path: string, method: 'get' | 'post', options: Partial<Request> = {}) {
  const handler = findRouteHandler(path, method);
  const response = createMockResponse();
  const request = {
    params: {},
    query: {},
    body: undefined,
    user: { id: 'user-1' },
    ...options,
  } as Request;

  await handler(request, response);
  return response;
}

describe('battleRouter solitaire match routes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('创建可记录对墙打时只接收合法 deckId，并传入当前登录用户', async () => {
    vi.mocked(solitaireMatchService.createMatch).mockResolvedValue({
      matchId: 'match-1',
      snapshot: {
        matchId: 'match-1',
        seat: 'FIRST',
        playerId: 'player-1',
        seq: 1,
        playerViewState: {},
      },
    } as never);

    const response = await invokeRoute('/solitaire-matches', 'post', {
      body: { deckId: '11111111-1111-4111-8111-111111111111' },
    });

    expect(response.statusCode).toBe(201);
    expect(solitaireMatchService.createMatch).toHaveBeenCalledWith({
      userId: 'user-1',
      deckId: '11111111-1111-4111-8111-111111111111',
    });
    expect(response.body?.data).toMatchObject({
      matchId: 'match-1',
    });
  });

  it('创建可记录对墙打时拒绝非法 deckId', async () => {
    const response = await invokeRoute('/solitaire-matches', 'post', {
      body: { deckId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(solitaireMatchService.createMatch).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '卡组参数非法' },
    });
  });

  it('对墙打撤销路由校验 revision 与 undo entry 后透传当前用户', async () => {
    vi.mocked(solitaireMatchService.undoLatest).mockResolvedValue({
      success: true,
      snapshot: {
        matchId: 'match-1',
        seat: 'FIRST',
        playerId: 'player-1',
        seq: 8,
        playerViewState: {},
      },
    } as never);

    const response = await invokeRoute('/solitaire-matches/:matchId/undo', 'post', {
      params: { matchId: 'match-1' },
      body: {
        expectedRevision: 7,
        undoEntryId: 'match-1:undo:1',
        idempotencyKey: 'undo-key-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(solitaireMatchService.undoLatest).toHaveBeenCalledWith('match-1', 'user-1', {
      expectedRevision: 7,
      undoEntryId: 'match-1:undo:1',
      idempotencyKey: 'undo-key-1',
    });
    expect(response.body?.error).toBeNull();
    expect(response.body?.data).toMatchObject({ success: true });
  });

  it('对墙打撤销路由拒绝非法参数', async () => {
    const response = await invokeRoute('/solitaire-matches/:matchId/undo', 'post', {
      params: { matchId: 'match-1' },
      body: {
        expectedRevision: -1,
        undoEntryId: '',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(solitaireMatchService.undoLatest).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '撤销参数非法' },
    });
  });

  it('重新开始对墙打时透传当前用户并返回新对局快照', async () => {
    vi.mocked(solitaireMatchService.restartMatch).mockResolvedValue({
      matchId: 'match-2',
      snapshot: {
        matchId: 'match-2',
        seat: 'FIRST',
        playerId: 'player-2',
        seq: 0,
        playerViewState: {},
      },
    } as never);

    const response = await invokeRoute('/solitaire-matches/:matchId/restart', 'post', {
      params: { matchId: 'match-1' },
    });

    expect(response.statusCode).toBe(201);
    expect(solitaireMatchService.restartMatch).toHaveBeenCalledWith('match-1', 'user-1');
    expect(response.body?.error).toBeNull();
    expect(response.body?.data).toMatchObject({ matchId: 'match-2' });
  });

  it('管理员历史只读路由允许当前赛季管理员，导出仍只允许平台管理员', async () => {
    permissionMocks.poolQuery.mockResolvedValue({
      rows: [{ role: 'season_admin' }],
      rowCount: 1,
    });
    const readRoutes = [
      '/admin/match-records',
      '/admin/match-records/:matchId/timeline',
      '/admin/match-records/:matchId/replay',
      '/admin/match-records/:matchId',
    ];

    for (const path of readRoutes) {
      const route = findRoute(path, 'get');
      const requireSeasonPermission = route.stack.at(1)?.handle as (
        req: Request,
        res: Response,
        next: () => void
      ) => Promise<void>;
      const response = createMockResponse();
      const next = vi.fn();

      await requireSeasonPermission(
        { user: { id: 'season-admin-1', role: 'season_admin' } } as Request,
        response,
        next
      );

      expect(next, path).toHaveBeenCalledOnce();
      expect(response.body, path).toBeNull();

      const userResponse = createMockResponse();
      const userNext = vi.fn();
      await requireSeasonPermission(
        { user: { id: 'user-1', role: 'user' } } as Request,
        userResponse,
        userNext
      );
      expect(userResponse.statusCode, path).toBe(403);
      expect(userResponse.body?.error?.code, path).toBe('FORBIDDEN');
      expect(userNext, path).not.toHaveBeenCalled();
    }

    const exportRoute = findRoute('/admin/match-records/:matchId/export', 'get');
    const requirePlatformAdmin = exportRoute.stack.at(1)?.handle as (
      req: Request,
      res: Response,
      next: () => void
    ) => void;
    const exportResponse = createMockResponse();
    const exportNext = vi.fn();

    requirePlatformAdmin(
      { user: { id: 'season-admin-1', role: 'season_admin' } } as Request,
      exportResponse,
      exportNext
    );

    expect(exportResponse.statusCode).toBe(403);
    expect(exportResponse.body?.error?.code).toBe('FORBIDDEN');
    expect(exportNext).not.toHaveBeenCalled();
  });

  it('管理员历史列表透传排位赛季和娱乐模式活动筛选', async () => {
    const listMatchRecords = vi
      .spyOn(matchReplayReadService, 'listMatchRecordsForAdmin')
      .mockResolvedValue([]);

    const response = await invokeRoute('/admin/match-records', 'get', {
      query: {
        rankedSeasonId: '11111111-1111-4111-8111-111111111111',
        themeTableVersionId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(listMatchRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        rankedSeasonId: '11111111-1111-4111-8111-111111111111',
        themeTableVersionId: '22222222-2222-4222-8222-222222222222',
      })
    );
  });
});
