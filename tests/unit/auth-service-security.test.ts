import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_COMPATIBLE_PASSWORD_HASH_PREFIX,
  PASSWORD_RESET_REQUIRED_HASH,
} from '../../src/server/auth-credential-format';
import { config, isCompleteSmtpConfiguration } from '../../src/server/config';
import {
  hashRefreshToken,
  hashPassword,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
  verifyRefreshToken,
} from '../../src/server/services/auth-service';

describe('auth-service security primitives', () => {
  it('requires every SMTP field and a valid port when email delivery is enabled', () => {
    const complete = {
      host: 'smtp.example.com',
      port: 587,
      user: 'smtp-user',
      pass: 'smtp-pass',
      from: 'noreply@example.com',
    };

    expect(isCompleteSmtpConfiguration(complete)).toBe(true);
    expect(isCompleteSmtpConfiguration({ ...complete, port: Number.NaN })).toBe(false);
    expect(isCompleteSmtpConfiguration({ ...complete, port: 70_000 })).toBe(false);
    expect(isCompleteSmtpConfiguration({ ...complete, from: '   ' })).toBe(false);
  });

  it('pre-hashes passwords so bcrypt cannot ignore differences after byte 72', async () => {
    const sharedPrefix = 'a'.repeat(72);
    const password = `${sharedPrefix}-first-suffix`;
    const collidingUnderRawBcrypt = `${sharedPrefix}-different-suffix`;

    const passwordHash = await hashPassword(password);

    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
    await expect(verifyPassword(collidingUnderRawBcrypt, passwordHash)).resolves.toBe(false);
  });

  it('accepts explicitly wrapped legacy credentials and rejects raw or reset-required values', async () => {
    const legacyHash = await bcrypt.hash('legacy-password', 4);

    await expect(
      verifyPassword('legacy-password', `${LEGACY_COMPATIBLE_PASSWORD_HASH_PREFIX}${legacyHash}`)
    ).resolves.toBe(true);
    await expect(
      verifyPassword('wrong-password', `${LEGACY_COMPATIBLE_PASSWORD_HASH_PREFIX}${legacyHash}`)
    ).resolves.toBe(false);
    await expect(verifyPassword('legacy-password', legacyHash)).resolves.toBe(false);
    await expect(verifyPassword('wrong-password', legacyHash)).resolves.toBe(false);
    await expect(verifyPassword('any-password', PASSWORD_RESET_REQUIRED_HASH)).resolves.toBe(false);
  });

  it('pre-hashes refresh tokens so every byte participates in verification', async () => {
    const sharedPrefix = 'a'.repeat(72);
    const refreshToken = `${sharedPrefix}11111111`;
    const sameBcryptPrefix = `${sharedPrefix}22222222`;
    const refreshTokenHash = await hashRefreshToken(refreshToken);

    await expect(verifyRefreshToken(refreshToken, refreshTokenHash)).resolves.toBe(true);
    await expect(verifyRefreshToken(sameBcryptPrefix, refreshTokenHash)).resolves.toBe(false);
  });

  it('requires the expected JWT algorithm, issuer, audience, subject, and role', () => {
    const token = signAccessToken('user-1', 'admin');
    expect(verifyAccessToken(token)).toEqual({ sub: 'user-1', role: 'admin' });

    const missingClaims = jwt.sign({ sub: 'user-1', role: 'admin' }, config.jwtSecret, {
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(missingClaims)).toThrow();

    const invalidRole = jwt.sign({ sub: 'user-1', role: 'owner' }, config.jwtSecret, {
      algorithm: 'HS256',
      issuer: 'loveca-api',
      audience: 'loveca-client',
    });
    expect(() => verifyAccessToken(invalidRole)).toThrow('Invalid access token payload');
  });
});
