import { Router, type Response } from 'express';
import { z } from 'zod';
import type { GameCommand } from '../../application/game-commands.js';
import { fromTransport } from '../../online/serde.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireGameplayAvailable } from '../middleware/require-gameplay-available.js';
import {
  MatchReplayReadServiceError,
  matchReplayReadService,
} from '../services/match-replay-read-service.js';
import { requireAdmin } from '../middleware/require-admin.js';
import {
  SolitaireMatchServiceError,
  solitaireMatchService,
} from '../services/solitaire-match-service.js';

export const battleRouter = Router();

const deckSelectionSchema = z.object({
  deckId: z.string().uuid(),
});

const remoteUndoSchema = z.object({
  expectedRevision: z.number().int().min(0),
  undoEntryId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

const manualOperationModeSchema = z.object({
  targetMode: z.enum(['RULES', 'FREE']),
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().min(1).optional(),
});

battleRouter.post('/solitaire-matches', requireAuth, requireGameplayAvailable, async (req, res) => {
  const parsed = deckSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '卡组参数非法' } });
    return;
  }

  try {
    const result = await solitaireMatchService.createMatch({
      userId: req.user!.id,
      deckId: parsed.data.deckId,
    });
    res.status(201).json({ data: result, error: null });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.get('/solitaire-matches/:matchId/snapshot', requireAuth, async (req, res) => {
  try {
    const snapshot = await solitaireMatchService.getMatchSnapshot(
      readPathParam(req.params.matchId),
      req.user!.id,
      { sinceSeq: readOptionalSeq(req.query?.sinceSeq) }
    );
    if (!snapshot) {
      respondMatchNotFound(res);
      return;
    }
    res.json({ data: snapshot, error: null });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.get('/solitaire-matches/:matchId/public-events', requireAuth, async (req, res) => {
  try {
    const events = await solitaireMatchService.getMatchPublicEvents(
      readPathParam(req.params.matchId),
      req.user!.id,
      { afterSeq: readOptionalSeq(req.query?.afterSeq) }
    );
    if (!events) {
      respondMatchNotFound(res);
      return;
    }
    res.json({ data: events, error: null });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.post('/solitaire-matches/:matchId/command', requireAuth, async (req, res) => {
  try {
    const body = req.body as Partial<{ command: unknown }> | undefined;
    if (body?.command === undefined) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '命令参数非法' } });
      return;
    }

    const command = fromTransport<GameCommand>(body.command);
    const result = await solitaireMatchService.executeCommand(
      readPathParam(req.params.matchId),
      req.user!.id,
      command
    );
    if (!result) {
      respondMatchNotFound(res);
      return;
    }

    res.json({
      data: result,
      error: result.success
        ? null
        : { code: 'COMMAND_REJECTED', message: result.error ?? '命令执行失败' },
    });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.post('/solitaire-matches/:matchId/advance', requireAuth, async (req, res) => {
  try {
    const result = await solitaireMatchService.advancePhase(
      readPathParam(req.params.matchId),
      req.user!.id
    );
    if (!result) {
      respondMatchNotFound(res);
      return;
    }

    res.json({
      data: result,
      error: result.success
        ? null
        : { code: 'ADVANCE_REJECTED', message: result.error ?? '阶段推进失败' },
    });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.post('/solitaire-matches/:matchId/undo', requireAuth, async (req, res) => {
  const parsed = remoteUndoSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '撤销参数非法' } });
    return;
  }

  try {
    const result = await solitaireMatchService.undoLatest(
      readPathParam(req.params.matchId),
      req.user!.id,
      parsed.data
    );
    if (!result) {
      respondMatchNotFound(res);
      return;
    }

    res.json({
      data: result,
      error: result.success ? null : { code: 'UNDO_REJECTED', message: result.error ?? '撤销失败' },
    });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.post(
  '/solitaire-matches/:matchId/manual-operation-mode',
  requireAuth,
  async (req, res) => {
    const parsed = manualOperationModeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        data: null,
        error: { code: 'INVALID_REQUEST', message: '操作模式参数非法' },
      });
      return;
    }
    try {
      const result = await solitaireMatchService.changeManualOperationMode(
        readPathParam(req.params.matchId),
        req.user!.id,
        parsed.data
      );
      if (!result) {
        respondMatchNotFound(res);
        return;
      }
      res.json({
        data: result,
        error: result.success
          ? null
          : {
              code: 'MANUAL_OPERATION_MODE_REJECTED',
              message: result.error ?? '切换操作模式失败',
            },
      });
    } catch (error) {
      respondBattleError(res, error);
    }
  }
);

battleRouter.post('/solitaire-matches/:matchId/leave', requireAuth, async (req, res) => {
  try {
    const result = await solitaireMatchService.leaveMatch(
      readPathParam(req.params.matchId),
      req.user!.id
    );
    if (result === null) {
      respondMatchNotFound(res);
      return;
    }
    res.json({ data: { left: result }, error: null });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.get('/match-records', requireAuth, async (req, res) => {
  try {
    const records = await matchReplayReadService.listMatchRecordsForUser(req.user!.id, {
      limit: readOptionalPositiveInt(req.query?.limit),
      offset: readOptionalPositiveInt(req.query?.offset),
    });
    res.json({ data: records, total: records.length, error: null });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.get('/admin/match-records', requireAuth, requireAdmin, async (req, res) => {
  try {
    const records = await matchReplayReadService.listMatchRecordsForAdmin({
      limit: readOptionalPositiveInt(req.query?.limit),
      offset: readOptionalPositiveInt(req.query?.offset),
      userQuery: readOptionalString(req.query?.userQuery),
      userId: readOptionalString(req.query?.userId),
      startedFrom: readOptionalTimestamp(req.query?.startedFrom),
      startedTo: readOptionalTimestamp(req.query?.startedTo),
    });
    res.json({ data: records, total: records.length, error: null });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.get(
  '/admin/match-records/:matchId/timeline',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const timeline = await matchReplayReadService.getMatchRecordTimelineForAdmin(
        readPathParam(req.params.matchId),
        readSeatQuery(req.query?.viewerSeat) ?? 'FIRST'
      );
      if (!timeline) {
        respondMatchRecordNotFound(res);
        return;
      }
      res.json({ data: timeline, error: null });
    } catch (error) {
      respondBattleError(res, error);
    }
  }
);

battleRouter.get(
  '/admin/match-records/:matchId/replay',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const replay = await matchReplayReadService.getMatchRecordReplayForAdmin(
        readPathParam(req.params.matchId),
        readSeatQuery(req.query?.viewerSeat) ?? 'FIRST',
        readReplayCheckpointSeqQuery(req.query)
      );
      if (!replay) {
        respondMatchRecordNotFound(res);
        return;
      }
      res.json({ data: replay, error: null });
    } catch (error) {
      respondBattleError(res, error);
    }
  }
);

battleRouter.get(
  '/admin/match-records/:matchId/export',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const bundle = await matchReplayReadService.exportMatchRecordBundleForAdmin(
        readPathParam(req.params.matchId)
      );
      if (!bundle) {
        respondMatchRecordNotFound(res);
        return;
      }
      res.json({ data: bundle, error: null });
    } catch (error) {
      respondBattleError(res, error);
    }
  }
);

battleRouter.get('/admin/match-records/:matchId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const detail = await matchReplayReadService.getMatchRecordDetailForAdmin(
      readPathParam(req.params.matchId)
    );
    if (!detail) {
      respondMatchRecordNotFound(res);
      return;
    }
    res.json({ data: detail, error: null });
  } catch (error) {
    respondBattleError(res, error);
  }
});

battleRouter.get('/match-records/:matchId/timeline', requireAuth, async (req, res) => {
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
    respondBattleError(res, error);
  }
});

battleRouter.get('/match-records/:matchId/replay', requireAuth, async (req, res) => {
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
    respondBattleError(res, error);
  }
});

battleRouter.get('/match-records/:matchId', requireAuth, async (req, res) => {
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
    respondBattleError(res, error);
  }
});

function respondMatchNotFound(res: Response): void {
  res.status(404).json({
    data: null,
    error: { code: 'BATTLE_MATCH_NOT_FOUND', message: '对局不存在或已失效' },
  });
}

function respondMatchRecordNotFound(res: Response): void {
  res.status(404).json({
    data: null,
    error: { code: 'MATCH_RECORD_NOT_FOUND', message: '历史对局记录不存在' },
  });
}

function respondBattleError(res: Response, error: unknown): void {
  if (error instanceof SolitaireMatchServiceError) {
    res
      .status(error.statusCode)
      .json({ data: null, error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof MatchReplayReadServiceError) {
    res
      .status(error.statusCode)
      .json({ data: null, error: { code: error.code, message: error.message } });
    return;
  }

  console.error('[battle] unexpected error', error);
  res.status(500).json({
    data: null,
    error: { code: 'BATTLE_INTERNAL_ERROR', message: '对战服务暂时不可用' },
  });
}

function readPathParam(value: string | readonly string[] | undefined): string {
  return String(Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim();
}

function readOptionalSeq(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readSeatQuery(value: unknown): 'FIRST' | 'SECOND' | null {
  return value === 'FIRST' || value === 'SECOND' ? value : null;
}

function readReplayCheckpointSeqQuery(query: unknown): number | undefined {
  const checkpointSeq =
    query && typeof query === 'object'
      ? (query as Partial<Record<string, unknown>>).checkpointSeq
      : undefined;
  if (typeof checkpointSeq !== 'string') {
    return undefined;
  }
  const parsed = Number(checkpointSeq);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
