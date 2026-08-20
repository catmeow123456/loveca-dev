import type { Request } from 'express';
import type { UserRole } from '../../shared/auth/permissions.js';

export interface AuthUser {
  id: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface ApiResponse<T = unknown> {
  data: T | null;
  error: { code: string; message: string } | null;
  total?: number;
}
