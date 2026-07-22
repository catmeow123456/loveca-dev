import type { Request, Response, NextFunction } from 'express';
import type { AuthUser } from '../types/api.js';
import { verifyAccessToken } from '../services/auth-service.js';

/**
 * Optional authentication middleware.
 * Parses JWT from Authorization header if present, sets req.user.
 * Does NOT reject unauthenticated requests.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role,
    } satisfies AuthUser;
  } catch {
    // Invalid token — treat as unauthenticated, don't fail
  }
  next();
}
