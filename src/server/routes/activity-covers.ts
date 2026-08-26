import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  ACTIVITY_COVER_ACTIVITY_TYPES,
  ACTIVITY_COVER_MASK_LEVELS,
  type ActivityCoverActivityType,
} from '../../online/activity-cover-types.js';
import { config } from '../config.js';
import {
  enforceImageUploadAttemptLimit,
  enforceImageUploadedByteLimit,
} from '../middleware/image-upload-rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  ActivityCoverServiceError,
  activityCoverService,
} from '../services/activity-cover-service.js';

export const activityCoverAdminRouter = Router();

const activityTypeSchema = z.enum(ACTIVITY_COVER_ACTIVITY_TYPES);
const activityIdSchema = z.string().uuid();
const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const cropSchema = pointSchema
  .extend({ width: z.number().positive().max(1), height: z.number().positive().max(1) })
  .strict();
const layoutSchema = z.object({ crop: cropSchema, focus: pointSchema }).strict();
const saveSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().trim().min(8).max(160),
    source: z.enum(['UPLOAD', 'CURRENT']),
    maskLevel: z.enum(ACTIVITY_COVER_MASK_LEVELS),
    wide: layoutSchema,
    compact: layoutSchema,
  })
  .strict();
const removeSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().trim().min(8).max(160),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const sourceRevisionSchema = z.coerce.number().int().positive();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.playerWallpaper.maxInputBytes,
    files: 1,
    fields: 1,
    parts: 3,
  },
});
const receiveSourceImage = upload.single('image');
const requireRankedCoverPermission = requirePermission('season.ranked.manage');
const requireThemeCoverPermission = requirePermission('season.theme.manage');

activityCoverAdminRouter.use(requireAuth);

activityCoverAdminRouter.get(
  '/:activityType/:activityId/source',
  requireCoverPermission,
  async (req, res, next) => {
    try {
      const target = parseTarget(req, res);
      if (!target) return;
      const revision = sourceRevisionSchema.safeParse(req.query.revision);
      if (!revision.success) {
        invalid(res, '活动封面母图 revision 无效');
        return;
      }
      const asset = await activityCoverService.getCurrentSource(
        target.activityType,
        target.activityId,
        revision.data
      );
      if (req.headers['if-none-match'] === asset.etag) {
        res.status(304).end();
        return;
      }
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('ETag', asset.etag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      asset.stream.once('error', () => res.destroy());
      asset.stream.pipe(res);
    } catch (error) {
      respondOrNext(error, res, next);
    }
  }
);

activityCoverAdminRouter.get(
  '/:activityType/:activityId',
  requireCoverPermission,
  async (req, res, next) => {
    try {
      const target = parseTarget(req, res);
      if (!target) return;
      res.json({
        data: await activityCoverService.getAdmin(target.activityType, target.activityId),
        error: null,
      });
    } catch (error) {
      respondOrNext(error, res, next);
    }
  }
);

activityCoverAdminRouter.post(
  '/:activityType/:activityId',
  requireCoverPermission,
  enforceImageUploadAttemptLimit,
  receiveCoverUpload,
  enforceImageUploadedByteLimit,
  async (req, res, next) => {
    try {
      const target = parseTarget(req, res);
      if (!target) return;
      const parsed = saveSchema.safeParse(readMultipartConfig(req.body));
      if (!parsed.success) {
        invalid(res, '活动封面配置无效，请重新调整后保存');
        return;
      }
      if (parsed.data.source === 'UPLOAD' && !req.file?.buffer) {
        invalid(res, '请选择要上传的活动封面图片');
        return;
      }
      if (parsed.data.source === 'CURRENT' && req.file) {
        invalid(res, '复用当前母图时不能同时上传新图片');
        return;
      }
      res.json({
        data: await activityCoverService.save({
          ...target,
          ...parsed.data,
          upload: req.file?.buffer,
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

activityCoverAdminRouter.delete(
  '/:activityType/:activityId',
  requireCoverPermission,
  async (req, res, next) => {
    try {
      const target = parseTarget(req, res);
      if (!target) return;
      const parsed = removeSchema.safeParse(req.body);
      if (!parsed.success) {
        invalid(res, '请填写移除原因并重新确认');
        return;
      }
      res.json({
        data: await activityCoverService.remove({
          ...target,
          ...parsed.data,
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

async function requireCoverPermission(
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
    parsed.data === 'RANKED' ? requireRankedCoverPermission : requireThemeCoverPermission;
  await middleware(req, res, next);
}

function receiveCoverUpload(req: Request, res: Response, next: NextFunction): void {
  receiveSourceImage(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      res.status(tooLarge ? 413 : 400).json({
        data: null,
        error: {
          code: tooLarge ? 'ACTIVITY_COVER_FILE_TOO_LARGE' : 'ACTIVITY_COVER_INVALID_UPLOAD',
          message: tooLarge
            ? '图片不能超过 8 MB，请压缩后重新选择'
            : '封面上传字段无效，请重新选择图片',
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
): { readonly activityType: ActivityCoverActivityType; readonly activityId: string } | null {
  const activityType = activityTypeSchema.safeParse(req.params.activityType);
  const activityId = activityIdSchema.safeParse(req.params.activityId);
  if (!activityType.success || !activityId.success) {
    invalid(res, '活动封面参数无效');
    return null;
  }
  return { activityType: activityType.data, activityId: activityId.data };
}

function readMultipartConfig(body: unknown): unknown {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).config;
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
    error: { code: 'ACTIVITY_COVER_INVALID_REQUEST', message },
  });
}

function respondOrNext(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ActivityCoverServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  next(error);
}
