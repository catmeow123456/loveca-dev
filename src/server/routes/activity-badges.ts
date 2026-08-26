import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  ACTIVITY_BADGE_ACTIVITY_TYPES,
  type ActivityBadgeActivityType,
} from '../../online/activity-badge-types.js';
import { config } from '../config.js';
import {
  enforceImageUploadAttemptLimit,
  enforceImageUploadedByteLimit,
} from '../middleware/image-upload-rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  ActivityBadgeServiceError,
  activityBadgeService,
} from '../services/activity-badge-service.js';

export const activityBadgeAdminRouter = Router();

const activityTypeSchema = z.enum(ACTIVITY_BADGE_ACTIVITY_TYPES);
const activityIdSchema = z.string().uuid();
const saveSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().trim().min(8).max(160),
  })
  .strict();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.playerWallpaper.maxInputBytes,
    files: 1,
    fields: 1,
    parts: 3,
  },
}).single('image');
const requireRankedBadgePermission = requirePermission('season.ranked.manage');
const requireThemeBadgePermission = requirePermission('season.theme.manage');

activityBadgeAdminRouter.use(requireAuth);
activityBadgeAdminRouter.get(
  '/:activityType/:activityId',
  requireBadgePermission,
  async (req, res, next) => {
    try {
      const target = parseTarget(req, res);
      if (!target) return;
      res.json({
        data: await activityBadgeService.getAdmin(target.activityType, target.activityId),
        error: null,
      });
    } catch (error) {
      respondOrNext(error, res, next);
    }
  }
);

activityBadgeAdminRouter.post(
  '/:activityType/:activityId',
  requireBadgePermission,
  enforceImageUploadAttemptLimit,
  receiveBadgeUpload,
  enforceImageUploadedByteLimit,
  async (req, res, next) => {
    try {
      const target = parseTarget(req, res);
      if (!target) return;
      const parsed = saveSchema.safeParse(readMultipartConfig(req.body));
      if (!parsed.success || !req.file?.buffer) {
        invalid(res, '请选择徽章图片并重新保存');
        return;
      }
      res.json({
        data: await activityBadgeService.save({
          ...target,
          ...parsed.data,
          upload: req.file.buffer,
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          requestId: req.requestId!,
        }),
        error: null,
      });
    } catch (error) {
      respondOrNext(error, res, next);
    }
  }
);

async function requireBadgePermission(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = activityTypeSchema.safeParse(req.params.activityType);
  if (!parsed.success) {
    invalid(res, '活动类型无效');
    return;
  }
  const middleware =
    parsed.data === 'RANKED' ? requireRankedBadgePermission : requireThemeBadgePermission;
  await middleware(req, res, next);
}

function receiveBadgeUpload(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      res.status(tooLarge ? 413 : 400).json({
        data: null,
        error: {
          code: tooLarge ? 'ACTIVITY_BADGE_FILE_TOO_LARGE' : 'ACTIVITY_BADGE_INVALID_UPLOAD',
          message: tooLarge
            ? '图片不能超过 8 MB，请压缩后重新选择'
            : '徽章上传字段无效，请重新选择图片',
        },
      });
      return;
    }
    next(error);
  });
}

function parseTarget(
  req: Request,
  res: Response
): { readonly activityType: ActivityBadgeActivityType; readonly activityId: string } | null {
  const activityType = activityTypeSchema.safeParse(req.params.activityType);
  const activityId = activityIdSchema.safeParse(req.params.activityId);
  if (!activityType.success || !activityId.success) {
    invalid(res, '活动徽章目标无效');
    return null;
  }
  return { activityType: activityType.data, activityId: activityId.data };
}

function readMultipartConfig(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !('config' in body)) return null;
  const value = (body as { readonly config?: unknown }).config;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function invalid(res: Response, message: string): void {
  res.status(400).json({
    data: null,
    error: { code: 'ACTIVITY_BADGE_INVALID_REQUEST', message },
  });
}

function respondOrNext(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ActivityBadgeServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  next(error);
}
