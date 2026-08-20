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
      const { confirmation } = req.body as { confirmation: string };
      res.json({
        data: await platformOperationsService.applyReplayRetention(confirmation, req.user!.id),
        error: null,
      });
    } catch (error) {
      respond(res, error, '清理回放数据失败');
    }
  }
);
platformOperationsRouter.post(
  '/ranked-analysis-export',
  validate(z.object({ seasonId: z.string().uuid() })),
  async (req, res) => {
    try {
      const { seasonId } = req.body as { seasonId: string };
      const exported = await platformOperationsService.exportRankedAnalysis(seasonId, req.user!.id);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(exported.buffer);
    } catch (error) {
      respond(res, error, '生成赛季分析数据失败');
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
