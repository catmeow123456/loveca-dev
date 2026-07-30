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
    touchInGameMemberByMatch: vi.fn(() => true),
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
import { OnlineMatchChatRuntimeError } from '../../src/server/services/online-match-chat-runtime';
import { aiBattlePhaseThreeService } from '../../src/server/services/ai-battle-phase-three-service';
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

  it('观战聊天应绑定当前 token、session 和单局代际并禁止缓存', async () => {
    vi.spyOn(onlineMatchService, 'getSpectatorChatMessages').mockReturnValue({
      matchId: 'm1',
      messages: [],
      currentSeq: 0,
      nextAfterSeq: 0,
      oldestAvailableSeq: 1,
      truncated: false,
      hasMore: false,
    });

    const response = await invokeRoute('/spectator-links/:token/chat/messages', 'get', {
      params: { token: 'token-1' },
      query: {
        sessionId: 'session-1',
        afterSeq: '4',
        roomGeneration: 'room-generation-1',
        attachmentGeneration: '2',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(onlineMatchService.getSpectatorChatMessages).toHaveBeenCalledWith(
      'token-1',
      'session-1',
      {
        afterSeq: 4,
        expectedRoomGeneration: 'room-generation-1',
        expectedAttachmentGeneration: 2,
      }
    );
    expect(response.headers).toMatchObject({
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
  });

  it('玩家聊天限频应返回结构化等待时间', async () => {
    vi.spyOn(onlineMatchService, 'sendMatchChatMessage').mockImplementation(() => {
      throw new OnlineMatchChatRuntimeError(
        'ONLINE_CHAT_RATE_LIMITED',
        '消息发送太快，请稍后再试',
        429,
        1_250
      );
    });

    const response = await invokeRoute('/matches/:matchId/chat/messages', 'post', {
      params: { matchId: 'm1' },
      body: { clientMessageId: 'client-message-1', text: '稍等一下' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['Retry-After']).toBe('2');
    expect(response.body).toEqual({
      data: null,
      error: {
        code: 'ONLINE_CHAT_RATE_LIMITED',
        message: '消息发送太快，请稍后再试',
        retryAfterMs: 1_250,
      },
    });
  });

  it('已退出当前对局的玩家不能继续发送聊天', async () => {
    vi.mocked(onlineRoomService.touchInGameMemberByMatch).mockReturnValue(false);
    const sendMessage = vi.spyOn(onlineMatchService, 'sendMatchChatMessage');

    const response = await invokeRoute('/matches/:matchId/chat/messages', 'post', {
      params: { matchId: 'm1' },
      body: { clientMessageId: 'client-message-left', text: '我已经退出了' },
    });

    expect(response.statusCode).toBe(403);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      data: null,
      error: { code: 'ONLINE_MATCH_FORBIDDEN', message: '当前用户不属于该对局' },
    });
  });

  it('无真人房间的受控 AI 对局仍按 match participant 授权聊天读写', async () => {
    const touchInGameMember = vi
      .spyOn(onlineRoomService, 'touchInGameMemberByMatch')
      .mockReturnValue(false);
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue({
      matchId: 'ai-match-1',
      originKind: 'AI_BATTLE',
    } as never);
    const getMessages = vi.spyOn(onlineMatchService, 'getMatchChatMessages').mockReturnValue({
      matchId: 'ai-match-1',
      messages: [
        {
          messageSeq: 1,
          sentAt: 1_000,
          messageType: 'SYSTEM_NOTICE',
          noticeCode: 'AI_MATCH_READY',
          text: 'AI 对局已准备完成',
        },
      ],
      currentSeq: 1,
      nextAfterSeq: 1,
      oldestAvailableSeq: 1,
      truncated: false,
      hasMore: false,
    });
    const sendMessage = vi.spyOn(onlineMatchService, 'sendMatchChatMessage').mockReturnValue({
      messageSeq: 2,
      sentAt: 1_001,
      messageType: 'PLAYER',
      senderSeat: 'FIRST',
      senderDisplayName: '测试员',
      text: '开始吧',
    });

    const readResponse = await invokeRoute('/matches/:matchId/chat/messages', 'get', {
      params: { matchId: 'ai-match-1' },
      query: { afterSeq: '0' },
    });
    const sendResponse = await invokeRoute('/matches/:matchId/chat/messages', 'post', {
      params: { matchId: 'ai-match-1' },
      body: { clientMessageId: 'client-message-ai', text: '开始吧' },
    });

    expect(readResponse.statusCode).toBe(200);
    expect(sendResponse.statusCode).toBe(201);
    expect(touchInGameMember).not.toHaveBeenCalled();
    expect(getMessages).toHaveBeenCalledWith('ai-match-1', 'u1', {
      afterSeq: 0,
    });
    expect(sendMessage).toHaveBeenCalledWith('ai-match-1', 'u1', {
      clientMessageId: 'client-message-ai',
      text: '开始吧',
    });
  });

  it('管理员受控 AI 对局入口校验并透传认证卡组与 SYSTEM 席位', async () => {
    const createBattle = vi.spyOn(aiBattlePhaseThreeService, 'createBattle').mockResolvedValue({
      schemaVersion: 'ai-battle.phase-four-entry/v1',
      matchId: 'ai-match-1',
      roomCode: 'AI-ROOM',
      humanSeat: 'SECOND',
      systemSeat: 'FIRST',
      snapshot: { matchId: 'ai-match-1' },
    } as never);

    const response = await invokeRoute('/admin/ai-battles', 'post', {
      body: {
        humanDeckKey: 'MUSE_STARTER',
        aiDeckKey: 'GREEN_HASUNOSORA_B6',
        aiSeat: 'FIRST',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createBattle).toHaveBeenCalledWith({
      humanUserId: 'u1',
      humanDeckKey: 'MUSE_STARTER',
      aiDeckKey: 'GREEN_HASUNOSORA_B6',
      aiSeat: 'FIRST',
    });
    expect(response.body?.data).toMatchObject({
      matchId: 'ai-match-1',
      systemSeat: 'FIRST',
    });
  });

  it('普通玩家入口明确公开 AI 身份，并只在模型已配置时创建对局', async () => {
    const previousKey = process.env.DASHSCOPE_API_KEY;
    const previousEnabled = process.env.AI_BATTLE_MODEL_ENABLED;
    const previousDebugTrace = process.env.AI_BATTLE_DEBUG_TRACE_ENABLED;
    process.env.DASHSCOPE_API_KEY = 'route-test-key';
    process.env.AI_BATTLE_MODEL_ENABLED = '1';
    process.env.AI_BATTLE_DEBUG_TRACE_ENABLED = '1';
    try {
      const configResponse = await invokeRoute('/ai-battles/config', 'get');
      expect(configResponse.statusCode).toBe(200);
      expect(configResponse.body?.data).toMatchObject({
        schemaVersion: 'ai-battle.public-entry-config/v1',
        available: true,
        debugTraceEnabled: true,
        opponent: {
          displayName: 'Loveca AI',
          participantKind: 'SYSTEM',
          strategy: 'SERVER_MODEL_WITH_CONSERVATIVE_FALLBACK',
          chatUsedAsModelInput: false,
        },
      });

      const createBattle = vi.spyOn(aiBattlePhaseThreeService, 'createBattle').mockResolvedValue({
        schemaVersion: 'ai-battle.phase-four-entry/v1',
        matchId: 'public-ai-match',
        humanSeat: 'FIRST',
        systemSeat: 'SECOND',
      } as never);
      const createResponse = await invokeRoute('/ai-battles', 'post', {
        body: {
          humanDeckKey: 'MUSE_STARTER',
          aiDeckKey: 'GREEN_HASUNOSORA_B6',
          aiSeat: 'SECOND',
        },
      });
      expect(createResponse.statusCode).toBe(201);
      expect(createBattle).toHaveBeenCalledWith({
        humanUserId: 'u1',
        humanDeckKey: 'MUSE_STARTER',
        aiDeckKey: 'GREEN_HASUNOSORA_B6',
        aiSeat: 'SECOND',
      });
    } finally {
      if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previousKey;
      if (previousEnabled === undefined) delete process.env.AI_BATTLE_MODEL_ENABLED;
      else process.env.AI_BATTLE_MODEL_ENABLED = previousEnabled;
      if (previousDebugTrace === undefined) delete process.env.AI_BATTLE_DEBUG_TRACE_ENABLED;
      else process.env.AI_BATTLE_DEBUG_TRACE_ENABLED = previousDebugTrace;
    }
  });

  it('AI 调试轨迹路由只返回当前玩家获授权的内存轨迹', async () => {
    const getDebugTrace = vi.spyOn(aiBattlePhaseThreeService, 'getDebugTrace').mockResolvedValue({
      schemaVersion: 'ai-battle.debug-trace/v1',
      enabled: true,
      matchId: 'ai-match-1',
      currentSeq: 2,
      truncated: false,
      entries: [{ seq: 2, stage: 'COMPLETED', summary: '选择低费用成员' }],
    } as never);

    const response = await invokeRoute('/ai-battles/:matchId/debug-trace', 'get', {
      params: { matchId: 'ai-match-1' },
      query: { afterSeq: '1' },
    });

    expect(response.statusCode).toBe(200);
    expect(getDebugTrace).toHaveBeenCalledWith('ai-match-1', 'u1', 1);
    expect(response.body?.data).toMatchObject({
      enabled: true,
      currentSeq: 2,
    });
    expect(response.headers['Cache-Control']).toBe('private, no-store');
  });

  it('模型未配置时普通玩家 AI 对局入口返回稳定的 503', async () => {
    const previousKey = process.env.DASHSCOPE_API_KEY;
    const previousEnabled = process.env.AI_BATTLE_MODEL_ENABLED;
    delete process.env.DASHSCOPE_API_KEY;
    process.env.AI_BATTLE_MODEL_ENABLED = '1';
    try {
      const response = await invokeRoute('/ai-battles', 'post', {
        body: {
          humanDeckKey: 'MUSE_STARTER',
          aiDeckKey: 'MUSE_STARTER',
          aiSeat: 'FIRST',
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.body?.error).toEqual({
        code: 'AI_BATTLE_MODEL_UNAVAILABLE',
        message: 'AI 对战暂未开放，请稍后再试',
      });
    } finally {
      if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = previousKey;
      if (previousEnabled === undefined) delete process.env.AI_BATTLE_MODEL_ENABLED;
      else process.env.AI_BATTLE_MODEL_ENABLED = previousEnabled;
    }
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

  it('public-events 二次读取返回空时仍先登记活动再按对局不存在处理', async () => {
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
    expect(onlineRoomService.touchInGameMemberByMatch).toHaveBeenCalledWith('m1', 'u1');
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
