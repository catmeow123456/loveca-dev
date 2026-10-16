import { pathToFileURL } from 'node:url';
import pg, { type PoolClient } from 'pg';

/** Run only after the old process has drained and stopped; DB rows cannot prove that. */
export async function retireLegacyCasual(
  client: PoolClient,
  options: { apply: boolean; writersStopped: boolean }
) {
  await client.query('BEGIN');
  try {
    // Prevent a concurrent old writer from adding a ticket between report and deletion.
    await client.query(`LOCK TABLE gameplay_participations, public_table_tickets,
      public_table_reservations, theme_table_assignments, match_records IN SHARE ROW EXCLUSIVE MODE`);
    const report = (
      await client.query<{
        tickets: number;
        reservations: number;
        participations: number;
        live_tickets: number;
        live_reservations: number;
        live_matches: number;
        foreign_references: number;
      }>(`
      WITH legacy_tickets AS (SELECT id FROM public_table_tickets WHERE queue_kind = 'CASUAL'),
      legacy_claims AS (
        SELECT gp.* FROM gameplay_participations gp
        LEFT JOIN public_table_tickets t ON t.id = gp.ticket_id
        WHERE gp.casual_table_id IS NULL AND
          (gp.kind = 'PUBLIC_QUEUE' OR (gp.kind IN ('ONLINE_ROOM', 'ONLINE_MATCH')
            AND (t.queue_kind = 'CASUAL' OR gp.ticket_id IS NULL)
            AND NOT EXISTS (SELECT 1 FROM public_table_reservations r
              WHERE r.queue_kind IN ('RANKED', 'THEME') AND r.room_generation = gp.room_generation)))
      )
      SELECT
        (SELECT count(*)::int FROM legacy_tickets) tickets,
        (SELECT count(*)::int FROM public_table_reservations WHERE queue_kind = 'CASUAL') reservations,
        (SELECT count(*)::int FROM legacy_claims) participations,
        (SELECT count(*)::int FROM public_table_tickets WHERE queue_kind = 'CASUAL'
          AND state IN ('WAITING', 'RESERVED') AND heartbeat_at > now() - interval '45 seconds') live_tickets,
        (SELECT count(*)::int FROM public_table_reservations WHERE queue_kind = 'CASUAL' AND
          ((state = 'PENDING_CONFIRMATION' AND expires_at > now()) OR
           (state = 'CREATING_ROOM' AND bootstrap_lease_until > now()))) live_reservations,
        (SELECT count(*)::int FROM match_records m WHERE status = 'IN_PROGRESS' AND match_mode = 'ONLINE'
          AND origin_kind IN ('ONLINE_ROOM', 'PUBLIC_TABLE')
          AND NOT EXISTS (SELECT 1 FROM gameplay_participations gp WHERE gp.casual_table_id IS NOT NULL AND gp.match_id = m.match_id)
          AND NOT EXISTS (SELECT 1 FROM public_table_reservations r
            WHERE r.queue_kind IN ('RANKED', 'THEME') AND r.match_id = m.match_id)
          AND NOT EXISTS (SELECT 1 FROM theme_table_assignments a WHERE a.match_id = m.match_id)) live_matches,
        ((SELECT count(*) FROM public_table_reservations r WHERE r.queue_kind <> 'CASUAL' AND
          (r.first_ticket_id IN (SELECT id FROM legacy_tickets) OR r.second_ticket_id IN (SELECT id FROM legacy_tickets))) +
         (SELECT count(*) FROM theme_table_assignments a JOIN public_table_reservations r ON r.id = a.reservation_id
          WHERE r.queue_kind = 'CASUAL') +
         (SELECT count(*) FROM gameplay_participations gp WHERE gp.ticket_id IN (SELECT id FROM legacy_tickets)
          AND gp.user_id NOT IN (SELECT user_id FROM legacy_claims)))::int foreign_references
    `)
    ).rows[0]!;
    const blockers =
      report.live_tickets +
      report.live_reservations +
      report.live_matches +
      report.foreign_references;
    if (options.apply) {
      if (!options.writersStopped)
        throw new Error(
          'Apply requires --writers-stopped after draining and stopping the old process'
        );
      if (blockers) throw new Error(`Legacy casual cutover blocked: ${JSON.stringify(report)}`);
      await client.query(`DELETE FROM gameplay_participations gp WHERE gp.casual_table_id IS NULL
        AND (gp.kind = 'PUBLIC_QUEUE' OR (gp.kind IN ('ONLINE_ROOM', 'ONLINE_MATCH')
          AND (gp.ticket_id IS NULL OR gp.ticket_id IN (SELECT id FROM public_table_tickets WHERE queue_kind = 'CASUAL'))
          AND NOT EXISTS (SELECT 1 FROM public_table_reservations r WHERE r.queue_kind IN ('RANKED', 'THEME')
            AND r.room_generation = gp.room_generation)))`);
      await client.query("DELETE FROM public_table_reservations WHERE queue_kind = 'CASUAL'");
      await client.query("DELETE FROM public_table_tickets WHERE queue_kind = 'CASUAL'");
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
    return { ...report, blockers, applied: options.apply };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) {
    if (!['--apply', '--writers-stopped'].includes(flag)) throw new Error(`Unknown flag: ${flag}`);
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await database.connect();
  try {
    console.log(
      JSON.stringify(
        await retireLegacyCasual(client, {
          apply: flags.has('--apply'),
          writersStopped: flags.has('--writers-stopped'),
        }),
        null,
        2
      )
    );
  } finally {
    client.release();
    await database.end();
  }
}
