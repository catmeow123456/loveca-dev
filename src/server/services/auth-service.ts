import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import {
  CURRENT_PASSWORD_HASH_PREFIX,
  readCurrentBcryptHash,
  readLegacyCompatibleBcryptHash,
} from '../auth-credential-format.js';

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_ISSUER = 'loveca-api';
const ACCESS_TOKEN_AUDIENCE = 'loveca-client';
const DUMMY_BCRYPT_HASH = '$2b$12$0U1fzrkc6tJ15x6Ouq9Yyu7CGkGhQlNatYROfKV38jO1bOW4IXjE2';

export const DUMMY_PASSWORD_HASH = `${CURRENT_PASSWORD_HASH_PREFIX}${DUMMY_BCRYPT_HASH}`;

export interface IssuedRefreshToken {
  readonly tokenId: string;
  readonly rawToken: string;
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  readonly userId: string;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
}

interface IdRow {
  id: string;
}

interface UserIdRow {
  user_id: string;
}

// ============================================
// Password hashing
// ============================================

export async function hashPassword(password: string): Promise<string> {
  const bcryptHash = await bcrypt.hash(preparePasswordForBcrypt(password), SALT_ROUNDS);
  return `${CURRENT_PASSWORD_HASH_PREFIX}${bcryptHash}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const preparedPassword = preparePasswordForBcrypt(password);
  const currentBcryptHash = readCurrentBcryptHash(hash);
  if (currentBcryptHash) {
    return bcrypt.compare(preparedPassword, currentBcryptHash);
  }

  const legacyBcryptHash = readLegacyCompatibleBcryptHash(hash);
  if (legacyBcryptHash) {
    return bcrypt.compare(password, legacyBcryptHash);
  }

  // Unsupported credential states are never accepted. Keep the comparison cost so
  // accounts marked for reset do not create a cheap identity-enumeration oracle.
  await bcrypt.compare(preparedPassword, DUMMY_BCRYPT_HASH);
  return false;
}

export function isLegacyCompatiblePasswordHash(hash: string): boolean {
  return readLegacyCompatibleBcryptHash(hash) !== null;
}

function preparePasswordForBcrypt(password: string): string {
  return crypto
    .createHash('sha256')
    .update('loveca-password-v1\0', 'utf8')
    .update(password, 'utf8')
    .digest('base64url');
}

// ============================================
// JWT
// ============================================

export function signAccessToken(userId: string, role: 'user' | 'admin'): string {
  return jwt.sign({ sub: userId, role }, config.jwtSecret, {
    algorithm: 'HS256',
    audience: ACCESS_TOKEN_AUDIENCE,
    issuer: ACCESS_TOKEN_ISSUER,
    expiresIn: config.jwtAccessExpiresIn,
  });
}

export function verifyAccessToken(token: string): { sub: string; role: 'user' | 'admin' } {
  const payload = jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
    audience: ACCESS_TOKEN_AUDIENCE,
    issuer: ACCESS_TOKEN_ISSUER,
  });
  const role: unknown = typeof payload === 'string' ? undefined : payload.role;

  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    (role !== 'user' && role !== 'admin')
  ) {
    throw new Error('Invalid access token payload');
  }

  return { sub: payload.sub, role };
}

// ============================================
// Refresh tokens
// ============================================

export function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

export async function hashRefreshToken(token: string): Promise<string> {
  return bcrypt.hash(prepareRefreshTokenForBcrypt(token), SALT_ROUNDS);
}

export async function verifyRefreshToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(prepareRefreshTokenForBcrypt(token), hash);
}

function prepareRefreshTokenForBcrypt(token: string): string {
  return crypto
    .createHash('sha256')
    .update('loveca-refresh-token-v2\0', 'utf8')
    .update(token, 'utf8')
    .digest('base64url');
}

export async function issueRefreshToken(userId: string): Promise<IssuedRefreshToken> {
  const rawToken = generateRefreshToken();
  const tokenHash = await hashRefreshToken(rawToken);
  const tokenId = await storeRefreshToken(pool, userId, tokenHash);
  return { tokenId, rawToken };
}

export async function rotateRefreshToken(
  tokenId: string,
  rawToken: string
): Promise<RotatedRefreshToken | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const matched = await findLockedRefreshToken(client, tokenId, rawToken);
    if (!matched) {
      await client.query('ROLLBACK');
      return null;
    }

    const deleted = await client.query<IdRow>(
      'DELETE FROM refresh_tokens WHERE id = $1 RETURNING id',
      [matched.id]
    );
    if (deleted.rowCount !== 1) {
      await client.query('ROLLBACK');
      return null;
    }

    const nextRawToken = generateRefreshToken();
    const nextTokenHash = await hashRefreshToken(nextRawToken);
    const nextTokenId = await storeRefreshToken(client, matched.user_id, nextTokenHash);

    await client.query('COMMIT');
    return {
      userId: matched.user_id,
      tokenId: nextTokenId,
      rawToken: nextRawToken,
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeRefreshToken(tokenId: string, rawToken: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const matched = await findLockedRefreshToken(client, tokenId, rawToken);
    if (!matched) {
      await client.query('ROLLBACK');
      return false;
    }

    const deleted = await client.query<IdRow>(
      'DELETE FROM refresh_tokens WHERE id = $1 RETURNING id',
      [matched.id]
    );
    await client.query('COMMIT');
    return deleted.rowCount === 1;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteAllRefreshTokens(userId: string): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

async function findLockedRefreshToken(
  client: PoolClient,
  tokenId: string,
  rawToken: string
): Promise<RefreshTokenRow | null> {
  const result = await client.query<RefreshTokenRow>(
    `SELECT id, user_id, token_hash FROM refresh_tokens
     WHERE id = $1 AND expires_at > now()
     FOR UPDATE`,
    [tokenId]
  );
  const row = result.rows[0];
  if (!row || !(await verifyRefreshToken(rawToken, row.token_hash))) return null;
  return row;
}

async function storeRefreshToken(
  queryable: Pick<PoolClient, 'query'>,
  userId: string,
  tokenHash: string
): Promise<string> {
  const expiresAt = new Date(Date.now() + config.jwtRefreshExpiresInDays * 24 * 60 * 60 * 1000);
  const result = await queryable.query<IdRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, tokenHash, expiresAt]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to store refresh token');
  return row.id;
}

// ============================================
// Verification and reset tokens
// ============================================

export function generateRandomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = generateRandomToken();
  const tokenDigest = digestOneTimeToken(token, 'email-verification');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `WITH removed AS (
       DELETE FROM email_verification_tokens WHERE user_id = $1
     )
     INSERT INTO email_verification_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenDigest, expiresAt]
  );
  return token;
}

