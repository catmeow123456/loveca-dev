import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { AuthUser } from '../types/api.js';

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
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    req.user = {
      id: payload.sub as string,
      role: payload.role as 'user' | 'admin',
    } satisfies AuthUser;
  } catch {
    // Invalid token — treat as unauthenticated, don't fail
  }
  next();
}
