/**
 * 从未清理的历史卡组快照回填指定排位赛季的长期卡组观察事实。
 *
 * 默认只读 dry-run。正式执行前必须完成结构迁移、停止排位写入并核对赛季流水版本：
 *   DATABASE_URL=... pnpm ranked:environment:backfill -- --season-key=<key>
 *   DATABASE_URL=... pnpm ranked:environment:backfill -- --season-key=<key> --apply --yes \
 *     --expected-ledger-revision=<revision>
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  buildRankedDeckObservation,
  captureRankedDeckObservations,
  type RankedDeckObservationFact,
  type RankedDeckObservationQueryClient,
} from '../../src/server/services/ranked-deck-observation-service.js';
import { stableJsonStringify } from '../../src/server/services/replay-payload-serialization.js';

type MigrationMode = 'dry-run' | 'apply';

export interface RankedDeckObservationBackfillArgs {
  readonly mode: MigrationMode;
  readonly seasonKey: string;
  readonly expectedLedgerRevision: number | null;
  readonly yes: boolean;
}

export interface RankedDeckObservationBackfillQueryClient extends RankedDeckObservationQueryClient {}

interface SeasonRow {
  readonly id: string;
  readonly season_key: string;
  readonly name: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly ledger_revision: number;
}

interface SnapshotRow {
  readonly match_id: string;
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly completeness: string;
  readonly started_at: Date | string;
  readonly seat: 'FIRST' | 'SECOND' | null;
  readonly snapshot_user_id: string | null;
  readonly main_deck: unknown;
  readonly card_summaries: unknown;
}

interface ExistingObservationRow {
  readonly match_id: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly user_id: string;
  readonly deck_fingerprint: string;
  readonly main_deck_cards: unknown;
  readonly observed_at: Date | string;
}

interface BackfillableMatch {
  readonly matchId: string;
  readonly firstUserId: string;
  readonly secondUserId: string;
  readonly facts: readonly RankedDeckObservationFact[];
}

interface InspectionResult {
  readonly season: SeasonRow | null;
  readonly blockers: readonly string[];
  readonly matchCount: number;
  readonly alreadyCompleteMatchCount: number;
  readonly backfillableMatches: readonly BackfillableMatch[];
  readonly existingObservationCount: number;
  readonly wouldInsertObservationCount: number;
  readonly earliestObservedAt: string | null;
}

export interface RankedDeckObservationBackfillReport {
  readonly script: 'backfill-ranked-deck-observations';
  readonly mode: MigrationMode;
  readonly season: {
    readonly id: string;
    readonly seasonKey: string;
    readonly name: string;
    readonly lifecycle: SeasonRow['lifecycle'];
    readonly ledgerRevision: number;
  } | null;
  readonly blockers: readonly string[];
  readonly matchCount: number;
  readonly alreadyCompleteMatchCount: number;
  readonly backfillableMatchCount: number;
  readonly existingObservationCount: number;
  readonly wouldInsertObservationCount: number;
  readonly insertedObservationCount: number;
  readonly earliestObservedAt: string | null;
}

export function parseRankedDeckObservationBackfillArgs(
  argv: readonly string[]
): RankedDeckObservationBackfillArgs {
  let mode: MigrationMode = 'dry-run';
  let seasonKey = '';
  let expectedLedgerRevision: number | null = null;
  let yes = false;
  let explicitMode: MigrationMode | null = null;

  for (const argument of argv) {
    if (argument === '--dry-run' || argument === '--apply') {
      const nextMode: MigrationMode = argument === '--apply' ? 'apply' : 'dry-run';
      if (explicitMode && explicitMode !== nextMode) {
        throw new Error('--dry-run and --apply cannot be used together');
      }
      mode = nextMode;
      explicitMode = nextMode;
    } else if (argument === '--yes') {
      yes = true;
    } else if (argument.startsWith('--season-key=')) {
      seasonKey = argument.slice('--season-key='.length).trim();
    } else if (argument.startsWith('--expected-ledger-revision=')) {
      expectedLedgerRevision = parseNonNegativeInteger(
        argument.slice('--expected-ledger-revision='.length),
        '--expected-ledger-revision'
      );
    } else if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        '用法：pnpm ranked:environment:backfill -- --season-key=<key> [--dry-run|--apply --yes --expected-ledger-revision=<n>]\n'
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(seasonKey)) {
    throw new Error('--season-key is required and must use the ranked season key format');
  }
  if (mode === 'apply' && !yes) throw new Error('--apply requires --yes');
  if (mode === 'apply' && expectedLedgerRevision === null) {
    throw new Error('--apply requires --expected-ledger-revision');
  }
  return { mode, seasonKey, expectedLedgerRevision, yes };
}

export async function runRankedDeckObservationBackfill(
  client: RankedDeckObservationBackfillQueryClient,
  args: RankedDeckObservationBackfillArgs
): Promise<RankedDeckObservationBackfillReport> {
  if (args.mode === 'dry-run') {
    return toReport(await inspectBackfill(client, args, false), args.mode, 0);
  }

  await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  try {
    const preview = await inspectBackfill(client, args, true);
    if (preview.blockers.length > 0) {
      throw new Error(`Ranked deck observation backfill blocked: ${preview.blockers.join('; ')}`);
    }
    for (const match of preview.backfillableMatches) {
      await captureRankedDeckObservations(client, {
        seasonId: preview.season!.id,
        matchId: match.matchId,
        firstUserId: match.firstUserId,
        secondUserId: match.secondUserId,
      });
    }
    const postcondition = await inspectBackfill(client, args, true);
    if (postcondition.blockers.length > 0 || postcondition.wouldInsertObservationCount > 0) {
      throw new Error(
        `Ranked deck observation backfill postcondition failed: ${[
          ...postcondition.blockers,
          ...(postcondition.wouldInsertObservationCount > 0
            ? [`仍有 ${postcondition.wouldInsertObservationCount} 条观察事实未回填`]
            : []),
        ].join('; ')}`
      );
    }
    await client.query('COMMIT');
    return toReport(postcondition, args.mode, preview.wouldInsertObservationCount);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function inspectBackfill(
  client: RankedDeckObservationBackfillQueryClient,
  args: RankedDeckObservationBackfillArgs,
  lock: boolean
): Promise<InspectionResult> {
  const seasonResult = await client.query<SeasonRow>(
    `SELECT id, season_key, name, lifecycle, ledger_revision
     FROM ranked_seasons
     WHERE season_key = $1
     ${lock ? 'FOR UPDATE' : ''}`,
    [args.seasonKey]
  );
  const season = seasonResult.rows[0] ?? null;
  const blockers: string[] = [];
  if (!season) {
    blockers.push(`找不到赛季：${args.seasonKey}`);
    return emptyInspection(season, blockers);
  }
  if (season.lifecycle === 'DRAFT') blockers.push('草稿赛季没有可回填的公开排位对局');
  if (args.mode === 'apply' && season.ledger_revision !== args.expectedLedgerRevision) {
    blockers.push(
      `评分流水版本不匹配：预期 ${args.expectedLedgerRevision}，实际 ${season.ledger_revision}`
    );
  }

  const [snapshotResult, existingResult] = await Promise.all([
    client.query<SnapshotRow>(
      `SELECT
         ranked_match.match_id,
         ranked_match.first_user_id,
         ranked_match.second_user_id,
         record.completeness,
         record.started_at,
         snapshot.seat,
         snapshot.user_id AS snapshot_user_id,
         snapshot.main_deck,
         snapshot.card_summaries
       FROM ranked_matches AS ranked_match
       JOIN match_records AS record ON record.match_id = ranked_match.match_id
       LEFT JOIN match_deck_snapshots AS snapshot ON snapshot.match_id = ranked_match.match_id
       WHERE ranked_match.season_id = $1
       ORDER BY ranked_match.match_id ASC, snapshot.seat ASC`,
      [season.id]
    ),
    client.query<ExistingObservationRow>(
      `SELECT match_id, seat, user_id, deck_fingerprint, main_deck_cards, observed_at
       FROM ranked_deck_observations
       WHERE season_id = $1
       ORDER BY match_id ASC, seat ASC`,
      [season.id]
    ),
  ]);
  const snapshotRowsByMatch = groupBy(snapshotResult.rows, (row) => row.match_id);
  const existingRowsByMatch = groupBy(existingResult.rows, (row) => row.match_id);
  const backfillableMatches: BackfillableMatch[] = [];
  let alreadyCompleteMatchCount = 0;
  let earliestObservedAt: number | null = null;

  for (const [matchId, rows] of snapshotRowsByMatch) {
    const first = rows[0]!;
    const expectedUsers = { FIRST: first.first_user_id, SECOND: first.second_user_id } as const;
    const existingRows = existingRowsByMatch.get(matchId) ?? [];
    if (first.completeness === 'METADATA_ONLY') {
      if (hasCompleteExistingObservations(existingRows, expectedUsers)) {
        alreadyCompleteMatchCount += 1;
        earliestObservedAt = minTime(earliestObservedAt, first.started_at);
        continue;
      }
      blockers.push(`${matchId}：历史卡组明细已清理，无法回填`);
      continue;
    }
    const rowsBySeat = new Map(rows.filter((row) => row.seat).map((row) => [row.seat, row]));
    if (rowsBySeat.size !== 2) {
      blockers.push(`${matchId}：缺少双方卡组快照`);
      continue;
    }
    try {
      const facts = (['FIRST', 'SECOND'] as const).map((seat) => {
        const row = rowsBySeat.get(seat)!;
        if (row.snapshot_user_id !== expectedUsers[seat]) {
          throw new Error(`${seat} 席卡组快照与排位玩家不一致`);
        }
        return buildRankedDeckObservation({
          seasonId: season.id,
          matchId,
          seat,
          userId: row.snapshot_user_id,
          mainDeck: row.main_deck,
          cardSummaries: row.card_summaries,
          observedAt: row.started_at,
        });
      });
      const conflictingExisting = existingRows.find((existing) => {
        const fact = facts.find((candidate) => candidate.seat === existing.seat);
        return !fact || !existingObservationMatches(existing, fact);
      });
      if (conflictingExisting) {
        blockers.push(`${matchId}：${conflictingExisting.seat} 席既有观察事实与卡组快照不一致`);
        continue;
      }
      if (existingRows.length === facts.length) {
        alreadyCompleteMatchCount += 1;
        earliestObservedAt = minTime(earliestObservedAt, first.started_at);
        continue;
      }
      backfillableMatches.push({
        matchId,
        firstUserId: first.first_user_id,
        secondUserId: first.second_user_id,
        facts,
      });
      earliestObservedAt = minTime(earliestObservedAt, first.started_at);
    } catch (error) {
      blockers.push(`${matchId}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    season,
    blockers,
    matchCount: snapshotRowsByMatch.size,
    alreadyCompleteMatchCount,
    backfillableMatches,
    existingObservationCount: existingResult.rows.length,
    wouldInsertObservationCount: backfillableMatches.reduce((count, match) => {
      const existing = existingRowsByMatch.get(match.matchId)?.length ?? 0;
      return count + Math.max(0, match.facts.length - existing);
    }, 0),
    earliestObservedAt:
      earliestObservedAt === null ? null : new Date(earliestObservedAt).toISOString(),
  };
}

function existingObservationMatches(
  row: ExistingObservationRow,
  fact: RankedDeckObservationFact
): boolean {
  const observedAt = new Date(row.observed_at).getTime();
  return (
    row.match_id === fact.matchId &&
    row.seat === fact.seat &&
    row.user_id === fact.userId &&
    row.deck_fingerprint === fact.deckFingerprint &&
    stableJsonStringify(row.main_deck_cards) === stableJsonStringify(fact.mainDeckCards) &&
    Number.isFinite(observedAt) &&
    observedAt === fact.observedAt.getTime()
  );
}

function hasCompleteExistingObservations(
  rows: readonly ExistingObservationRow[],
  expectedUsers: Readonly<Record<'FIRST' | 'SECOND', string>>
): boolean {
  return (
    rows.length === 2 &&
    rows.every(
      (row) =>
        (row.seat === 'FIRST' || row.seat === 'SECOND') && row.user_id === expectedUsers[row.seat]
    )
  );
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    result.set(key, [...(result.get(key) ?? []), row]);
  }
  return result;
}

function minTime(current: number | null, value: Date | string): number {
  const parsed = new Date(value).getTime();
  return current === null ? parsed : Math.min(current, parsed);
}

function emptyInspection(season: SeasonRow | null, blockers: readonly string[]): InspectionResult {
  return {
    season,
    blockers,
    matchCount: 0,
    alreadyCompleteMatchCount: 0,
    backfillableMatches: [],
    existingObservationCount: 0,
    wouldInsertObservationCount: 0,
    earliestObservedAt: null,
  };
}

function toReport(
  inspection: InspectionResult,
  mode: MigrationMode,
  insertedObservationCount: number
): RankedDeckObservationBackfillReport {
  return {
    script: 'backfill-ranked-deck-observations',
    mode,
    season: inspection.season
      ? {
          id: inspection.season.id,
          seasonKey: inspection.season.season_key,
          name: inspection.season.name,
          lifecycle: inspection.season.lifecycle,
          ledgerRevision: inspection.season.ledger_revision,
        }
      : null,
    blockers: inspection.blockers,
    matchCount: inspection.matchCount,
    alreadyCompleteMatchCount: inspection.alreadyCompleteMatchCount,
    backfillableMatchCount: inspection.backfillableMatches.length,
    existingObservationCount: inspection.existingObservationCount,
    wouldInsertObservationCount: inspection.wouldInsertObservationCount,
    insertedObservationCount,
    earliestObservedAt: inspection.earliestObservedAt,
  };
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = parseRankedDeckObservationBackfillArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const report = await runRankedDeckObservationBackfill(client, args);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.blockers.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
