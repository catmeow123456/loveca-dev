import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { validate } from '../middleware/validate.js';

export const cardsRouter = Router();

// ============================================
// GET /api/cards
// ============================================

cardsRouter.get('/', async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const statusFilter = req.query.status as string | undefined;

    let query: string;
    const params: unknown[] = [];

    if (isAdmin && statusFilter === 'all') {
      query = 'SELECT * FROM cards ORDER BY card_code';
    } else if (isAdmin && statusFilter) {
      query = 'SELECT * FROM cards WHERE status = $1 ORDER BY card_code';
      params.push(statusFilter);
    } else {
      // Non-admin: only PUBLISHED
      query = "SELECT * FROM cards WHERE status = 'PUBLISHED' ORDER BY card_code";
    }

    const { rows } = await pool.query(query, params);
    res.json({ data: rows, total: rows.length, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /api/cards/export
// ============================================

cardsRouter.get('/export', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cards ORDER BY card_code');
    // Transform to camelCase for export
    const exported = rows.map((r) => ({
      cardCode: r.card_code,
      cardType: r.card_type,
      name: r.name,
      groupName: r.group_name,
      unitName: r.unit_name,
      cost: r.cost,
      blade: r.blade,
      hearts: r.hearts,
      bladeHearts: r.blade_hearts,
      score: r.score,
      requirements: r.requirements,
      cardText: r.card_text,
      imageFilename: r.image_filename,
      rare: r.rare,
      product: r.product,
      status: r.status,
    }));
    res.json({ data: exported, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /api/cards/status-map
// ============================================

cardsRouter.get('/status-map', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT card_code, status FROM cards');
    const statusMap: Record<string, string> = {};
    for (const row of rows) {
      statusMap[row.card_code] = row.status;
    }
    res.json({ data: statusMap, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /api/cards/:code
// ============================================

cardsRouter.get('/:code', async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const { rows } = await pool.query(
      'SELECT * FROM cards WHERE card_code = $1',
      [req.params.code]
    );

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '卡牌不存在' },
      });
      return;
    }

    const card = rows[0];
    if (!isAdmin && card.status !== 'PUBLISHED') {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '卡牌不存在' },
      });
      return;
    }

    res.json({ data: card, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/cards
// ============================================

const createCardSchema = z.object({
  card_code: z.string().min(1),
  card_type: z.enum(['MEMBER', 'LIVE', 'ENERGY']),
  name: z.string().min(1),
  group_name: z.string().nullable().optional(),
  unit_name: z.string().nullable().optional(),
  cost: z.number().int().nullable().optional(),
  blade: z.number().int().nullable().optional(),
  hearts: z.any().optional(),
  blade_heart: z.any().optional(),
  blade_hearts: z.any().optional(),
  score: z.number().int().nullable().optional(),
  requirements: z.any().optional(),
  card_text: z.string().nullable().optional(),
  image_filename: z.string().nullable().optional(),
  rare: z.string().nullable().optional(),
  product: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
});

cardsRouter.post('/', requireAuth, requireAdmin, validate(createCardSchema), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await pool.query(
      `INSERT INTO cards (
        card_code, card_type, name, group_name, unit_name,
        cost, blade, hearts, blade_heart, blade_hearts,
        score, requirements, card_text, image_filename,
        rare, product, status, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        b.card_code, b.card_type, b.name, b.group_name ?? null, b.unit_name ?? null,
        b.cost ?? null, b.blade ?? null,
        JSON.stringify(b.hearts ?? []), b.blade_heart ? JSON.stringify(b.blade_heart) : null,
        b.blade_hearts ? JSON.stringify(b.blade_hearts) : null,
        b.score ?? null, JSON.stringify(b.requirements ?? []),
        b.card_text ?? null, b.image_filename ?? null,
        b.rare ?? null, b.product ?? null, b.status ?? 'DRAFT',
        req.user!.id,
      ]
    );
    res.status(201).json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// PUT /api/cards/:code
// ============================================

cardsRouter.put('/:code', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const updates = req.body;
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Dynamically build SET clause from provided fields
    const allowedFields = [
      'card_type', 'name', 'group_name', 'unit_name',
      'cost', 'blade', 'hearts', 'blade_heart', 'blade_hearts',
      'score', 'requirements', 'card_text', 'image_filename',
      'rare', 'product', 'status',
    ];

    for (const field of allowedFields) {
      if (field in updates) {
        const val = updates[field];
        fields.push(`${field} = $${idx}`);
        values.push(
          typeof val === 'object' && val !== null ? JSON.stringify(val) : val
        );
        idx++;
      }
    }

    if (fields.length === 0) {
      res.status(400).json({
        data: null,
        error: { code: 'NO_FIELDS', message: '没有需要更新的字段' },
      });
      return;
    }

    // Add updated_by
    fields.push(`updated_by = $${idx}`);
    values.push(req.user!.id);
    idx++;

    values.push(req.params.code);
    const { rows } = await pool.query(
      `UPDATE cards SET ${fields.join(', ')} WHERE card_code = $${idx} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '卡牌不存在' },
      });
      return;
    }

    res.json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// DELETE /api/cards/:code
// ============================================

cardsRouter.delete('/:code', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM cards WHERE card_code = $1',
      [req.params.code]
    );

    if (rowCount === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '卡牌不存在' },
      });
      return;
    }

    res.json({ data: { message: '已删除' }, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/cards/import
// ============================================

const importSchema = z.object({
  cards: z.array(z.object({
    cardCode: z.string().min(1),
    cardType: z.string().min(1),
    name: z.string().min(1),
    groupName: z.string().nullable().optional(),
    unitName: z.string().nullable().optional(),
    cost: z.number().int().nullable().optional(),
    blade: z.number().int().nullable().optional(),
    hearts: z.any().optional(),
    bladeHearts: z.any().optional(),
    score: z.number().int().nullable().optional(),
    requirements: z.any().optional(),
    cardText: z.string().nullable().optional(),
    imageFilename: z.string().nullable().optional(),
    rare: z.string().nullable().optional(),
    product: z.string().nullable().optional(),
    status: z.string().optional(),
  })),
});

cardsRouter.post('/import', requireAuth, requireAdmin, validate(importSchema), async (req, res, next) => {
  try {
    const { cards } = req.body;
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const card of cards) {
      try {
        await pool.query(
          `INSERT INTO cards (
            card_code, card_type, name, group_name, unit_name,
            cost, blade, hearts, blade_hearts, score, requirements,
            card_text, image_filename, rare, product, status, updated_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT (card_code) DO UPDATE SET
            card_type = EXCLUDED.card_type,
            name = EXCLUDED.name,
            group_name = EXCLUDED.group_name,
            unit_name = EXCLUDED.unit_name,
            cost = EXCLUDED.cost,
            blade = EXCLUDED.blade,
            hearts = EXCLUDED.hearts,
            blade_hearts = EXCLUDED.blade_hearts,
            score = EXCLUDED.score,
            requirements = EXCLUDED.requirements,
            card_text = EXCLUDED.card_text,
            image_filename = EXCLUDED.image_filename,
            rare = EXCLUDED.rare,
            product = EXCLUDED.product,
            status = EXCLUDED.status`,
          [
            card.cardCode, card.cardType, card.name,
            card.groupName ?? null, card.unitName ?? null,
            card.cost ?? null, card.blade ?? null,
            JSON.stringify(card.hearts ?? []),
            card.bladeHearts ? JSON.stringify(card.bladeHearts) : null,
            card.score ?? null, JSON.stringify(card.requirements ?? []),
            card.cardText ?? null, card.imageFilename ?? null,
            card.rare ?? null, card.product ?? null,
            card.status ?? 'DRAFT', req.user!.id,
          ]
        );
        imported++;
      } catch (err) {
        failed++;
        errors.push(`${card.cardCode}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    res.json({
      data: { success: true, imported, failed, errors },
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// PUT /api/cards/:code/publish
// ============================================

cardsRouter.put('/:code/publish', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE cards SET status = 'PUBLISHED', updated_by = $1
       WHERE card_code = $2 RETURNING *`,
      [req.user!.id, req.params.code]
    );

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '卡牌不存在' },
      });
      return;
    }

    res.json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// PUT /api/cards/:code/unpublish
// ============================================

cardsRouter.put('/:code/unpublish', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE cards SET status = 'DRAFT', updated_by = $1
       WHERE card_code = $2 RETURNING *`,
      [req.user!.id, req.params.code]
    );

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '卡牌不存在' },
      });
      return;
    }

    res.json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});
