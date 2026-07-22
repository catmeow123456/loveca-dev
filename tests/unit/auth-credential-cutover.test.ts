import { describe, expect, it } from 'vitest';
import {
  parseAuthCredentialCutoverArgs,
  runAuthCredentialCutover,
  type AuthCredentialCutoverArgs,
  type AuthCredentialCutoverStats,
  type AuthCredentialMigrationQueryClient,
} from '../../drizzle/data-migrations/auth-v1-to-v2-credential-cutover';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function args(overrides: Partial<AuthCredentialCutoverArgs> = {}): AuthCredentialCutoverArgs {
  return {
    mode: 'dry-run',
    yes: false,
    invalidateLegacyPasswords: false,
    allowUnrecoverableAccounts: false,
    reportPath: null,
    ...overrides,
  };
}

function createStats(
  overrides: Partial<AuthCredentialCutoverStats> = {}
): AuthCredentialCutoverStats {
  return {
    totalUserCount: 3,
    currentPasswordCount: 1,
    resetRequiredPasswordCount: 0,
    legacyBcryptPasswordCount: 2,
    unsupportedPasswordCount: 0,
    placeholderResetRequiredCount: 0,
    refreshTokenCount: 2,
    emailVerificationTokenCount: 1,
    passwordResetTokenCount: 1,
    ...overrides,
  };
}

function createHarness(initial: AuthCredentialCutoverStats): {
  readonly client: AuthCredentialMigrationQueryClient;
  readonly calls: QueryCall[];
  readonly stats: () => AuthCredentialCutoverStats;
} {
  const calls: QueryCall[] = [];
  let stats = { ...initial };

  const client: AuthCredentialMigrationQueryClient = {
    query<T = unknown>(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      if (text.includes('total_user_count')) {
        return Promise.resolve({
          rows: [
            {
              total_user_count: stats.totalUserCount,
              current_password_count: stats.currentPasswordCount,
              reset_required_password_count: stats.resetRequiredPasswordCount,
              legacy_bcrypt_password_count: stats.legacyBcryptPasswordCount,
              unsupported_password_count: stats.unsupportedPasswordCount,
              placeholder_reset_required_count: stats.placeholderResetRequiredCount,
              refresh_token_count: stats.refreshTokenCount,
              email_verification_token_count: stats.emailVerificationTokenCount,
              password_reset_token_count: stats.passwordResetTokenCount,
            },
          ] as T[],
        });
      }
      if (text.trim().startsWith('UPDATE users')) {
        const affected = stats.legacyBcryptPasswordCount + stats.unsupportedPasswordCount;
        stats = {
          ...stats,
          resetRequiredPasswordCount: stats.resetRequiredPasswordCount + affected,
          legacyBcryptPasswordCount: 0,
          unsupportedPasswordCount: 0,
        };
        return Promise.resolve({ rows: [] as T[], rowCount: affected });
      }
      if (text === 'DELETE FROM refresh_tokens') {
        const count = stats.refreshTokenCount;
        stats = { ...stats, refreshTokenCount: 0 };
        return Promise.resolve({ rows: [] as T[], rowCount: count });
      }
      if (text === 'DELETE FROM email_verification_tokens') {
        const count = stats.emailVerificationTokenCount;
        stats = { ...stats, emailVerificationTokenCount: 0 };
        return Promise.resolve({ rows: [] as T[], rowCount: count });
      }
      if (text === 'DELETE FROM password_reset_tokens') {
        const count = stats.passwordResetTokenCount;
        stats = { ...stats, passwordResetTokenCount: 0 };
        return Promise.resolve({ rows: [] as T[], rowCount: count });
      }
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) {
        return Promise.resolve({ rows: [] as T[], rowCount: null });
      }
      return Promise.reject(new Error(`Unhandled query: ${text}`));
    },
  };

  return { client, calls, stats: () => stats };
}

