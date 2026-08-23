import { pool } from '../db/pool.js';
import { classifyDeck, type DeckClassificationResult } from './deck-classifier-engine.js';
import {
  hashDeckClassifierSnapshot,
  readDeckClassifierSnapshot,
  readTemplateCards,
} from './deck-classifier-release.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const STALE_RUN_INTERVAL = '3 minutes';

interface ClaimedClassificationRun {
  readonly id: string;
  readonly releaseId: string;
  readonly releaseStatus: 'BUILDING' | 'ACTIVE' | 'SUPERSEDED' | 'FAILED';
  readonly trigger:
    'RELEASE_PUBLISHED' | 'MANUAL_RECLASSIFY' | 'MANUAL_OVERRIDE' | 'AUTO_NEW_OBSERVATIONS';
  readonly scopeSeasonId: string | null;
  readonly snapshotJson: unknown;
  readonly configHash: string;
}

interface ObservationRow {
  readonly match_id: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly deck_fingerprint: string;
  readonly main_deck_cards: unknown;
}

interface OverrideDecisionRow {
  readonly id: string;
  readonly deck_fingerprint: string;
  readonly target_status: 'CLASSIFIED' | 'UNKNOWN' | 'EXCLUDED';
  readonly archetype_id: string | null;
  readonly reason: string;
}

interface ExistingAssignmentRow {
  readonly match_id: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly status: PersistedAssignment['status'];
  readonly archetype_id: string | null;
  readonly method: PersistedAssignment['method'];
}

interface PersistedAssignment {
  readonly matchId: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly archetypeId: string | null;
  readonly status: 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS' | 'INVALID' | 'EXCLUDED';
  readonly method: 'MANUAL' | 'EXACT' | 'RULE' | 'SIMILARITY' | 'UNKNOWN' | 'AMBIGUOUS' | 'INVALID';
  readonly bestDistance: number | null;
  readonly secondDistance: number | null;
  readonly margin: number | null;
  readonly evidence: Record<string, unknown>;
}

interface RunCounts {
  total: number;
  processed: number;
  classified: number;
  unknown: number;
  ambiguous: number;
  invalid: number;
  excluded: number;
  changed: number;
}

export class DeckClassificationWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private working = false;

  constructor(private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.pollIntervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  notify(): void {
    void this.runOnce();
  }

  async runOnce(): Promise<boolean> {
    if (this.working) return false;
    this.working = true;
    try {
      await recoverInterruptedClassificationRuns();
      const run = await claimNextClassificationRun();
      if (run) {
        await this.execute(run);
        return true;
      }
      return await queueMissingObservationRun();
    } catch (error) {
      console.error('[DeckClassifier] Worker loop failed', safeError(error));
      return false;
    } finally {
      this.working = false;
    }
  }

  private async execute(run: ClaimedClassificationRun): Promise<void> {
    const heartbeat = setInterval(() => {
      void pool
        .query(
          `UPDATE deck_classification_runs SET updated_at = NOW()
           WHERE id = $1 AND status = 'RUNNING'`,
          [run.id]
        )
        .catch((error) => {
          console.error('[DeckClassifier] Run heartbeat failed', {
            runId: run.id,
            ...safeError(error),
          });
        });
    }, 30_000);
    heartbeat.unref();
    try {
      const snapshot = readDeckClassifierSnapshot(run.snapshotJson);
      if (hashDeckClassifierSnapshot(snapshot) !== run.configHash) {
        throw new Error('卡组分类发布快照哈希校验失败');
      }
      const [observationsResult, overridesResult, existingResult] = await Promise.all([
        pool.query<ObservationRow>(
          `SELECT match_id, seat, deck_fingerprint, main_deck_cards
           FROM ranked_deck_observations
           WHERE ($1::uuid IS NULL OR season_id = $1)
           ORDER BY match_id ASC, seat ASC`,
          [run.scopeSeasonId]
        ),
        pool.query<OverrideDecisionRow>(
          `SELECT DISTINCT ON (deck_fingerprint)
             id, deck_fingerprint, target_status, archetype_id, reason
           FROM deck_classification_overrides
           WHERE revoked_at IS NULL
             AND (applies_to_future_releases = true OR release_id = $1)
           ORDER BY deck_fingerprint, applies_to_future_releases ASC, created_at DESC`,
          [run.releaseId]
        ),
        pool.query<ExistingAssignmentRow>(
          `SELECT assignment.match_id, assignment.seat, assignment.status,
                  assignment.archetype_id, assignment.method
           FROM deck_classification_assignments AS assignment
           JOIN ranked_deck_observations AS observation
             ON observation.match_id = assignment.match_id AND observation.seat = assignment.seat
           WHERE assignment.release_id = $1
             AND ($2::uuid IS NULL OR observation.season_id = $2)`,
          [run.releaseId, run.scopeSeasonId]
        ),
      ]);
      const overrides = new Map(
        overridesResult.rows.map((override) => [override.deck_fingerprint, override])
      );
      const existing = new Map(
        existingResult.rows.map((assignment) => [assignmentKey(assignment), assignment])
      );
      const byFingerprint = new Map<string, PersistedAssignment>();
      const assignments = observationsResult.rows.map((observation) => {
        let classification = byFingerprint.get(observation.deck_fingerprint);
        if (!classification) {
          const override = overrides.get(observation.deck_fingerprint);
          classification = override
            ? assignmentFromOverride(override)
            : assignmentFromClassifier(
                classifyDeck(readTemplateCards(observation.main_deck_cards), snapshot)
              );
          byFingerprint.set(observation.deck_fingerprint, classification);
        }
        return { ...classification, matchId: observation.match_id, seat: observation.seat };
      });
      const counts = countAssignments(assignments, existing);
      await persistClassificationRun(run, assignments, counts);
    } catch (error) {
      await failClassificationRun(run, error);
    } finally {
      clearInterval(heartbeat);
    }
  }
}

