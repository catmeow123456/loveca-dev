import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const url = process.env.CASUAL_TABLE_TEST_DATABASE_URL;
describe.skipIf(!url)('casual rule mode migration', () => {
  it('backfills ordinary history, preserves activity identity and constrains new modes in an isolated schema', async () => {
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(url!).hostname);
    const client = new pg.Client({ connectionString: url });
    const schema = `casual_rules_${randomUUID().replaceAll('-', '')}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`
        CREATE TABLE match_records (match_id text PRIMARY KEY, origin_kind text, match_mode text);
        CREATE TABLE casual_tables (environment_id text NOT NULL);
        CREATE TABLE theme_table_assignments (match_id text);
        INSERT INTO match_records VALUES ('ordinary', 'ONLINE_ROOM', 'ONLINE'), ('theme', 'PUBLIC_TABLE', 'ONLINE'), ('ranked', 'RANKED', 'ONLINE');
        INSERT INTO theme_table_assignments VALUES ('theme');
        INSERT INTO casual_tables VALUES ('CASUAL_TABLE_V1');
      `);
      await client.query(
        await readFile(
          new URL('../../drizzle/0044_add_casual_rule_modes.sql', import.meta.url),
          'utf8'
        )
      );
      expect(
        (
          await client.query(
            'SELECT match_id, casual_rule_mode FROM match_records ORDER BY match_id'
          )
        ).rows
      ).toEqual([
        { match_id: 'ordinary', casual_rule_mode: 'NORMAL' },
        { match_id: 'ranked', casual_rule_mode: null },
        { match_id: 'theme', casual_rule_mode: null },
      ]);
      await client.query(
        "INSERT INTO match_records VALUES ('entertainment', 'PUBLIC_TABLE', 'ONLINE', 'UNLIMITED')"
      );
      await client.query("INSERT INTO casual_tables VALUES ('CASUAL_UNLIMITED_PT_V1')");
      await expect(
        client.query(
          "UPDATE match_records SET casual_rule_mode = 'UNLIMITED' WHERE match_id = 'ranked'"
        )
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        client.query("INSERT INTO casual_tables VALUES ('UNKNOWN')")
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
