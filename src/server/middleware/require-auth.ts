import type { Request, Response, NextFunction } from 'express';

/**
 * Requires an authenticated user (req.user must be set).
 * Returns 401 if not authenticated.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      data: null,
      error: { code: 'UNAUTHORIZED', message: '未登录' },
    });
    return;
  }
  next();
}
