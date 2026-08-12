import { Router, type Response } from 'express';
import { z } from 'zod';
import { fromTransport } from '../../online/serde.js';
import { ONLINE_MATCH_EMOTE_IDS } from '../../online/chat-types.js';
import type { GameCommand } from '../../application/game-commands.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { requireGameplayAvailable } from '../middleware/require-gameplay-available.js';
import {
  DebugReplayServiceError,
  createDebugReplayBundle,
  debugReplayService,
} from '../services/debug-replay-service.js';
import {
  OnlineSpectatorServiceError,
  onlineMatchService,
} from '../services/online-match-service.js';
import { OnlineMatchChatRuntimeError } from '../services/online-match-chat-runtime.js';
import {
  OnlineRoomServiceError,
  loadUserProfileForOnlineMatch,
  onlineRoomService,
} from '../services/online-room-service.js';
import {
  MatchReplayReadServiceError,
  matchReplayReadService,
} from '../services/match-replay-read-service.js';
import {
  AiBattlePhaseThreeServiceError,
  aiBattlePhaseThreeService,
} from '../services/ai-battle-phase-three-service.js';
import { AI_MODEL_ID, readAiBattleModelConfigurationStatus } from '../ai-battle/model-provider.js';
import { readAiBattleDebugTraceConfigurationStatus } from '../ai-battle/debug-trace.js';
import { AI_BATTLE_FORMAL_SYSTEM_IDENTITY } from '../ai-battle/system-participant.js';

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

const manualOperationModeSchema = z.object({
  targetMode: z.enum(['RULES', 'FREE']),
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().min(1).optional(),
});

const manualOperationModeResponseSchema = z.object({
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().min(1).optional(),
});

const spectatorSessionSchema = z.object({
  clientId: z.string().trim().min(1).max(128).optional(),
});

const spectatorViewSchema = z.object({
  viewerSeat: z.enum(['FIRST', 'SECOND']),
});

const adminPlayerViewSpectatorLinkSchema = z.object({
  viewerSeat: z.enum(['FIRST', 'SECOND']),
});

const roomSpectatorEntrySchema = z.object({
  enabled: z.boolean(),
});

const matchChatMessageSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('TEXT'),
      clientMessageId: z.string().trim().min(1).max(128),
      text: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('EMOTE'),
      clientMessageId: z.string().trim().min(1).max(128),
      emoteId: z.enum(ONLINE_MATCH_EMOTE_IDS),
    })
    .strict(),
]);

const controlledAiBattleSchema = z.object({
  humanDeckKey: z.enum(['MUSE_STARTER', 'GREEN_HASUNOSORA_B6']),
  aiDeckKey: z.enum(['MUSE_STARTER', 'GREEN_HASUNOSORA_B6']),
  aiSeat: z.enum(['FIRST', 'SECOND']),
});

const aiBattleDebugTraceQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
});

const AI_BATTLE_PUBLIC_CONFIG_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.runtime.publicEntryConfig;

onlineRouter.get('/ai-battles/config', requireAuth, (_req, res) => {
  const model = readAiBattleModelConfigurationStatus();
  const debugTrace = readAiBattleDebugTraceConfigurationStatus();
  setPrivateNoStoreHeaders(res);
  res.json({
    data: {
      schemaVersion: AI_BATTLE_PUBLIC_CONFIG_SCHEMA_VERSION,
      available: model.enabled && model.configured,
      debugTraceEnabled: debugTrace.enabled,
      opponent: {
        displayName: AI_BATTLE_FORMAL_SYSTEM_IDENTITY.displayName,
        participantKind: AI_BATTLE_FORMAL_SYSTEM_IDENTITY.participantKind,
        modelId: AI_MODEL_ID,
        strategy: 'SERVER_MODEL_WITH_CONSERVATIVE_FALLBACK',
        chatUsedAsModelInput: false,
      },
      decks: [
        {
          deckKey: 'MUSE_STARTER',
          displayName: 'μ’s 预组',
          description: '节奏直接、适合熟悉完整对局流程。',
        },
        {
          deckKey: 'GREEN_HASUNOSORA_B6',
          displayName: '绿莲 6 弹',
          description: '资源与效果选择更丰富，适合测试复杂窗口。',
        },
      ],
      seats: ['FIRST', 'SECOND'],
    },
    error: null,
  });
});

