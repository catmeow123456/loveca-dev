import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { uploadObject, deleteObjects, getObject } from '../services/minio-service.js';

export const imagesRouter = Router();
export const publicImagesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const SIZES = ['thumb', 'medium', 'large'] as const;
const READ_FOLDERS = ['thumb', 'medium', 'large', 'static'] as const;
type UploadedFiles = Record<string, Array<{ buffer: Buffer }>>;

function getContentType(fileName: string): string {
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
  if (fileName.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

// ============================================
// GET /images/:folder/:fileName
// ============================================

publicImagesRouter.get('/:folder/:fileName', async (req, res, next) => {
  try {
    const folder = req.params.folder as string;
    const fileName = req.params.fileName as string;

    if (!(READ_FOLDERS as readonly string[]).includes(folder) || fileName.includes('/')) {
      res.status(404).json({
        data: null,
        error: { code: 'IMAGE_NOT_FOUND', message: '图片不存在' },
      });
      return;
    }

    const objectPath = `${folder}/${fileName}`;
    const stream = await getObject(objectPath);

    res.setHeader('Content-Type', getContentType(fileName));
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    stream.on('error', next);
    stream.pipe(res);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'NoSuchKey' || code === 'NotFound') {
      res.status(404).json({
        data: null,
        error: { code: 'IMAGE_NOT_FOUND', message: '图片不存在' },
      });
      return;
    }
    next(err);
  }
});

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
      const files = req.files as UploadedFiles | undefined;

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
