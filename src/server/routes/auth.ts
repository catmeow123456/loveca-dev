import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { config } from '../config.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  storeRefreshToken,
  findValidRefreshToken,
  deleteRefreshToken,
  deleteAllRefreshTokens,
  createEmailVerificationToken,
  verifyEmailToken,
  createPasswordResetToken,
  verifyPasswordResetToken,
  markPasswordResetTokenUsed,
} from '../services/auth-service.js';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from '../services/mail-service.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

function setRefreshCookie(res: import('express').Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: !config.isDev,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_MAX_AGE,
  });
}

function clearRefreshCookie(res: import('express').Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: !config.isDev,
    sameSite: 'lax',
    path: '/api/auth',
  });
}

// ============================================
// POST /api/auth/register
// ============================================

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email().optional(),
  password: z.string().min(6).max(128),
  displayName: z.string().max(50).optional(),
});

authRouter.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const { username, email, password, displayName } = req.body;

    // Generate placeholder email if not provided
    const userEmail =
      email || `${username}@placeholder.loveca.local`;

    // Check for existing username
    const { rows: existingUsername } = await pool.query(
      'SELECT id FROM profiles WHERE username = $1',
      [username]
    );
    if (existingUsername.length > 0) {
      res.status(409).json({
        data: null,
        error: { code: 'USERNAME_TAKEN', message: '用户名已被使用' },
      });
      return;
    }

    // Check for existing email
    const { rows: existingEmail } = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [userEmail]
    );
    if (existingEmail.length > 0) {
      res.status(409).json({
        data: null,
        error: { code: 'EMAIL_TAKEN', message: '邮箱已被注册' },
      });
      return;
    }

    const passwordHash = await hashPassword(password);

    // Create user + profile in transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query(
        `INSERT INTO users (email, password_hash, email_verified)
         VALUES ($1, $2, $3) RETURNING id`,
        [userEmail, passwordHash, !email || !config.emailEnabled] // Auto-verify if no real email or email disabled
      );
      const userId = userRows[0].id;

      await client.query(
        `INSERT INTO profiles (id, username, display_name)
         VALUES ($1, $2, $3)`,
        [userId, username, displayName || username]
      );

      await client.query('COMMIT');

      // Send verification email if real email provided and email is enabled
      if (email && config.emailEnabled && config.isSmtpConfigured) {
        const token = await createEmailVerificationToken(userId);
        await sendVerificationEmail(email, token);
      }

      res.status(201).json({
        data: {
          id: userId,
          username,
          message: email && config.emailEnabled
            ? '注册成功，请查收验证邮件'
            : '注册成功',
        },
        error: null,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/auth/login
// ============================================

const loginSchema = z.object({
  usernameOrEmail: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { usernameOrEmail, password } = req.body;

    // Find user by username or email
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.email_verified,
              p.username, p.display_name, p.avatar_url, p.role, p.deck_count
       FROM users u
       JOIN profiles p ON u.id = p.id
       WHERE u.email = $1 OR p.username = $1`,
      [usernameOrEmail]
    );

    if (rows.length === 0) {
      res.status(401).json({
        data: null,
        error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' },
      });
      return;
    }

    const user = rows[0];
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      res.status(401).json({
        data: null,
        error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' },
      });
      return;
    }

    // Check email verification (skip if email verification is disabled)
    if (config.emailEnabled && !user.email_verified) {
      res.status(403).json({
        data: null,
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: '请先验证邮箱',
        },
      });
      return;
    }

    // Generate tokens
    const accessToken = signAccessToken(user.id, user.role);
    const refreshToken = generateRefreshToken();
    const refreshHash = await hashRefreshToken(refreshToken);
    await storeRefreshToken(user.id, refreshHash);

    setRefreshCookie(res, `${user.id}:${refreshToken}`);

    res.json({
      data: {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.email_verified,
        },
        profile: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url,
          role: user.role,
          deck_count: user.deck_count,
        },
      },
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/auth/refresh
// ============================================

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const cookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!cookie) {
      res.status(401).json({
        data: null,
        error: { code: 'NO_REFRESH_TOKEN', message: '无刷新令牌' },
      });
      return;
    }

    const separatorIndex = cookie.indexOf(':');
    if (separatorIndex === -1) {
      clearRefreshCookie(res);
      res.status(401).json({
        data: null,
        error: { code: 'INVALID_REFRESH_TOKEN', message: '刷新令牌无效' },
      });
      return;
    }

    const userId = cookie.slice(0, separatorIndex);
    const rawToken = cookie.slice(separatorIndex + 1);

    // Validate the refresh token
    const tokenId = await findValidRefreshToken(userId, rawToken);
    if (!tokenId) {
      clearRefreshCookie(res);
      res.status(401).json({
        data: null,
        error: { code: 'INVALID_REFRESH_TOKEN', message: '刷新令牌无效或已过期' },
      });
      return;
    }

    // Token rotation: delete old, create new
    await deleteRefreshToken(tokenId);

    // Get user profile
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.email_verified,
              p.username, p.display_name, p.avatar_url, p.role, p.deck_count
       FROM users u
       JOIN profiles p ON u.id = p.id
       WHERE u.id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      clearRefreshCookie(res);
      res.status(401).json({
        data: null,
        error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
      });
      return;
    }

    const user = rows[0];
    const accessToken = signAccessToken(user.id, user.role);
    const newRefreshToken = generateRefreshToken();
    const newHash = await hashRefreshToken(newRefreshToken);
    await storeRefreshToken(user.id, newHash);

    setRefreshCookie(res, `${user.id}:${newRefreshToken}`);

    res.json({
      data: {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.email_verified,
        },
        profile: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url,
          role: user.role,
          deck_count: user.deck_count,
        },
      },
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/auth/logout
// ============================================

authRouter.post('/logout', async (req, res, next) => {
  try {
    const cookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (cookie) {
      const separatorIndex = cookie.indexOf(':');
      if (separatorIndex !== -1) {
        const userId = cookie.slice(0, separatorIndex);
        await deleteAllRefreshTokens(userId);
      }
    }
    clearRefreshCookie(res);
    res.json({ data: { message: '已登出' }, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /api/auth/session
// ============================================

authRouter.get('/session', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.email_verified,
              p.username, p.display_name, p.avatar_url, p.role, p.deck_count
       FROM users u
       JOIN profiles p ON u.id = p.id
       WHERE u.id = $1`,
      [req.user!.id]
    );

    if (rows.length === 0) {
      res.status(404).json({
        data: null,
        error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
      });
      return;
    }

    const user = rows[0];
    res.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.email_verified,
        },
        profile: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url,
          role: user.role,
          deck_count: user.deck_count,
        },
      },
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/auth/verify-email
// ============================================

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

