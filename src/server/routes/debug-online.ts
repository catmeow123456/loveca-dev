import { Router } from 'express';
import type { Seat } from '../../online/types.js';
import type {
  DebugAdvancePhaseRequest,
  DebugCommandRequest,
  DebugSeatDeckSelection,
} from '../../online/debug-types.js';
import { fromTransport, toTransport } from '../../online/serde.js';
import {
  advanceDebugMatchPhase,
  executeDebugMatchCommand,
  getDebugMatchRecovery,
  getDebugMatchSnapshot,
  getDebugMatchStatus,
  resetDebugMatch,
  selectDebugSeatDeck,
} from '../services/debug-match-service.js';

export const debugOnlineRouter = Router();

debugOnlineRouter.get('/matches/:matchId', (req, res) => {
  const status = getDebugMatchStatus(req.params.matchId);
  res.json({ data: status, error: null });
});

debugOnlineRouter.post('/matches/:matchId/seat', (req, res) => {
  const body = fromTransport<Partial<DebugSeatDeckSelection> | undefined>(req.body);
  const seat = parseSeat(body?.seat);
  if (!seat || !body?.deck || typeof body.playerName !== 'string' || typeof body.deckName !== 'string') {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: '调试卡组锁定参数非法' } });
    return;
  }

  try {
    const status = selectDebugSeatDeck({
      matchId: req.params.matchId,
      seat,
      playerName: body.playerName,
      deckName: body.deckName,
      deck: body.deck,
    });
    res.json({ data: status, error: null });
  } catch (error) {
    res.status(400).json({
      data: null,
      error: {
        code: 'DEBUG_MATCH_SETUP_FAILED',
        message: error instanceof Error ? error.message : '调试对局准备失败',
      },
    });
  }
});

debugOnlineRouter.post('/matches/:matchId/reset', (req, res) => {
  const status = resetDebugMatch(req.params.matchId);
  res.json({ data: status, error: null });
});

debugOnlineRouter.get('/matches/:matchId/snapshot', (req, res) => {
  const seat = parseSeat(req.query.seat);
  if (!seat) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: 'seat 参数非法' } });
    return;
  }

  const snapshot = getDebugMatchSnapshot(req.params.matchId, seat);
  if (!snapshot) {
    res.status(404).json({ data: null, error: { code: 'MATCH_NOT_READY', message: '调试对局尚未开始' } });
    return;
  }

  res.json({ data: toTransport(snapshot), error: null });
});

debugOnlineRouter.get('/matches/:matchId/recovery', (req, res) => {
  const seat = parseSeat(req.query.seat);
  const requestedSeq = Number(req.query.fromSeq ?? 0);
  if (!seat || !Number.isFinite(requestedSeq) || requestedSeq < 0) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: '恢复参数非法' } });
    return;
  }

  const recovery = getDebugMatchRecovery(req.params.matchId, seat, requestedSeq);
  if (!recovery) {
    res.status(404).json({ data: null, error: { code: 'MATCH_NOT_READY', message: '调试对局尚未开始' } });
    return;
  }

  res.json({ data: toTransport(recovery), error: null });
});

debugOnlineRouter.post('/matches/:matchId/command', (req, res) => {
  const body = req.body as Partial<{ seat: Seat; command: unknown }> | undefined;
  const seat = parseSeat(body?.seat);
  if (!seat || body?.command === undefined) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: '命令参数非法' } });
    return;
  }

  const commandRequest = fromTransport<DebugCommandRequest>({
    seat,
    command: body.command,
  });
  const result = executeDebugMatchCommand(req.params.matchId, seat, commandRequest.command);
  res.json({
    data: toTransport(result),
    error: result.success ? null : { code: 'COMMAND_REJECTED', message: result.error ?? '命令执行失败' },
  });
});

debugOnlineRouter.post('/matches/:matchId/advance', (req, res) => {
  const body = req.body as Partial<DebugAdvancePhaseRequest> | undefined;
  const seat = parseSeat(body?.seat);
  if (!seat) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: '推进参数非法' } });
    return;
  }

  const result = advanceDebugMatchPhase(req.params.matchId, seat);
  res.json({
    data: toTransport(result),
    error: result.success ? null : { code: 'ADVANCE_REJECTED', message: result.error ?? '阶段推进失败' },
  });
});

function parseSeat(value: unknown): Seat | null {
  if (value === 'FIRST' || value === 'SECOND') {
    return value;
  }
  return null;
}
