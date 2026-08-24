import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { requireGameplayAvailable } from '../middleware/require-gameplay-available.js';
import { PublicTableServiceError } from '../services/public-table-service.js';
import {
  RankedEnvironmentServiceError,
  rankedEnvironmentService,
} from '../services/ranked-environment-service.js';
import {
  RankedDeckArchetypeEnvironmentServiceError,
  rankedDeckArchetypeEnvironmentService,
} from '../services/ranked-deck-archetype-environment-service.js';
import {
  RankedPlayerServiceError,
  rankedPlayerService,
} from '../services/ranked-player-service.js';

export const rankedRouter = Router();

const joinSchema = z.object({
  deckId: z.string().uuid(),
});

rankedRouter.use(requireAuth);

rankedRouter.get('/seasons', async (_req, res) => {
  try {
    respondData(res, await rankedPlayerService.listPublicSeasons());
  } catch (error) {
    respondRankedError(res, error);
  }
});

rankedRouter.get('/overview', async (req, res) => {
  const parsed = z.object({ seasonId: z.string().uuid().optional() }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '赛季参数无效' },
    });
    return;
  }
  try {
    respondData(res, await rankedPlayerService.getOverview(req.user!.id, parsed.data.seasonId));
  } catch (error) {
    respondRankedError(res, error);
  }
});

rankedRouter.get('/environment', async (req, res) => {
  const parsed = z.object({ seasonId: z.string().uuid() }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '赛季参数无效' },
    });
    return;
  }
  try {
    respondData(res, await rankedEnvironmentService.getSeasonEnvironment(parsed.data.seasonId));
  } catch (error) {
    respondRankedError(res, error);
  }
});

rankedRouter.get('/environment/decks', async (req, res) => {
  const parsed = z.object({ seasonId: z.string().uuid() }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '赛季参数无效' },
    });
    return;
  }
  try {
    respondData(
      res,
      await rankedDeckArchetypeEnvironmentService.getSeasonEnvironment(parsed.data.seasonId)
    );
  } catch (error) {
    respondRankedError(res, error);
  }
});

rankedRouter.post('/queue/join', requireGameplayAvailable, async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '请选择合法的云端卡组' },
    });
    return;
  }
  try {
    const status = await rankedPlayerService.join(req.user!.id, parsed.data.deckId);
    res.status(201).json({ data: status, error: null });
  } catch (error) {
    respondRankedError(res, error);
  }
});

rankedRouter.post('/queue/heartbeat', async (req, res) => {
  try {
    respondData(res, await rankedPlayerService.heartbeat(req.user!.id));
  } catch (error) {
    respondRankedError(res, error);
  }
});

rankedRouter.post('/queue/confirm', requireGameplayAvailable, async (req, res) => {
  try {
    respondData(res, await rankedPlayerService.confirm(req.user!.id));
  } catch (error) {
    respondRankedError(res, error);
  }
});

rankedRouter.post('/queue/cancel', async (req, res) => {
  try {
    respondData(res, await rankedPlayerService.cancel(req.user!.id));
  } catch (error) {
    respondRankedError(res, error);
  }
});

function respondData(res: Response, data: unknown): void {
  res.json({ data, error: null });
}

function respondRankedError(res: Response, error: unknown): void {
  if (
    error instanceof RankedPlayerServiceError ||
    error instanceof RankedEnvironmentServiceError ||
    error instanceof RankedDeckArchetypeEnvironmentServiceError ||
    error instanceof PublicTableServiceError
  ) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('ranked player request failed', error);
  res.status(500).json({
    data: null,
    error: { code: 'RANKED_INTERNAL_ERROR', message: '赛季排位服务暂时不可用' },
  });
}
