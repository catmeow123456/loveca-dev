import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { requireGameplayAvailable } from '../middleware/require-gameplay-available.js';
import { PublicTableServiceError, publicTableService } from '../services/public-table-service.js';

export const publicTableRouter = Router();

const joinSchema = z.object({
  deckId: z.string().uuid(),
  entrySource: z.enum(['DIRECT', 'SHARED_LINK']).optional(),
});

publicTableRouter.get('/summary', async (_req, res) => {
  try {
    res.json({ data: await publicTableService.getSummary(), error: null });
  } catch (error) {
    respondPublicTableError(res, error);
  }
});

publicTableRouter.get('/me', requireAuth, async (req, res) => {
  try {
    res.json({ data: await publicTableService.getStatus(req.user!.id), error: null });
  } catch (error) {
    respondPublicTableError(res, error);
  }
});

publicTableRouter.post('/join', requireAuth, requireGameplayAvailable, async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '请选择合法的云端卡组' },
    });
    return;
  }
  try {
    const status = await publicTableService.join(
      req.user!.id,
      parsed.data.deckId,
      parsed.data.entrySource
    );
    res.status(201).json({ data: status, error: null });
  } catch (error) {
    respondPublicTableError(res, error);
  }
});

publicTableRouter.post('/heartbeat', requireAuth, async (req, res) => {
  try {
    res.json({ data: await publicTableService.heartbeat(req.user!.id), error: null });
  } catch (error) {
    respondPublicTableError(res, error);
  }
});

publicTableRouter.post('/confirm', requireAuth, requireGameplayAvailable, async (req, res) => {
  try {
    res.json({ data: await publicTableService.confirm(req.user!.id), error: null });
  } catch (error) {
    respondPublicTableError(res, error);
  }
});

publicTableRouter.post('/cancel', requireAuth, async (req, res) => {
  try {
    res.json({ data: await publicTableService.cancel(req.user!.id), error: null });
  } catch (error) {
    respondPublicTableError(res, error);
  }
});

function respondPublicTableError(res: Response, error: unknown): void {
  if (error instanceof PublicTableServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('public table request failed', error);
  res.status(500).json({
    data: null,
    error: { code: 'PUBLIC_TABLE_INTERNAL_ERROR', message: '公共牌桌服务暂时不可用' },
  });
}
