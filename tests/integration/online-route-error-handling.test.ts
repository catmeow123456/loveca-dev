import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/server/services/online-room-service.js', () => ({
  OnlineRoomServiceError: class OnlineRoomServiceError extends Error {
    code = 'ONLINE_ROOM_ERROR';
    statusCode = 400;
  },
  loadUserProfileForOnlineMatch: vi.fn(async (userId: string) => ({
    userId,
    displayName: '服务端昵称',
  })),
  onlineRoomService: {
    touchInGameMemberByMatch: vi.fn(),
    markReadyToStart: vi.fn(),
    submitOpeningRps: vi.fn(),
    replayOpeningRps: vi.fn(),
    chooseOpeningTurnOrder: vi.fn(),
    requestRestart: vi.fn(),
    acceptRestartRequest: vi.fn(),
    rejectRestartRequest: vi.fn(),
    cancelRestartRequest: vi.fn(),
  },
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { onlineRouter } from '../../src/server/routes/online';
import {
  OnlineSpectatorServiceError,
  onlineMatchService,
} from '../../src/server/services/online-match-service';
import { onlineRoomService } from '../../src/server/services/online-room-service';

function createMockResponse() {
  const response = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };

  return response as Response & {
    statusCode: number;
    body: {
      data: unknown;
      error: { code: string; message: string } | null;
    } | null;
    headers: Record<string, string>;
  };
}

function findRouteHandler(path: string, method: 'get' | 'post') {
  const layer = onlineRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  return layer.route.stack.at(-1)?.handle as (req: Request, res: Response) => void | Promise<void>;
}

async function invokeRoute(path: string, method: 'get' | 'post', options: Partial<Request> = {}) {
  const handler = findRouteHandler(path, method);
  const response = createMockResponse();
  const request = {
    params: {},
    body: undefined,
    user: { id: 'u1' },
    ...options,
  } as Request;

  await handler(request, response);
  return response;
}

