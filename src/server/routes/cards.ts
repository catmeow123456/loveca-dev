import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { validate } from '../middleware/validate.js';
import { inheritMissingBladeHeartsByBase } from '../../domain/card-data/blade-heart-inheritance.js';

export const cardsRouter = Router();

function hasLanguageName(value: { name_jp?: string | null; name_cn?: string | null }): boolean {
  return Boolean(value.name_jp?.trim() || value.name_cn?.trim());
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveNextName(
  updates: UpdateCardInput,
  field: 'name_jp' | 'name_cn',
  existingValue: string | null
): string | null {
  if (field in updates) {
    return normalizeOptionalText(updates[field]) ?? null;
  }
  return normalizeOptionalText(existingValue) ?? null;
}

interface CardRouteRecord {
  readonly [key: string]: unknown;
  readonly card_code: string;
  readonly card_type: string;
  readonly name_jp?: string | null;
  readonly name_cn?: string | null;
  readonly work_names?: string[] | null;
  readonly group_names?: string[] | null;
  readonly unit_name?: string | null;
  readonly unit_name_raw?: string | null;
  readonly blade_hearts?: Array<{ effect: string; heartColor?: string; value?: number }> | null;
  readonly card_text_jp?: string | null;
  readonly card_text_cn?: string | null;
  readonly image_filename?: string | null;
  readonly image_source_uri?: string | null;
  readonly product?: string | null;
  readonly product_code?: string | null;
  readonly source_external_id?: string | null;
  readonly source_flags?: Record<string, unknown> | null;
  readonly status?: string;
}

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

    const { rows } = await pool.query<CardRouteRecord>(query, params);
    const cards = inheritMissingBladeHeartsByBase(rows);
    res.json({ data: cards, total: cards.length, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /api/cards/export
// ============================================

cardsRouter.get('/export', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query<CardRouteRecord>('SELECT * FROM cards ORDER BY card_code');
    const cards = inheritMissingBladeHeartsByBase(rows);
    // Transform to camelCase for export
    const exported = cards.map((r) => ({
      cardCode: r.card_code,
      cardType: r.card_type,
      nameJp: r.name_jp,
      nameCn: r.name_cn,
      workNames: r.work_names,
      groupNames: r.group_names,
      unitName: r.unit_name,
      unitNameRaw: r.unit_name_raw,
      cost: r.cost,
      blade: r.blade,
      hearts: r.hearts,
      bladeHearts: r.blade_hearts,
      score: r.score,
      requirements: r.requirements,
      cardTextJp: r.card_text_jp,
      cardTextCn: r.card_text_cn,
      imageFilename: r.image_filename,
      imageSourceUri: r.image_source_uri,
      rare: r.rare,
      product: r.product,
      productCode: r.product_code,
      sourceExternalId: r.source_external_id,
      sourceFlags: r.source_flags,
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
    const { rows } = await pool.query<CardRouteRecord>('SELECT * FROM cards WHERE card_code = $1', [
      req.params.code,
    ]);

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

    const inheritanceQuery = isAdmin
      ? 'SELECT * FROM cards WHERE card_type = $1 ORDER BY card_code'
      : "SELECT * FROM cards WHERE card_type = $1 AND status = 'PUBLISHED' ORDER BY card_code";
    const { rows: sameTypeRows } = await pool.query<CardRouteRecord>(inheritanceQuery, [
      card.card_type,
    ]);
    const inheritedCard =
      inheritMissingBladeHeartsByBase(sameTypeRows).find(
        (row) => row.card_code === card.card_code
      ) ?? card;

    res.json({ data: inheritedCard, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/cards
// ============================================

const cardInputSchema = z.object({
  card_code: z.string().min(1),
  card_type: z.enum(['MEMBER', 'LIVE', 'ENERGY']),
  name_jp: z.string().nullable().optional(),
  name_cn: z.string().nullable().optional(),
  work_names: z.array(z.string()).nullable().optional(),
  group_names: z.array(z.string()).nullable().optional(),
  unit_name: z.string().nullable().optional(),
  unit_name_raw: z.string().nullable().optional(),
  cost: z.number().int().nullable().optional(),
  blade: z.number().int().nullable().optional(),
  hearts: z.unknown().optional(),
  blade_hearts: z.unknown().optional(),
  score: z.number().int().nullable().optional(),
  requirements: z.unknown().optional(),
  card_text_jp: z.string().nullable().optional(),
  card_text_cn: z.string().nullable().optional(),
  image_filename: z.string().nullable().optional(),
  image_source_uri: z.string().nullable().optional(),
  rare: z.string().nullable().optional(),
  product: z.string().nullable().optional(),
  product_code: z.string().nullable().optional(),
  source_external_id: z.string().nullable().optional(),
  source_flags: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
});

const createCardSchema = cardInputSchema.refine(hasLanguageName, {
  message: 'name_jp 或 name_cn 至少需要一个',
  path: ['name_cn'],
});

const updateCardSchema = cardInputSchema.omit({ card_code: true }).partial();

type CreateCardInput = z.infer<typeof createCardSchema>;
type UpdateCardInput = z.infer<typeof updateCardSchema>;

cardsRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  validate(createCardSchema),
  async (req, res, next) => {
    try {
      const b = req.body as CreateCardInput;
      const { rows } = await pool.query(
        `INSERT INTO cards (
        card_code, card_type, name_jp, name_cn,
        work_names, group_names, unit_name, unit_name_raw,
        cost, blade, hearts, blade_hearts,
        score, requirements, image_filename,
        card_text_jp, card_text_cn, image_source_uri,
        rare, product, product_code, source_external_id, source_flags, status, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING *`,
        [
          b.card_code,
          b.card_type,
          b.name_jp ?? null,
          b.name_cn ?? null,
          b.work_names == null ? null : JSON.stringify(b.work_names),
          b.group_names == null ? null : JSON.stringify(b.group_names),
          b.unit_name ?? null,
          b.unit_name_raw ?? null,
          b.cost ?? null,
          b.blade ?? null,
          JSON.stringify(b.hearts ?? []),
          b.blade_hearts == null ? null : JSON.stringify(b.blade_hearts),
          b.score ?? null,
          JSON.stringify(b.requirements ?? []),
          b.image_filename ?? null,
          b.card_text_jp ?? null,
          b.card_text_cn ?? null,
          b.image_source_uri ?? null,
          b.rare ?? null,
          b.product ?? null,
          b.product_code ?? null,
          b.source_external_id ?? null,
          b.source_flags == null ? null : JSON.stringify(b.source_flags),
          b.status ?? 'DRAFT',
          req.user!.id,
        ]
      );
      res.status(201).json({ data: rows[0], error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================
// PUT /api/cards/:code
// ============================================

cardsRouter.put(
  '/:code',
  requireAuth,
  requireAdmin,
  validate(updateCardSchema),
  async (req, res, next) => {
    try {
      const updates = req.body as UpdateCardInput;
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      // Dynamically build SET clause from provided fields
      const allowedFields: Array<keyof UpdateCardInput> = [
        'card_type',
        'name_jp',
        'name_cn',
        'work_names',
        'group_names',
        'unit_name',
        'unit_name_raw',
        'cost',
        'blade',
        'hearts',
        'blade_hearts',
        'score',
        'requirements',
        'card_text_jp',
        'card_text_cn',
        'image_filename',
        'image_source_uri',
        'rare',
        'product',
        'product_code',
        'source_external_id',
        'source_flags',
        'status',
      ];

      for (const field of allowedFields) {
        if (field in updates) {
          const rawVal = updates[field];
          const val =
            field === 'name_jp' || field === 'name_cn'
              ? normalizeOptionalText(rawVal as string | null | undefined)
              : rawVal;
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

      if ('name_jp' in updates || 'name_cn' in updates) {
        const { rows: existingNameRows } = await pool.query<{
          name_jp: string | null;
          name_cn: string | null;
        }>('SELECT name_jp, name_cn FROM cards WHERE card_code = $1', [req.params.code]);

        if (existingNameRows.length === 0) {
          res.status(404).json({
            data: null,
            error: { code: 'NOT_FOUND', message: '卡牌不存在' },
          });
          return;
        }

        const existingNames = existingNameRows[0];
        const nextNameJp = resolveNextName(updates, 'name_jp', existingNames.name_jp);
        const nextNameCn = resolveNextName(updates, 'name_cn', existingNames.name_cn);

        if (!hasLanguageName({ name_jp: nextNameJp, name_cn: nextNameCn })) {
          res.status(400).json({
            data: null,
            error: { code: 'VALIDATION_ERROR', message: 'name_jp 或 name_cn 至少需要一个' },
          });
          return;
        }
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
  }
);

// ============================================
// DELETE /api/cards/:code
// ============================================

cardsRouter.delete('/:code', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM cards WHERE card_code = $1', [
      req.params.code,
    ]);

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
  cards: z.array(
    z
      .object({
        cardCode: z.string().min(1),
        cardType: z.string().min(1),
        nameJp: z.string().nullable().optional(),
        nameCn: z.string().nullable().optional(),
        workNames: z.array(z.string()).nullable().optional(),
        groupNames: z.array(z.string()).nullable().optional(),
        unitName: z.string().nullable().optional(),
        unitNameRaw: z.string().nullable().optional(),
        cost: z.number().int().nullable().optional(),
        blade: z.number().int().nullable().optional(),
        hearts: z.unknown().optional(),
        bladeHearts: z.unknown().optional(),
        score: z.number().int().nullable().optional(),
        requirements: z.unknown().optional(),
        cardTextJp: z.string().nullable().optional(),
        cardTextCn: z.string().nullable().optional(),
        imageFilename: z.string().nullable().optional(),
        imageSourceUri: z.string().nullable().optional(),
        rare: z.string().nullable().optional(),
        product: z.string().nullable().optional(),
        productCode: z.string().nullable().optional(),
        sourceExternalId: z.string().nullable().optional(),
        sourceFlags: z.record(z.string(), z.unknown()).nullable().optional(),
        status: z.string().optional(),
      })
      .refine((value) => Boolean(value.nameJp?.trim() || value.nameCn?.trim()), {
        message: 'nameJp 或 nameCn 至少需要一个',
        path: ['nameCn'],
      })
  ),
});

cardsRouter.post(
  '/import',
  requireAuth,
  requireAdmin,
  validate(importSchema),
  async (req, res, next) => {
    try {
      const { cards } = req.body;
      let imported = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const card of cards) {
        try {
          await pool.query(
            `INSERT INTO cards (
            card_code, card_type, name_jp, name_cn,
            work_names, group_names, unit_name, unit_name_raw,
            cost, blade, hearts, blade_hearts, score, requirements,
            card_text_jp, card_text_cn, image_filename, image_source_uri,
            rare, product, product_code, source_external_id, source_flags, status, updated_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
          ON CONFLICT (card_code) DO UPDATE SET
            card_type = EXCLUDED.card_type,
            name_jp = EXCLUDED.name_jp,
            name_cn = EXCLUDED.name_cn,
            work_names = EXCLUDED.work_names,
            group_names = EXCLUDED.group_names,
            unit_name = EXCLUDED.unit_name,
            unit_name_raw = EXCLUDED.unit_name_raw,
            cost = EXCLUDED.cost,
            blade = EXCLUDED.blade,
            hearts = EXCLUDED.hearts,
            blade_hearts = EXCLUDED.blade_hearts,
            score = EXCLUDED.score,
            requirements = EXCLUDED.requirements,
            card_text_jp = EXCLUDED.card_text_jp,
            card_text_cn = EXCLUDED.card_text_cn,
            image_filename = EXCLUDED.image_filename,
            image_source_uri = EXCLUDED.image_source_uri,
            rare = EXCLUDED.rare,
            product = EXCLUDED.product,
            product_code = EXCLUDED.product_code,
            source_external_id = EXCLUDED.source_external_id,
            source_flags = EXCLUDED.source_flags,
            status = EXCLUDED.status`,
            [
              card.cardCode,
              card.cardType,
              card.nameJp ?? null,
              card.nameCn ?? null,
              card.workNames == null ? null : JSON.stringify(card.workNames),
              card.groupNames == null ? null : JSON.stringify(card.groupNames),
              card.unitName ?? null,
              card.unitNameRaw ?? null,
              card.cost ?? null,
              card.blade ?? null,
              JSON.stringify(card.hearts ?? []),
              card.bladeHearts ? JSON.stringify(card.bladeHearts) : null,
              card.score ?? null,
              JSON.stringify(card.requirements ?? []),
              card.cardTextJp ?? null,
              card.cardTextCn ?? null,
              card.imageFilename ?? null,
              card.imageSourceUri ?? null,
              card.rare ?? null,
              card.product ?? null,
              card.productCode ?? null,
              card.sourceExternalId ?? null,
              card.sourceFlags == null ? null : JSON.stringify(card.sourceFlags),
              card.status ?? 'DRAFT',
              req.user!.id,
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
  }
);

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
