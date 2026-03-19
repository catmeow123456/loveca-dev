import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validate } from '../middleware/validate.js';
import { scrapeDecklog, extractDecklogId } from '../services/decklog-scraper.js';

export const decksRouter = Router();

// ============================================
// GET /api/decks
// ============================================

decksRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM decks WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user!.id]
    );
    res.json({ data: rows, total: rows.length, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /api/decks/public
// ============================================

decksRouter.get('/public', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM decks WHERE is_public = true ORDER BY updated_at DESC'
    );
    res.json({ data: rows, total: rows.length, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/decks/scrape-decklog
// ============================================

const scrapeDecklogSchema = z.object({
  deck_id: z.string().min(1),
});

decksRouter.post(
  '/scrape-decklog',
  requireAuth,
  validate(scrapeDecklogSchema),
  async (req, res, next) => {
    try {
      const { deck_id: rawInput } = req.body;
      const deckId = extractDecklogId(rawInput);

      if (!deckId) {
        res.status(400).json({
          data: null,
          error: {
            code: 'INVALID_INPUT',
            message: '无效的 DeckLog ID 或 URL',
          },
        });
        return;
      }

      const result = await scrapeDecklog(deckId);

      if (!result.success) {
        res.status(422).json({
          data: null,
          error: {
            code: 'SCRAPE_FAILED',
            message: result.error || '爬取失败',
          },
        });
        return;
      }

      res.json({
        data: {
          cards: result.cards,
          deckName: result.deckName,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================
// GET /api/decks/:id
// ============================================

decksRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM decks WHERE id = $1', [req.params.id]);

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '卡组不存在' },
      });
      return;
    }

    const deck = rows[0];
    // Allow access if owner, admin, or public deck
    if (deck.user_id !== req.user!.id && req.user!.role !== 'admin' && !deck.is_public) {
      res.status(403).json({
        data: null,
        error: { code: 'FORBIDDEN', message: '无权访问此卡组' },
      });
      return;
    }

    res.json({ data: deck, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/decks
// ============================================

const createDeckSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  main_deck: z.array(z.any()).default([]),
  energy_deck: z.array(z.any()).default([]),
  is_valid: z.boolean().default(false),
  validation_errors: z.array(z.any()).default([]),
  is_public: z.boolean().default(false),
});

decksRouter.post('/', requireAuth, validate(createDeckSchema), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await pool.query(
      `INSERT INTO decks (user_id, name, description, main_deck, energy_deck, is_valid, validation_errors, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user!.id,
        b.name,
        b.description ?? null,
        JSON.stringify(b.main_deck),
        JSON.stringify(b.energy_deck),
        b.is_valid,
        JSON.stringify(b.validation_errors),
        b.is_public,
      ]
    );
    res.status(201).json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// PUT /api/decks/:id
// ============================================

decksRouter.put('/:id', requireAuth, async (req, res, next) => {
  try {
    // Verify ownership
    const { rows: existing } = await pool.query('SELECT user_id FROM decks WHERE id = $1', [
      req.params.id,
    ]);

    if (existing.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '卡组不存在' },
      });
      return;
    }

    if (existing[0].user_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({
        data: null,
        error: { code: 'FORBIDDEN', message: '无权修改此卡组' },
      });
      return;
    }

    const updates = req.body;
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const allowedFields = [
      'name',
      'description',
      'main_deck',
      'energy_deck',
      'is_valid',
      'validation_errors',
      'is_public',
    ];

    for (const field of allowedFields) {
      if (field in updates) {
        const val = updates[field];
        fields.push(`${field} = $${idx}`);
        values.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
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

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE decks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// DELETE /api/decks/:id
// ============================================

decksRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows: existing } = await pool.query('SELECT user_id FROM decks WHERE id = $1', [
      req.params.id,
    ]);

    if (existing.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '卡组不存在' },
      });
      return;
    }

    if (existing[0].user_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({
        data: null,
        error: { code: 'FORBIDDEN', message: '无权删除此卡组' },
      });
      return;
    }

    await pool.query('DELETE FROM decks WHERE id = $1', [req.params.id]);

    res.json({ data: { message: '已删除' }, error: null });
  } catch (err) {
    next(err);
  }
});