onlineRouter.post('/ai-battles', requireAuth, requireGameplayAvailable, async (req, res) => {
  if (!requirePublicAiBattleModel(res)) return;
  const parsed = controlledAiBattleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: 'AI 对局参数非法' },
    });
    return;
  }
  try {
    const battle = await aiBattlePhaseThreeService.createBattle({
      humanUserId: req.user!.id,
      ...parsed.data,
      ...(req.user!.role === 'admin' ? { enableAdministratorDebugTrace: true } : {}),
    });
    setPrivateNoStoreHeaders(res);
    res.status(201).json({ data: battle, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/ai-battles/current', requireAuth, async (req, res) => {
  try {
    const battle = await aiBattlePhaseThreeService.getCurrentBattle(req.user!.id);
    setPrivateNoStoreHeaders(res);
    res.json({ data: battle, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/ai-battles/:matchId', requireAuth, async (req, res) => {
  try {
    const battle = await aiBattlePhaseThreeService.refreshBattle(
      readPathParam(req.params.matchId),
      req.user!.id
    );
    if (!battle) {
      res.status(404).json({
        data: null,
        error: { code: 'AI_BATTLE_NOT_FOUND', message: 'AI 对局不存在或已结束' },
      });
      return;
    }
    setPrivateNoStoreHeaders(res);
    res.json({ data: battle, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get(
  '/ai-battles/:matchId/debug-trace',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const parsedQuery = aiBattleDebugTraceQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) {
      res.status(400).json({
        data: null,
        error: { code: 'INVALID_REQUEST', message: 'AI 调试轨迹游标非法' },
      });
      return;
    }
    try {
      const trace = await aiBattlePhaseThreeService.getDebugTrace(
        readPathParam(req.params.matchId),
        req.user!.id,
        parsedQuery.data.afterSeq ?? 0
      );
      if (!trace) {
        res.status(404).json({
          data: null,
          error: { code: 'AI_BATTLE_NOT_FOUND', message: 'AI 对局不存在或无权读取' },
        });
        return;
      }
      setPrivateNoStoreHeaders(res);
      res.json({ data: trace, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.get(
  '/ai-battles/:matchId/history-document',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const document = await aiBattlePhaseThreeService.getReflectionDocument(
        readPathParam(req.params.matchId),
        req.user!.id
      );
      if (!document) {
        res.status(404).json({
          data: null,
          error: { code: 'AI_BATTLE_NOT_FOUND', message: 'AI 对局不存在或无权导出' },
        });
        return;
      }
      setPrivateNoStoreHeaders(res);
      res.json({ data: document, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.post(
  '/ai-battles/:matchId/restart',
  requireAuth,
  requireGameplayAvailable,
  async (req, res) => {
    if (!requirePublicAiBattleModel(res)) return;
    try {
      const battle = await aiBattlePhaseThreeService.restartBattle(
        readPathParam(req.params.matchId),
        req.user!.id
      );
      setPrivateNoStoreHeaders(res);
      res.status(201).json({ data: battle, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.post('/ai-battles/:matchId/leave', requireAuth, async (req, res) => {
  try {
    await aiBattlePhaseThreeService.leaveBattle(readPathParam(req.params.matchId), req.user!.id);
    res.json({ data: { left: true }, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post(
  '/admin/ai-battles',
  requireAuth,
  requireAdmin,
  requireGameplayAvailable,
  async (req, res) => {
    const parsed = controlledAiBattleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        data: null,
        error: { code: 'INVALID_REQUEST', message: '内部 AI 对局参数非法' },
      });
      return;
    }
    try {
      const battle = await aiBattlePhaseThreeService.createBattle({
        humanUserId: req.user!.id,
        ...parsed.data,
        enableAdministratorDebugTrace: true,
      });
      setPrivateNoStoreHeaders(res);
      res.status(201).json({ data: battle, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.get('/admin/ai-battles/:matchId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const battle = await aiBattlePhaseThreeService.refreshBattle(
      readPathParam(req.params.matchId),
      req.user!.id
    );
    if (!battle) {
      res.status(404).json({
        data: null,
        error: { code: 'AI_BATTLE_NOT_FOUND', message: '内部 AI 对局不存在或已结束' },
      });
      return;
    }
    setPrivateNoStoreHeaders(res);
    res.json({ data: battle, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post(
  '/admin/ai-battles/:matchId/restart',
  requireAuth,
  requireAdmin,
  requireGameplayAvailable,
  async (req, res) => {
    try {
      const battle = await aiBattlePhaseThreeService.restartBattle(
        readPathParam(req.params.matchId),
        req.user!.id
      );
      setPrivateNoStoreHeaders(res);
      res.status(201).json({ data: battle, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.post(
  '/admin/ai-battles/:matchId/leave',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      await aiBattlePhaseThreeService.leaveBattle(readPathParam(req.params.matchId), req.user!.id);
      res.json({ data: { left: true }, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

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

onlineRouter.post(
  '/admin/matches/:matchId/spectator-links/player-view',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const parsed = adminPlayerViewSpectatorLinkSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '观战视角参数非法' } });
      return;
    }

    try {
      const matchId = readPathParam(req.params.matchId);
      const match = onlineMatchService.getMatch(matchId);
      if (!match) {
        respondMatchNotFound(res);
        return;
      }

      const link = await onlineMatchService.createAdminPlayerViewSpectatorLink(
        match.matchId,
        parsed.data.viewerSeat
      );
      if (!link) {
        respondPlayerViewSpectatorUnavailable(res);
        return;
      }

      res.status(201).json({ data: link, error: null });
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

onlineRouter.post('/rooms', requireAuth, requireGameplayAvailable, async (req, res) => {
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

onlineRouter.post(
  '/rooms/:roomCode/join',
  requireAuth,
  requireGameplayAvailable,
  async (req, res) => {
    try {
      const room = await onlineRoomService.joinRoom(
        readPathParam(req.params.roomCode),
        req.user!.id
      );
      res.json({ data: room, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

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

onlineRouter.get('/rooms/:roomCode/spectator-entry', async (req, res) => {
  setSpectatorNoStoreHeaders(res);
  try {
    const entry = await onlineRoomService.getRoomSpectatorEntry(
      readPathParam(req.params.roomCode),
      req.user?.id
    );
    if (!entry || !entry.matchId || entry.seats.length === 0) {
      res.status(404).json({
        data: null,
        error: {
          code: 'ONLINE_ROOM_SPECTATOR_UNAVAILABLE',
          message: '该房间当前不能通过房间号观战',
        },
      });
      return;
    }

    res.json({ data: entry, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/rooms/:roomCode/spectator-entry/:viewerSeat/link', async (req, res) => {
  setSpectatorNoStoreHeaders(res);
  const viewerSeat = readSeatPath(req.params.viewerSeat);
  if (!viewerSeat) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '观战视角参数非法' } });
    return;
  }

  try {
    const link = await onlineRoomService.createRoomCodeSpectatorLink(
      readPathParam(req.params.roomCode),
      viewerSeat,
      req.user?.id
    );
    res.status(201).json({ data: link, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.put('/rooms/:roomCode/spectator-entry', requireAuth, async (req, res) => {
  const parsed = roomSpectatorEntrySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '房间号观战设置参数非法' },
    });
    return;
  }

  try {
    const room = await onlineRoomService.setOwnRoomSpectatorEntry(
      readPathParam(req.params.roomCode),
      req.user!.id,
      parsed.data.enabled
    );
    res.json({ data: room, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post(
  '/rooms/:roomCode/deck',
  requireAuth,
  requireGameplayAvailable,
  async (req, res) => {
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
  }
);

onlineRouter.post(
  '/rooms/:roomCode/ready-start',
  requireAuth,
  requireGameplayAvailable,
  async (req, res) => {
    try {
      const room = await onlineRoomService.markReadyToStart(
        readPathParam(req.params.roomCode),
        req.user!.id
      );
      res.json({ data: room, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

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

onlineRouter.post('/rooms/:roomCode/abandon-for-local-game', requireAuth, async (req, res) => {
  try {
    const result = await onlineRoomService.abandonRoomForLocalGame(
      readPathParam(req.params.roomCode),
      req.user!.id
    );
    res.json({ data: result, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post(
  '/rooms/:roomCode/restart-request',
  requireAuth,
  requireGameplayAvailable,
  async (req, res) => {
    try {
      const room = await onlineRoomService.requestRestart(
        readPathParam(req.params.roomCode),
        req.user!.id
      );
      res.json({ data: room, error: null });
    } catch (error) {
      respondOnlineError(res, error);
    }
  }
);

onlineRouter.post(
  '/rooms/:roomCode/restart-request/:requestId/accept',
  requireAuth,
  requireGameplayAvailable,
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

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    const snapshot = await onlineMatchService.getMatchSnapshot(match.matchId, req.user!.id, {
      sinceSeq: readOptionalSeq(req.query?.sinceSeq),
    });
    if (!snapshot) {
      respondMatchForbidden(res);
      return;
    }

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

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    const events = await onlineMatchService.getMatchPublicEvents(match.matchId, req.user!.id, {
      afterSeq: readOptionalSeq(req.query?.afterSeq),
    });
    if (!events) {
      respondMatchNotFound(res);
      return;
    }

    res.json({ data: events, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/matches/:matchId/chat/messages', requireAuth, (req, res) => {
  setPrivateNoStoreHeaders(res);
  try {
    const matchId = readPathParam(req.params.matchId);
    const standaloneAiMatch = onlineMatchService.getMatch(matchId)?.originKind === 'AI_BATTLE';
    if (!standaloneAiMatch && !onlineRoomService.touchInGameMemberByMatch(matchId, req.user!.id)) {
      respondMatchForbidden(res);
      return;
    }
    const messages = onlineMatchService.getMatchChatMessages(matchId, req.user!.id, {
      afterSeq: readOptionalSeq(req.query?.afterSeq),
    });
    if (!messages) {
      respondMatchForbidden(res);
      return;
    }
    res.json({ data: messages, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/matches/:matchId/chat/messages', requireAuth, (req, res) => {
  setPrivateNoStoreHeaders(res);
  const parsed = matchChatMessageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    if (isUnknownMatchEmoteRequest(req.body)) {
      res.status(422).json({
        data: null,
        error: { code: 'ONLINE_CHAT_EMOTE_UNAVAILABLE', message: '这个表情暂时不可用' },
      });
      return;
    }
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '聊天参数非法' } });
    return;
  }

  try {
    const matchId = readPathParam(req.params.matchId);
    const standaloneAiMatch = onlineMatchService.getMatch(matchId)?.originKind === 'AI_BATTLE';
    if (!standaloneAiMatch && !onlineRoomService.touchInGameMemberByMatch(matchId, req.user!.id)) {
      respondMatchForbidden(res);
      return;
    }
    const message = onlineMatchService.sendMatchChatMessage(matchId, req.user!.id, parsed.data);
    if (!message) {
      respondMatchForbidden(res);
      return;
    }
    res.status(201).json({ data: message, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/spectator-links/:token/sessions', async (req, res) => {
  setSpectatorNoStoreHeaders(res);
  const parsed = spectatorSessionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '观战参数非法' } });
    return;
  }

  try {
    const displayName = req.user
      ? (await loadUserProfileForOnlineMatch(req.user.id)).displayName
      : undefined;
    const joined = await onlineMatchService.joinSpectatorLink(readPathParam(req.params.token), {
      ...parsed.data,
      displayName,
      authenticatedUserId: req.user?.id,
    });
    res.status(201).json({ data: joined, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/spectator-links/:token/snapshot', async (req, res) => {
  setSpectatorNoStoreHeaders(res);
  try {
    const snapshot = await onlineMatchService.getSpectatorSnapshot(
      readPathParam(req.params.token),
      readOptionalString(req.query?.sessionId),
      {
        sinceSeq: readOptionalSeq(req.query?.sinceSeq),
        sinceViewVersion: readOptionalSeq(req.query?.sinceViewVersion),
        expectedRoomGeneration: readOptionalString(req.query?.roomGeneration) ?? undefined,
        expectedAttachmentGeneration: readOptionalSeq(req.query?.attachmentGeneration),
      }
    );
    res.json({ data: snapshot, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/spectator-links/:token/public-events', async (req, res) => {
  setSpectatorNoStoreHeaders(res);
  try {
    const events = await onlineMatchService.getSpectatorPublicEvents(
      readPathParam(req.params.token),
      readOptionalString(req.query?.sessionId),
      {
        afterSeq: readOptionalSeq(req.query?.afterSeq),
        expectedRoomGeneration: readOptionalString(req.query?.roomGeneration) ?? undefined,
        expectedAttachmentGeneration: readOptionalSeq(req.query?.attachmentGeneration),
      }
    );
    res.json({ data: events, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.get('/spectator-links/:token/chat/messages', (req, res) => {
  setSpectatorNoStoreHeaders(res);
  try {
    const messages = onlineMatchService.getSpectatorChatMessages(
      readPathParam(req.params.token),
      readOptionalString(req.query?.sessionId),
      {
        afterSeq: readOptionalSeq(req.query?.afterSeq),
        expectedRoomGeneration: readOptionalString(req.query?.roomGeneration) ?? undefined,
        expectedAttachmentGeneration: readOptionalSeq(req.query?.attachmentGeneration),
      }
    );
    res.json({ data: messages, error: null });
  } catch (error) {
    respondOnlineError(res, error);
  }
});

onlineRouter.post('/spectator-links/:token/sessions/:sessionId/view', async (req, res) => {
  setSpectatorNoStoreHeaders(res);
  const parsed = spectatorViewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res
      .status(400)
      .json({ data: null, error: { code: 'INVALID_REQUEST', message: '观战视角参数非法' } });
    return;
  }

  try {
    const switched = await onlineMatchService.switchSpectatorView(
      readPathParam(req.params.token),
      readPathParam(req.params.sessionId),
      parsed.data.viewerSeat
    );
    res.json({ data: switched, error: null });
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
    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    const result = await onlineMatchService.executeCommand(match.matchId, req.user!.id, command);
    if (!result) {
      respondMatchForbidden(res);
      return;
    }

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

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    const result = await onlineMatchService.advancePhase(match.matchId, req.user!.id);
    if (!result) {
      respondMatchForbidden(res);
      return;
    }

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

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    const result = await onlineMatchService.undoLatest(match.matchId, req.user!.id, parsed.data);
    if (!result) {
      respondMatchForbidden(res);
      return;
    }

    res.json({
      data: result,
      error: result.success ? null : { code: 'UNDO_REJECTED', message: result.error ?? '撤销失败' },
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

    onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
    const result = await onlineMatchService.createUndoRequest(
      match.matchId,
      req.user!.id,
      parsed.data
    );
    if (!result) {
      respondMatchForbidden(res);
      return;
    }

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

      onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
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

      onlineRoomService.touchInGameMemberByMatch(match.matchId, req.user!.id);
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

onlineRouter.post('/matches/:matchId/manual-operation-mode', requireAuth, async (req, res) => {
  const parsed = manualOperationModeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '操作模式参数非法' },
    });
    return;
  }
  try {
    const matchId = readPathParam(req.params.matchId);
    onlineRoomService.touchInGameMemberByMatch(matchId, req.user!.id);
    const result = await onlineMatchService.changeManualOperationMode(
      matchId,
      req.user!.id,
      parsed.data
    );
    if (!result) {
      respondMatchForbidden(res);
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
    respondOnlineError(res, error);
  }
});

for (const action of ['accept', 'reject', 'cancel'] as const) {
  onlineRouter.post(
    `/matches/:matchId/manual-operation-mode-requests/:requestId/${action}`,
    requireAuth,
    async (req, res) => {
      const parsed = manualOperationModeResponseSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          data: null,
          error: { code: 'INVALID_REQUEST', message: '自由模式请求响应参数非法' },
        });
        return;
      }
      try {
        const matchId = readPathParam(req.params.matchId);
        const requestId = readPathParam(req.params.requestId);
        onlineRoomService.touchInGameMemberByMatch(matchId, req.user!.id);
        const result =
          action === 'accept'
            ? await onlineMatchService.acceptManualOperationModeRequest(
                matchId,
                req.user!.id,
                requestId,
                parsed.data
              )
            : action === 'reject'
              ? await onlineMatchService.rejectManualOperationModeRequest(
                  matchId,
                  req.user!.id,
                  requestId,
                  parsed.data
                )
              : await onlineMatchService.cancelManualOperationModeRequest(
                  matchId,
                  req.user!.id,
                  requestId,
                  parsed.data
                );
        if (!result) {
          respondMatchForbidden(res);
          return;
        }
        res.json({
          data: result,
          error: result.success
            ? null
            : {
                code: 'MANUAL_OPERATION_MODE_REQUEST_REJECTED',
                message: result.error ?? '处理自由模式请求失败',
              },
        });
      } catch (error) {
        respondOnlineError(res, error);
      }
    }
  );
}

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

function respondPlayerViewSpectatorUnavailable(res: Response): void {
  res.status(404).json({
    data: null,
    error: { code: 'ONLINE_PLAYER_VIEW_NOT_FOUND', message: '该对局没有可用的玩家视角' },
  });
}

function respondMatchRecordNotFound(res: Response): void {
  res.status(404).json({
    data: null,
    error: { code: 'MATCH_RECORD_NOT_FOUND', message: '历史对局记录不存在或不可访问' },
  });
}

function requirePublicAiBattleModel(res: Response): boolean {
  const model = readAiBattleModelConfigurationStatus();
  if (model.enabled && model.configured) return true;
  res.status(503).json({
    data: null,
    error: {
      code: 'AI_BATTLE_MODEL_UNAVAILABLE',
      message: 'AI 对战暂未开放，请稍后再试',
    },
  });
  return false;
}

function respondOnlineError(res: Response, error: unknown): void {
  if (error instanceof AiBattlePhaseThreeServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  if (error instanceof OnlineMatchChatRuntimeError) {
    if (error.retryAfterMs !== undefined) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
    }
    res.status(error.statusCode).json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
        ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
      },
    });
    return;
  }

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

  if (error instanceof OnlineSpectatorServiceError) {
    if (error.retryAfterMs !== undefined) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
    }
    res.status(error.statusCode).json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
        ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
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

function isUnknownMatchEmoteRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const candidate = body as Record<string, unknown>;
  return (
    candidate.kind === 'EMOTE' &&
    typeof candidate.emoteId === 'string' &&
    !ONLINE_MATCH_EMOTE_IDS.some((emoteId) => emoteId === candidate.emoteId)
  );
}

function setSpectatorNoStoreHeaders(res: Response): void {
  setPrivateNoStoreHeaders(res);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
}

function setPrivateNoStoreHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
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

function readOptionalString(value: unknown): string | null {
  const raw = Array.isArray(value) ? (value[0] as unknown) : value;
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
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

function readSeatPath(value: string | string[] | undefined): 'FIRST' | 'SECOND' | null {
  const raw = readPathParam(value);
  return raw === 'FIRST' || raw === 'SECOND' ? raw : null;
}
