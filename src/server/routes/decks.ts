import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validate } from '../middleware/validate.js';
import { scrapeDecklog, extractDecklogId } from '../services/decklog-scraper.js';
import {
  DeckPayloadValidationError,
  prepareDeckPayloadForStorage,
} from '../services/deck-storage-service.js';
import { ENERGY_DECK_SIZE, MAX_SAME_CODE_COUNT } from '../../domain/rules/deck-validator.js';

export const decksRouter = Router();

const mainDeckEntrySchema = z.object({
  card_code: z.string().min(1),
  count: z.number().int().positive().max(MAX_SAME_CODE_COUNT),
  card_type: z.enum(['MEMBER', 'LIVE']).optional(),
});

const energyDeckEntrySchema = z.object({
  card_code: z.string().min(1),
  count: z.number().int().positive().max(ENERGY_DECK_SIZE),
});

const shareForkSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});

const createDeckSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  main_deck: z.array(mainDeckEntrySchema).default([]),
  energy_deck: z.array(energyDeckEntrySchema).default([]),
  is_public: z.boolean().default(false),
});

const updateDeckSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  main_deck: z.array(mainDeckEntrySchema).optional(),
  energy_deck: z.array(energyDeckEntrySchema).optional(),
  is_public: z.boolean().optional(),
});

function getDeckPayloadErrorMessage(error: DeckPayloadValidationError): string {
  return error.errors.slice(0, 8).join('; ');
}

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

decksRouter.post(
  '/share/:shareId/fork',
  requireAuth,
  validate(shareForkSchema),
  async (req, res, next) => {
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
      let preparedDeck;

      try {
        preparedDeck = await prepareDeckPayloadForStorage({
          name,
          description,
          main_deck: sourceDeck.main_deck ?? [],
          energy_deck: sourceDeck.energy_deck ?? [],
        });
      } catch (error) {
        if (error instanceof DeckPayloadValidationError) {
          res.status(400).json({
            data: null,
            error: {
              code: 'DECK_PAYLOAD_INVALID',
              message: `分享卡组包含不可用卡牌: ${getDeckPayloadErrorMessage(error)}`,
            },
          });
          return;
        }
        throw error;
      }

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
          JSON.stringify(preparedDeck.main_deck),
          JSON.stringify(preparedDeck.energy_deck),
          preparedDeck.validation.valid,
          JSON.stringify(preparedDeck.validation.errors),
          sourceDeck.id,
          sourceDeck.share_id,
        ]
      );

      res.status(201).json({ data: created[0], error: null });
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
    // Allow access if owner, admin, or public/shared deck
    if (
      deck.user_id !== req.user!.id &&
      req.user!.role !== 'admin' &&
      !deck.is_public &&
      !deck.share_enabled
    ) {
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

decksRouter.post('/', requireAuth, validate(createDeckSchema), async (req, res, next) => {
  try {
    const b = req.body;
    const shareEnabled = Boolean(b.is_public);
    let preparedDeck;

    try {
      preparedDeck = await prepareDeckPayloadForStorage({
        name: b.name,
        description: b.description ?? null,
        main_deck: b.main_deck,
        energy_deck: b.energy_deck,
      });
    } catch (error) {
      if (error instanceof DeckPayloadValidationError) {
        res.status(400).json({
          data: null,
          error: {
            code: 'DECK_PAYLOAD_INVALID',
            message: getDeckPayloadErrorMessage(error),
          },
        });
        return;
      }
      throw error;
    }

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
        JSON.stringify(preparedDeck.main_deck),
        JSON.stringify(preparedDeck.energy_deck),
        preparedDeck.validation.valid,
        JSON.stringify(preparedDeck.validation.errors),
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
    const { rows: existing } = await pool.query('SELECT * FROM decks WHERE id = $1', [
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
    const { rows: existing } = await pool.query('SELECT * FROM decks WHERE id = $1', [
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

decksRouter.put('/:id', requireAuth, validate(updateDeckSchema), async (req, res, next) => {
  try {
    // Verify ownership
    const { rows: existing } = await pool.query(
      'SELECT user_id, name, description, main_deck, energy_deck FROM decks WHERE id = $1',
      [req.params.id]
    );

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

    if ('name' in updates) {
      fields.push(`name = $${idx}`);
      values.push(updates.name);
      idx++;
    }

    if ('description' in updates) {
      fields.push(`description = $${idx}`);
      values.push(updates.description ?? null);
      idx++;
    }

    if ('main_deck' in updates || 'energy_deck' in updates) {
      let preparedDeck;
      try {
        preparedDeck = await prepareDeckPayloadForStorage({
          name: updates.name ?? existing[0].name,
          description: updates.description ?? existing[0].description,
          main_deck: updates.main_deck ?? existing[0].main_deck ?? [],
          energy_deck: updates.energy_deck ?? existing[0].energy_deck ?? [],
        });
      } catch (error) {
        if (error instanceof DeckPayloadValidationError) {
          res.status(400).json({
            data: null,
            error: {
              code: 'DECK_PAYLOAD_INVALID',
              message: getDeckPayloadErrorMessage(error),
            },
          });
          return;
        }
        throw error;
      }

      fields.push(`main_deck = $${idx}`);
      values.push(JSON.stringify(preparedDeck.main_deck));
      idx++;

      fields.push(`energy_deck = $${idx}`);
      values.push(JSON.stringify(preparedDeck.energy_deck));
      idx++;

      fields.push(`is_valid = $${idx}`);
      values.push(preparedDeck.validation.valid);
      idx++;

      fields.push(`validation_errors = $${idx}`);
      values.push(JSON.stringify(preparedDeck.validation.errors));
      idx++;
    }

    if ('is_public' in updates) {
      fields.push(`is_public = $${idx}`);
      values.push(updates.is_public);
      idx++;

      fields.push(`share_enabled = $${idx}`);
      values.push(Boolean(updates.is_public));
      idx++;
      if (updates.is_public) {
        fields.push(`shared_at = COALESCE(shared_at, now())`);
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
