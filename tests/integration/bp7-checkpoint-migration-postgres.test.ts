import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { migrateBp7Checkpoints } from '../../drizzle/data-migrations/add-bp7-ruleset-checkpoints';
import { createGameState } from '../../src/domain/entities/game';
import {
  serializeReplayPayload,
  rehydrateAuthorityGameState,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';

const url = process.env.CASUAL_TABLE_TEST_DATABASE_URL;
describe.skipIf(!url)('BP7 checkpoint migration', () => {
  it('dry-runs without writes, upgrades hashes/schema, preserves sealed games and rolls back corrupt batches', async () => {
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(url!).hostname);
    const client = new pg.Client({ connectionString: url });
    const schema = `bp7_migration_${randomUUID().replaceAll('-', '')}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(
        'CREATE TABLE match_checkpoints(id uuid PRIMARY KEY, payload jsonb NOT NULL, schema_version text NOT NULL, payload_hash text NOT NULL, payload_compression text NOT NULL)'
      );
      const { rulesetId: _, ...old } = createGameState('old', 'a', 'A', 'b', 'B');
      const legacy = serializeReplayPayload(old, 'AUTHORITY_GAME_STATE', 'GAME_STATE_V2');
      const sealed = serializeReplayPayload(
        createGameState('new', 'a', 'A', 'b', 'B', 'SEALED_HALF_GRAY_V1'),
        'AUTHORITY_GAME_STATE',
        GAME_STATE_SCHEMA_VERSION
      );
      const view = serializeReplayPayload(
        { match: { matchId: 'old' }, objects: {} },
        'PLAYER_VIEW_STATE',
        'PLAYER_VIEW_STATE_V1'
      );
      const legacyId = '00000000-0000-4000-8000-000000000001';
      const viewId = '00000000-0000-4000-8000-000000000002';
      const sealedId = '00000000-0000-4000-8000-000000000003';
      for (const [id, envelope] of [
        [legacyId, legacy],
        [sealedId, sealed],
        [viewId, view],
      ] as const)
        await client.query('INSERT INTO match_checkpoints VALUES ($1,$2,$3,$4,$5)', [
          id,
          envelope,
          envelope.sourceSchemaVersion,
          envelope.payloadHash,
          envelope.compression,
        ]);
      const dryRunProgress: Array<{ scanned: number; changed: number; total: number }> = [];
      expect(
        await migrateBp7Checkpoints(client, false, {
          batchSize: 2,
          onProgress: ({ scanned, changed, total }) =>
            dryRunProgress.push({ scanned, changed, total }),
        })
      ).toMatchObject({
        scanned: 3,
        changed: 2,
        mode: 'dry-run',
      });
      expect(dryRunProgress).toEqual([
        { scanned: 2, changed: 2, total: 3 },
        { scanned: 3, changed: 2, total: 3 },
      ]);
      expect(
        (await client.query('SELECT payload_hash FROM match_checkpoints WHERE id=$1', [legacyId]))
          .rows[0].payload_hash
      ).toBe(legacy.payloadHash);
      expect(await migrateBp7Checkpoints(client, true)).toMatchObject({ scanned: 3, changed: 2 });
      const migrated = (
        await client.query('SELECT payload FROM match_checkpoints WHERE id=$1', [legacyId])
      ).rows[0].payload;
      expect(rehydrateAuthorityGameState(migrated).rulesetId).toBe('STANDARD');
      expect(
        (await client.query('SELECT payload FROM match_checkpoints WHERE id=$1', [sealedId]))
          .rows[0].payload
      ).toEqual(sealed);
      expect(await migrateBp7Checkpoints(client, true)).toMatchObject({ changed: 0 });
      await client.query('TRUNCATE match_checkpoints');
      await client.query('INSERT INTO match_checkpoints VALUES ($1,$2,$3,$4,$5),($6,$2,$3,$7,$5)', [
        '00000000-0000-4000-8000-000000000001',
        legacy,
        legacy.sourceSchemaVersion,
        legacy.payloadHash,
        legacy.compression,
        '00000000-0000-4000-8000-000000000002',
        'bad',
      ]);
      await expect(migrateBp7Checkpoints(client, true)).rejects.toThrow('metadata mismatch');
      expect(
        (await client.query('SELECT payload_hash FROM match_checkpoints ORDER BY id')).rows[0]
          .payload_hash
      ).toBe(legacy.payloadHash);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
