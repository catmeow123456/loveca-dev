import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

const SALT_ROUNDS = 12;

// ============================================
// Password hashing
// ============================================

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ============================================
// JWT
// ============================================

export function signAccessToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, config.jwtSecret, {
    expiresIn: config.jwtAccessExpiresIn,
  });
}

export function verifyAccessToken(token: string): { sub: string; role: string } {
  return jwt.verify(token, config.jwtSecret) as { sub: string; role: string };
}

// ============================================
// Refresh Token
// ============================================

export function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

export async function hashRefreshToken(token: string): Promise<string> {
  return bcrypt.hash(token, SALT_ROUNDS);
}

export async function verifyRefreshToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}

/**
 * Store a refresh token in the database.
 */
export async function storeRefreshToken(userId: string, tokenHash: string): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.jwtRefreshExpiresInDays);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );
}

/**
 * Find and validate a stored refresh token for a user.
 * Returns the token row id if valid, null otherwise.
 */
export async function findValidRefreshToken(
  userId: string,
  rawToken: string
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT id, token_hash FROM refresh_tokens
     WHERE user_id = $1 AND expires_at > now()
     ORDER BY created_at DESC`,
    [userId]
  );

  for (const row of rows) {
    if (await verifyRefreshToken(rawToken, row.token_hash)) {
      return row.id;
    }
  }
  return null;
}

/**
 * Delete a specific refresh token.
 */
export async function deleteRefreshToken(tokenId: string): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenId]);
}

/**
 * Delete all refresh tokens for a user.
 */
export async function deleteAllRefreshTokens(userId: string): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

// ============================================
// Verification & Reset Tokens
// ============================================

export function generateRandomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = generateRandomToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );
  return token;
}

export async function verifyEmailToken(token: string): Promise<{ userId: string } | null> {
  const { rows } = await pool.query(
    `DELETE FROM email_verification_tokens
     WHERE token = $1 AND expires_at > now()
     RETURNING user_id`,
    [token]
  );
  if (rows.length === 0) return null;
  return { userId: rows[0].user_id };
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = generateRandomToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1);

  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );
  return token;
}

export async function verifyPasswordResetToken(
  token: string
): Promise<{ userId: string; tokenId: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token = $1 AND expires_at > now() AND used_at IS NULL`,
    [token]
  );
  if (rows.length === 0) return null;
  return { userId: rows[0].user_id, tokenId: rows[0].id };
}

export async function markPasswordResetTokenUsed(tokenId: string): Promise<void> {
  await pool.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [tokenId]);
}