export async function recoverInterruptedClassificationRuns(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const interrupted = await client.query<{ id: string; release_id: string }>(
      `SELECT id, release_id
       FROM deck_classification_runs
       WHERE status = 'RUNNING'
         AND updated_at < NOW() - INTERVAL '${STALE_RUN_INTERVAL}'
       FOR UPDATE`
    );
    if (interrupted.rows.length === 0) {
      await client.query('COMMIT');
      return 0;
    }
    const runIds = interrupted.rows.map((row) => row.id);
    const releaseIds = interrupted.rows.map((row) => row.release_id);
    await client.query(
      `UPDATE deck_classification_runs
          SET status = 'FAILED', error_message = '分类任务执行中断，请重新发起',
              finished_at = NOW(), updated_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [runIds]
    );
    await client.query(
      `UPDATE deck_classifier_releases
          SET status = 'FAILED'
        WHERE id = ANY($1::uuid[]) AND status = 'BUILDING'`,
      [releaseIds]
    );
    await client.query('COMMIT');
    return interrupted.rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextClassificationRun(): Promise<ClaimedClassificationRun | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE deck_classification_runs AS run
          SET status = 'FAILED',
              error_message = '对应分类版本已不再接受任务',
              finished_at = NOW(), updated_at = NOW()
         FROM deck_classifier_releases AS release
        WHERE run.release_id = release.id
          AND run.status = 'QUEUED'
          AND release.status NOT IN ('BUILDING', 'ACTIVE')`
    );
    const selected = await client.query<{
      id: string;
      release_id: string;
      release_status: ClaimedClassificationRun['releaseStatus'];
      trigger: ClaimedClassificationRun['trigger'];
      scope_season_id: string | null;
      snapshot_json: unknown;
      config_hash: string;
    }>(
      `SELECT run.id, run.release_id, release.status AS release_status,
              run.trigger, run.scope_season_id, release.snapshot_json, release.config_hash
       FROM deck_classification_runs AS run
       JOIN deck_classifier_releases AS release ON release.id = run.release_id
       WHERE run.status = 'QUEUED'
         AND release.status IN ('BUILDING', 'ACTIVE')
       ORDER BY run.created_at ASC, run.id ASC
       FOR UPDATE OF run SKIP LOCKED
       LIMIT 1`
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    const claimed = await client.query(
      `UPDATE deck_classification_runs
          SET status = 'RUNNING', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND status = 'QUEUED'
          AND NOT EXISTS (
            SELECT 1 FROM deck_classification_runs WHERE status = 'RUNNING'
          )
        RETURNING id`,
      [row.id]
    );
    if (!claimed.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    await client.query('COMMIT');
    return {
      id: row.id,
      releaseId: row.release_id,
      releaseStatus: row.release_status,
      trigger: row.trigger,
      scopeSeasonId: row.scope_season_id,
      snapshotJson: row.snapshot_json,
      configHash: row.config_hash,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isPgUniqueViolation(error)) return null;
    throw error;
  } finally {
    client.release();
  }
}

async function persistClassificationRun(
  run: ClaimedClassificationRun,
  assignments: readonly PersistedAssignment[],
  counts: RunCounts
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string }>(
      'SELECT status FROM deck_classification_runs WHERE id = $1 FOR UPDATE',
      [run.id]
    );
    if (locked.rows[0]?.status !== 'RUNNING') {
      throw new Error('分类任务状态已变化');
    }
    for (let offset = 0; offset < assignments.length; offset += 250) {
      const batch = assignments.slice(offset, offset + 250);
      await client.query(
        `WITH input AS (
           SELECT *
           FROM jsonb_to_recordset($3::jsonb) AS row(
             match_id text,
             seat text,
             archetype_id uuid,
             status text,
             method text,
             best_distance double precision,
             second_distance double precision,
             margin double precision,
             evidence jsonb
           )
         )
         INSERT INTO deck_classification_assignments (
           match_id, seat, release_id, run_id, archetype_id, status, method,
           best_distance, second_distance, margin, evidence, classified_at, updated_at
         )
         SELECT match_id, seat, $1, $2, archetype_id, status, method,
                best_distance, second_distance, margin, evidence, NOW(), NOW()
         FROM input
         ON CONFLICT (match_id, seat, release_id) DO UPDATE SET
           run_id = EXCLUDED.run_id,
           archetype_id = EXCLUDED.archetype_id,
           status = EXCLUDED.status,
           method = EXCLUDED.method,
           best_distance = EXCLUDED.best_distance,
           second_distance = EXCLUDED.second_distance,
           margin = EXCLUDED.margin,
           evidence = EXCLUDED.evidence,
           classified_at = EXCLUDED.classified_at,
           updated_at = NOW()`,
        [run.releaseId, run.id, stableJsonStringify(batch.map(toPersistedJson))]
      );
    }
    if (run.releaseStatus === 'BUILDING') {
      if (run.trigger !== 'RELEASE_PUBLISHED' || run.scopeSeasonId !== null) {
        throw new Error('构建中的分类版本只能由全量发布任务激活');
      }
      if (counts.processed !== counts.total || counts.invalid > 0) {
        throw new Error('新分类版本未能完整处理所有有效卡组观察');
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext('deck-classifier-release'))");
      await client.query(
        `UPDATE deck_classifier_releases
            SET status = 'SUPERSEDED'
          WHERE status = 'ACTIVE' AND id <> $1`,
        [run.releaseId]
      );
      const activated = await client.query(
        `UPDATE deck_classifier_releases
            SET status = 'ACTIVE', activated_at = NOW()
          WHERE id = $1 AND status = 'BUILDING'
          RETURNING id`,
        [run.releaseId]
      );
      if (!activated.rows[0]) throw new Error('新分类版本激活失败');
    }
    await client.query(
      `UPDATE deck_classification_runs
          SET status = 'SUCCEEDED', total_count = $2, processed_count = $3,
              classified_count = $4, unknown_count = $5, ambiguous_count = $6,
              invalid_count = $7, excluded_count = $8, changed_count = $9,
              finished_at = NOW(), updated_at = NOW(), error_message = NULL
        WHERE id = $1`,
      [
        run.id,
        counts.total,
        counts.processed,
        counts.classified,
        counts.unknown,
        counts.ambiguous,
        counts.invalid,
        counts.excluded,
        counts.changed,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function failClassificationRun(run: ClaimedClassificationRun, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : '卡组分类任务失败';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE deck_classification_runs
          SET status = 'FAILED', error_message = $2, finished_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'RUNNING'`,
      [run.id, message]
    );
    if (run.releaseStatus === 'BUILDING') {
      await client.query(
        `UPDATE deck_classifier_releases SET status = 'FAILED'
         WHERE id = $1 AND status = 'BUILDING'`,
        [run.releaseId]
      );
    }
    await client.query('COMMIT');
  } catch (persistError) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[DeckClassifier] Failed to persist run failure', {
      runId: run.id,
      ...safeError(persistError),
    });
  } finally {
    client.release();
  }
}

async function queueMissingObservationRun(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const missing = await client.query<{
      release_id: string;
      missing_count: number | string;
      latest_observed_at: Date | string;
    }>(
      `SELECT release.id AS release_id, count(*) AS missing_count,
              max(observation.observed_at) AS latest_observed_at
       FROM deck_classifier_releases AS release
       JOIN ranked_deck_observations AS observation ON TRUE
       LEFT JOIN deck_classification_assignments AS assignment
         ON assignment.release_id = release.id
        AND assignment.match_id = observation.match_id
        AND assignment.seat = observation.seat
       WHERE release.status = 'ACTIVE' AND assignment.match_id IS NULL
       GROUP BY release.id
       LIMIT 1`
    );
    const row = missing.rows[0];
    if (!row || Number(row.missing_count) <= 0) {
      await client.query('COMMIT');
      return false;
    }
    const suffix = new Date(row.latest_observed_at).getTime();
    const queued = await client.query<{ id: string }>(
      `INSERT INTO deck_classification_runs (
         release_id, trigger, request_id, idempotency_key, reason
       )
       VALUES ($1, 'AUTO_NEW_OBSERVATIONS', $2, $2, '自动补分类新增排位卡组观察')
       ON CONFLICT (idempotency_key) DO UPDATE
         SET status = 'QUEUED', total_count = 0, processed_count = 0,
             classified_count = 0, unknown_count = 0, ambiguous_count = 0,
             invalid_count = 0, excluded_count = 0, changed_count = 0,
             error_message = NULL, started_at = NULL, finished_at = NULL,
             updated_at = NOW()
         WHERE deck_classification_runs.status = 'FAILED'
       RETURNING id`,
      [row.release_id, `deck-classifier:auto:${row.release_id}:${suffix}:${row.missing_count}`]
    );
    await client.query('COMMIT');
    return Boolean(queued.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assignmentFromOverride(override: OverrideDecisionRow): PersistedAssignment {
  return {
    matchId: '',
    seat: 'FIRST',
    archetypeId: override.target_status === 'CLASSIFIED' ? override.archetype_id : null,
    status: override.target_status,
    method: 'MANUAL',
    bestDistance: null,
    secondDistance: null,
    margin: null,
    evidence: {
      reason: 'MANUAL_OVERRIDE',
      overrideId: override.id,
      operatorReason: override.reason,
    },
  };
}

function assignmentFromClassifier(result: DeckClassificationResult): PersistedAssignment {
  return {
    matchId: '',
    seat: 'FIRST',
    archetypeId: result.archetypeId,
    status: result.decision,
    method: result.method,
    bestDistance: result.evidence.similarity?.best?.distance ?? null,
    secondDistance: result.evidence.similarity?.secondBest?.distance ?? null,
    margin: result.evidence.similarity?.margin ?? null,
    evidence: result.evidence as unknown as Record<string, unknown>,
  };
}

function countAssignments(
  assignments: readonly PersistedAssignment[],
  existing: ReadonlyMap<string, ExistingAssignmentRow>
): RunCounts {
  const counts: RunCounts = {
    total: assignments.length,
    processed: assignments.length,
    classified: 0,
    unknown: 0,
    ambiguous: 0,
    invalid: 0,
    excluded: 0,
    changed: 0,
  };
  for (const assignment of assignments) {
    if (assignment.status === 'CLASSIFIED') counts.classified += 1;
    else if (assignment.status === 'UNKNOWN') counts.unknown += 1;
    else if (assignment.status === 'AMBIGUOUS') counts.ambiguous += 1;
    else if (assignment.status === 'EXCLUDED') counts.excluded += 1;
    else counts.invalid += 1;
    const prior = existing.get(assignmentKey(assignment));
    if (
      !prior ||
      prior.status !== assignment.status ||
      prior.archetype_id !== assignment.archetypeId ||
      prior.method !== assignment.method
    ) {
      counts.changed += 1;
    }
  }
  return counts;
}

function toPersistedJson(assignment: PersistedAssignment) {
  return {
    match_id: assignment.matchId,
    seat: assignment.seat,
    archetype_id: assignment.archetypeId,
    status: assignment.status,
    method: assignment.method,
    best_distance: assignment.bestDistance,
    second_distance: assignment.secondDistance,
    margin: assignment.margin,
    evidence: assignment.evidence,
  };
}

function assignmentKey(assignment: {
  readonly match_id?: string;
  readonly matchId?: string;
  readonly seat: string;
}) {
  return `${assignment.match_id ?? assignment.matchId}:${assignment.seat}`;
}

function isPgUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function safeError(error: unknown): { readonly name: string; readonly message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) };
}

export const deckClassificationWorker = new DeckClassificationWorker();
