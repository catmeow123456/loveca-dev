import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  bcryptHash: vi.fn((value: string) => Promise.resolve(`hash:${value}`)),
  bcryptCompare: vi.fn((value: string, hash: string) => Promise.resolve(hash === `hash:${value}`)),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.poolConnect,
  },
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: mocks.bcryptHash,
    compare: mocks.bcryptCompare,
  },
}));

import {
  createEmailVerificationToken,
  createPasswordResetToken,
  resetPasswordWithToken,
  rotateRefreshToken,
  updatePasswordAndInvalidateSessions,
  verifyEmailToken,
} from '../../src/server/services/auth-service';

type QueryCall = [query: string, params?: readonly unknown[]];

function clientQueryCalls(): QueryCall[] {
  return mocks.clientQuery.mock.calls as unknown as QueryCall[];
}

function poolQueryCalls(): QueryCall[] {
  return mocks.poolQuery.mock.calls as unknown as QueryCall[];
}

describe('auth token transactions', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockClear();
    mocks.poolConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease,
    });
  });

  it('stores keyed digests instead of plaintext one-time tokens', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const emailToken = await createEmailVerificationToken('user-1');
    const resetToken = await createPasswordResetToken('user-1');
    const calls = poolQueryCalls();
    const storedEmailToken = calls[0]?.[1]?.[1];
    const storedResetToken = calls[1]?.[1]?.[1];

    expect(emailToken).toMatch(/^[a-f0-9]{64}$/);
    expect(resetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(storedEmailToken).toMatch(/^[a-f0-9]{64}$/);
    expect(storedResetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(storedEmailToken).not.toBe(emailToken);
    expect(storedResetToken).not.toBe(resetToken);
    expect(calls[0]?.[0]).toContain('DELETE FROM email_verification_tokens');
    expect(calls[1]?.[0]).toContain('DELETE FROM password_reset_tokens');
  });

  it('locks, consumes, and replaces a refresh token in one transaction', async () => {
    const tokenId = '11111111-1111-4111-8111-111111111111';
    const rawToken = 'a'.repeat(80);
    mocks.bcryptCompare.mockResolvedValueOnce(true);
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [{ id: tokenId, user_id: 'user-1', token_hash: `hash:${rawToken}` }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: tokenId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'next-token-id' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    const rotated = await rotateRefreshToken(tokenId, rawToken);

    expect(rotated).toMatchObject({ userId: 'user-1', tokenId: 'next-token-id' });
    expect(rotated?.rawToken).toMatch(/^[a-f0-9]{80}$/);
    const calls = clientQueryCalls();
    expect(calls[1]?.[0]).toContain('FOR UPDATE');
    expect(calls[1]?.[1]).toEqual([tokenId]);
    expect(calls[2]?.[0]).toContain('DELETE FROM refresh_tokens');
    expect(calls[3]?.[0]).toContain('INSERT INTO refresh_tokens');
    expect(calls.at(-1)?.[0]).toBe('COMMIT');
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });

  it('atomically consumes an email token before marking the user verified', async () => {
    const rawToken = 'b'.repeat(64);
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'user-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(verifyEmailToken(rawToken)).resolves.toEqual({ userId: 'user-2' });

    const calls = clientQueryCalls();
    const consumeCall = calls[1];
    expect(consumeCall?.[0]).toContain('DELETE FROM email_verification_tokens');
    expect(consumeCall?.[1]?.[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(consumeCall?.[1]?.[0]).not.toBe(rawToken);
    expect(calls[2]?.[0]).toContain('UPDATE users SET email_verified');
    expect(calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('changes the password and revokes every session in the same token-consumption transaction', async () => {
    const rawToken = 'c'.repeat(64);
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-3' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'user-3' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(resetPasswordWithToken(rawToken, 'new-hash')).resolves.toEqual({
      userId: 'user-3',
    });

    const calls = clientQueryCalls();
    expect(calls[1]?.[0]).toContain('DELETE FROM password_reset_tokens');
    expect(calls[2]?.[0]).toContain('UPDATE users SET password_hash');
    expect(calls[3]?.[0]).toContain('DELETE FROM refresh_tokens');
    expect(calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('changes an authenticated password only if the verified credential is still current', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ id: 'user-4' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(
      updatePasswordAndInvalidateSessions('user-4', 'verified-hash', 'replacement-hash')
    ).resolves.toBe(true);

    const calls = clientQueryCalls();
    expect(calls[1]?.[0]).toContain('password_hash = $3');
    expect(calls[1]?.[1]).toEqual(['replacement-hash', 'user-4', 'verified-hash']);
    expect(calls[2]?.[0]).toContain('DELETE FROM refresh_tokens');
    expect(calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('rejects an authenticated password change when another request replaced the credential', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(
      updatePasswordAndInvalidateSessions('user-4', 'stale-hash', 'replacement-hash')
    ).resolves.toBe(false);

    expect(clientQueryCalls().map((call) => call[0])).toEqual([
      'BEGIN',
      expect.stringContaining('UPDATE users'),
      'ROLLBACK',
    ]);
  });

  it('rolls back without changing a user when an email token was already consumed', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(verifyEmailToken('d'.repeat(64))).resolves.toBeNull();

    expect(clientQueryCalls().map((call) => call[0])).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM email_verification_tokens'),
      'ROLLBACK',
    ]);
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });
});
