import { writeFile } from 'node:fs/promises';
import { getCurrentRankedCardCatalogIdentity } from '../src/server/rating/ranked-environment.js';
import { pool } from '../src/server/db/pool.js';
import { RankedV3MigrationService } from '../src/server/services/ranked-v3-migration-service.js';

interface CliOptions {
  readonly seasonId: string;
  readonly apply: boolean;
  readonly expectedLedgerRevision?: number;
  readonly adminUserId?: string;
  readonly reportPath?: string;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const cardCatalog = await getCurrentRankedCardCatalogIdentity(true);
  const report = await new RankedV3MigrationService().migrate({
    seasonId: options.seasonId,
    cardCatalog,
    apply: options.apply,
    expectedLedgerRevision: options.expectedLedgerRevision,
    adminUserId: options.adminUserId,
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.reportPath) {
    await writeFile(options.reportPath, serialized, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(serialized);
}

function parseOptions(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  let apply = false;
  for (const argument of args) {
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) {
      throw new Error(`无法识别参数：${argument}`);
    }
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }
  const seasonId = values.get('season-id')?.trim();
  if (!seasonId) {
    throw new Error('必须提供 --season-id=<uuid>');
  }
  const revisionValue = values.get('expected-ledger-revision');
  const expectedLedgerRevision =
    revisionValue === undefined ? undefined : Number.parseInt(revisionValue, 10);
  if (
    revisionValue !== undefined &&
    (!/^\d+$/.test(revisionValue) || !Number.isSafeInteger(expectedLedgerRevision))
  ) {
    throw new Error('--expected-ledger-revision 必须是非负整数');
  }
  return {
    seasonId,
    apply,
    expectedLedgerRevision,
    adminUserId: values.get('admin-user-id')?.trim(),
    reportPath: values.get('report')?.trim(),
  };
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
