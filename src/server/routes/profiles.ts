import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/require-auth.js';

export const profilesRouter = Router();

// ============================================
// GET /api/profiles/:id
// ============================================

profilesRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
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

profilesRouter.put('/:id', requireAuth, async (req, res, next) => {
  try {
    // Users can only update their own profile (admins can update any)
    if (req.params.id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({
        data: null,
        error: { code: 'FORBIDDEN', message: '无权修改此档案' },
      });
      return;
    }

    const updates = req.body;
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Allowed fields for user self-update (role excluded!)
    const allowedFields = ['display_name', 'avatar_url'];

    // Admin can also update role and username
    if (req.user!.role === 'admin') {
      allowedFields.push('role', 'username');
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

    values.push(req.params.id);
    const { rows } = await pool.query(
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
    next(err);
  }
});
