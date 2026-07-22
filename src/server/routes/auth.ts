import { Router, type Request } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import {
  bodyIdentityKey,
  createAuthRateLimitMiddleware,
  requestIpKey,
} from '../middleware/auth-rate-limit.js';
import { config } from '../config.js';
import {
  DUMMY_PASSWORD_HASH,
  createEmailVerificationToken,
  createPasswordResetToken,
  deleteAllRefreshTokens,
  hashPassword,
  isLegacyCompatiblePasswordHash,
  issueRefreshToken,
  resetPasswordWithToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  updatePasswordAndInvalidateSessions,
  verifyEmailToken,
  verifyPassword,
} from '../services/auth-service.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../services/mail-service.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_MAX_AGE = config.jwtRefreshExpiresInDays * 24 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const AUTH_EMAIL_RESPONSE_FLOOR_MS = config.isDev ? 0 : 250;

const passwordSchema = z.string().min(6).max(128);
const emailSchema = z.string().trim().toLowerCase().email().max(254);

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/),
  email: emailSchema.optional(),
  password: passwordSchema,
  displayName: z.string().trim().max(50).optional(),
});

const loginSchema = z.object({
  usernameOrEmail: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

const verifyEmailSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i),
});

const resendSchema = z.object({
  email: emailSchema,
});

const resetPasswordSchema = z.object({
  email: emailSchema,
});

const updatePasswordSchema = z.union([
  z
    .object({
      token: z
        .string()
        .trim()
        .regex(/^[a-f0-9]{64}$/i),
      newPassword: passwordSchema,
    })
    .strict(),
  z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict(),
]);

type RegisterBody = z.infer<typeof registerSchema>;
type LoginBody = z.infer<typeof loginSchema>;
type VerifyEmailBody = z.infer<typeof verifyEmailSchema>;
type ResendBody = z.infer<typeof resendSchema>;
type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
type UpdatePasswordBody = z.infer<typeof updatePasswordSchema>;

interface UserIdRow {
  id: string;
}

interface EmailUserRow {
  id: string;
  email_verified: boolean;
}

interface PasswordRow {
  password_hash: string;
}

interface AuthSessionRow {
  id: string;
  email: string;
  password_hash?: string;
  email_verified: boolean;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin';
  deck_count: number;
}

interface ParsedRefreshCookie {
  tokenId: string;
  rawToken: string;
}

const registerRateLimit = createAuthRateLimitMiddleware([
  { id: 'register-ip', limit: 5, windowMs: ONE_HOUR, key: requestIpKey },
]);
const loginRateLimit = createAuthRateLimitMiddleware([
  { id: 'login-ip', limit: 50, windowMs: TEN_MINUTES, key: requestIpKey },
  {
    id: 'login-identity',
    limit: 10,
    windowMs: TEN_MINUTES,
    key: bodyIdentityKey('usernameOrEmail'),
  },
]);
const refreshRateLimit = createAuthRateLimitMiddleware([
  { id: 'refresh-ip', limit: 120, windowMs: TEN_MINUTES, key: requestIpKey },
]);
const verifyRateLimit = createAuthRateLimitMiddleware([
  { id: 'verify-ip', limit: 30, windowMs: TEN_MINUTES, key: requestIpKey },
  { id: 'verify-token', limit: 5, windowMs: ONE_HOUR, key: bodyIdentityKey('token') },
]);
const resendRateLimit = createAuthRateLimitMiddleware([
  { id: 'resend-ip', limit: 20, windowMs: ONE_HOUR, key: requestIpKey },
  { id: 'resend-email', limit: 3, windowMs: ONE_HOUR, key: bodyIdentityKey('email') },
]);
const passwordResetRequestRateLimit = createAuthRateLimitMiddleware([
  { id: 'reset-request-ip', limit: 20, windowMs: ONE_HOUR, key: requestIpKey },
  { id: 'reset-request-email', limit: 3, windowMs: ONE_HOUR, key: bodyIdentityKey('email') },
]);
const passwordUpdateRateLimit = createAuthRateLimitMiddleware([
  { id: 'password-update-ip', limit: 20, windowMs: ONE_HOUR, key: requestIpKey },
  {
    id: 'password-update-subject',
    limit: 5,
    windowMs: ONE_HOUR,
    key: (req) => bodyIdentityKey('token')(req) ?? req.user?.id ?? null,
  },
]);

authRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// ============================================
// POST /api/auth/register
// ============================================

