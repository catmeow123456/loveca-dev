import { Router, type Response } from 'express';
import { z } from 'zod';
import { fromTransport } from '../../online/serde.js';
import type { GameCommand } from '../../application/game-commands.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import {
  DebugReplayServiceError,
  createDebugReplayBundle,
  debugReplayService,
} from '../services/debug-replay-service.js';
import { onlineMatchService } from '../services/online-match-service.js';
import { OnlineRoomServiceError, onlineRoomService } from '../services/online-room-service.js';
import {
  MatchReplayReadServiceError,
  matchReplayReadService,
} from '../services/match-replay-read-service.js';

export const onlineRouter = Router();

const roomCodeSchema = z.object({
  roomCode: z.string().min(4).max(12),
});

const deckSelectionSchema = z.object({
  deckId: z.string().uuid(),
});

const openingRpsSchema = z.object({
  gesture: z.enum(['ROCK', 'PAPER', 'SCISSORS']),
});

const openingTurnOrderSchema = z.object({
  choice: z.enum(['SELF_FIRST', 'SELF_SECOND']),
});

const undoRequestSchema = z.object({
  expectedRevision: z.number().int().min(0),
  undoEntryId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

const undoRequestResponseSchema = z.object({
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().min(1).optional(),
  grantContinuous: z.boolean().optional(),
});

onlineRouter.get('/admin/rooms', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rooms = await onlineRoomService.listAdminRoomSummaries();
    res.json({ data: rooms, total: rooms.length, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post(
  '/admin/matches/:matchId/debug-replay/export',
  requireAuth,
  requireAdmin,
  (req, res) => {
    try {
      const match = onlineMatchService.getMatch(readPathParam(req.params.matchId));
      if (!match) {
        respondMatchNotFound(res);
        return;
      }

      const bundle = createDebugReplayBundle(match);
      res.json({ data: bundle, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.post('/admin/debug-replay/import', requireAuth, requireAdmin, (req, res) => {
  try {
    const body = req.body as Partial<{ bundle: unknown }> | undefined;
    if (body?.bundle === undefined) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '回放包参数非法' } });
      return;
    }

    const imported = debugReplayService.importBundle(body.bundle);
    res.status(201).json({ data: imported, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get(
  '/admin/debug-replay/:bundleId/timeline',
  requireAuth,
  requireAdmin,
  (req, res) => {
    try {
      const timeline = debugReplayService.getTimeline(readPathParam(req.params.bundleId));
      res.json({ data: timeline, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.get(
  '/admin/debug-replay/:bundleId/checkpoints/:checkpointSeq',
  requireAuth,
  requireAdmin,
  (req, res) => {
    try {
      const viewerSeat = readSeatQuery(req.query?.viewerSeat);
      if (!viewerSeat) {
        res.status(400).json({
          data: null,
          error: { code: 'INVALID_REQUEST', message: '回放视角参数非法' },
        });
        return;
      }

      const checkpointSeq = readRequiredSeq(req.params.checkpointSeq);
      if (checkpointSeq === null) {
        res.status(400).json({
          data: null,
          error: { code: 'INVALID_REQUEST', message: '检查点序号参数非法' },
        });
        return;
      }

      const checkpointView = debugReplayService.getCheckpointView(
        readPathParam(req.params.bundleId),
        checkpointSeq,
        viewerSeat
      );
      res.json({ data: checkpointView, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.get('/match-records', requireAuth, async (req, res) => {
  try {
    const records = await matchReplayReadService.listMatchRecordsForUser(req.user!.id, {
      limit: readOptionalSeq(req.query?.limit),
      offset: readOptionalSeq(req.query?.offset),
    });
    res.json({ data: records, total: records.length, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/match-records/:matchId/timeline', requireAuth, async (req, res) => {
  try {
    const timeline = await matchReplayReadService.getMatchRecordTimeline(
      readPathParam(req.params.matchId),
      req.user!.id
    );
    if (!timeline) {
      respondMatchRecordNotFound(res);
      return;
    }

    res.json({ data: timeline, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/match-records/:matchId/replay', requireAuth, async (req, res) => {
  try {
    const replay = await matchReplayReadService.getMatchRecordReplay(
      readPathParam(req.params.matchId),
      req.user!.id,
      readReplayCheckpointSeqQuery(req.query)
    );
    if (!replay) {
      respondMatchRecordNotFound(res);
      return;
    }

    res.json({ data: replay, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/match-records/:matchId', requireAuth, async (req, res) => {
  try {
    const detail = await matchReplayReadService.getMatchRecordDetail(
      readPathParam(req.params.matchId),
      req.user!.id
    );
    if (!detail) {
      respondMatchRecordNotFound(res);
      return;
    }

    res.json({ data: detail, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms', requireAuth, async (req, res) => {
  const parsed = roomCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '房间号参数非法' } });
    return;
  }

  try {
    const room = await onlineRoomService.createRoom(parsed.data.roomCode, req.user!.id);
    res.status(201).json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/join', requireAuth, async (req, res) => {
  try {
    const room = await onlineRoomService.joinRoom(readPathParam(req.params.roomCode), req.user!.id);
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/rooms/:roomCode', requireAuth, async (req, res) => {
  try {
    const room = await onlineRoomService.getRoomView(
      readPathParam(req.params.roomCode),
      req.user!.id
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/deck', requireAuth, async (req, res) => {
  const parsed = deckSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '卡组参数非法' } });
    return;
  }

  try {
    const room = await onlineRoomService.lockDeck(
      readPathParam(req.params.roomCode),
      req.user!.id,
      parsed.data.deckId
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/ready-start', requireAuth, async (req, res) => {
  try {
    const room = await onlineRoomService.markReadyToStart(
      readPathParam(req.params.roomCode),
      req.user!.id
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/opening-rps', requireAuth, async (req, res) => {
  const parsed = openingRpsSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '猜拳手势参数非法' } });
    return;
  }

  try {
    const room = await onlineRoomService.submitOpeningRps(
      readPathParam(req.params.roomCode),
      req.user!.id,
      parsed.data.gesture
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/opening-rps/replay', requireAuth, async (req, res) => {
  try {
    const room = await onlineRoomService.replayOpeningRps(
      readPathParam(req.params.roomCode),
      req.user!.id
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/opening-turn-order', requireAuth, async (req, res) => {
  const parsed = openingTurnOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '先后手选择参数非法' } });
    return;
  }

  try {
    const room = await onlineRoomService.chooseOpeningTurnOrder(
      readPathParam(req.params.roomCode),
      req.user!.id,
      parsed.data.choice
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/leave', requireAuth, async (req, res) => {
  try {
    const result = await onlineRoomService.leaveRoom(
      readPathParam(req.params.roomCode),
      req.user!.id
    );
    res.json({ data: result, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/restart-request', requireAuth, async (req, res) => {
  try {
    const room = await onlineRoomService.requestRestart(
      readPathParam(req.params.roomCode),
      req.user!.id
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post(
  '/rooms/:roomCode/restart-request/:requestId/accept',
  requireAuth,
  async (req, res) => {
    try {
      const room = await onlineRoomService.acceptRestartRequest(
        readPathParam(req.params.roomCode),
        req.user!.id,
        readPathParam(req.params.requestId)
      );
      res.json({ data: room, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.post(
  '/rooms/:roomCode/restart-request/:requestId/reject',
  requireAuth,
  async (req, res) => {
    try {
      const room = await onlineRoomService.rejectRestartRequest(
        readPathParam(req.params.roomCode),
        req.user!.id,
        readPathParam(req.params.requestId)
      );
      res.json({ data: room, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.post(
  '/rooms/:roomCode/restart-request/:requestId/cancel',
  requireAuth,
  async (req, res) => {
    try {
      const room = await onlineRoomService.cancelRestartRequest(
        readPathParam(req.params.roomCode),
        req.user!.id,
        readPathParam(req.params.requestId)
      );
      res.json({ data: room, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.get('/matches/:matchId/snapshot', requireAuth, async (req, res) => {
  try {
    const matchId = readPathParam(req.params.matchId);
    const match = onlineMatchService.getMatch(matchId);
    if (!match) {
      respondMatchNotFound(res);
      return;
    }

    const snapshot = await onlineMatchService.getMatchSnapshot(match.matchId, req.user!.id, {
      sinceSeq: readOptionalSeq(req.query?.sinceSeq),
    });
    if (!snapshot) {
      respondMatchForbidden(res);
      return;
    }

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    res.json({ data: snapshot, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/matches/:matchId/public-events', requireAuth, async (req, res) => {
  try {
    const matchId = readPathParam(req.params.matchId);
    const match = onlineMatchService.getMatch(matchId);
    if (!match) {
      respondMatchNotFound(res);
      return;
    }

    const events = await onlineMatchService.getMatchPublicEvents(match.matchId, req.user!.id, {
      afterSeq: readOptionalSeq(req.query?.afterSeq),
    });
    if (!events) {
      respondMatchNotFound(res);
      return;
    }

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    res.json({ data: events, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/matches/:matchId/command', requireAuth, async (req, res) => {
  try {
    const body = req.body as Partial<{ command: unknown }> | undefined;
    if (body?.command === undefined) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '命令参数非法' } });
      return;
    }

    const matchId = readPathParam(req.params.matchId);
    const match = onlineMatchService.getMatch(matchId);
    if (!match) {
      respondMatchNotFound(res);
      return;
    }

    const command = fromTransport<GameCommand>(body.command);
    const result = await onlineMatchService.executeCommand(match.matchId, req.user!.id, command);
    if (!result) {
      respondMatchForbidden(res);
      return;
    }

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    res.json({
      data: result,
      error: result.success
        ? null
        : { code: 'COMMAND_REJECTED', message: result.error ?? '命令执行失败' },
    });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/matches/:matchId/advance', requireAuth, async (req, res) => {
  try {
    const matchId = readPathParam(req.params.matchId);
    const match = onlineMatchService.getMatch(matchId);
    if (!match) {
      respondMatchNotFound(res);
      return;
    }

    const result = await onlineMatchService.advancePhase(match.matchId, req.user!.id);
    if (!result) {
      respondMatchForbidden(res);
      return;
    }

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    res.json({
      data: result,
      error: result.success
        ? null
        : { code: 'ADVANCE_REJECTED', message: result.error ?? '阶段推进失败' },
    });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/matches/:matchId/undo', requireAuth, async (req, res) => {
  const parsed = undoRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '撤销参数非法' } });
    return;
  }

  try {
    const matchId = readPathParam(req.params.matchId);
    const match = onlineMatchService.getMatch(matchId);
    if (!match) {
      respondMatchNotFound(res);
      return;
    }

    const result = await onlineMatchService.undoLatest(match.matchId, req.user!.id, parsed.data);
    if (!result) {
      respondMatchForbidden(res);
      return;
    }

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    res.json({
      data: result,
      error: result.success
        ? null
        : { code: 'UNDO_REJECTED', message: result.error ?? '撤销失败' },
    });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/matches/:matchId/undo-requests', requireAuth, async (req, res) => {
  const parsed = undoRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '撤销请求参数非法' } });
    return;
  }

  try {
    const matchId = readPathParam(req.params.matchId);
    const match = onlineMatchService.getMatch(matchId);
    if (!match) {
      respondMatchNotFound(res);
      return;
    }

    const result = await onlineMatchService.createUndoRequest(
      match.matchId,
      req.user!.id,
      parsed.data
    );
    if (!result) {
      respondMatchForbidden(res);
      return;
    }

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    res.json({
      data: result,
      error: result.success
        ? null
        : { code: 'UNDO_REQUEST_REJECTED', message: result.error ?? '撤销请求失败' },
    });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post(
  '/matches/:matchId/undo-requests/:requestId/accept',
  requireAuth,
  async (req, res) => {
    const parsed = undoRequestResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '撤销响应参数非法' } });
      return;
    }

    try {
      const matchId = readPathParam(req.params.matchId);
      const match = onlineMatchService.getMatch(matchId);
      if (!match) {
        respondMatchNotFound(res);
        return;
      }

      const result = await onlineMatchService.acceptUndoRequest(
        match.matchId,
        req.user!.id,
        readPathParam(req.params.requestId),
        parsed.data
      );
      if (!result) {
        respondMatchForbidden(res);
        return;
      }

      onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
      res.json({
        data: result,
        error: result.success
          ? null
          : { code: 'UNDO_ACCEPT_REJECTED', message: result.error ?? '接受撤销失败' },
      });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.post(
  '/matches/:matchId/undo-requests/:requestId/reject',
  requireAuth,
  async (req, res) => {
    const parsed = undoRequestResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '撤销响应参数非法' } });
      return;
    }

    try {
      const matchId = readPathParam(req.params.matchId);
      const match = onlineMatchService.getMatch(matchId);
      if (!match) {
        respondMatchNotFound(res);
        return;
      }

      const result = await onlineMatchService.rejectUndoRequest(
        match.matchId,
        req.user!.id,
        readPathParam(req.params.requestId),
        parsed.data
      );
      if (!result) {
        respondMatchForbidden(res);
        return;
      }

      onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
      res.json({
        data: result,
        error: result.success
          ? null
          : { code: 'UNDO_REJECT_REJECTED', message: result.error ?? '拒绝撤销失败' },
      });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

function respondMatchNotFound(res: Response): void {
  res.status(404).json({
    data: null,
    error: { code: 'ONLINE_MATCH_NOT_FOUND', message: '联机对局不存在或已失效' },
  });
}

function respondMatchForbidden(res: Response): void {
  res.status(403).json({
    data: null,
    error: { code: 'ONLINE_MATCH_FORBIDDEN', message: '当前用户不属于该对局' },
  });
}

function respondMatchRecordNotFound(res: Response): void {
  res.status(404).json({
    data: null,
    error: { code: 'MATCH_RECORD_NOT_FOUND', message: '历史对局记录不存在或不可访问' },
  });
}

function respondOnlineError(res: Response, error: unknown): void {
  if (error instanceof MatchReplayReadServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof DebugReplayServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof OnlineRoomServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  res.status(500).json({
    data: null,
    error: {
      code: 'ONLINE_INTERNAL_ERROR',
      message: error instanceof Error ? error.message : '正式联机请求失败',
    },
  });
}

function readPathParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}

function readOptionalSeq(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? (value[0] as unknown) : value;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }

  const seq = Number(raw);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : undefined;
}

function readReplayCheckpointSeqQuery(query: unknown): number | undefined {
  if (!query || typeof query !== 'object') {
    return undefined;
  }

  const params = query as { readonly checkpointSeq?: unknown; readonly cursor?: unknown };
  return readOptionalSeq(params.checkpointSeq) ?? readOptionalSeq(params.cursor);
}

function readRequiredSeq(value: unknown): number | null {
  const raw = Array.isArray(value) ? (value[0] as unknown) : value;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }

  const seq = Number(raw);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
}

function readSeatQuery(value: unknown): 'FIRST' | 'SECOND' | null {
  const raw = Array.isArray(value) ? (value[0] as unknown) : value;
  return raw === 'FIRST' || raw === 'SECOND' ? raw : null;
}
