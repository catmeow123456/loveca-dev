import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { createUploadRateLimitMiddleware } from '../middleware/upload-rate-limit.js';
import {
  MatchmakingBgmServiceError,
  matchmakingBgmService,
} from '../services/matchmaking-bgm-service.js';

export const matchmakingBgmRouter = Router();

const trackIdSchema = z.string().uuid();
const defaultTracksSchema = z
  .object({ trackIds: z.array(z.string().uuid()) })
  .strict()
  .refine((value) => new Set(value.trackIds).size === value.trackIds.length, {
    message: '默认子集不能包含重复曲目',
  });
const uploadFieldsSchema = z.object({ title: z.string() }).passthrough();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 20 * 1024 * 1024, fields: 1, parts: 3 },
});
const matchmakingBgmUploadRateLimit = createUploadRateLimitMiddleware({
  windowMs: 10 * 60 * 1000,
  userAttemptLimit: 6,
  addressAttemptLimit: 12,
  userByteLimit: 60 * 1024 * 1024,
  addressByteLimit: 120 * 1024 * 1024,
  attemptErrorCode: 'MATCHMAKING_BGM_UPLOAD_RATE_LIMIT',
  byteErrorCode: 'MATCHMAKING_BGM_UPLOAD_BYTE_LIMIT',
  attemptErrorMessage: 'BGM 上传尝试过于频繁，请稍后再试。',
  byteErrorMessage: '短时间内上传的 BGM 总量过大，请稍后再试。',
});

function receiveTrack(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          data: null,
          error: { code: 'MATCHMAKING_BGM_TOO_LARGE', message: 'BGM 文件必须小于 20 MB' },
        });
        return;
      }
      res.status(400).json({
        data: null,
        error: { code: 'MATCHMAKING_BGM_MULTIPART_INVALID', message: 'BGM 上传参数非法' },
      });
      return;
    }
    if (error) {
      respondMatchmakingBgmError(res, error);
      return;
    }
    next();
  });
}

matchmakingBgmRouter.get('/', async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json({ data: { tracks: await matchmakingBgmService.listTracks() }, error: null });
  } catch (error) {
    respondMatchmakingBgmError(res, error);
  }
});

matchmakingBgmRouter.post(
  '/admin',
  requireAuth,
  requireAdmin,
  matchmakingBgmUploadRateLimit.enforceAttemptLimit,
  receiveTrack,
  matchmakingBgmUploadRateLimit.enforceUploadedByteLimit,
  async (req, res) => {
    if (!req.file?.buffer) {
      res.status(400).json({
        data: null,
        error: { code: 'MATCHMAKING_BGM_REQUIRED', message: '请选择要上传的 MP3 文件' },
      });
      return;
    }
    const parsedFields = uploadFieldsSchema.safeParse(req.body as unknown);
    const title = parsedFields.success
      ? parsedFields.data.title
      : titleFromFilename(req.file.originalname);
    try {
      const track = await matchmakingBgmService.uploadTrack({
        file: req.file.buffer,
        title,
        adminUserId: req.user!.id,
      });
      res.status(201).json({ data: track, error: null });
    } catch (error) {
      respondMatchmakingBgmError(res, error);
    }
  }
);

matchmakingBgmRouter.put('/admin/default', requireAuth, requireAdmin, async (req, res) => {
  const parsed = defaultTracksSchema.safeParse(req.body as unknown);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '默认 BGM 子集参数非法' },
    });
    return;
  }
  try {
    const tracks = await matchmakingBgmService.setDefaultTracks(parsed.data.trackIds);
    res.json({ data: { tracks }, error: null });
  } catch (error) {
    respondMatchmakingBgmError(res, error);
  }
});

matchmakingBgmRouter.delete('/admin/:trackId', requireAuth, requireAdmin, async (req, res) => {
  const parsed = trackIdSchema.safeParse(req.params.trackId);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: 'BGM ID 非法' },
    });
    return;
  }
  try {
    await matchmakingBgmService.deleteTrack(parsed.data);
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    respondMatchmakingBgmError(res, error);
  }
});

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/u, '').trim() || '未命名 BGM';
}

function respondMatchmakingBgmError(res: Response, error: unknown): void {
  if (error instanceof MatchmakingBgmServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('[MatchmakingBgm] Request failed:', error);
  res.status(500).json({
    data: null,
    error: { code: 'MATCHMAKING_BGM_INTERNAL_ERROR', message: 'BGM 曲库操作失败' },
  });
}
