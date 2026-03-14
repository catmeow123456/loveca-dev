import type { Request, Response, NextFunction } from 'express';

/**
 * Requires the authenticated user to have admin role.
 * Must be used after requireAuth.
 * Returns 403 if not admin.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({
      data: null,
      error: { code: 'FORBIDDEN', message: '需要管理员权限' },
    });
    return;
  }
  next();
}
