import { Router, type Response } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import { requireGameplayAvailable } from '../middleware/require-gameplay-available.js';
import {
  isThemeTablePlayerError,
  themeTablePlayerService,
} from '../services/theme-table-player-service.js';

export const themeTableRouter = Router();

themeTableRouter.use(requireAuth);

themeTableRouter.get('/overview', async (req, res) => {
  try {
    respondData(res, await themeTablePlayerService.getOverview(req.user!.id));
  } catch (error) {
    respondError(res, error);
  }
});

themeTableRouter.post('/queue/join', requireGameplayAvailable, async (req, res) => {
  try {
    res.status(201).json({ data: await themeTablePlayerService.join(req.user!.id), error: null });
  } catch (error) {
    respondError(res, error);
  }
});

themeTableRouter.post('/queue/heartbeat', async (req, res) => {
  try {
    respondData(res, await themeTablePlayerService.heartbeat(req.user!.id));
  } catch (error) {
    respondError(res, error);
  }
});

themeTableRouter.post('/queue/confirm', requireGameplayAvailable, async (req, res) => {
  try {
    respondData(res, await themeTablePlayerService.confirm(req.user!.id));
  } catch (error) {
    respondError(res, error);
  }
});

themeTableRouter.post('/queue/cancel', async (req, res) => {
  try {
    respondData(res, await themeTablePlayerService.cancel(req.user!.id));
  } catch (error) {
    respondError(res, error);
  }
});

function respondData(res: Response, data: unknown): void {
  res.json({ data, error: null });
}

function respondError(res: Response, error: unknown): void {
  if (isThemeTablePlayerError(error)) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('theme table request failed', error);
  res.status(500).json({
    data: null,
    error: { code: 'THEME_TABLE_INTERNAL_ERROR', message: '娱乐模式服务暂时不可用' },
  });
}