authRouter.post('/verify-email', validate(verifyEmailSchema), async (req, res, next) => {
  try {
    const { token } = req.body;
    const result = await verifyEmailToken(token);

    if (!result) {
      res.status(400).json({
        data: null,
        error: { code: 'INVALID_TOKEN', message: '验证链接无效或已过期' },
      });
      return;
    }

    await pool.query(
      'UPDATE users SET email_verified = true WHERE id = $1',
      [result.userId]
    );

    res.json({ data: { message: '邮箱验证成功' }, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/auth/resend-verification
// ============================================

const resendSchema = z.object({
  email: z.string().email(),
});

authRouter.post('/resend-verification', validate(resendSchema), async (req, res, next) => {
  try {
    if (!config.emailEnabled) {
      res.status(403).json({
        data: null,
        error: { code: 'EMAIL_DISABLED', message: '邮箱功能暂不支持' },
      });
      return;
    }

    const { email } = req.body;

    const { rows } = await pool.query(
      `SELECT u.id, u.email_verified FROM users u WHERE u.email = $1`,
      [email]
    );

    if (rows.length === 0 || rows[0].email_verified) {
      // Don't reveal whether the email exists
      res.json({ data: { message: '如果邮箱已注册且未验证，验证邮件已发送' }, error: null });
      return;
    }

    // Check cooldown (60 seconds)
    const { rows: recentTokens } = await pool.query(
      `SELECT id FROM email_verification_tokens
       WHERE user_id = $1 AND created_at > now() - interval '60 seconds'`,
      [rows[0].id]
    );

    if (recentTokens.length > 0) {
      res.status(429).json({
        data: null,
        error: { code: 'RATE_LIMIT', message: '请等待 60 秒后再试' },
      });
      return;
    }

    const token = await createEmailVerificationToken(rows[0].id);
    await sendVerificationEmail(email, token);

    res.json({ data: { message: '验证邮件已发送' }, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/auth/reset-password
// ============================================

const resetPasswordSchema = z.object({
  email: z.string().email(),
});

authRouter.post('/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
  try {
    if (!config.emailEnabled) {
      res.status(403).json({
        data: null,
        error: { code: 'EMAIL_DISABLED', message: '邮箱功能暂不支持，请联系管理员重置密码' },
      });
      return;
    }

    const { email } = req.body;

    const { rows } = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    // Always return success to not reveal email existence
    if (rows.length > 0) {
      const token = await createPasswordResetToken(rows[0].id);
      await sendPasswordResetEmail(email, token);
    }

    res.json({ data: { message: '如果邮箱已注册，重置链接已发送' }, error: null });
  } catch (err) {
    next(err);
  }
});

// ============================================
// PUT /api/auth/password
// ============================================

const updatePasswordSchema = z.union([
  // Reset via token
  z.object({
    token: z.string().min(1),
    newPassword: z.string().min(6).max(128),
  }),
  // Change while logged in
  z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6).max(128),
  }),
]);

authRouter.put('/password', validate(updatePasswordSchema), async (req, res, next) => {
  try {
    const { newPassword } = req.body;

    let userId: string;

    if ('token' in req.body) {
      // Reset via token
      const result = await verifyPasswordResetToken(req.body.token);
      if (!result) {
        res.status(400).json({
          data: null,
          error: { code: 'INVALID_TOKEN', message: '重置链接无效或已过期' },
        });
        return;
      }
      userId = result.userId;
      await markPasswordResetTokenUsed(result.tokenId);
    } else {
      // Change while logged in
      if (!req.user) {
        res.status(401).json({
          data: null,
          error: { code: 'UNAUTHORIZED', message: '未登录' },
        });
        return;
      }
      userId = req.user.id;

      const { rows } = await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
      );
      if (rows.length === 0) {
        res.status(404).json({
          data: null,
          error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
        });
        return;
      }

      const valid = await verifyPassword(req.body.currentPassword, rows[0].password_hash);
      if (!valid) {
        res.status(401).json({
          data: null,
          error: { code: 'INVALID_PASSWORD', message: '当前密码错误' },
        });
        return;
      }
    }

    const newHash = await hashPassword(newPassword);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);

    // Invalidate all refresh tokens
    await deleteAllRefreshTokens(userId);
    clearRefreshCookie(res);

    res.json({ data: { message: '密码修改成功，请重新登录' }, error: null });
  } catch (err) {
    next(err);
  }
});
