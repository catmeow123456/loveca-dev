import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

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

  it('管理员历史对局路由全部要求 admin 角色', () => {
    const adminRoutes = [
      '/admin/match-records',
      '/admin/match-records/:matchId/timeline',
      '/admin/match-records/:matchId/replay',
      '/admin/match-records/:matchId/export',
      '/admin/match-records/:matchId',
    ];

    for (const path of adminRoutes) {
      const route = findRoute(path, 'get');
      const requireAdmin = route.stack.at(1)?.handle as (
        req: Request,
        res: Response,
        next: () => void
      ) => void;
      const response = createMockResponse();
      const next = vi.fn();

      requireAdmin({ user: { id: 'u1', role: 'user' } } as Request, response, next);

      expect(response.statusCode, path).toBe(403);
      expect(response.body?.error?.code, path).toBe('FORBIDDEN');
      expect(next, path).not.toHaveBeenCalled();
    }
  });
});
