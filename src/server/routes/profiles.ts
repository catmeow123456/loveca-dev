import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validate } from '../middleware/validate.js';

export const profilesRouter = Router();

const updateProfileSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线')
      .optional(),
    display_name: z.string().trim().min(1).max(50).optional(),
    avatar_url: z.string().trim().url().max(2048).nullable().optional(),
    role: z.enum(['user', 'admin']).optional(),
  })
  .strict();

type UpdateProfileBody = z.infer<typeof updateProfileSchema>;

interface ProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin';
  deck_count: number;
  created_at: Date;
  updated_at?: Date;
}

// ============================================
// GET /api/profiles/:id
// ============================================

profilesRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query<ProfileRow>(
      'SELECT id, username, display_name, avatar_url, role, deck_count, created_at FROM profiles WHERE id = $1',
      [req.params.id]
    );

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '用户不存在' },
      });
      return;
    }

    res.json({ data: rows[0], error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// PUT /api/profiles/:id
// ============================================

profilesRouter.put('/:id', requireAuth, validate(updateProfileSchema), async (req, res, next) => {
  try {
    // Users can only update their own profile (admins can update any)
    if (req.params.id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({
        data: null,
        error: { code: 'FORBIDDEN', message: '无权修改此档案' },
      });
      return;
    }

    const updates = req.body as UpdateProfileBody;
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Allowed fields for user self-update (role excluded!)
    const allowedFields: Array<keyof UpdateProfileBody> = [
      'username',
      'display_name',
      'avatar_url',
    ];

    // Admin can also update role and username
    if (req.user!.role === 'admin') {
      allowedFields.push('role');
    }

    for (const field of allowedFields) {
      if (field in updates) {
        fields.push(`${field} = $${idx}`);
        values.push(updates[field]);
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

    fields.push('updated_at = now()');
    values.push(req.params.id);
    const { rows } = await pool.query<ProfileRow>(
      `UPDATE profiles SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'NOT_FOUND', message: '用户不存在' },
      });
      return;
    }

    res.json({ data: rows[0], error: null });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({
        data: null,
        error: { code: 'USERNAME_TAKEN', message: '用户名已被使用' },
      });
      return;
    }
    next(err);
  }
});

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505';
}
