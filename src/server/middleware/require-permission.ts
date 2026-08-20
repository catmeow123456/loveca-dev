import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  hasPermission,
  isUserRole,
  type ManagementPermission,
  type UserRole,
} from '../../shared/auth/permissions.js';
import { pool } from '../db/pool.js';

interface CurrentRoleRow {
  readonly role: string;
}

export async function readCurrentAuthorizedRole(
  userId: string,
  tokenRole: UserRole,
  permission: ManagementPermission
): Promise<UserRole | null> {
  if (!hasPermission(tokenRole, permission)) {
    return null;
  }

  const result = await pool.query<CurrentRoleRow>('SELECT role FROM profiles WHERE id = $1', [
    userId,
  ]);
  const currentRole = result.rows[0]?.role;
  if (!isUserRole(currentRole) || currentRole !== tokenRole) {
    return null;
  }

  return hasPermission(currentRole, permission) ? currentRole : null;
}

export function requirePermission(permission: ManagementPermission): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      respondForbidden(res, '需要相应管理权限');
      return;
    }

    // Reject an old low-privilege token synchronously after a promotion. A new login
    // must issue a token containing the new role before privileged APIs can be used.
    if (!hasPermission(req.user.role, permission)) {
      writePermissionDenial(req, permission, 'TOKEN_ROLE_FORBIDDEN');
      respondForbidden(res, '需要相应管理权限');
      return;
    }

    try {
      const currentRole = await readCurrentAuthorizedRole(req.user.id, req.user.role, permission);
      if (!currentRole) {
        writePermissionDenial(req, permission, 'AUTHORIZATION_STALE');
        res.status(403).json({
          data: null,
          error: { code: 'AUTHORIZATION_STALE', message: '权限已变更，请重新登录' },
        });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

function respondForbidden(res: Response, message: string): void {
  res.status(403).json({
    data: null,
    error: { code: 'FORBIDDEN', message },
  });
}

function writePermissionDenial(
  req: Request,
  permission: ManagementPermission,
  reason: 'TOKEN_ROLE_FORBIDDEN' | 'AUTHORIZATION_STALE'
): void {
  console.warn(
    JSON.stringify({
      event: 'management-permission-denied',
      requestId: req.requestId ?? null,
      userId: req.user?.id ?? null,
      tokenRole: req.user?.role ?? null,
      permission,
      reason,
    })
  );
}
