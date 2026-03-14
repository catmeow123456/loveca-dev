import type { Request } from 'express';

export interface AuthUser {
  id: string;
  role: 'user' | 'admin';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface ApiResponse<T = unknown> {
  data: T | null;
  error: { code: string; message: string } | null;
  total?: number;
}