export async function verifyEmailToken(token: string): Promise<{ userId: string } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const consumed = await client.query<UserIdRow>(
      `DELETE FROM email_verification_tokens
       WHERE token = $1 AND expires_at > now()
       RETURNING user_id`,
      [digestOneTimeToken(token, 'email-verification')]
    );
    const row = consumed.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    const updated = await client.query<IdRow>(
      'UPDATE users SET email_verified = true WHERE id = $1 RETURNING id',
      [row.user_id]
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [row.user_id]);
    await client.query('COMMIT');
    return { userId: row.user_id };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = generateRandomToken();
  const tokenDigest = digestOneTimeToken(token, 'password-reset');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await pool.query(
    `WITH removed AS (
       DELETE FROM password_reset_tokens WHERE user_id = $1
     )
     INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenDigest, expiresAt]
  );
  return token;
}

export async function resetPasswordWithToken(
  token: string,
  newPasswordHash: string
): Promise<{ userId: string } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const consumed = await client.query<UserIdRow>(
      `DELETE FROM password_reset_tokens
       WHERE token = $1 AND expires_at > now() AND used_at IS NULL
       RETURNING user_id`,
      [digestOneTimeToken(token, 'password-reset')]
    );
    const row = consumed.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    const updated = await client.query<IdRow>(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id',
      [newPasswordHash, row.user_id]
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [row.user_id]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [row.user_id]);
    await client.query('COMMIT');
    return { userId: row.user_id };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePasswordAndInvalidateSessions(
  userId: string,
  expectedPasswordHash: string,
  newPasswordHash: string
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query<IdRow>(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2 AND password_hash = $3
       RETURNING id`,
      [newPasswordHash, userId, expectedPasswordHash]
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function digestOneTimeToken(token: string, purpose: string): string {
  return crypto
    .createHmac('sha256', config.jwtRefreshSecret)
    .update(`${purpose}\0`, 'utf8')
    .update(token, 'utf8')
    .digest('hex');
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction error.
  }
}
