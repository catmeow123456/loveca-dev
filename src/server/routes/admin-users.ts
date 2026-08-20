import { Router, type Response } from 'express';
import { z } from 'zod';
import { USER_ROLES, type UserRole } from '../../shared/auth/permissions.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import { validate } from '../middleware/validate.js';
import { AdminUserServiceError, adminUserService } from '../services/admin-user-service.js';

export const adminUsersRouter = Router();

const listUsersQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    role: z.enum(USER_ROLES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const changeRoleSchema = z
  .object({
    role: z.enum(USER_ROLES),
    expectedRole: z.enum(USER_ROLES),
  })
  .strict();

const userIdSchema = z.string().uuid();

adminUsersRouter.get('/', requireAuth, requirePermission('users.list'), async (req, res) => {
  const parsed = listUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res);
    return;
  }

  try {
    const result = await adminUserService.listUsers({
      query: parsed.data.q || undefined,
      role: parsed.data.role,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    res.json({ data: result.data, total: result.total, error: null });
  } catch (error) {
    respondAdminUserError(res, error);
  }
});

adminUsersRouter.put(
  '/:userId/role',
  requireAuth,
  requirePermission('users.roles.manage'),
  validate(changeRoleSchema),
  async (req, res) => {
    const parsedUserId = userIdSchema.safeParse(req.params.userId);
    if (!parsedUserId.success) {
      respondValidationError(res);
      return;
    }

    try {
      const body = req.body as z.infer<typeof changeRoleSchema>;
      const result = await adminUserService.changeRole({
        targetUserId: parsedUserId.data,
        actorUserId: req.user!.id,
        nextRole: body.role as UserRole,
        expectedRole: body.expectedRole as UserRole,
      });
      res.json({ data: result, error: null });
    } catch (error) {
      respondAdminUserError(res, error);
    }
  }
);

function respondValidationError(res: Response): void {
  res.status(400).json({
    data: null,
    error: { code: 'VALIDATION_ERROR', message: '请求参数不合法' },
  });
}

function respondAdminUserError(res: Response, error: unknown): void {
  if (error instanceof AdminUserServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  throw error;
}
