import pg from 'pg';
import { expect, it, vi } from 'vitest';
import { PostgresAiEvidenceRepository } from '../../src/server/ai-battle/evidence-repository';

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/server/db/pool.js', () => ({ pool: database }));

const databaseUrl = process.env.AI_EVIDENCE_TEST_DATABASE_URL;

it.skipIf(!databaseUrl)(
  'exports evidence in numeric order across bigint digit boundaries and paginates without omissions',
  async () => {
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(databaseUrl!).hostname);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      // A connection-local table shadows the real table; no business records are changed.
      await client.query(
        'CREATE TEMP TABLE ai_battle_evidence_entries (id bigint PRIMARY KEY, match_id text, entry jsonb) ON COMMIT DROP'
      );
      await client.query(
        `INSERT INTO ai_battle_evidence_entries VALUES
          (9, 'match', '{"kind":"HEADER"}'),
          (10, 'match', '{"kind":"SOURCES"}'),
          (99, 'match', '{"kind":"BEGIN"}'),
          (100, 'match', '{"kind":"APPEND"}'),
          (999, 'match', '{"kind":"APPEND"}'),
          (1000, 'match', '{"kind":"END"}'),
          (1001, 'other', '{"kind":"HEADER"}')`
      );
      database.query.mockImplementation((text: string, values?: readonly unknown[]) =>
        client.query(text, values ? [...values] : undefined)
      );
      const repository = new PostgresAiEvidenceRepository();
      expect(await repository.latest('match')).toEqual({ id: '1000', entry: { kind: 'END' } });
      const ids: string[] = [];
      let cursor = '0';
      for (;;) {
        const page = await repository.listAfter('match', cursor, 2);
        if (!page.length) break;
        ids.push(...page.map((row) => row.id));
        cursor = page.at(-1)!.id;
      }
      expect(ids).toEqual(['9', '10', '99', '100', '999', '1000']);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
      database.query.mockReset();
    }
  }
);
