/**
 * 为首届排位赛季达到 3 场有效计分对局的玩家补发纪念徽章。
 *
 * 默认只读 dry-run。正式执行前必须完成结构迁移、停止排位写入并确认评分流水版本：
 *   DATABASE_URL=... pnpm badges:first-ranked:backfill -- --season-key=<key>
 *   DATABASE_URL=... pnpm badges:first-ranked:backfill -- --season-key=<key> --apply --yes \
 *     --expected-ledger-revision=<revision>
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { awardEligibleFirstRankedSeasonBadges } from '../../src/server/player-badges/award.js';
import {
  FIRST_RANKED_SEASON_BADGE_CRITERIA_VERSION,
  FIRST_RANKED_SEASON_BADGE_KEY,
  FIRST_RANKED_SEASON_MINIMUM_RATED_MATCH_COUNT,
} from '../../src/server/player-badges/catalog.js';

type MigrationMode = 'dry-run' | 'apply';

export interface FirstRankedSeasonBadgeBackfillArgs {
  readonly mode: MigrationMode;
  readonly seasonKey: string;
  readonly expectedLedgerRevision: number | null;
  readonly yes: boolean;
}

export interface FirstRankedSeasonBadgeBackfillQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ readonly rows: T[]; readonly rowCount?: number | null }>;
}

interface SeasonRow {
  readonly id: string;
  readonly season_key: string;
  readonly name: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly starts_at: Date | string;
  readonly ledger_revision: number;
}

interface BadgeRuleRow {
  readonly badge_key: string;
  readonly source_season_id: string;
  readonly criteria_type: string;
  readonly minimum_value: number;
  readonly criteria_version: string;
}

interface CandidateRow {
  readonly user_id: string;
  readonly display_name: string;
  readonly rated_match_count: number;
  readonly already_awarded: boolean;
}

export interface FirstRankedSeasonBadgeBackfillCandidate {
  readonly userId: string;
  readonly displayName: string;
  readonly ratedMatchCount: number;
  readonly alreadyAwarded: boolean;
}

export interface FirstRankedSeasonBadgeBackfillReport {
  readonly script: 'award-first-ranked-season-badge';
  readonly mode: MigrationMode;
  readonly badgeKey: string;
  readonly criteriaVersion: string;
  readonly minimumRatedMatchCount: number;
  readonly season: {
    readonly id: string;
    readonly seasonKey: string;
    readonly name: string;
    readonly lifecycle: SeasonRow['lifecycle'];
    readonly ledgerRevision: number;
  } | null;
  readonly earliestPublicSeasonKey: string | null;
  readonly existingRule: BadgeRuleRow | null;
  readonly blockers: readonly string[];
  readonly candidates: readonly FirstRankedSeasonBadgeBackfillCandidate[];
  readonly eligibleCount: number;
  readonly alreadyAwardedCount: number;
  readonly wouldAwardCount: number;
  readonly awardedCount: number;
}

export function parseFirstRankedSeasonBadgeBackfillArgs(
  argv: readonly string[]
): FirstRankedSeasonBadgeBackfillArgs {
  let mode: MigrationMode = 'dry-run';
  let seasonKey = '';
  let expectedLedgerRevision: number | null = null;
  let yes = false;
  let modeWasExplicit = false;

  for (const argument of argv) {
    if (argument === '--dry-run' || argument === '--apply') {
      const nextMode = argument === '--apply' ? 'apply' : 'dry-run';
      if (modeWasExplicit && mode !== nextMode) {
        throw new Error('--dry-run and --apply cannot be used together');
      }
      mode = nextMode;
      modeWasExplicit = true;
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
        '用法：pnpm badges:first-ranked:backfill -- --season-key=<key> [--dry-run|--apply --yes --expected-ledger-revision=<n>]\n'
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(seasonKey)) {
    throw new Error('--season-key is required and must use the ranked season key format');
  }
  if (mode === 'apply' && !yes) {
    throw new Error('--apply requires --yes');
  }
  if (mode === 'apply' && expectedLedgerRevision === null) {
    throw new Error('--apply requires --expected-ledger-revision');
  }
  return { mode, seasonKey, expectedLedgerRevision, yes };
}

export async function runFirstRankedSeasonBadgeBackfill(
  client: FirstRankedSeasonBadgeBackfillQueryClient,
  args: FirstRankedSeasonBadgeBackfillArgs
): Promise<FirstRankedSeasonBadgeBackfillReport> {
  if (args.mode === 'dry-run') {
    return inspectBackfill(client, args, 0);
  }

  await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  try {
    const preview = await inspectBackfill(client, args, 0, true);
    if (preview.blockers.length > 0) {
      throw new Error(`Badge backfill blocked: ${preview.blockers.join('; ')}`);
    }
    await client.query(
      `INSERT INTO player_badge_rules (
         badge_key,
         source_season_id,
         criteria_type,
         minimum_value,
         criteria_version,
         created_at
       ) VALUES ($1, $2, 'RANKED_RATED_MATCH_COUNT', $3, $4, NOW())
       ON CONFLICT (badge_key) DO NOTHING`,
      [
        FIRST_RANKED_SEASON_BADGE_KEY,
        preview.season!.id,
        FIRST_RANKED_SEASON_MINIMUM_RATED_MATCH_COUNT,
        FIRST_RANKED_SEASON_BADGE_CRITERIA_VERSION,
      ]
    );
    const rule = await loadBadgeRule(client, true);
    const ruleBlocker = validateRule(rule, preview.season!.id);
    if (ruleBlocker) {
      throw new Error(ruleBlocker);
    }
    const awardedUserIds = await awardEligibleFirstRankedSeasonBadges(client, {
      seasonId: preview.season!.id,
    });
    const postcondition = await inspectBackfill(client, args, awardedUserIds.length, true);
    if (postcondition.blockers.length > 0 || postcondition.wouldAwardCount > 0) {
      throw new Error(
        `Badge backfill postcondition failed: ${[
          ...postcondition.blockers,
          ...(postcondition.wouldAwardCount > 0
            ? [`仍有 ${postcondition.wouldAwardCount} 名合格玩家未获得徽章`]
            : []),
        ].join('; ')}`
      );
    }
    await client.query('COMMIT');
    return postcondition;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function inspectBackfill(
  client: FirstRankedSeasonBadgeBackfillQueryClient,
  args: FirstRankedSeasonBadgeBackfillArgs,
  awardedCount: number,
  lock = false
): Promise<FirstRankedSeasonBadgeBackfillReport> {
  const targetSeason = await loadSeason(client, args.seasonKey, lock);
  const earliestPublicSeason = await loadEarliestPublicSeason(client, lock);
  const existingRule = await loadBadgeRule(client, lock);
  const blockers: string[] = [];

  if (!targetSeason) {
    blockers.push(`找不到赛季：${args.seasonKey}`);
  } else {
    if (targetSeason.lifecycle === 'DRAFT') {
      blockers.push('目标赛季仍为 DRAFT，不能作为首届公开排位赛季');
    }
    if (earliestPublicSeason?.id !== targetSeason.id) {
      blockers.push(
        `目标赛季不是最早公开赛季，当前最早赛季为：${earliestPublicSeason?.season_key ?? '无'}`
      );
    }
    if (args.mode === 'apply' && targetSeason.ledger_revision !== args.expectedLedgerRevision) {
      blockers.push(
        `评分流水版本不匹配：预期 ${args.expectedLedgerRevision}，实际 ${targetSeason.ledger_revision}`
      );
    }
    const ruleBlocker = validateRule(existingRule, targetSeason.id);
    if (ruleBlocker) blockers.push(ruleBlocker);
  }

  const candidateRows = targetSeason
    ? await client.query<CandidateRow>(
        `SELECT
           rating.user_id,
           COALESCE(profile.display_name, profile.username) AS display_name,
           rating.rated_match_count,
           EXISTS (
             SELECT 1
             FROM player_badges AS badge
             WHERE badge.user_id = rating.user_id
               AND badge.badge_key = $3
           ) AS already_awarded
         FROM ranked_player_ratings AS rating
         JOIN profiles AS profile ON profile.id = rating.user_id
         WHERE rating.season_id = $1
           AND rating.rated_match_count >= $2
         ORDER BY rating.user_id ASC`,
        [
          targetSeason.id,
          FIRST_RANKED_SEASON_MINIMUM_RATED_MATCH_COUNT,
          FIRST_RANKED_SEASON_BADGE_KEY,
        ]
      )
    : { rows: [] as CandidateRow[] };
  const candidates = candidateRows.rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    ratedMatchCount: row.rated_match_count,
    alreadyAwarded: row.already_awarded,
  }));
  const alreadyAwardedCount = candidates.filter((candidate) => candidate.alreadyAwarded).length;

  return {
    script: 'award-first-ranked-season-badge',
    mode: args.mode,
    badgeKey: FIRST_RANKED_SEASON_BADGE_KEY,
    criteriaVersion: FIRST_RANKED_SEASON_BADGE_CRITERIA_VERSION,
    minimumRatedMatchCount: FIRST_RANKED_SEASON_MINIMUM_RATED_MATCH_COUNT,
    season: targetSeason
      ? {
          id: targetSeason.id,
          seasonKey: targetSeason.season_key,
          name: targetSeason.name,
          lifecycle: targetSeason.lifecycle,
          ledgerRevision: targetSeason.ledger_revision,
        }
      : null,
    earliestPublicSeasonKey: earliestPublicSeason?.season_key ?? null,
    existingRule,
    blockers,
    candidates,
    eligibleCount: candidates.length,
    alreadyAwardedCount,
    wouldAwardCount: candidates.length - alreadyAwardedCount,
    awardedCount,
  };
}

async function loadSeason(
  client: FirstRankedSeasonBadgeBackfillQueryClient,
  seasonKey: string,
  lock: boolean
): Promise<SeasonRow | null> {
  const result = await client.query<SeasonRow>(
    `SELECT id, season_key, name, lifecycle, starts_at, ledger_revision
     FROM ranked_seasons
     WHERE season_key = $1
     ${lock ? 'FOR UPDATE' : ''}`,
    [seasonKey]
  );
  return result.rows[0] ?? null;
}

async function loadEarliestPublicSeason(
  client: FirstRankedSeasonBadgeBackfillQueryClient,
  lock: boolean
): Promise<SeasonRow | null> {
  const result = await client.query<SeasonRow>(
    `SELECT id, season_key, name, lifecycle, starts_at, ledger_revision
     FROM ranked_seasons
     WHERE lifecycle IN ('ACTIVE', 'FINALIZING', 'CLOSED')
     ORDER BY starts_at ASC, id ASC
     LIMIT 1
     ${lock ? 'FOR UPDATE' : ''}`
  );
  return result.rows[0] ?? null;
}

async function loadBadgeRule(
  client: FirstRankedSeasonBadgeBackfillQueryClient,
  lock: boolean
): Promise<BadgeRuleRow | null> {
  const result = await client.query<BadgeRuleRow>(
    `SELECT badge_key, source_season_id, criteria_type, minimum_value, criteria_version
     FROM player_badge_rules
     WHERE badge_key = $1
     ${lock ? 'FOR UPDATE' : ''}`,
    [FIRST_RANKED_SEASON_BADGE_KEY]
  );
  return result.rows[0] ?? null;
}

function validateRule(rule: BadgeRuleRow | null, targetSeasonId: string): string | null {
  if (!rule) return null;
  if (
    rule.source_season_id !== targetSeasonId ||
    rule.criteria_type !== 'RANKED_RATED_MATCH_COUNT' ||
    rule.minimum_value !== FIRST_RANKED_SEASON_MINIMUM_RATED_MATCH_COUNT ||
    rule.criteria_version !== FIRST_RANKED_SEASON_BADGE_CRITERIA_VERSION
  ) {
    return '既有徽章规则与本次首赛季、3 场门槛或规则版本不一致';
  }
  return null;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = parseFirstRankedSeasonBadgeBackfillArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const report = await runFirstRankedSeasonBadgeBackfill(client, args);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.blockers.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