authRouter.post(
  '/register',
  validate(registerSchema),
  registerRateLimit,
  async (req, res, next) => {
    try {
      const { username, email, password, displayName } = req.body as RegisterBody;

      if (config.isEmailVerificationRequired && !email) {
        res.status(400).json({
          data: null,
          error: { code: 'EMAIL_REQUIRED', message: '当前部署要求填写并验证邮箱' },
        });
        return;
      }
      if (config.isEmailVerificationRequired && !config.isEmailFeatureEnabled) {
        res.status(503).json({
          data: null,
          error: { code: 'EMAIL_UNAVAILABLE', message: '邮箱服务暂不可用，请稍后再试' },
        });
        return;
      }

      const userEmail = email ?? `${username.toLowerCase()}@placeholder.loveca.local`;
      const passwordHash = await hashPassword(password);
      const client = await pool.connect();
      let userId: string;

      try {
        await client.query('BEGIN');
        const existingUsername = await client.query<UserIdRow>(
          'SELECT id FROM profiles WHERE username = $1',
          [username]
        );
        if (existingUsername.rowCount) {
          await client.query('ROLLBACK');
          res.status(409).json({
            data: null,
            error: { code: 'USERNAME_TAKEN', message: '用户名已被使用' },
          });
          return;
        }

        const existingEmail = await client.query<UserIdRow>(
          'SELECT id FROM users WHERE lower(email) = lower($1)',
          [userEmail]
        );
        if (existingEmail.rowCount) {
          await client.query('ROLLBACK');
          res.status(409).json({
            data: null,
            error: { code: 'EMAIL_TAKEN', message: '邮箱已被注册' },
          });
          return;
        }

        const userRows = await client.query<UserIdRow>(
          `INSERT INTO users (email, password_hash, email_verified)
         VALUES ($1, $2, $3) RETURNING id`,
          [userEmail, passwordHash, !config.isEmailVerificationRequired]
        );
        const createdUser = userRows.rows[0];
        if (!createdUser) throw new Error('Failed to create user');
        userId = createdUser.id;

        await client.query(
          `INSERT INTO profiles (id, username, display_name)
         VALUES ($1, $2, $3)`,
          [userId, username, displayName || username]
        );
        await client.query('COMMIT');
      } catch (error) {
        await rollbackQuietly(client);
        if (isUniqueViolation(error)) {
          res.status(409).json({
            data: null,
            error: { code: 'ACCOUNT_TAKEN', message: '用户名或邮箱已被使用' },
          });
          return;
        }
        throw error;
      } finally {
        client.release();
      }

      let verificationEmailSent = false;
      if (email && config.isEmailFeatureEnabled) {
        try {
          const token = await createEmailVerificationToken(userId);
          verificationEmailSent = await sendVerificationEmail(email, token);
        } catch (error) {
          console.error('Failed to send registration verification email:', error);
        }
      }

      const needsVerification = config.isEmailVerificationRequired;
      res.status(201).json({
        data: {
          id: userId,
          username,
          verificationRequired: needsVerification,
          verificationEmailSent,
          message: needsVerification
            ? verificationEmailSent
              ? '注册成功，请查收验证邮件'
              : '账号已创建，但验证邮件发送失败，请稍后重新发送'
            : '注册成功',
        },
        error: null,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/auth/login
// ============================================

authRouter.post('/login', validate(loginSchema), loginRateLimit, async (req, res, next) => {
  try {
    const { usernameOrEmail, password } = req.body as LoginBody;
    const result = await pool.query<AuthSessionRow>(
      `SELECT u.id, u.email, u.password_hash, u.email_verified,
              p.username, p.display_name, p.avatar_url, p.role, p.deck_count
       FROM users u
       JOIN profiles p ON u.id = p.id
       WHERE lower(u.email) = lower($1) OR p.username = $1`,
      [usernameOrEmail]
    );

    const user = result.rows[0];
    if (!user) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      respondInvalidCredentials(res);
      return;
    }

    const storedPasswordHash = user.password_hash ?? '';
    const passwordValid = await verifyPassword(password, storedPasswordHash);
    if (!passwordValid) {
      respondInvalidCredentials(res);
      return;
    }

    if (config.isEmailVerificationRequired && !user.email_verified) {
      res.status(403).json({
        data: null,
        error: { code: 'EMAIL_NOT_VERIFIED', message: '请先验证邮箱' },
      });
      return;
    }

    if (isLegacyCompatiblePasswordHash(storedPasswordHash)) {
      const upgradedPasswordHash = await hashPassword(password);
      const upgraded = await updatePasswordAndInvalidateSessions(
        user.id,
        storedPasswordHash,
        upgradedPasswordHash
      );
      if (!upgraded) {
        respondInvalidCredentials(res);
        return;
      }
    }

    const issuedRefreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(res, issuedRefreshToken);
    respondWithSession(res, user);
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/auth/refresh
// ============================================

authRouter.post('/refresh', refreshRateLimit, async (req, res, next) => {
  try {
    const parsedCookie = parseRefreshCookie(readCookie(req, REFRESH_COOKIE));
    if (!parsedCookie) {
      clearRefreshCookie(res);
      res.status(401).json({
        data: null,
        error: { code: 'NO_REFRESH_TOKEN', message: '无有效刷新令牌' },
      });
      return;
    }

    const rotated = await rotateRefreshToken(parsedCookie.tokenId, parsedCookie.rawToken);
    if (!rotated) {
      // Do not clear a well-formed cookie here. A concurrent tab may already have
      // replaced it with a freshly rotated token while this request was in flight.
      res.status(401).json({
        data: null,
        error: { code: 'INVALID_REFRESH_TOKEN', message: '刷新令牌无效或已过期' },
      });
      return;
    }

    const result = await pool.query<AuthSessionRow>(
      `SELECT u.id, u.email, u.email_verified,
              p.username, p.display_name, p.avatar_url, p.role, p.deck_count
       FROM users u
       JOIN profiles p ON u.id = p.id
       WHERE u.id = $1`,
      [rotated.userId]
    );
    const user = result.rows[0];

    if (!user || (config.isEmailVerificationRequired && !user.email_verified)) {
      await deleteAllRefreshTokens(rotated.userId);
      clearRefreshCookie(res);
      res.status(user ? 403 : 401).json({
        data: null,
        error: user
          ? { code: 'EMAIL_NOT_VERIFIED', message: '请先验证邮箱' }
          : { code: 'USER_NOT_FOUND', message: '用户不存在' },
      });
      return;
    }

    setRefreshCookie(res, rotated);
    respondWithSession(res, user);
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/auth/logout
// ============================================

authRouter.post(
  '/logout',
  (_req, res, next) => {
    // Clearing the browser credential must not depend on the best-effort server-side
    // revocation path. A saturated IP limiter must not make the client restore the
    // same session after the user explicitly signs out.
    clearRefreshCookie(res);
    next();
  },
  refreshRateLimit,
  async (req, res, next) => {
    try {
      const parsedCookie = parseRefreshCookie(readCookie(req, REFRESH_COOKIE));
      if (parsedCookie) {
        await revokeRefreshToken(parsedCookie.tokenId, parsedCookie.rawToken);
      }
      res.json({ data: { message: '已登出当前设备' }, error: null });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/auth/session
// ============================================

authRouter.get('/session', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query<AuthSessionRow>(
      `SELECT u.id, u.email, u.email_verified,
              p.username, p.display_name, p.avatar_url, p.role, p.deck_count
       FROM users u
       JOIN profiles p ON u.id = p.id
       WHERE u.id = $1`,
      [req.user!.id]
    );
    const user = result.rows[0];
    if (!user) {
      res.status(404).json({
        data: null,
        error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
      });
      return;
    }
    respondWithSession(res, user, false);
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/auth/verify-email
// ============================================

authRouter.post(
  '/verify-email',
  validate(verifyEmailSchema),
  verifyRateLimit,
  async (req, res, next) => {
    try {
      const { token } = req.body as VerifyEmailBody;
      const result = await verifyEmailToken(token);
      if (!result) {
        res.status(400).json({
          data: null,
          error: { code: 'INVALID_TOKEN', message: '验证链接无效或已过期' },
        });
        return;
      }
      res.json({ data: { message: '邮箱验证成功' }, error: null });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/auth/resend-verification
// ============================================

authRouter.post(
  '/resend-verification',
  validate(resendSchema),
  resendRateLimit,
  async (req, res, next) => {
    const startedAt = Date.now();
    try {
      if (!config.isEmailFeatureEnabled) {
        res.status(403).json({
          data: null,
          error: { code: 'EMAIL_DISABLED', message: '邮箱功能暂不支持' },
        });
        return;
      }

      const { email } = req.body as ResendBody;
      const result = await pool.query<EmailUserRow>(
        'SELECT id, email_verified FROM users WHERE lower(email) = lower($1)',
        [email]
      );
      const user = result.rows[0];
      if (user && !user.email_verified) {
        const token = await createEmailVerificationToken(user.id);
        queueAuthEmail('verification', () => sendVerificationEmail(email, token));
      }

      await waitForAuthEmailResponseFloor(startedAt);
      respondWithGenericEmailMessage(res, '如果邮箱已注册且未验证，验证邮件将会发送');
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/auth/reset-password
// ============================================

authRouter.post(
  '/reset-password',
  validate(resetPasswordSchema),
  passwordResetRequestRateLimit,
  async (req, res, next) => {
    const startedAt = Date.now();
    try {
      if (!config.isEmailFeatureEnabled) {
        res.status(403).json({
          data: null,
          error: { code: 'EMAIL_DISABLED', message: '邮箱功能暂不支持，请联系管理员重置密码' },
        });
        return;
      }

      const { email } = req.body as ResetPasswordBody;
      const result = await pool.query<UserIdRow>(
        'SELECT id FROM users WHERE lower(email) = lower($1)',
        [email]
      );
      const user = result.rows[0];
      if (user) {
        const token = await createPasswordResetToken(user.id);
        queueAuthEmail('password reset', () => sendPasswordResetEmail(email, token));
      }

      await waitForAuthEmailResponseFloor(startedAt);
      respondWithGenericEmailMessage(res, '如果邮箱已注册，重置链接将会发送');
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PUT /api/auth/password
// ============================================

authRouter.put(
  '/password',
  validate(updatePasswordSchema),
  passwordUpdateRateLimit,
  async (req, res, next) => {
    try {
      const body = req.body as UpdatePasswordBody;

      if ('token' in body) {
        const newHash = await hashPassword(body.newPassword);
        const result = await resetPasswordWithToken(body.token, newHash);
        if (!result) {
          res.status(400).json({
            data: null,
            error: { code: 'INVALID_TOKEN', message: '重置链接无效或已过期' },
          });
          return;
        }
      } else {
        if (!req.user) {
          res.status(401).json({
            data: null,
            error: { code: 'UNAUTHORIZED', message: '未登录' },
          });
          return;
        }

        const current = await pool.query<PasswordRow>(
          'SELECT password_hash FROM users WHERE id = $1',
          [req.user.id]
        );
        const passwordRow = current.rows[0];
        if (!passwordRow) {
          res.status(404).json({
            data: null,
            error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
          });
          return;
        }

        const valid = await verifyPassword(body.currentPassword, passwordRow.password_hash);
        if (!valid) {
          res.status(401).json({
            data: null,
            error: { code: 'INVALID_PASSWORD', message: '当前密码错误' },
          });
          return;
        }

        const newHash = await hashPassword(body.newPassword);
        const updated = await updatePasswordAndInvalidateSessions(
          req.user.id,
          passwordRow.password_hash,
          newHash
        );
        if (!updated) {
          res.status(401).json({
            data: null,
            error: { code: 'INVALID_PASSWORD', message: '当前密码已变化，请重新登录后重试' },
          });
          return;
        }
      }

      clearRefreshCookie(res);
      res.json({ data: { message: '密码修改成功，请重新登录' }, error: null });
    } catch (error) {
      next(error);
    }
  }
);

function setRefreshCookie(
  res: import('express').Response,
  token: { readonly tokenId: string; readonly rawToken: string }
): void {
  res.cookie(REFRESH_COOKIE, `v2:${token.tokenId}:${token.rawToken}`, {
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

function parseRefreshCookie(cookie: string | null): ParsedRefreshCookie | null {
  if (!cookie) return null;
  const parts = cookie.split(':');

  if (parts.length !== 3 || parts[0] !== 'v2') return null;
  const tokenId = parts[1];
  const rawToken = parts[2];
  if (tokenId && rawToken && isUuid(tokenId) && isRefreshToken(rawToken)) {
    return { tokenId, rawToken };
  }
  return null;
}

function readCookie(req: Request, name: string): string | null {
  const cookies: unknown = req.cookies;
  if (!cookies || typeof cookies !== 'object') return null;
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

function isRefreshToken(value: string): boolean {
  return /^[a-f0-9]{80}$/i.test(value);
}

function respondInvalidCredentials(res: import('express').Response): void {
  res.status(401).json({
    data: null,
    error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' },
  });
}

function respondWithSession(
  res: import('express').Response,
  user: AuthSessionRow,
  includeAccessToken = true
): void {
  res.json({
    data: {
      ...(includeAccessToken ? { accessToken: signAccessToken(user.id, user.role) } : {}),
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
}

function respondWithGenericEmailMessage(res: import('express').Response, message: string): void {
  res.json({ data: { message }, error: null });
}

async function waitForAuthEmailResponseFloor(startedAt: number): Promise<void> {
  const remainingMs = AUTH_EMAIL_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
  if (remainingMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
}

function queueAuthEmail(label: string, send: () => Promise<boolean>): void {
  void send()
    .then((sent) => {
      if (!sent) console.error(`Failed to queue ${label} email: SMTP unavailable`);
    })
    .catch((error: unknown) => {
      console.error(`Failed to send ${label} email:`, error);
    });
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505';
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction error.
  }
}
