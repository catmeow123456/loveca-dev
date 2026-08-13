import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import {
  MatchEmoteCatalogServiceError,
  matchEmoteCatalogService,
} from '../services/match-emote-catalog-service.js';

export const matchEmotesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 2 * 1024 * 1024 },
});

function receiveAsset(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        data: null,
        error: { code: 'MATCH_EMOTE_ASSET_TOO_LARGE', message: '表情源文件必须小于 2 MB' },
      });
      return;
    }
    if (error) {
      respondMatchEmoteError(res, error);
      return;
    }
    next();
  });
}

const catalogInputSchema = z
  .object({
    expectedVersion: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            id: z.string().trim().min(2).max(64),
            label: z.string().trim().min(1).max(80),
            shortLabel: z.string().trim().min(1).max(24),
            sortOrder: z.number().int().min(0).max(11),
            enabled: z.boolean(),
            assetId: z.string().uuid(),
          })
          .strict()
      )
      .min(1)
      .max(12),
  })
  .strict();

matchEmotesRouter.get('/admin/catalog', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const catalog = await matchEmoteCatalogService.getAdminCatalog();
    res.json({ data: catalog, error: null });
  } catch (error) {
    respondMatchEmoteError(res, error);
  }
});

matchEmotesRouter.post('/admin/ids', requireAuth, requireAdmin, (_req, res) => {
  res.status(201).json({ data: { id: matchEmoteCatalogService.createEmoteId() }, error: null });
});

matchEmotesRouter.post(
  '/admin/assets',
  requireAuth,
  requireAdmin,
  receiveAsset,
  async (req, res) => {
    if (!req.file?.buffer) {
      res.status(400).json({
        data: null,
        error: { code: 'MATCH_EMOTE_ASSET_REQUIRED', message: '请选择要上传的表情图片' },
      });
      return;
    }
    try {
      const asset = await matchEmoteCatalogService.uploadAsset(req.file.buffer, req.user!.id);
      res.status(201).json({ data: asset, error: null });
    } catch (error) {
      respondMatchEmoteError(res, error);
    }
  }
);

matchEmotesRouter.put('/admin/catalog', requireAuth, requireAdmin, async (req, res) => {
  const parsed = catalogInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '快捷表情目录参数非法' },
    });
    return;
  }
  try {
    const catalog = await matchEmoteCatalogService.saveCatalog(parsed.data, req.user!.id);
    res.json({ data: catalog, error: null });
  } catch (error) {
    respondMatchEmoteError(res, error);
  }
});

function respondMatchEmoteError(res: Response, error: unknown): void {
  if (error instanceof MatchEmoteCatalogServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('[MatchEmotes] Request failed:', error);
  res.status(500).json({
    data: null,
    error: { code: 'MATCH_EMOTE_INTERNAL_ERROR', message: '快捷表情操作失败' },
  });
}
