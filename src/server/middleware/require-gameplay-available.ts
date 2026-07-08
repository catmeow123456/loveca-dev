import type { NextFunction, Request, Response } from 'express';
import { siteAnnouncementService } from '../services/site-announcement-service.js';

export async function requireGameplayAvailable(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const maintenance = await siteAnnouncementService.getGameplayRestriction(process.env);
    if (!maintenance) {
      next();
      return;
    }

    res.status(503).json({
      data: null,
      error: {
        code: 'SITE_MAINTENANCE',
        message: maintenance.summary || maintenance.title || '当前正在维护，暂时不能开始新的对局',
      },
    });
  } catch (error) {
    next(error);
  }
}
