import { Router, type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { parseAiHumanCommand } from '../ai-battle/human-command.js';
import { fromTransport, toTransport } from '../../online/serde.js';
import { privateNoStore } from '../middleware/private-no-store.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import { requireGameplayAvailable } from '../middleware/require-gameplay-available.js';
import { AiBattleSetupError } from '../ai-battle/presets.js';
import type { AiBattleService } from '../services/ai-battle-service.js';
import { AI_BATTLE_MODELS } from '../../online/ai-battle-billing-types.js';

const createSchema = z
  .object({
    humanPresetId: z.string().min(1).max(100),
    aiPresetId: z.string().min(1).max(100),
    handbookId: z.string().min(1).max(100),
    humanSeat: z.enum(['FIRST', 'SECOND']),
    model: z.enum(AI_BATTLE_MODELS),
    enableThinking: z.boolean(),
  })
  .strict();
const seqSchema = z.coerce.number().int().min(0).optional();
const commandSchema = z
  .object({ command: z.unknown().refine((value) => value !== undefined) })
  .strict();

export function createAiBattleRouter(service: AiBattleService): Router {
  const router = Router();
  router.use(privateNoStore, requireAuth, requirePermission('rules.manage'));
  router.get('/presets', async (_req, res, next) => {
    try {
      res.json({ data: await service.listPresets(), error: null });
    } catch (error) {
      next(error);
    }
  });
  router.get('/sessions', (req, res) => {
    res.json({ data: service.listSessions(req.user!.id), error: null });
  });
  router.get('/records/:matchId/billing', async (req, res, next) => {
    try {
      res.json({
        data: await service.getRecordedBilling(req.user!.id, req.params.matchId),
        error: null,
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/sessions', requireGameplayAvailable, async (req, res, next) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '创建参数非法' } });
      return;
    }
    try {
      res
        .status(201)
        .json({ data: toTransport(await service.create(req.user!.id, parsed.data)), error: null });
    } catch (error) {
      next(error);
    }
  });
  router.get('/sessions/:matchId', (req, res, next) => {
    try {
      res.json({ data: service.getSession(req.user!.id, req.params.matchId), error: null });
    } catch (error) {
      next(error);
    }
  });
  router.get('/sessions/:matchId/decisions', (req, res, next) => {
    try {
      res.json({ data: service.listDecisions(req.user!.id, req.params.matchId), error: null });
    } catch (error) {
      next(error);
    }
  });
  router.get('/sessions/:matchId/decisions/:decisionId', (req, res, next) => {
    try {
      res.json({
        data: service.exportDecisions(req.user!.id, req.params.matchId, req.params.decisionId),
        error: null,
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/sessions/:matchId/export', (req, res, next) => {
    try {
      const bundle = service.exportDecisions(req.user!.id, req.params.matchId);
      res.attachment(`loveca-ai-${encodeURIComponent(req.params.matchId)}.json`).json(bundle);
    } catch (error) {
      next(error);
    }
  });
  router.get('/sessions/:matchId/snapshot', async (req, res, next) => {
    const seq = seqSchema.safeParse(req.query.sinceSeq);
    if (!seq.success) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '快照序号非法' } });
      return;
    }
    try {
      res.json({
        data: toTransport(await service.snapshot(req.user!.id, req.params.matchId, seq.data)),
        error: null,
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/sessions/:matchId/public-events', async (req, res, next) => {
    const seq = seqSchema.safeParse(req.query.afterSeq);
    if (!seq.success) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '事件序号非法' } });
      return;
    }
    try {
      res.json({
        data: toTransport(await service.publicEvents(req.user!.id, req.params.matchId, seq.data)),
        error: null,
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/sessions/:matchId/command', async (req, res, next) => {
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ data: null, error: { code: 'INVALID_REQUEST', message: '命令参数非法' } });
      return;
    }
    try {
      const result = await service.command(
        req.user!.id,
        req.params.matchId,
        parseAiHumanCommand(fromTransport(parsed.data.command))
      );
      res.json({
        data: toTransport(result),
        error: result?.success
          ? null
          : { code: 'COMMAND_REJECTED', message: result?.error ?? '对局不存在' },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/sessions/:matchId/end', async (req, res, next) => {
    try {
      res.json({ data: await service.end(req.user!.id, req.params.matchId), error: null });
    } catch (error) {
      next(error);
    }
  });
  router.post('/sessions/:matchId/advance', async (req, res, next) => {
    try {
      res.json({
        data: toTransport(await service.advance(req.user!.id, req.params.matchId)),
        error: null,
      });
    } catch (error) {
      next(error);
    }
  });
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (error instanceof AiBattleSetupError) {
      res
        .status(error.statusCode)
        .json({ data: null, error: { code: error.code, message: error.message } });
    } else next(error);
  };
  router.use(handleError);
  return router;
}
