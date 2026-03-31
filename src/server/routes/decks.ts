import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validate } from '../middleware/validate.js';
import { scrapeDecklog, extractDecklogId } from '../services/decklog-scraper.js';

export const decksRouter = Router();

const shareForkSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});

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
      'SELECT * FROM decks WHERE is_public = true OR share_enabled = true ORDER BY updated_at DESC'
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
// GET /api/decks/share/:shareId
// ============================================

decksRouter.get('/share/:shareId', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
        d.*,
        p.display_name AS author_display_name,
        p.username AS author_username
      FROM decks d
      JOIN profiles p ON p.id = d.user_id
      WHERE d.share_id = $1 AND d.share_enabled = true
      LIMIT 1`,
      [req.params.shareId]
    );

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '分享卡组不存在或已关闭分享' },
      });
      return;
    }

    res.json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/decks/share/:shareId/fork
// ============================================

decksRouter.post('/share/:shareId/fork', requireAuth, validate(shareForkSchema), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM decks WHERE share_id = $1 AND share_enabled = true LIMIT 1',
      [req.params.shareId]
    );

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '分享卡组不存在或已关闭分享' },
      });
      return;
    }

    const sourceDeck = rows[0];
    const name = req.body.name?.trim() || `${sourceDeck.name} - 副本`;
    const description = req.body.description ?? sourceDeck.description ?? null;

    const { rows: created } = await pool.query(
      `INSERT INTO decks (
        user_id, name, description, main_deck, energy_deck, is_valid, validation_errors,
        is_public, share_enabled, forked_from_deck_id, forked_from_share_id, forked_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, $8, $9, now())
      RETURNING *`,
      [
        req.user!.id,
        name,
        description,
        JSON.stringify(sourceDeck.main_deck),
        JSON.stringify(sourceDeck.energy_deck),
        sourceDeck.is_valid,
        JSON.stringify(sourceDeck.validation_errors ?? []),
        sourceDeck.id,
        sourceDeck.share_id,
      ]
    );

    res.status(201).json({ data: created[0], error: null });
  } catch (err) {
    next(err);
  }
});

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
    // Allow access if owner, admin, or public/shared deck
    if (deck.user_id !== req.user!.id && req.user!.role !== 'admin' && !deck.is_public && !deck.share_enabled) {
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
    const shareEnabled = Boolean(b.is_public);
    const { rows } = await pool.query(
      `INSERT INTO decks (
        user_id, name, description, main_deck, energy_deck, is_valid, validation_errors,
        is_public, share_enabled, shared_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        shareEnabled,
        shareEnabled ? new Date().toISOString() : null,
      ]
    );
    res.status(201).json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/decks/:id/share
// ============================================

decksRouter.post('/:id/share', requireAuth, async (req, res, next) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM decks WHERE id = $1', [req.params.id]);

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
        error: { code: 'FORBIDDEN', message: '无权分享此卡组' },
      });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE decks
       SET
         share_id = COALESCE(share_id, gen_random_uuid()),
         share_enabled = true,
         is_public = true,
         shared_at = COALESCE(shared_at, now())
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    res.json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// DELETE /api/decks/:id/share
// ============================================

decksRouter.delete('/:id/share', requireAuth, async (req, res, next) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM decks WHERE id = $1', [req.params.id]);

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
        error: { code: 'FORBIDDEN', message: '无权关闭分享' },
      });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE decks
       SET
         share_enabled = false,
         is_public = false
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    res.json({ data: rows[0], error: null });
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

        if (field === 'is_public') {
          fields.push(`share_enabled = $${idx}`);
          values.push(Boolean(val));
          idx++;
          if (val) {
            fields.push(`shared_at = COALESCE(shared_at, now())`);
          }
        }
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
