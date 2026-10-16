import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  awardEligibleThemeActivityBadgesForMatch,
  type PlayerBadgeQueryClient,
} from '../../src/server/player-badges/award';
const url = process.env.CASUAL_TABLE_TEST_DATABASE_URL;
const schema = `theme_badge_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Client;
let database: pg.Pool;
const users = [randomUUID(), randomUUID()];
const theme = randomUUID();
const client: PlayerBadgeQueryClient = {
  query: async <T>(text: string, values?: readonly unknown[]) => {
    const result = await database.query(text, values ? [...values] : undefined);
    return { rows: result.rows as T[], rowCount: result.rowCount };
  },
};
describe.skipIf(!url)('theme terminal badge query PostgreSQL types', () => {
  beforeAll(async () => {
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(url!).hostname);
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new pg.Pool({ connectionString: url, options: `-c search_path=${schema},public` });
    await database.query(`
   CREATE TABLE profiles(id uuid PRIMARY KEY);
   CREATE TABLE match_records(match_id text PRIMARY KEY,first_user_id text,second_user_id text,status text,winner_seat text,ended_at timestamptz);
   CREATE TABLE theme_table_assignments(match_id text,theme_table_version_id uuid);
   CREATE TABLE player_badge_rules(badge_key text PRIMARY KEY,source_theme_table_version_id uuid,source_season_id uuid,criteria_version integer,criteria_type text,minimum_value integer);
   CREATE TABLE player_badges(user_id uuid REFERENCES profiles(id),badge_key text,source_season_id uuid,source_theme_table_version_id uuid,criteria_version integer,evidence jsonb,awarded_at timestamptz,PRIMARY KEY(user_id,badge_key));
  `);
    for (const user of users) await database.query('INSERT INTO profiles VALUES ($1)', [user]);
    await database.query(
      "INSERT INTO player_badge_rules VALUES ('theme-test',$1,null,1,'THEME_COMPLETED_MATCH_COUNT',2)",
      [theme]
    );
  });
  afterAll(async () => {
    await database?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  it('seals below-threshold results, awards real UUID players at the threshold, and remains idempotent', async () => {
    for (const [index, status] of ['SURRENDERED', 'COMPLETED'].entries()) {
      const match = `theme-${index}`;
      await database.query('INSERT INTO match_records VALUES ($1,$2,$3,$4,$5,$6)', [
        match,
        ...users,
        status,
        index === 0 ? 'SECOND' : null,
        new Date(100000 + index * 1000),
      ]);
      await database.query('INSERT INTO theme_table_assignments VALUES ($1,$2)', [match, theme]);
      expect([...(await awardEligibleThemeActivityBadgesForMatch(client, match))].sort()).toEqual(
        index === 0 ? [] : [...users].sort()
      );
    }
    expect(await awardEligibleThemeActivityBadgesForMatch(client, 'theme-1')).toEqual([]);
    const rows = (
      await database.query<{
        user_id: string;
        evidence: { observedCompletedMatchCount: number };
        awarded_at: Date;
      }>('SELECT user_id,evidence,awarded_at FROM player_badges ORDER BY user_id')
    ).rows;
    expect(rows.map((row) => row.user_id).sort()).toEqual([...users].sort());
    expect(
      rows.every(
        (row) =>
          row.evidence.observedCompletedMatchCount === 2 && row.awarded_at.getTime() === 101000
      )
    ).toBe(true);
  });
});
