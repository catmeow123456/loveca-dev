/**
 * Cut authentication credentials from the v1 runtime formats to v2.
 *
 * This migration intentionally does not transform legacy bcrypt passwords: the
 * plaintext password is unavailable, so converting bcrypt(password) into
 * bcrypt(sha256(password)) is impossible. Legacy/unknown password credentials are
 * marked for reset, and every existing refresh/verification/reset token is revoked.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm exec tsx drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts --dry-run --report=tmp/auth-v2-dry-run.json
 *   DATABASE_URL=postgresql://... pnpm exec tsx drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts --apply --yes --invalidate-legacy-passwords --report=tmp/auth-v2-apply.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  BCRYPT_HASH_PATTERN_SOURCE,
  CURRENT_PASSWORD_HASH_PATTERN_SOURCE,
  PASSWORD_RESET_REQUIRED_HASH,
} from '../../src/server/auth-credential-format.js';

type MigrationMode = 'dry-run' | 'apply';

export interface AuthCredentialCutoverArgs {
  readonly mode: MigrationMode;
  readonly yes: boolean;
  readonly invalidateLegacyPasswords: boolean;
  readonly allowUnrecoverableAccounts: boolean;
  readonly reportPath: string | null;
}

export interface AuthCredentialMigrationQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ readonly rows: T[]; readonly rowCount?: number | null }>;
}

interface CredentialStatsRow {
  readonly total_user_count: number | string;
  readonly current_password_count: number | string;
  readonly reset_required_password_count: number | string;
  readonly legacy_bcrypt_password_count: number | string;
  readonly unsupported_password_count: number | string;
  readonly placeholder_reset_required_count: number | string;
  readonly refresh_token_count: number | string;
  readonly email_verification_token_count: number | string;
  readonly password_reset_token_count: number | string;
}

export interface AuthCredentialCutoverStats {
  readonly totalUserCount: number;
  readonly currentPasswordCount: number;
  readonly resetRequiredPasswordCount: number;
  readonly legacyBcryptPasswordCount: number;
  readonly unsupportedPasswordCount: number;
  readonly placeholderResetRequiredCount: number;
  readonly refreshTokenCount: number;
  readonly emailVerificationTokenCount: number;
  readonly passwordResetTokenCount: number;
}

export interface AuthCredentialCutoverBlockingError {
  readonly code:
    | 'APPLY_CONFIRMATION_REQUIRED'
    | 'LEGACY_PASSWORD_INVALIDATION_NOT_CONFIRMED'
    | 'UNRECOVERABLE_ACCOUNT_IMPACT_NOT_CONFIRMED';
  readonly message: string;
}

export interface AuthCredentialCutoverReport {
  readonly script: 'auth-v1-to-v2-credential-cutover';
  readonly generatedAt: string;
  readonly mode: MigrationMode;
  readonly before: AuthCredentialCutoverStats;
  readonly after: AuthCredentialCutoverStats | null;
  readonly blockingErrors: readonly AuthCredentialCutoverBlockingError[];
  readonly applied: {
    readonly attempted: boolean;
    readonly committed: boolean;
    readonly passwordsMarkedForReset: number;
    readonly refreshTokensDeleted: number;
    readonly emailVerificationTokensDeleted: number;
    readonly passwordResetTokensDeleted: number;
  };
}

const SCRIPT_NAME = 'auth-v1-to-v2-credential-cutover';

export function parseAuthCredentialCutoverArgs(argv: readonly string[]): AuthCredentialCutoverArgs {
  let mode: MigrationMode = 'dry-run';
  let sawDryRun = false;
  let sawApply = false;
  let yes = false;
  let invalidateLegacyPasswords = false;
  let allowUnrecoverableAccounts = false;
  let reportPath: string | null = null;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      sawDryRun = true;
      mode = 'dry-run';
    } else if (arg === '--apply') {
      sawApply = true;
      mode = 'apply';
    } else if (arg === '--yes') {
      yes = true;
    } else if (arg === '--invalidate-legacy-passwords') {
      invalidateLegacyPasswords = true;
    } else if (arg === '--allow-unrecoverable-accounts') {
      allowUnrecoverableAccounts = true;
    } else if (arg.startsWith('--report=')) {
      reportPath = requireNonEmptyArg(arg, '--report=');
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (sawDryRun && sawApply) {
    throw new Error('--dry-run and --apply cannot be used together');
  }

  return {
    mode,
    yes,
    invalidateLegacyPasswords,
    allowUnrecoverableAccounts,
    reportPath,
  };
}

export async function runAuthCredentialCutover(
  queryClient: AuthCredentialMigrationQueryClient,
  args: AuthCredentialCutoverArgs
): Promise<AuthCredentialCutoverReport> {
  const before = await readCredentialStats(queryClient);
  const blockingErrors = collectBlockingErrors(before, args);
  const emptyApplied = {
    attempted: args.mode === 'apply',
    committed: false,
    passwordsMarkedForReset: 0,
    refreshTokensDeleted: 0,
    emailVerificationTokensDeleted: 0,
    passwordResetTokensDeleted: 0,
  } as const;

  if (args.mode === 'dry-run' || blockingErrors.length > 0) {
    return {
      script: SCRIPT_NAME,
      generatedAt: new Date().toISOString(),
      mode: args.mode,
      before,
      after: null,
      blockingErrors,
      applied: emptyApplied,
    };
  }

  const affectedPasswordCount = before.legacyBcryptPasswordCount + before.unsupportedPasswordCount;
  await queryClient.query('BEGIN');
  try {
    const passwordUpdate = await queryClient.query(
      `UPDATE users
       SET password_hash = $1, updated_at = now()
       WHERE password_hash !~ $2
         AND password_hash <> $1`,
      [PASSWORD_RESET_REQUIRED_HASH, CURRENT_PASSWORD_HASH_PATTERN_SOURCE]
    );
    assertAffectedRows(
      'password credential invalidation',
      passwordUpdate.rowCount,
      affectedPasswordCount
    );

    const refreshDelete = await queryClient.query('DELETE FROM refresh_tokens');
    const verificationDelete = await queryClient.query('DELETE FROM email_verification_tokens');
    const resetDelete = await queryClient.query('DELETE FROM password_reset_tokens');

    assertAffectedRows('refresh token deletion', refreshDelete.rowCount, before.refreshTokenCount);
    assertAffectedRows(
      'email verification token deletion',
      verificationDelete.rowCount,
      before.emailVerificationTokenCount
    );
    assertAffectedRows(
      'password reset token deletion',
      resetDelete.rowCount,
      before.passwordResetTokenCount
    );

    const after = await readCredentialStats(queryClient);
    assertPostconditions(after);
    await queryClient.query('COMMIT');

    return {
      script: SCRIPT_NAME,
      generatedAt: new Date().toISOString(),
      mode: args.mode,
      before,
      after,
      blockingErrors: [],
      applied: {
        attempted: true,
        committed: true,
        passwordsMarkedForReset: affectedPasswordCount,
        refreshTokensDeleted: before.refreshTokenCount,
        emailVerificationTokensDeleted: before.emailVerificationTokenCount,
        passwordResetTokensDeleted: before.passwordResetTokenCount,
      },
    };
  } catch (error) {
    await queryClient.query('ROLLBACK');
    throw error;
  }
}

async function readCredentialStats(
  queryClient: AuthCredentialMigrationQueryClient
): Promise<AuthCredentialCutoverStats> {
  const result = await queryClient.query<CredentialStatsRow>(
    `SELECT
       count(*)::int AS total_user_count,
       count(*) FILTER (WHERE password_hash ~ $1)::int AS current_password_count,
       count(*) FILTER (WHERE password_hash = $2)::int AS reset_required_password_count,
       count(*) FILTER (WHERE password_hash ~ $3)::int AS legacy_bcrypt_password_count,
       count(*) FILTER (
         WHERE password_hash !~ $1
           AND password_hash <> $2
           AND password_hash !~ $3
       )::int AS unsupported_password_count,
       count(*) FILTER (
         WHERE password_hash !~ $1
           AND lower(email) LIKE '%@placeholder.loveca.local'
       )::int AS placeholder_reset_required_count,
       (SELECT count(*)::int FROM refresh_tokens) AS refresh_token_count,
       (SELECT count(*)::int FROM email_verification_tokens) AS email_verification_token_count,
       (SELECT count(*)::int FROM password_reset_tokens) AS password_reset_token_count
     FROM users`,
    [CURRENT_PASSWORD_HASH_PATTERN_SOURCE, PASSWORD_RESET_REQUIRED_HASH, BCRYPT_HASH_PATTERN_SOURCE]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to read authentication credential statistics');
  return {
    totalUserCount: toNumber(row.total_user_count),
    currentPasswordCount: toNumber(row.current_password_count),
    resetRequiredPasswordCount: toNumber(row.reset_required_password_count),
    legacyBcryptPasswordCount: toNumber(row.legacy_bcrypt_password_count),
    unsupportedPasswordCount: toNumber(row.unsupported_password_count),
    placeholderResetRequiredCount: toNumber(row.placeholder_reset_required_count),
    refreshTokenCount: toNumber(row.refresh_token_count),
    emailVerificationTokenCount: toNumber(row.email_verification_token_count),
    passwordResetTokenCount: toNumber(row.password_reset_token_count),
  };
}

function collectBlockingErrors(
  stats: AuthCredentialCutoverStats,
  args: AuthCredentialCutoverArgs
): AuthCredentialCutoverBlockingError[] {
  if (args.mode !== 'apply') return [];

  const errors: AuthCredentialCutoverBlockingError[] = [];
  if (!args.yes) {
    errors.push({
      code: 'APPLY_CONFIRMATION_REQUIRED',
      message: '--apply requires --yes',
    });
  }

  const affectedPasswordCount = stats.legacyBcryptPasswordCount + stats.unsupportedPasswordCount;
  if (affectedPasswordCount > 0 && !args.invalidateLegacyPasswords) {
    errors.push({
      code: 'LEGACY_PASSWORD_INVALIDATION_NOT_CONFIRMED',
      message: `${affectedPasswordCount} legacy/unsupported password credentials require --invalidate-legacy-passwords`,
    });
  }

  if (stats.placeholderResetRequiredCount > 0 && !args.allowUnrecoverableAccounts) {
    errors.push({
      code: 'UNRECOVERABLE_ACCOUNT_IMPACT_NOT_CONFIRMED',
      message: `${stats.placeholderResetRequiredCount} placeholder-email accounts cannot self-service a password reset; resolve them first or pass --allow-unrecoverable-accounts`,
    });
  }
  return errors;
}

function assertAffectedRows(
  label: string,
  actual: number | null | undefined,
  expected: number
): void {
  if ((actual ?? 0) !== expected) {
    throw new Error(`${label} affected ${actual ?? 0} rows; expected ${expected}`);
  }
}

function assertPostconditions(stats: AuthCredentialCutoverStats): void {
  if (stats.legacyBcryptPasswordCount !== 0 || stats.unsupportedPasswordCount !== 0) {
    throw new Error('Legacy or unsupported password credentials remain after migration');
  }
  if (
    stats.refreshTokenCount !== 0 ||
    stats.emailVerificationTokenCount !== 0 ||
    stats.passwordResetTokenCount !== 0
  ) {
    throw new Error('Authentication tokens remain after migration');
  }
}

function toNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received ${String(value)}`);
  }
  return parsed;
}

function requireNonEmptyArg(arg: string, prefix: string): string {
  const value = arg.slice(prefix.length).trim();
  if (!value) throw new Error(`${prefix}<value> must not be empty`);
  return value;
}

function printUsage(): void {
  console.log(`
Usage:
  DATABASE_URL=postgresql://... pnpm exec tsx drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts --dry-run --report=tmp/auth-v2-dry-run.json
  DATABASE_URL=postgresql://... pnpm exec tsx drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts --apply --yes --invalidate-legacy-passwords --report=tmp/auth-v2-apply.json

Options:
  --dry-run                       Analyze only. This is the default.
  --apply                         Mark legacy passwords for reset and revoke all auth tokens.
  --yes                           Required for apply.
  --invalidate-legacy-passwords   Confirm that legacy/unknown passwords will stop working.
  --allow-unrecoverable-accounts  Allow placeholder-email accounts to require operator recovery.
  --report=<path>                 Write a machine-readable JSON report.
`);
}

function printReport(report: AuthCredentialCutoverReport): void {
  console.log('\nAuthentication credential v1 -> v2 cutover report');
  console.log(`  Mode: ${report.mode}`);
  console.log(`  Users: ${report.before.totalUserCount}`);
  console.log(`  Current password credentials: ${report.before.currentPasswordCount}`);
  console.log(`  Existing reset-required credentials: ${report.before.resetRequiredPasswordCount}`);
  console.log(`  Legacy bcrypt credentials: ${report.before.legacyBcryptPasswordCount}`);
  console.log(`  Unsupported credentials: ${report.before.unsupportedPasswordCount}`);
  console.log(
    `  Placeholder accounts requiring reset: ${report.before.placeholderResetRequiredCount}`
  );
  console.log(
    `  Tokens to revoke: refresh=${report.before.refreshTokenCount}, verification=${report.before.emailVerificationTokenCount}, reset=${report.before.passwordResetTokenCount}`
  );
  for (const error of report.blockingErrors) {
    console.error(`  BLOCKED [${error.code}]: ${error.message}`);
  }
  if (report.applied.committed) {
    console.log(`  Passwords marked for reset: ${report.applied.passwordsMarkedForReset}`);
    console.log('  Transaction committed and postconditions passed');
  }
}

function writeReport(reportPath: string | null, report: AuthCredentialCutoverReport): void {
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written: ${reportPath}`);
}

async function main(): Promise<void> {
  const args = parseAuthCredentialCutoverArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const report = await runAuthCredentialCutover(client, args);
    printReport(report);
    writeReport(args.reportPath, report);
    if (report.blockingErrors.length > 0) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