describe('auth credential v1 to v2 cutover', () => {
  it('defaults to dry-run and parses explicit destructive confirmations', () => {
    expect(parseAuthCredentialCutoverArgs([])).toEqual(args());
    expect(
      parseAuthCredentialCutoverArgs([
        '--apply',
        '--yes',
        '--invalidate-legacy-passwords',
        '--allow-unrecoverable-accounts',
        '--report=tmp/auth.json',
      ])
    ).toEqual(
      args({
        mode: 'apply',
        yes: true,
        invalidateLegacyPasswords: true,
        allowUnrecoverableAccounts: true,
        reportPath: 'tmp/auth.json',
      })
    );
    expect(() => parseAuthCredentialCutoverArgs(['--dry-run', '--apply'])).toThrow(
      '--dry-run and --apply cannot be used together'
    );
  });

  it('reports legacy credentials and tokens without writing in dry-run mode', async () => {
    const harness = createHarness(createStats());
    const report = await runAuthCredentialCutover(harness.client, args());

    expect(report.before).toMatchObject({
      legacyBcryptPasswordCount: 2,
      refreshTokenCount: 2,
    });
    expect(report.applied).toMatchObject({ attempted: false, committed: false });
    expect(harness.calls).toHaveLength(1);
  });

  it('blocks apply until password invalidation and placeholder-account impact are explicit', async () => {
    const harness = createHarness(createStats({ placeholderResetRequiredCount: 1 }));
    const report = await runAuthCredentialCutover(
      harness.client,
      args({ mode: 'apply', yes: true })
    );

    expect(report.blockingErrors.map((error) => error.code)).toEqual([
      'LEGACY_PASSWORD_INVALIDATION_NOT_CONFIRMED',
      'UNRECOVERABLE_ACCOUNT_IMPACT_NOT_CONFIRMED',
    ]);
    expect(report.applied.committed).toBe(false);
    expect(harness.calls).toHaveLength(1);
  });

  it('marks old passwords for reset and revokes all token families atomically', async () => {
    const harness = createHarness(createStats({ unsupportedPasswordCount: 1, totalUserCount: 4 }));
    const report = await runAuthCredentialCutover(
      harness.client,
      args({
        mode: 'apply',
        yes: true,
        invalidateLegacyPasswords: true,
      })
    );

    expect(report.blockingErrors).toEqual([]);
    expect(report.applied).toEqual({
      attempted: true,
      committed: true,
      passwordsMarkedForReset: 3,
      refreshTokensDeleted: 2,
      emailVerificationTokensDeleted: 1,
      passwordResetTokensDeleted: 1,
    });
    expect(report.after).toMatchObject({
      resetRequiredPasswordCount: 3,
      legacyBcryptPasswordCount: 0,
      unsupportedPasswordCount: 0,
      refreshTokenCount: 0,
      emailVerificationTokenCount: 0,
      passwordResetTokenCount: 0,
    });
    expect(harness.calls.map((call) => call.text)).toEqual(
      expect.arrayContaining(['BEGIN', 'COMMIT'])
    );
    expect(harness.stats()).toMatchObject({ resetRequiredPasswordCount: 3 });
  });

  it('rolls back when affected rows no longer match the analyzed counts', async () => {
    const harness = createHarness(createStats());
    const driftingClient: AuthCredentialMigrationQueryClient = {
      async query<T = unknown>(text: string, values: readonly unknown[] = []) {
        const result = await harness.client.query<T>(text, values);
        if (text === 'DELETE FROM refresh_tokens') {
          return { ...result, rowCount: 1 };
        }
        return result;
      },
    };

    await expect(
      runAuthCredentialCutover(
        driftingClient,
        args({
          mode: 'apply',
          yes: true,
          invalidateLegacyPasswords: true,
        })
      )
    ).rejects.toThrow('refresh token deletion affected 1 rows; expected 2');

    expect(harness.calls.map((call) => call.text)).toContain('ROLLBACK');
    expect(harness.calls.map((call) => call.text)).not.toContain('COMMIT');
  });
});
