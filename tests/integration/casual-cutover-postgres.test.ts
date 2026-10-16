import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { retireLegacyCasual } from '../../drizzle/data-migrations/retire-legacy-casual';
const url = process.env.CASUAL_TABLE_TEST_DATABASE_URL;
const schema = `casual_cutover_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Client;
let database: pg.Pool;
async function run(apply = false, writersStopped = false) {
  const client = await database.connect();
  try {
    return await retireLegacyCasual(client, { apply, writersStopped });
  } finally {
    client.release();
  }
}
describe.skipIf(!url)('legacy casual cutover PostgreSQL', () => {
  beforeAll(async () => {
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(url!).hostname);
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new pg.Pool({ connectionString: url, options: `-c search_path=${schema},public` });
    await database.query(`
   CREATE TABLE public_table_tickets (id text PRIMARY KEY, queue_kind text, state text, heartbeat_at timestamptz);
   CREATE TABLE public_table_reservations (id text PRIMARY KEY,queue_kind text,first_ticket_id text REFERENCES public_table_tickets(id),second_ticket_id text REFERENCES public_table_tickets(id),room_generation text,match_id text,state text,expires_at timestamptz,bootstrap_lease_until timestamptz);
   CREATE TABLE theme_table_assignments (reservation_id text REFERENCES public_table_reservations(id),match_id text);
   CREATE TABLE gameplay_participations (user_id text PRIMARY KEY,kind text,ticket_id text REFERENCES public_table_tickets(id),casual_table_id text,room_generation text,match_id text);
   CREATE TABLE match_records (match_id text PRIMARY KEY,match_mode text,origin_kind text,status text);
  `);
  });
  afterAll(async () => {
    await database?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  beforeEach(async () => {
    await database.query(
      'TRUNCATE gameplay_participations,theme_table_assignments,public_table_reservations,public_table_tickets,match_records CASCADE'
    );
    await database.query(`
   INSERT INTO public_table_tickets VALUES ('c1','CASUAL','WAITING',now()-interval '2 minutes'),('c2','CASUAL','MATCHED',now()-interval '2 minutes'),('r1','RANKED','WAITING',now()),('t1','THEME','WAITING',now());
   INSERT INTO public_table_reservations(id,queue_kind,first_ticket_id,second_ticket_id,room_generation,state) VALUES ('c','CASUAL','c1','c2','old-room','MATCHED');
   INSERT INTO gameplay_participations VALUES ('old','PUBLIC_QUEUE','c1',null,null,null),('manual','ONLINE_ROOM',null,null,'manual',null),('ranked','RANKED_QUEUE','r1',null,null,null),('theme','THEME_QUEUE','t1',null,null,null),('new','ONLINE_MATCH',null,'new-table','new-room','new-match');
   INSERT INTO match_records VALUES ('history','ONLINE','PUBLIC_TABLE','SURRENDERED'),('new-match','ONLINE','ONLINE_ROOM','IN_PROGRESS');
  `);
  });
  it('reports without writing and requires the explicit stopped-writer assertion', async () => {
    expect(await run()).toMatchObject({
      tickets: 2,
      reservations: 1,
      participations: 2,
      blockers: 0,
      applied: false,
    });
    await expect(run(true)).rejects.toThrow('--writers-stopped');
    expect(
      (await database.query<{ n: number }>('SELECT count(*)::int n FROM public_table_tickets'))
        .rows[0].n
    ).toBe(4);
  });
  it('clears only retired runtime supply and preserves other modes, new rooms and history', async () => {
    expect(await run(true, true)).toMatchObject({ applied: true, blockers: 0 });
    expect(
      (
        await database.query<{ id: string }>('SELECT id FROM public_table_tickets ORDER BY id')
      ).rows.map((x) => x.id)
    ).toEqual(['r1', 't1']);
    expect(
      (
        await database.query<{ user_id: string }>(
          'SELECT user_id FROM gameplay_participations ORDER BY user_id'
        )
      ).rows.map((x) => x.user_id)
    ).toEqual(['new', 'ranked', 'theme']);
    expect(
      (
        await database.query<{ match_id: string }>(
          'SELECT match_id FROM match_records ORDER BY match_id'
        )
      ).rows.map((x) => x.match_id)
    ).toEqual(['history', 'new-match']);
    expect(await run(true, true)).toMatchObject({
      tickets: 0,
      reservations: 0,
      participations: 0,
      applied: true,
    });
  });
  it.each(['ticket', 'confirmation', 'bootstrap', 'match', 'foreign'])(
    'blocks %s and rolls the entire transaction back',
    async (kind) => {
      if (kind === 'ticket')
        await database.query("UPDATE public_table_tickets SET heartbeat_at=now() WHERE id='c1'");
      if (kind === 'confirmation')
        await database.query(
          "UPDATE public_table_reservations SET state='PENDING_CONFIRMATION',expires_at=now()+interval '1 minute' WHERE id='c'"
        );
      if (kind === 'bootstrap')
        await database.query(
          "UPDATE public_table_reservations SET state='CREATING_ROOM',bootstrap_lease_until=now()+interval '1 minute' WHERE id='c'"
        );
      if (kind === 'match')
        await database.query(
          "INSERT INTO match_records VALUES ('active-old','ONLINE','ONLINE_ROOM','IN_PROGRESS')"
        );
      if (kind === 'foreign')
        await database.query("INSERT INTO theme_table_assignments VALUES ('c',null)");
      expect((await run()).blockers).toBeGreaterThan(0);
      await expect(run(true, true)).rejects.toThrow('blocked');
      expect(
        (await database.query<{ n: number }>('SELECT count(*)::int n FROM public_table_tickets'))
          .rows[0].n
      ).toBe(4);
    }
  );
});
