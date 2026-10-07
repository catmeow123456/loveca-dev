import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import { getObject, statObject } from '../services/minio-service.js';
import { CardImageCatalogService } from '../services/card-image-catalog-service.js';
import type { CardImageCatalogFilters } from '../../shared/game-assets.js';

const pageSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(48),
    query: z.string().trim().max(100).optional(),
    cardType: z.enum(['MEMBER', 'LIVE', 'ENERGY']).optional(),
    cardStatus: z.enum(['DRAFT', 'PUBLISHED']).optional(),
    filename: z.enum(['SET', 'UNSET']).optional(),
  })
  .strict();

const detailSchema = z.object({
  cardCode: z.string().trim().min(1).max(160),
  verifyContent: z.preprocess(
    (value) => (value === undefined ? false : value === 'true' || value === true),
    z.boolean()
  ),
});

export function createCardImageCatalogRouter(
  service = new CardImageCatalogService((sql, values) => pool.query(sql, values), {
    stat: statObject,
    read: getObject,
  })
): Router {
  const router = Router();
  router.use(requireAuth, requirePermission('cards.manage'));

  router.get('/', async (req, res, next) => {
    try {
      const parsed = pageSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues.map((issue) => issue.message).join('; '),
          },
        });
        return;
      }
      const page = await service.list(parsed.data as CardImageCatalogFilters);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: page, error: null });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:cardCode', async (req, res, next) => {
    try {
      const parsed = detailSchema.safeParse({
        cardCode: req.params.cardCode,
        verifyContent: req.query.verifyContent,
      });
      if (!parsed.success) {
        res.status(400).json({
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues.map((issue) => issue.message).join('; '),
          },
        });
        return;
      }
      const detail = await service.detail(parsed.data.cardCode, parsed.data.verifyContent);
      if (!detail) {
        res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: '卡牌不存在' } });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: detail, error: null });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const cardImageCatalogRouter = createCardImageCatalogRouter();
