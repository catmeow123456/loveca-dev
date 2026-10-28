/** Run after stopping old writers and backing up; dry-run is the default. */
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import type { ReplaySerializedPayloadEnvelope } from '../../src/online/replay-types.js';
import { migrateBattleRulesetCheckpoint } from '../../src/server/services/replay-payload-serialization.js';

export async function migrateBp7Checkpoints(client: pg.Client, apply = false) {
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  let scanned = 0;
  let changed = 0;
  let cursor = '00000000-0000-0000-0000-000000000000';
  try {
    if (apply) await client.query('LOCK TABLE match_checkpoints IN SHARE ROW EXCLUSIVE MODE');
    while (true) {
      const { rows } = await client.query<{
        id: string;
        schema_version: string;
        payload_hash: string;
        payload_compression: string;
        payload: ReplaySerializedPayloadEnvelope;
      }>(
        'SELECT id, schema_version, payload_hash, payload_compression, payload FROM match_checkpoints WHERE id > $1 ORDER BY id LIMIT 100',
        [cursor]
      );
      if (!rows.length) break;
      for (const row of rows) {
        if (
          row.schema_version !== row.payload.sourceSchemaVersion ||
          row.payload_hash !== row.payload.payloadHash ||
          row.payload_compression !== row.payload.compression
        )
          throw new Error(`Checkpoint metadata mismatch: ${row.id}`);
        const migrated = migrateBattleRulesetCheckpoint(row.payload);
        scanned++;
        if (
          migrated.payloadHash !== row.payload_hash ||
          migrated.sourceSchemaVersion !== row.schema_version
        ) {
          changed++;
          if (apply)
            await client.query(
              'UPDATE match_checkpoints SET payload = $2::jsonb, schema_version = $3, payload_hash = $4, payload_compression = $5 WHERE id = $1',
              [
                row.id,
                JSON.stringify(migrated),
                migrated.sourceSchemaVersion,
                migrated.payloadHash,
                migrated.compression,
              ]
            );
        }
        cursor = row.id;
      }
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { mode: apply ? 'apply' : 'dry-run', scanned, changed };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--dry-run', '--apply', '--yes'].includes(arg)) ||
    (args.includes('--apply') && args.includes('--dry-run'))
  )
    throw new Error('Use --dry-run or --apply --yes');
  const apply = args.includes('--apply');
  if (apply && !args.includes('--yes'))
    throw new Error('Apply requires --yes after backup and stopping old writers');
  if (!process.env.DATABASE_URL) throw new Error('Explicit DATABASE_URL is required');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    console.log(JSON.stringify(await migrateBp7Checkpoints(client, apply)));
  } finally {
    await client.end();
  }
}
