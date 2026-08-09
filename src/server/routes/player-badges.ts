import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import { PlayerBadgeServiceError, playerBadgeService } from '../services/player-badge-service.js';

export const playerBadgesRouter = Router();

playerBadgesRouter.use(requireAuth);

playerBadgesRouter.get('/me', async (req, res) => {
  try {
    res.json({ data: await playerBadgeService.listOwnBadges(req.user!.id), error: null });
  } catch (error) {
    if (error instanceof PlayerBadgeServiceError) {
      res.status(error.statusCode).json({
        data: null,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    console.error('player badge request failed', error);
    res.status(500).json({
      data: null,
      error: { code: 'PLAYER_BADGE_INTERNAL_ERROR', message: '徽章信息暂时不可用' },
    });
  }
});
