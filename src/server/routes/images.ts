import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { uploadObject, deleteObjects } from '../services/minio-service.js';

export const imagesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const SIZES = ['thumb', 'medium', 'large'] as const;

// ============================================
// POST /api/images/:cardCode
// ============================================

imagesRouter.post(
  '/:cardCode',
  requireAuth,
  requireAdmin,
  upload.fields(SIZES.map((s) => ({ name: s, maxCount: 1 }))),
  async (req, res, next) => {
    try {
      const cardCode = req.params.cardCode as string;
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;

      if (!files) {
        res.status(400).json({
          data: null,
          error: { code: 'NO_FILES', message: '未上传文件' },
        });
        return;
      }

      const encodedCode = encodeURIComponent(cardCode);
      const results: string[] = [];

      for (const size of SIZES) {
        const fileArray = files[size];
        if (fileArray && fileArray.length > 0) {
          const file = fileArray[0];
          const remotePath = `${size}/${encodedCode}.webp`;
          await uploadObject(remotePath, file.buffer, 'image/webp');
          results.push(remotePath);
        }
      }

      res.json({
        data: { success: true, uploaded: results },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================
// DELETE /api/images/:cardCode
// ============================================

imagesRouter.delete('/:cardCode', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const cardCode = req.params.cardCode as string;
    const encodedCode = encodeURIComponent(cardCode);
    const paths = SIZES.map((s) => `${s}/${encodedCode}.webp`);

    await deleteObjects(paths);

    res.json({ data: { message: '已删除' }, error: null });
  } catch (err) {
    next(err);
  }
});
