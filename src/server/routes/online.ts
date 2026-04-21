import { Router, type Response } from 'express';
import { z } from 'zod';
import { fromTransport, toTransport } from '../../online/serde.js';
import type { GameCommand } from '../../application/game-commands.js';
import { requireAuth } from '../middleware/require-auth.js';
import { onlineMatchService } from '../services/online-match-service.js';
import {
  OnlineRoomServiceError,
  onlineRoomService,
} from '../services/online-room-service.js';

export const onlineRouter = Router();

const roomCodeSchema = z.object({
  roomCode: z.string().min(4).max(12),
});

const deckSelectionSchema = z.object({
  deckId: z.string().uuid(),
});

const turnOrderProposalSchema = z.object({
  proposal: z.enum(['HOST_FIRST', 'HOST_SECOND']),
});

const turnOrderResponseSchema = z.object({
  accepted: z.boolean(),
});

onlineRouter.post('/rooms', requireAuth, async (req, res) => {
  const parsed = roomCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: '房间号参数非法' } });
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
    const room = await onlineRoomService.getRoomView(readPathParam(req.params.roomCode), req.user!.id);
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/deck', requireAuth, async (req, res) => {
  const parsed = deckSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: '卡组参数非法' } });
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

onlineRouter.post('/rooms/:roomCode/turn-order-proposal', requireAuth, async (req, res) => {
  const parsed = turnOrderProposalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: '先后手提议参数非法' } });
    return;
  }

  try {
    const room = await onlineRoomService.proposeTurnOrder(
      readPathParam(req.params.roomCode),
      req.user!.id,
      parsed.data.proposal
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/turn-order-response', requireAuth, async (req, res) => {
  const parsed = turnOrderResponseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: '先后手响应参数非法' } });
    return;
  }

  try {
    const room = await onlineRoomService.respondTurnOrder(
      readPathParam(req.params.roomCode),
      req.user!.id,
      parsed.data.accepted
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/leave', requireAuth, async (req, res) => {
  try {
    const result = await onlineRoomService.leaveRoom(readPathParam(req.params.roomCode), req.user!.id);
    res.json({ data: result, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/matches/:matchId/snapshot', requireAuth, (req, res) => {
  const matchId = readPathParam(req.params.matchId);
  const match = onlineMatchService.getMatch(matchId);
  if (!match) {
    res.status(404).json({ data: null, error: { code: 'ONLINE_MATCH_NOT_FOUND', message: '联机对局不存在或已失效' } });
    return;
  }

  const snapshot = onlineMatchService.getMatchSnapshot(match.matchId, req.user!.id);
  if (!snapshot) {
    res.status(403).json({ data: null, error: { code: 'ONLINE_MATCH_FORBIDDEN', message: '当前用户不属于该对局' } });
    return;
  }

  res.json({ data: toTransport(snapshot), error: null });
});

onlineRouter.post('/matches/:matchId/command', requireAuth, (req, res) => {
  const body = req.body as Partial<{ command: unknown }> | undefined;
  if (body?.command === undefined) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: '命令参数非法' } });
    return;
  }

  const matchId = readPathParam(req.params.matchId);
  const match = onlineMatchService.getMatch(matchId);
  if (!match) {
    res.status(404).json({ data: null, error: { code: 'ONLINE_MATCH_NOT_FOUND', message: '联机对局不存在或已失效' } });
    return;
  }

  const command = fromTransport<GameCommand>(body.command);
  const result = onlineMatchService.executeCommand(match.matchId, req.user!.id, command);
  if (!result) {
    res.status(403).json({ data: null, error: { code: 'ONLINE_MATCH_FORBIDDEN', message: '当前用户不属于该对局' } });
    return;
  }

  res.json({
    data: toTransport(result),
    error: result.success ? null : { code: 'COMMAND_REJECTED', message: result.error ?? '命令执行失败' },
  });
});

onlineRouter.post('/matches/:matchId/advance', requireAuth, (req, res) => {
  const matchId = readPathParam(req.params.matchId);
  const match = onlineMatchService.getMatch(matchId);
  if (!match) {
    res.status(404).json({ data: null, error: { code: 'ONLINE_MATCH_NOT_FOUND', message: '联机对局不存在或已失效' } });
    return;
  }

  const result = onlineMatchService.advancePhase(match.matchId, req.user!.id);
  if (!result) {
    res.status(403).json({ data: null, error: { code: 'ONLINE_MATCH_FORBIDDEN', message: '当前用户不属于该对局' } });
    return;
  }

  res.json({
    data: toTransport(result),
    error: result.success ? null : { code: 'ADVANCE_REJECTED', message: result.error ?? '阶段推进失败' },
  });
});

function respondOnlineError(res: Response, error: unknown): void {
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
  return Array.isArray(value) ? value[0] : value ?? '';
}
