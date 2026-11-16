import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { casualEntrySchema } from '../../src/online/casual-table-schemas';

const sql = readFileSync('drizzle/0049_switch_sealed_to_bp8.sql', 'utf8');
async function database() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE casual_tables (id text PRIMARY KEY, environment_id text, state text,
    CONSTRAINT casual_tables_environment_check CHECK(environment_id IN ('CASUAL_TABLE_V1','CASUAL_UNLIMITED_PT_V1','CASUAL_SEALED_BP7_V1','CASUAL_HEXTECH_V1')));
    CREATE TABLE gameplay_participations (casual_table_id text);
    CREATE TABLE match_checkpoints (payload jsonb);
    INSERT INTO match_checkpoints VALUES ('{"cardCode":"PL!N-bp7-001-P","rulesetId":"SEALED_HALF_GRAY_V1"}');`);
  return db;
}

describe('BP8 deployment boundary', () => {
  it('requires old rooms and participation claims to finish before migration', async () => {
    const db = await database();
    try {
      await db.exec("INSERT INTO casual_tables VALUES ('old','CASUAL_SEALED_BP7_V1','BOUND')");
      await expect(db.exec(sql)).rejects.toThrow('Close all BP7 rooms');
      await db.exec(
        "UPDATE casual_tables SET state='CLOSED'; INSERT INTO gameplay_participations VALUES ('old')"
      );
      await expect(db.exec(sql)).rejects.toThrow('Close all BP7 rooms');
    } finally {
      await db.close();
    }
  });
  it('preserves closed rooms and historical cards, permits BP8 and forbids reactivating BP7', async () => {
    const db = await database();
    try {
      await db.exec("INSERT INTO casual_tables VALUES ('old','CASUAL_SEALED_BP7_V1','CLOSED')");
      const before = await db.query('SELECT * FROM match_checkpoints');
      await db.exec(sql);
      await db.exec("INSERT INTO casual_tables VALUES ('new','CASUAL_SEALED_BP8_V1','WAITING')");
      await expect(
        db.exec("UPDATE casual_tables SET state='WAITING' WHERE id='old'")
      ).rejects.toThrow('casual_tables_retired_bp7_check');
      expect((await db.query('SELECT * FROM match_checkpoints')).rows).toEqual(before.rows);
      expect(
        (await db.query("SELECT environment_id FROM casual_tables WHERE id='old'")).rows
      ).toEqual([{ environment_id: 'CASUAL_SEALED_BP7_V1' }]);
    } finally {
      await db.close();
    }
  });
  it('accepts deckless BP8 entries and rejects the retired client format', () => {
    const entry = {
      requestId: '11111111-1111-4111-8111-111111111111',
      format: 'SEALED_BP8',
      ruleMode: 'UNLIMITED',
      spectatorEnabled: false,
    };
    expect(casualEntrySchema.safeParse(entry).success).toBe(true);
    expect(casualEntrySchema.safeParse({ ...entry, format: 'SEALED_BP7' }).success).toBe(false);
  });
});
