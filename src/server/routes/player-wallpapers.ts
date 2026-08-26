import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { PLAYER_WALLPAPER_SOLID_PRESET_IDS } from '../../online/player-wallpaper-types.js';
import { config } from '../config.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { requireAuth } from '../middleware/require-auth.js';
import {
  enforceImageUploadAttemptLimit,
  enforceImageUploadedByteLimit,
} from '../middleware/image-upload-rate-limit.js';
import {
  PlayerWallpaperServiceError,
  playerWallpaperService,
} from '../services/player-wallpaper-service.js';

export const playerWallpapersRouter = Router();

const normalizedPointSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();

const cropSchema = normalizedPointSchema
  .extend({
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict();

const layoutDraftSchema = z
  .object({
    source: z.enum(['UPLOAD', 'CURRENT']).optional(),
    crop: cropSchema,
    focus: normalizedPointSchema,
  })
  .strict();

const publishSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    idempotencyKey: z.string().trim().min(8).max(160),
    wideMode: z.enum(['DEFAULT', 'SOLID', 'CUSTOM']),
    compactMode: z.enum(['INHERIT_PC', 'SOLID', 'CUSTOM']),
    wideSolidPreset: z.enum(PLAYER_WALLPAPER_SOLID_PRESET_IDS).nullable(),
    compactSolidPreset: z.enum(PLAYER_WALLPAPER_SOLID_PRESET_IDS).nullable(),
    wide: layoutDraftSchema.nullable(),
    compact: layoutDraftSchema.nullable(),
  })
  .strict();

const resetSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    idempotencyKey: z.string().trim().min(8).max(160),
  })
  .strict();

const adminRemoveSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

type UploadedFiles = Record<string, Array<{ readonly buffer: Buffer; readonly size: number }>>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.playerWallpaper.maxInputBytes,
    files: 2,
    fields: 1,
    parts: 3,
  },
});
const receiveWallpaperFiles = upload.fields([
  { name: 'wide', maxCount: 1 },
  { name: 'compact', maxCount: 1 },
]);

playerWallpapersRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const includeSources = req.query.includeSources === 'true';
    const wallpaper = await playerWallpaperService.getCurrent(req.user!.id, includeSources);
    res.json({ data: wallpaper, error: null });
  } catch (error) {
    respondOrNext(error, res, next);
  }
});

playerWallpapersRouter.get('/assets/:assetId', requireAuth, async (req, res, next) => {
  try {
    const assetId = z.string().uuid().parse(req.params.assetId);
    const asset = await playerWallpaperService.getOwnedActiveAsset(req.user!.id, assetId);
    if (req.headers['if-none-match'] === asset.etag) {
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', asset.byteSize);
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.setHeader('ETag', asset.etag);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    asset.stream.once('error', () => res.destroy());
    asset.stream.pipe(res);
  } catch (error) {
    respondOrNext(error, res, next);
  }
});

playerWallpapersRouter.post(
  '/',
  requireAuth,
  enforceImageUploadAttemptLimit,
  receiveWallpaperUpload,
  enforceImageUploadedByteLimit,
  async (req, res, next) => {
    try {
      const rawConfig = readMultipartConfig(req.body);
      const parsed = publishSchema.safeParse(rawConfig);
      if (!parsed.success) {
        res.status(400).json({
          data: null,
          error: { code: 'WALLPAPER_INVALID_REQUEST', message: '壁纸配置无效，请重新编辑。' },
        });
        return;
      }

      const files = (req.files ?? {}) as UploadedFiles;
      const result = await playerWallpaperService.publish({
        userId: req.user!.id,
        expectedVersion: parsed.data.expectedVersion,
        idempotencyKey: parsed.data.idempotencyKey,
        wideMode: parsed.data.wideMode,
        compactMode: parsed.data.compactMode,
        wideSolidPreset: parsed.data.wideSolidPreset,
        compactSolidPreset: parsed.data.compactSolidPreset,
        wide:
          parsed.data.wide && parsed.data.wide.source
            ? { ...parsed.data.wide, source: parsed.data.wide.source }
            : null,
        compact: parsed.data.compact,
        wideUpload: files.wide?.[0]?.buffer,
        compactUpload: files.compact?.[0]?.buffer,
      });
      res.json({ data: result, error: null });
    } catch (error) {
      respondOrNext(error, res, next);
    }
  }
);

playerWallpapersRouter.post('/reset', requireAuth, async (req, res, next) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        data: null,
        error: { code: 'WALLPAPER_INVALID_REQUEST', message: '恢复默认请求无效。' },
      });
      return;
    }
    const result = await playerWallpaperService.reset({
      userId: req.user!.id,
      ...parsed.data,
    });
    res.json({ data: result, error: null });
  } catch (error) {
    respondOrNext(error, res, next);
  }
});

playerWallpapersRouter.delete(
  '/admin/:userId',
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const userId = z.string().uuid().parse(req.params.userId);
      const parsed = adminRemoveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          data: null,
          error: { code: 'WALLPAPER_INVALID_REQUEST', message: '请填写移除原因。' },
        });
        return;
      }
      await playerWallpaperService.adminRemove(userId, req.user!.id, parsed.data.reason);
      res.json({ data: { removed: true }, error: null });
    } catch (error) {
      respondOrNext(error, res, next);
    }
  }
);

function receiveWallpaperUpload(req: Request, res: Response, next: NextFunction): void {
  receiveWallpaperFiles(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      const isTooLarge = error.code === 'LIMIT_FILE_SIZE';
      res.status(isTooLarge ? 413 : 400).json({
        data: null,
        error: {
          code: isTooLarge ? 'WALLPAPER_FILE_TOO_LARGE' : 'WALLPAPER_INVALID_UPLOAD',
          message: isTooLarge
            ? '图片不能超过 8 MB，请压缩后重新选择。'
            : '壁纸上传字段无效，请重新选择图片。',
        },
      });
      return;
    }
    next(error);
  });
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

function respondOrNext(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof PlayerWallpaperServiceError) {
    if (error.retryAfterMs !== undefined) {
      res.setHeader('Retry-After', Math.ceil(error.retryAfterMs / 1000));
    }
    res.status(error.status).json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
        ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
        ...(error.nextChangeAt !== undefined ? { nextChangeAt: error.nextChangeAt } : {}),
      },
    });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({
      data: null,
      error: { code: 'WALLPAPER_INVALID_REQUEST', message: '壁纸请求无效。' },
    });
    return;
  }
  next(error);
}