describe('onlineRouter error handling', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('match snapshot 内部抛错时应返回统一 500 错误', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'getMatchSnapshot').mockImplementation(() => {
      throw new Error('snapshot blew up');
    });

    const response = await invokeRoute('/matches/:matchId/snapshot', 'get', {
      params: { matchId: 'm1' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'ONLINE_INTERNAL_ERROR',
        message: 'snapshot blew up',
      },
    });
  });

  it('观战视角切换路由应绑定 token 与 session 并禁止缓存', async () => {
    vi.spyOn(onlineMatchService, 'switchSpectatorView').mockResolvedValue({
      session: { sessionId: 'session-1', viewerSeat: 'SECOND', viewVersion: 2 },
      snapshot: {
        matchId: 'm1',
        seat: 'SECOND',
        spectatorView: { currentViewerSeat: 'SECOND', viewVersion: 2 },
      },
    } as never);

    const response = await invokeRoute('/spectator-links/:token/sessions/:sessionId/view', 'post', {
      params: { token: 'token-1', sessionId: 'session-1' },
      body: { viewerSeat: 'SECOND' },
    });

    expect(response.statusCode).toBe(200);
    expect(onlineMatchService.switchSpectatorView).toHaveBeenCalledWith(
      'token-1',
      'session-1',
      'SECOND'
    );
    expect(response.headers).toMatchObject({
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
  });

  it('观战频率保护应返回结构化等待时间与 Retry-After', async () => {
    vi.spyOn(onlineMatchService, 'getSpectatorSnapshot').mockRejectedValue(
      new OnlineSpectatorServiceError(
        'ONLINE_SPECTATOR_RATE_LIMITED',
        '观战同步暂时繁忙，请稍等',
        429,
        2_250
      )
    );

    const response = await invokeRoute('/spectator-links/:token/snapshot', 'get', {
      params: { token: 'token-1' },
      query: { sessionId: 'session-1' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['Retry-After']).toBe('3');
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'ONLINE_SPECTATOR_RATE_LIMITED',
        message: '观战同步暂时繁忙，请稍等',
        retryAfterMs: 2_250,
      },
    });
  });

  it('观战建会话应忽略客户端昵称并使用服务端账号展示名', async () => {
    vi.spyOn(onlineMatchService, 'joinSpectatorLink').mockResolvedValue({
      link: { token: 'token-1' },
      session: { sessionId: 'session-1', displayName: '服务端昵称' },
      snapshot: { matchId: 'm1' },
    } as never);

    const response = await invokeRoute('/spectator-links/:token/sessions', 'post', {
      params: { token: 'token-1' },
      body: { clientId: 'tab-1', displayName: '伪造昵称' },
    });

    expect(response.statusCode).toBe(201);
    expect(onlineMatchService.joinSpectatorLink).toHaveBeenCalledWith('token-1', {
      clientId: 'tab-1',
      displayName: '服务端昵称',
      authenticatedUserId: 'u1',
    });
  });

  it('match command 内部抛错时应返回统一 500 错误', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'executeCommand').mockImplementation(() => {
      throw new Error('command blew up');
    });

    const response = await invokeRoute('/matches/:matchId/command', 'post', {
      params: { matchId: 'm1' },
      body: { command: { type: 'END_PHASE' } },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'ONLINE_INTERNAL_ERROR',
        message: 'command blew up',
      },
    });
  });

  it('public-events 二次读取返回空时按对局不存在处理', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'getMatchPublicEvents').mockResolvedValue(null);

    const response = await invokeRoute('/matches/:matchId/public-events', 'get', {
      params: { matchId: 'm1' },
      query: { afterSeq: '3' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'ONLINE_MATCH_NOT_FOUND',
        message: '联机对局不存在或已失效',
      },
    });
    expect(onlineRoomService.touchInGameMemberByMatch).not.toHaveBeenCalled();
  });

  it('match advance 内部抛错时应返回统一 500 错误', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'advancePhase').mockImplementation(() => {
      throw new Error('advance blew up');
    });

    const response = await invokeRoute('/matches/:matchId/advance', 'post', {
      params: { matchId: 'm1' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'ONLINE_INTERNAL_ERROR',
        message: 'advance blew up',
      },
    });
  });

  it('撤销请求路由校验参数后应透传当前用户与撤销目标', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'createUndoRequest').mockResolvedValue({
      success: true,
      snapshot: { matchId: 'm1', seq: 12 },
    } as never);

    const response = await invokeRoute('/matches/:matchId/undo-requests', 'post', {
      params: { matchId: 'm1' },
      body: {
        expectedRevision: 11,
        undoEntryId: 'm1:undo:1',
        idempotencyKey: 'request-key',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(onlineMatchService.createUndoRequest).toHaveBeenCalledWith('m1', 'u1', {
      expectedRevision: 11,
      undoEntryId: 'm1:undo:1',
      idempotencyKey: 'request-key',
    });
    expect(onlineRoomService.touchInGameMemberByMatch).toHaveBeenCalledWith('m1', 'u1');
    expect(response.body?.error).toBeNull();
    expect(response.body?.data).toMatchObject({ success: true });
  });

  it('撤销请求路由拒绝非法参数', async () => {
    const createUndoRequest = vi.spyOn(onlineMatchService, 'createUndoRequest');
    const response = await invokeRoute('/matches/:matchId/undo-requests', 'post', {
      params: { matchId: 'm1' },
      body: {
        expectedRevision: -1,
        undoEntryId: '',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(createUndoRequest).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '撤销请求参数非法' },
    });
  });

  it('撤销接受与拒绝路由应透传 requestId 和响应 revision', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'acceptUndoRequest').mockResolvedValue({
      success: true,
      snapshot: { matchId: 'm1', seq: 14 },
    } as never);
    vi.spyOn(onlineMatchService, 'rejectUndoRequest').mockResolvedValue({
      success: true,
      snapshot: { matchId: 'm1', seq: 15 },
    } as never);

    const acceptResponse = await invokeRoute(
      '/matches/:matchId/undo-requests/:requestId/accept',
      'post',
      {
        params: { matchId: 'm1', requestId: 'req-1' },
        body: { expectedRevision: 13, idempotencyKey: 'accept-key', grantContinuous: true },
      }
    );
    const rejectResponse = await invokeRoute(
      '/matches/:matchId/undo-requests/:requestId/reject',
      'post',
      {
        params: { matchId: 'm1', requestId: 'req-2' },
        body: { expectedRevision: 14, idempotencyKey: 'reject-key' },
      }
    );

    expect(acceptResponse.statusCode).toBe(200);
    expect(rejectResponse.statusCode).toBe(200);
    expect(onlineMatchService.acceptUndoRequest).toHaveBeenCalledWith('m1', 'u1', 'req-1', {
      expectedRevision: 13,
      idempotencyKey: 'accept-key',
      grantContinuous: true,
    });
    expect(onlineMatchService.rejectUndoRequest).toHaveBeenCalledWith('m1', 'u1', 'req-2', {
      expectedRevision: 14,
      idempotencyKey: 'reject-key',
    });
    expect(onlineRoomService.touchInGameMemberByMatch).toHaveBeenCalledWith('m1', 'u1');
  });

  it('联机直接撤销路由应透传撤销目标和 revision', async () => {
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({ matchId: 'm1' } as never);
    vi.spyOn(onlineMatchService, 'undoLatest').mockResolvedValue({
      success: true,
      snapshot: { matchId: 'm1', seq: 16 },
    } as never);

    const response = await invokeRoute('/matches/:matchId/undo', 'post', {
      params: { matchId: 'm1' },
      body: {
        expectedRevision: 15,
        undoEntryId: 'undo-1',
        idempotencyKey: 'direct-undo-key',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(onlineMatchService.undoLatest).toHaveBeenCalledWith('m1', 'u1', {
      expectedRevision: 15,
      undoEntryId: 'undo-1',
      idempotencyKey: 'direct-undo-key',
    });
    expect(onlineRoomService.touchInGameMemberByMatch).toHaveBeenCalledWith('m1', 'u1');
  });

  it('重开请求路由应透传房间号、当前用户与 requestId', async () => {
    vi.mocked(onlineRoomService.requestRestart).mockResolvedValue({
      roomCode: 'ROOM1',
      restartRequest: { requestId: 'req-1' },
    } as never);
    vi.mocked(onlineRoomService.acceptRestartRequest).mockResolvedValue({
      roomCode: 'ROOM1',
      matchId: 'm2',
      restartRequest: null,
    } as never);
    vi.mocked(onlineRoomService.rejectRestartRequest).mockResolvedValue({
      roomCode: 'ROOM1',
      restartRequest: null,
    } as never);
    vi.mocked(onlineRoomService.cancelRestartRequest).mockResolvedValue({
      roomCode: 'ROOM1',
      restartRequest: null,
    } as never);

    const requestResponse = await invokeRoute('/rooms/:roomCode/restart-request', 'post', {
      params: { roomCode: 'ROOM1' },
    });
    const acceptResponse = await invokeRoute(
      '/rooms/:roomCode/restart-request/:requestId/accept',
      'post',
      { params: { roomCode: 'ROOM1', requestId: 'req-1' } }
    );
    const rejectResponse = await invokeRoute(
      '/rooms/:roomCode/restart-request/:requestId/reject',
      'post',
      { params: { roomCode: 'ROOM1', requestId: 'req-2' } }
    );
    const cancelResponse = await invokeRoute(
      '/rooms/:roomCode/restart-request/:requestId/cancel',
      'post',
      { params: { roomCode: 'ROOM1', requestId: 'req-3' } }
    );

    expect(requestResponse.statusCode).toBe(200);
    expect(acceptResponse.statusCode).toBe(200);
    expect(rejectResponse.statusCode).toBe(200);
    expect(cancelResponse.statusCode).toBe(200);
    expect(onlineRoomService.requestRestart).toHaveBeenCalledWith('ROOM1', 'u1');
    expect(onlineRoomService.acceptRestartRequest).toHaveBeenCalledWith('ROOM1', 'u1', 'req-1');
    expect(onlineRoomService.rejectRestartRequest).toHaveBeenCalledWith('ROOM1', 'u1', 'req-2');
    expect(onlineRoomService.cancelRestartRequest).toHaveBeenCalledWith('ROOM1', 'u1', 'req-3');
  });

  it('开局猜拳路由应透传准备、手势、重来和先后手选择', async () => {
    vi.mocked(onlineRoomService.markReadyToStart).mockResolvedValue({
      roomCode: 'ROOM2',
      status: 'READY',
    } as never);
    vi.mocked(onlineRoomService.submitOpeningRps).mockResolvedValue({
      roomCode: 'ROOM2',
      openingRps: { revealed: false },
    } as never);
    vi.mocked(onlineRoomService.replayOpeningRps).mockResolvedValue({
      roomCode: 'ROOM2',
      openingRps: { round: 2 },
    } as never);
    vi.mocked(onlineRoomService.chooseOpeningTurnOrder).mockResolvedValue({
      roomCode: 'ROOM2',
      status: 'IN_GAME',
    } as never);

    const readyResponse = await invokeRoute('/rooms/:roomCode/ready-start', 'post', {
      params: { roomCode: 'ROOM2' },
    });
    const rpsResponse = await invokeRoute('/rooms/:roomCode/opening-rps', 'post', {
      params: { roomCode: 'ROOM2' },
      body: { gesture: 'ROCK' },
    });
    const replayResponse = await invokeRoute('/rooms/:roomCode/opening-rps/replay', 'post', {
      params: { roomCode: 'ROOM2' },
    });
    const chooseResponse = await invokeRoute('/rooms/:roomCode/opening-turn-order', 'post', {
      params: { roomCode: 'ROOM2' },
      body: { choice: 'SELF_SECOND' },
    });

    expect(readyResponse.statusCode).toBe(200);
    expect(rpsResponse.statusCode).toBe(200);
    expect(replayResponse.statusCode).toBe(200);
    expect(chooseResponse.statusCode).toBe(200);
    expect(onlineRoomService.markReadyToStart).toHaveBeenCalledWith('ROOM2', 'u1');
    expect(onlineRoomService.submitOpeningRps).toHaveBeenCalledWith('ROOM2', 'u1', 'ROCK');
    expect(onlineRoomService.replayOpeningRps).toHaveBeenCalledWith('ROOM2', 'u1');
    expect(onlineRoomService.chooseOpeningTurnOrder).toHaveBeenCalledWith(
      'ROOM2',
      'u1',
      'SELF_SECOND'
    );
  });

  it('开局猜拳路由应拒绝非法参数', async () => {
    const submitOpeningRps = vi.mocked(onlineRoomService.submitOpeningRps);
    const chooseOpeningTurnOrder = vi.mocked(onlineRoomService.chooseOpeningTurnOrder);
    submitOpeningRps.mockClear();
    chooseOpeningTurnOrder.mockClear();

    const rpsResponse = await invokeRoute('/rooms/:roomCode/opening-rps', 'post', {
      params: { roomCode: 'ROOM2' },
      body: { gesture: 'LIZARD' },
    });
    const chooseResponse = await invokeRoute('/rooms/:roomCode/opening-turn-order', 'post', {
      params: { roomCode: 'ROOM2' },
      body: { choice: 'OPPONENT_FIRST' },
    });

    expect(rpsResponse.statusCode).toBe(400);
    expect(chooseResponse.statusCode).toBe(400);
    expect(submitOpeningRps).not.toHaveBeenCalled();
    expect(chooseOpeningTurnOrder).not.toHaveBeenCalled();
  });
});
