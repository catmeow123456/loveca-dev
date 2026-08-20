import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { validate } from '../middleware/validate.js';
import {
  PlatformOperationsServiceError,
  platformOperationsService,
} from '../services/platform-operations-service.js';

export const platformOperationsRouter = Router();
platformOperationsRouter.use(requireAuth, requireAdmin);
platformOperationsRouter.get('/replay-retention/preview', async (_req, res) => {
  try {
    res.json({ data: await platformOperationsService.previewReplayRetention(), error: null });
  } catch (error) {
    respond(res, error, '读取回放清理预览失败');
  }
});
platformOperationsRouter.post(
  '/replay-retention/apply',
  validate(z.object({ confirmation: z.string().max(40) })),
  async (req, res) => {
    try {
      res.json({
        data: await platformOperationsService.applyReplayRetention(
          req.body.confirmation,
          req.user!.id
        ),
        error: null,
      });
    } catch (error) {
      respond(res, error, '清理回放数据失败');
    }
  }
);
platformOperationsRouter.post(
  '/ranked-volatility-report',
  validate(z.object({ seasonId: z.string().uuid().optional() })),
  async (req, res) => {
    try {
      res.json({
        data: await platformOperationsService.generateRankedVolatilityReport(req.body.seasonId),
        error: null,
      });
    } catch (error) {
      respond(res, error, '生成赛季报告失败');
    }
  }
);
function respond(res: Response, error: unknown, fallback: string): void {
  if (error instanceof PlatformOperationsServiceError) {
    const status =
      error.code === 'CONFIRMATION_REQUIRED'
        ? 400
        : error.code === 'RANKED_OBSERVATION_BLOCKED'
          ? 409
          : 500;
    res.status(status).json({ data: null, error: { code: error.code, message: error.message } });
    return;
  }
  console.error('[PlatformOperations] Route error:', error);
  res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: fallback } });
}
