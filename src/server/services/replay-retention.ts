export type ReplayRetentionMode = 'dry-run' | 'apply';

export interface ReplayRetentionOptions {
  readonly mode: ReplayRetentionMode;
  readonly retentionDays: number;
  readonly batchSize: number;
  readonly cutoff: string;
}

export interface ReplayRetentionQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ readonly rows: T[]; readonly rowCount?: number | null }>;
}

interface CandidateRow {
  readonly match_id: string;
  readonly replay_rows: number | string;
  readonly checkpoint_rows: number | string;
  readonly event_rows: number | string;
  readonly decision_rows: number | string;
}

interface CountRow {
  readonly count: number | string;
}

export interface ReplayRetentionReport {
  readonly retentionDays: number;
  readonly cutoff: string;
  readonly candidateMatchCount: number;
  readonly replayRows: number;
  readonly checkpointRows: number;
  readonly eventRows: number;
  readonly decisionRows: number;
  readonly blockedRankedMatchCount: number;
  readonly metadataRowsUpdated: number;
}

export class ReplayRetentionError extends Error {
  constructor(
    readonly code: 'RANKED_OBSERVATION_BLOCKED',
    message: string,
    readonly blockedRankedMatchCount: number
  ) {
    super(message);
  }
}

export async function runReplayRetention(
  queryClient: ReplayRetentionQueryClient,
  options: ReplayRetentionOptions
): Promise<ReplayRetentionReport> {
  const candidates = await queryClient.query<CandidateRow>(candidateSql(), [options.cutoff]);
  const totals = candidates.rows.reduce(
    (result, row) => ({
      candidateMatchCount: result.candidateMatchCount + 1,
      replayRows: result.replayRows + number(row.replay_rows),
      checkpointRows: result.checkpointRows + number(row.checkpoint_rows),
      eventRows: result.eventRows + number(row.event_rows),
      decisionRows: result.decisionRows + number(row.decision_rows),
    }),
    { candidateMatchCount: 0, replayRows: 0, checkpointRows: 0, eventRows: 0, decisionRows: 0 }
  );
  const blockerCount = await queryClient.query<CountRow>(rankedObservationBlockerCountSql(), [
    options.cutoff,
  ]);
  const blockedRankedMatchCount = number(blockerCount.rows[0]?.count ?? 0);

  if (options.mode === 'dry-run') {
    const count = await queryClient.query<CountRow>(countSql(), [options.cutoff]);
    return {
      ...totals,
      retentionDays: options.retentionDays,
      cutoff: options.cutoff,
      candidateMatchCount: number(count.rows[0]?.count ?? totals.candidateMatchCount),
      blockedRankedMatchCount,
      metadataRowsUpdated: 0,
    };
  }

  if (blockedRankedMatchCount > 0) {
    throw new ReplayRetentionError(
      'RANKED_OBSERVATION_BLOCKED',
      `Replay purge blocked: ${blockedRankedMatchCount} ranked candidate match(es) do not have two complete deck observations`,
      blockedRankedMatchCount
    );
  }

  let metadataRowsUpdated = 0;
  while (true) {
    await queryClient.query('BEGIN');
    try {
      const updated = await queryClient.query<CountRow>(purgeBatchSql(), [
        options.cutoff,
        options.batchSize,
      ]);
      await queryClient.query('COMMIT');
      const count = number(updated.rows[0]?.count ?? updated.rowCount ?? 0);
      metadataRowsUpdated += count;
      if (count === 0) break;
    } catch (error) {
      await queryClient.query('ROLLBACK');
      throw error;
    }
  }

  return {
    ...totals,
    retentionDays: options.retentionDays,
    cutoff: options.cutoff,
    blockedRankedMatchCount,
    metadataRowsUpdated,
  };
}

function candidateSql(): string {
  return `SELECT record.match_id,
    (SELECT count(*) FROM match_timeline_entries WHERE match_id = record.match_id) +
    (SELECT count(*) FROM match_checkpoints WHERE match_id = record.match_id) +
    (SELECT count(*) FROM match_record_public_events WHERE match_id = record.match_id) +
    (SELECT count(*) FROM match_record_private_events WHERE match_id = record.match_id) AS replay_rows,
    (SELECT count(*) FROM match_checkpoints WHERE match_id = record.match_id) AS checkpoint_rows,
    (SELECT count(*) FROM match_record_public_events WHERE match_id = record.match_id) +
    (SELECT count(*) FROM match_record_private_events WHERE match_id = record.match_id) AS event_rows,
    (SELECT count(*) FROM match_decision_records WHERE match_id = record.match_id) AS decision_rows
    FROM match_records record
    WHERE record.status <> 'IN_PROGRESS'
      AND record.sealed_at IS NOT NULL
      AND record.sealed_at < $1
      AND record.completeness <> 'METADATA_ONLY'
    ORDER BY record.sealed_at ASC, record.match_id ASC`;
}

function countSql(): string {
  return `SELECT count(*) FROM match_records record
    WHERE record.status <> 'IN_PROGRESS' AND record.sealed_at IS NOT NULL
      AND record.sealed_at < $1 AND record.completeness <> 'METADATA_ONLY'`;
}

function rankedObservationBlockerCountSql(): string {
  return `SELECT count(*) AS count
    FROM match_records AS record
    JOIN ranked_matches AS ranked_match ON ranked_match.match_id = record.match_id
    WHERE record.status <> 'IN_PROGRESS' AND record.sealed_at IS NOT NULL
      AND record.sealed_at < $1 AND record.completeness <> 'METADATA_ONLY'
      AND NOT (${rankedObservationReadySql('record')})`;
}

function purgeBatchSql(): string {
  return `WITH selected AS (
      SELECT record.match_id FROM match_records AS record
      WHERE record.status <> 'IN_PROGRESS' AND record.sealed_at IS NOT NULL
        AND record.sealed_at < $1 AND record.completeness <> 'METADATA_ONLY'
        AND ${rankedObservationReadySql('record')}
      ORDER BY record.sealed_at ASC, record.match_id ASC
      LIMIT $2
      FOR UPDATE OF record SKIP LOCKED
    ),
    deleted_decisions AS (DELETE FROM match_decision_records WHERE match_id IN (SELECT match_id FROM selected)),
    deleted_checkpoints AS (DELETE FROM match_checkpoints WHERE match_id IN (SELECT match_id FROM selected)),
    deleted_public AS (DELETE FROM match_record_public_events WHERE match_id IN (SELECT match_id FROM selected)),
    deleted_private AS (DELETE FROM match_record_private_events WHERE match_id IN (SELECT match_id FROM selected)),
    deleted_timeline AS (DELETE FROM match_timeline_entries WHERE match_id IN (SELECT match_id FROM selected)),
    updated_decks AS (UPDATE match_deck_snapshots SET main_deck = '[]'::jsonb, energy_deck = '[]'::jsonb, card_summaries = '{}'::jsonb WHERE match_id IN (SELECT match_id FROM selected)),
    updated_records AS (
      UPDATE match_records SET completeness = 'METADATA_ONLY', replay_capabilities = '[]'::jsonb,
        replay_limitations = CASE WHEN replay_limitations @> '["REPLAY_DATA_PURGED"]'::jsonb
          THEN replay_limitations ELSE replay_limitations || '["REPLAY_DATA_PURGED"]'::jsonb END,
        partial_reason = '回放数据已按保留策略清理', updated_at = now()
      WHERE match_id IN (SELECT match_id FROM selected)
      RETURNING match_id
    )
    SELECT count(*)::int AS count FROM updated_records`;
}

function rankedObservationReadySql(recordAlias: string): string {
  return `NOT EXISTS (
        SELECT 1
        FROM ranked_matches AS protected_ranked_match
        WHERE protected_ranked_match.match_id = ${recordAlias}.match_id
          AND (
            (SELECT count(*)
             FROM ranked_deck_observations AS observation
             WHERE observation.match_id = protected_ranked_match.match_id) <> 2
            OR NOT EXISTS (
              SELECT 1
              FROM ranked_deck_observations AS first_observation
              WHERE first_observation.match_id = protected_ranked_match.match_id
                AND first_observation.season_id = protected_ranked_match.season_id
                AND first_observation.seat = 'FIRST'
                AND first_observation.user_id = protected_ranked_match.first_user_id
            )
            OR NOT EXISTS (
              SELECT 1
              FROM ranked_deck_observations AS second_observation
              WHERE second_observation.match_id = protected_ranked_match.match_id
                AND second_observation.season_id = protected_ranked_match.season_id
                AND second_observation.seat = 'SECOND'
                AND second_observation.user_id = protected_ranked_match.second_user_id
            )
          )
      )`;
}

function number(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric replay retention result: ${String(value)}`);
  }
  return parsed;
}
