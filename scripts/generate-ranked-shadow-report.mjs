#!/usr/bin/env node

/**
 * One-off, read-only production report for the first Loveca ranked shadow study.
 *
 * Safety properties:
 * - opens one PostgreSQL connection;
 * - forces a REPEATABLE READ, READ ONLY transaction;
 * - executes one parameterized SELECT from match_records;
 * - never reads account profiles, deck snapshots, checkpoints, chat, or hidden game data;
 * - never writes to PostgreSQL;
 * - pseudonymizes player IDs and omits match IDs from both reports.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const REPORT_SCHEMA_VERSION = 'loveca-ranked-shadow-report-v2';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RD = 350;
const STABLE_RD = 50;
const DAYS_FROM_STABLE_TO_MAX_RD = 365;
const GLICKO_Q = Math.log(10) / 400;
const ALLOWED_ORIGINS = new Set(['PUBLIC_TABLE', 'ONLINE_ROOM']);

const ALGORITHM = Object.freeze({
  algorithmVersion: 'GLICKO1_PER_MATCH_SHADOW_V2',
  ratingPeriodMode: 'PER_MATCH',
  initialRating: 1500,
  initialRatingDeviation: MAX_RD,
  minimumRatingDeviation: 30,
  maximumRatingDeviation: MAX_RD,
  inactivityTimeUnitHours: 24,
  deviationIncreasePerTimeUnit: Math.sqrt(
    (MAX_RD ** 2 - STABLE_RD ** 2) / DAYS_FROM_STABLE_TO_MAX_RD
  ),
  placementMatchCount: 10,
  displayDecimalPlaces: 0,
  softResetCenter: 1500,
  softResetRetention: 0.5,
  softResetMinimumDeviation: 200,
});

const HELP = `Loveca 赛季排位 Glicko 影子报告（只读）

用法：
  node scripts/generate-ranked-shadow-report.mjs [选项]

选项：
  --output-dir=<目录>       输出目录，默认 ./ranked-shadow-output
  --from=<ISO 时间>         只读取 started_at >= 此时间的对局
  --to=<ISO 时间>           只读取 started_at < 此时间的对局
  --origins=<来源列表>      PUBLIC_TABLE 或 PUBLIC_TABLE,ONLINE_ROOM
                            默认仅 PUBLIC_TABLE
  --statement-timeout-ms=N  SELECT 超时，默认 60000，范围 1000～300000
  --help                    显示帮助

环境变量：
  DATABASE_URL              必填；脚本不会输出该值

输出：
  loveca-ranked-shadow-<时间>.json
  loveca-ranked-shadow-<时间>.md

报告不会包含原始玩家 ID、matchId、房间号、卡组或隐藏对局数据。`;

if (isDirectExecution()) {
  await main();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  runAlgorithmSelfCheck();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const generatedAt = new Date();
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    application_name: 'loveca-ranked-shadow-report',
  });

  let rows;
  const client = await pool.connect();
  try {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(`SET LOCAL statement_timeout TO '${args.statementTimeoutMs}ms'`);
    await client.query("SET LOCAL lock_timeout TO '2000ms'");
    const transactionMode = await client.query('SHOW transaction_read_only');
    if (transactionMode.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('database transaction is not read-only; refusing to continue');
    }

    const result = await client.query(
      `SELECT
         match_id AS "matchId",
         match_mode AS "matchMode",
         origin_kind AS "originKind",
         status,
         completeness,
         started_at AS "startedAt",
         ended_at AS "endedAt",
         sealed_at AS "sealedAt",
         first_user_id AS "firstUserId",
         second_user_id AS "secondUserId",
         winner_seat AS "winnerSeat",
         end_reason AS "endReason",
         rules_version AS "rulesVersion",
         card_data_version AS "cardDataVersion",
         card_data_hash AS "cardDataHash"
       FROM match_records
       WHERE origin_kind = ANY($1::text[])
         AND ($2::timestamptz IS NULL OR started_at >= $2::timestamptz)
         AND ($3::timestamptz IS NULL OR started_at < $3::timestamptz)
       ORDER BY started_at ASC, match_id ASC`,
      [args.origins, args.from?.toISOString() ?? null, args.to?.toISOString() ?? null]
    );
    rows = result.rows;
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original query error.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const report = buildRankedShadowReport(rows, {
    generatedAt,
    origins: args.origins,
    from: args.from,
    to: args.to,
  });
  const markdown = formatRankedShadowReportMarkdown(report);
  const timestamp = generatedAt.toISOString().replace(/[-:.]/g, '');
  const outputDirectory = path.resolve(args.outputDir);
  const jsonPath = path.join(outputDirectory, `loveca-ranked-shadow-${timestamp}.json`);
  const markdownPath = path.join(outputDirectory, `loveca-ranked-shadow-${timestamp}.md`);

  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(markdownPath, markdown, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        readOnly: true,
        selectedRows: report.input.selectedRows,
        eligibleMatches: report.input.eligibleMatches,
        excludedRows: report.input.excludedRows,
        anonymousPlayers: report.matchSummary.playerCount,
        jsonPath,
        markdownPath,
      },
      null,
      2
    )
  );
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function parseArgs(rawArgs) {
  const parsed = {
    outputDir: 'ranked-shadow-output',
    from: null,
    to: null,
    origins: ['PUBLIC_TABLE'],
    statementTimeoutMs: 60_000,
    help: false,
  };

  for (const arg of rawArgs) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    const [name, value] = splitOption(arg);
    switch (name) {
      case '--output-dir':
        if (!value) {
          throw new Error('--output-dir must not be empty');
        }
        parsed.outputDir = value;
        break;
      case '--from':
        parsed.from = parseIsoDate(value, '--from');
        break;
      case '--to':
        parsed.to = parseIsoDate(value, '--to');
        break;
      case '--origins': {
        const origins = value
          .split(',')
          .map((origin) => origin.trim().toUpperCase())
          .filter(Boolean);
        if (origins.length === 0 || origins.some((origin) => !ALLOWED_ORIGINS.has(origin))) {
          throw new Error('--origins only accepts PUBLIC_TABLE and ONLINE_ROOM');
        }
        parsed.origins = [...new Set(origins)];
        break;
      }
      case '--statement-timeout-ms': {
        const timeout = Number(value);
        if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 300_000) {
          throw new Error('--statement-timeout-ms must be an integer from 1000 to 300000');
        }
        parsed.statementTimeoutMs = timeout;
        break;
      }
      default:
        throw new Error(`unknown option: ${name}`);
    }
  }

  if (parsed.from && parsed.to && parsed.from.getTime() >= parsed.to.getTime()) {
    throw new Error('--from must be earlier than --to');
  }
  return parsed;
}

function splitOption(arg) {
  if (!arg.startsWith('--') || !arg.includes('=')) {
    throw new Error(`options must use --name=value form: ${arg}`);
  }
  const separator = arg.indexOf('=');
  return [arg.slice(0, separator), arg.slice(separator + 1)];
}

function parseIsoDate(value, label) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) {
    throw new Error(`${label} must be a valid ISO date`);
  }
  return date;
}

function runAlgorithmSelfCheck() {
  const publishedExample = ratePeriod({ rating: 1500, ratingDeviation: 200 }, [
    { opponent: { rating: 1400, ratingDeviation: 30 }, score: 1 },
    { opponent: { rating: 1550, ratingDeviation: 100 }, score: 0 },
    { opponent: { rating: 1700, ratingDeviation: 300 }, score: 0 },
  ]);
  if (
    Math.abs(publishedExample.rating - 1464.11) > 0.02 ||
    Math.abs(publishedExample.ratingDeviation - 151.4) > 0.1
  ) {
    throw new Error('Glicko algorithm self-check failed; refusing to query production');
  }
}

export function buildRankedShadowReport(sourceRows, scope) {
  const exclusions = new Map();
  const selectedStatusCounts = new Map();
  const excludedStatusCounts = new Map();
  const eligible = [];

  for (const sourceRow of sourceRows) {
    const row = normalizeRow(sourceRow);
    incrementMap(selectedStatusCounts, row.status || 'EMPTY');
    const exclusion = scope.origins.includes(row.originKind)
      ? getExclusionReason(row)
      : 'ORIGIN_OUT_OF_SCOPE';
    if (exclusion) {
      incrementMap(exclusions, exclusion);
      incrementMap(excludedStatusCounts, row.status || 'EMPTY');
      continue;
    }
    eligible.push(row);
  }

  eligible.sort((first, second) => {
    const timeDifference = first.endedAt.getTime() - second.endedAt.getTime();
    return timeDifference || compareText(first.matchId, second.matchId);
  });

  const playerStates = new Map();
  const playerStats = new Map();
  const pairStats = new Map();
  const weeklyStats = new Map();
  const rulesVersions = new Map();
  const cardDataVersions = new Map();
  const runtimeCardDataHashes = new Map();
  const endReasons = new Map();
  const statusCounts = new Map();
  const lastOpponentByPlayer = new Map();
  const ratingChanges = [];
  let consecutiveRepeatMatches = 0;
  let firstSeatWins = 0;

  for (const match of eligible) {
    const firstBefore = playerStates.get(match.firstUserId) ?? createInitialState();
    const secondBefore = playerStates.get(match.secondUserId) ?? createInitialState();
    const settled = rateHeadToHead(
      firstBefore,
      secondBefore,
      match.winnerSeat === 'FIRST' ? 1 : 0,
      match.endedAt
    );
    playerStates.set(match.firstUserId, settled.first);
    playerStates.set(match.secondUserId, settled.second);

    const firstWon = match.winnerSeat === 'FIRST';
    recordPlayerMatch(playerStats, match.firstUserId, match.secondUserId, firstWon);
    recordPlayerMatch(playerStats, match.secondUserId, match.firstUserId, !firstWon);
    if (
      lastOpponentByPlayer.get(match.firstUserId) === match.secondUserId ||
      lastOpponentByPlayer.get(match.secondUserId) === match.firstUserId
    ) {
      consecutiveRepeatMatches += 1;
    }
    lastOpponentByPlayer.set(match.firstUserId, match.secondUserId);
    lastOpponentByPlayer.set(match.secondUserId, match.firstUserId);

    const pairKey = makePairKey(match.firstUserId, match.secondUserId);
    pairStats.set(pairKey, (pairStats.get(pairKey) ?? 0) + 1);
    ratingChanges.push(Math.abs(settled.first.rating - firstBefore.rating));
    ratingChanges.push(Math.abs(settled.second.rating - secondBefore.rating));
    if (firstWon) {
      firstSeatWins += 1;
    }

    incrementMap(statusCounts, match.status);
    incrementMap(endReasons, match.endReason ?? 'NULL');
    incrementMap(rulesVersions, match.rulesVersion);
    incrementMap(cardDataVersions, match.cardDataVersion);
    incrementMap(runtimeCardDataHashes, match.cardDataHash);
    recordWeeklyMatch(weeklyStats, match);
  }

  const leaderboard = [...playerStates.entries()]
    .map(([rawPlayerId, state]) => {
      const stats = playerStats.get(rawPlayerId);
      const opponentCounts = [...stats.opponents.values()];
      const maxSameOpponentMatches = Math.max(0, ...opponentCounts);
      return {
        player: pseudonymizePlayer(rawPlayerId),
        rating: round(state.rating, 3),
        displayedRating: Math.round(state.rating),
        ratingDeviation: round(state.ratingDeviation, 3),
        matches: state.ratedMatchCount,
        wins: stats.wins,
        losses: stats.losses,
        winRate: ratio(stats.wins, state.ratedMatchCount),
        uniqueOpponents: stats.opponents.size,
        maxSameOpponentMatches,
        maxOpponentConcentration: ratio(maxSameOpponentMatches, state.ratedMatchCount),
        placementComplete: state.ratedMatchCount >= ALGORITHM.placementMatchCount,
      };
    })
    .sort(
      (first, second) => second.rating - first.rating || compareText(first.player, second.player)
    );

  let visibleRank = 0;
  for (const entry of leaderboard) {
    if (entry.placementComplete) {
      visibleRank += 1;
      entry.rank = visibleRank;
    } else {
      entry.rank = null;
    }
  }

  const ratings = leaderboard.map((entry) => entry.rating);
  const deviations = leaderboard.map((entry) => entry.ratingDeviation);
  const matchesPerPlayer = leaderboard.map((entry) => entry.matches);
  const pairCounts = [...pairStats.values()];
  const repeatedPairMatches = pairCounts
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: scope.generatedAt.toISOString(),
    input: {
      source: 'production PostgreSQL match_records (read-only SELECT)',
      origins: scope.origins,
      fromStartedAt: scope.from?.toISOString() ?? null,
      toStartedAtExclusive: scope.to?.toISOString() ?? null,
      selectedRows: sourceRows.length,
      eligibleMatches: eligible.length,
      excludedRows: sourceRows.length - eligible.length,
      exclusions: mapToCountObject(exclusions),
      selectedStatusCounts: mapToCountObject(selectedStatusCounts),
      excludedStatusCounts: mapToCountObject(excludedStatusCounts),
      eligibility:
        'ONLINE + FULL + COMPLETED/SURRENDERED + sealedAt + endedAt + winnerSeat + two distinct players',
    },
    algorithm: ALGORITHM,
    matchSummary: {
      matchCount: eligible.length,
      playerCount: leaderboard.length,
      placementCompletePlayerCount: leaderboard.filter((entry) => entry.placementComplete).length,
      firstMatchEndedAt: eligible[0]?.endedAt.toISOString() ?? null,
      lastMatchEndedAt: eligible.at(-1)?.endedAt.toISOString() ?? null,
      firstSeatWins,
      secondSeatWins: eligible.length - firstSeatWins,
      firstSeatWinRate: ratio(firstSeatWins, eligible.length),
      statusCounts: mapToCountObject(statusCounts),
      endReasons: mapToCountObject(endReasons),
    },
    distributions: {
      rating: numericSummary(ratings),
      ratingDeviation: numericSummary(deviations),
      matchesPerPlayer: numericSummary(matchesPerPlayer),
      absolutePerPlayerRatingChange: numericSummary(ratingChanges),
    },
    opponentMix: {
      uniquePairs: pairStats.size,
      repeatedPairs: pairCounts.filter((count) => count > 1).length,
      matchesInRepeatedPairs: repeatedPairMatches,
      repeatedPairMatchRate: ratio(repeatedPairMatches, eligible.length),
      maximumMatchesForOnePair: Math.max(0, ...pairCounts),
      consecutiveRepeatMatches,
      consecutiveRepeatMatchRate: ratio(consecutiveRepeatMatches, eligible.length),
    },
    versions: {
      rules: mapToCountObject(rulesVersions),
      cardDataVersions: mapToCountObject(cardDataVersions),
      runtimeDeckCardDataHashes: {
        distinctHashes: runtimeCardDataHashes.size,
        hashesUsedByMultipleMatches: [...runtimeCardDataHashes.values()].filter(
          (count) => count > 1
        ).length,
        maximumMatchesPerHash: Math.max(0, ...runtimeCardDataHashes.values()),
      },
    },
    weekly: [...weeklyStats.entries()]
      .sort(([first], [second]) => compareText(first, second))
      .map(([week, stats]) => ({
        week,
        matches: stats.matches,
        activePlayers: stats.players.size,
        firstSeatWins: stats.firstSeatWins,
        firstSeatWinRate: ratio(stats.firstSeatWins, stats.matches),
      })),
    leaderboard,
    limitations: [
      'This shadow uses completed casual matches and does not validate demand for visible ranked play.',
      'Pure FIFO and repeated opponents can make rating order reflect opponent mix as well as player strength.',
      'FREE usage is not available from the selected match_records columns and is not estimated.',
      'A server-authoritative final state does not prove that every manual FREE operation followed full card rules.',
      'match_records.cardDataHash identifies the two match deck snapshots, not one global card catalog; it cannot freeze a season environment.',
      'No statistical significance claim is made; interpret small samples descriptively.',
      'The report contains pseudonymous player labels but no raw player IDs or match IDs.',
    ],
  };
}

function normalizeRow(row) {
  return {
    matchId: readText(row.matchId),
    matchMode: readText(row.matchMode),
    originKind: readText(row.originKind),
    status: readText(row.status),
    completeness: readText(row.completeness),
    startedAt: readDate(row.startedAt),
    endedAt: readNullableDate(row.endedAt),
    sealedAt: readNullableDate(row.sealedAt),
    firstUserId: readText(row.firstUserId),
    secondUserId: readText(row.secondUserId),
    winnerSeat: row.winnerSeat === null ? null : readText(row.winnerSeat),
    endReason: row.endReason === null ? null : readText(row.endReason),
    rulesVersion: readText(row.rulesVersion),
    cardDataVersion: readText(row.cardDataVersion),
    cardDataHash: readText(row.cardDataHash),
  };
}

function getExclusionReason(row) {
  if (!row.matchId) return 'INVALID_MATCH_ID';
  if (row.matchMode !== 'ONLINE') return 'NOT_ONLINE';
  if (row.status !== 'COMPLETED' && row.status !== 'SURRENDERED') {
    return 'NOT_COMPLETED_OR_SURRENDERED';
  }
  if (row.completeness !== 'FULL') return 'NOT_FULL';
  if (!row.endedAt) return 'MISSING_ENDED_AT';
  if (!row.sealedAt) return 'NOT_SEALED';
  if (row.winnerSeat !== 'FIRST' && row.winnerSeat !== 'SECOND') return 'MISSING_WINNER';
  if (!row.firstUserId || !row.secondUserId || row.firstUserId === row.secondUserId) {
    return 'INVALID_PARTICIPANTS';
  }
  if (
    !Number.isFinite(row.startedAt.getTime()) ||
    !Number.isFinite(row.endedAt.getTime()) ||
    !Number.isFinite(row.sealedAt.getTime())
  ) {
    return 'INVALID_TIMESTAMP';
  }
  return null;
}

function createInitialState() {
  return {
    rating: ALGORITHM.initialRating,
    ratingDeviation: ALGORITHM.initialRatingDeviation,
    ratedMatchCount: 0,
    lastRatedAtMs: null,
  };
}

function inflateDeviation(state, ratedAt) {
  if (state.lastRatedAtMs === null || state.ratingDeviation >= ALGORITHM.maximumRatingDeviation) {
    return state.ratingDeviation;
  }
  const elapsedMs = ratedAt.getTime() - state.lastRatedAtMs;
  if (elapsedMs < 0) {
    throw new Error('eligible matches are not in chronological settlement order');
  }
  const elapsedUnits = elapsedMs / DAY_MS;
  return Math.min(
    ALGORITHM.maximumRatingDeviation,
    Math.sqrt(
      state.ratingDeviation ** 2 + ALGORITHM.deviationIncreasePerTimeUnit ** 2 * elapsedUnits
    )
  );
}

function rateHeadToHead(first, second, firstScore, ratedAt) {
  const preparedFirst = {
    rating: first.rating,
    ratingDeviation: inflateDeviation(first, ratedAt),
  };
  const preparedSecond = {
    rating: second.rating,
    ratingDeviation: inflateDeviation(second, ratedAt),
  };
  const firstAfter = ratePeriod(preparedFirst, [{ opponent: preparedSecond, score: firstScore }]);
  const secondAfter = ratePeriod(preparedSecond, [
    { opponent: preparedFirst, score: 1 - firstScore },
  ]);
  return {
    first: {
      ...firstAfter,
      ratedMatchCount: first.ratedMatchCount + 1,
      lastRatedAtMs: ratedAt.getTime(),
    },
    second: {
      ...secondAfter,
      ratedMatchCount: second.ratedMatchCount + 1,
      lastRatedAtMs: ratedAt.getTime(),
    },
  };
}

function ratePeriod(player, results) {
  let inverseVarianceSum = 0;
  let ratingDeltaSum = 0;
  for (const result of results) {
    const impact =
      1 / Math.sqrt(1 + (3 * GLICKO_Q ** 2 * result.opponent.ratingDeviation ** 2) / Math.PI ** 2);
    const expected = 1 / (1 + 10 ** ((-impact * (player.rating - result.opponent.rating)) / 400));
    inverseVarianceSum += impact ** 2 * expected * (1 - expected);
    ratingDeltaSum += impact * (result.score - expected);
  }
  const estimatedVariance = 1 / (GLICKO_Q ** 2 * inverseVarianceSum);
  const precision = 1 / player.ratingDeviation ** 2 + 1 / estimatedVariance;
  return {
    rating: player.rating + (GLICKO_Q / precision) * ratingDeltaSum,
    ratingDeviation: Math.max(
      ALGORITHM.minimumRatingDeviation,
      Math.min(ALGORITHM.maximumRatingDeviation, Math.sqrt(1 / precision))
    ),
  };
}

function recordPlayerMatch(playerStats, playerId, opponentId, won) {
  let stats = playerStats.get(playerId);
  if (!stats) {
    stats = { wins: 0, losses: 0, opponents: new Map() };
    playerStats.set(playerId, stats);
  }
  if (won) {
    stats.wins += 1;
  } else {
    stats.losses += 1;
  }
  stats.opponents.set(opponentId, (stats.opponents.get(opponentId) ?? 0) + 1);
}

function recordWeeklyMatch(weeklyStats, match) {
  const week = isoWeekKey(match.endedAt);
  let stats = weeklyStats.get(week);
  if (!stats) {
    stats = { matches: 0, firstSeatWins: 0, players: new Set() };
    weeklyStats.set(week, stats);
  }
  stats.matches += 1;
  if (match.winnerSeat === 'FIRST') {
    stats.firstSeatWins += 1;
  }
  stats.players.add(match.firstUserId);
  stats.players.add(match.secondUserId);
}

function isoWeekKey(date) {
  const cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((cursor.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${cursor.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function makePairKey(firstPlayerId, secondPlayerId) {
  return firstPlayerId < secondPlayerId
    ? `${firstPlayerId}\u0000${secondPlayerId}`
    : `${secondPlayerId}\u0000${firstPlayerId}`;
}

function pseudonymizePlayer(rawPlayerId) {
  return `P_${createHash('sha256')
    .update(`${REPORT_SCHEMA_VERSION}\u0000${rawPlayerId}`)
    .digest('hex')
    .slice(0, 12)}`;
}

function incrementMap(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mapToCountObject(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => compareText(a, b)));
}

function compareText(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function readText(value) {
  return typeof value === 'string' ? value : '';
}

function readDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function readNullableDate(value) {
  if (value === null || value === undefined) return null;
  return readDate(value);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : round(numerator / denominator, 4);
}

function round(value, decimalPlaces) {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

function numericSummary(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    min: round(sorted[0], 3),
    p10: round(quantile(sorted, 0.1), 3),
    p25: round(quantile(sorted, 0.25), 3),
    median: round(quantile(sorted, 0.5), 3),
    p75: round(quantile(sorted, 0.75), 3),
    p90: round(quantile(sorted, 0.9), 3),
    max: round(sorted.at(-1), 3),
    mean: round(sum / sorted.length, 3),
  };
}

function quantile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];
  const fraction = position - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * fraction;
}

export function formatRankedShadowReportMarkdown(report) {
  const lines = [
    '# Loveca 赛季排位 Glicko 影子报告',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 报告版本：\`${report.schemaVersion}\``,
    `- 算法版本：\`${report.algorithm.algorithmVersion}\``,
    `- 来源：${report.input.origins.map(escapeMarkdown).join(', ')}`,
    `- 时间范围：${report.input.fromStartedAt ?? '不限'} ～ ${report.input.toStartedAtExclusive ?? '不限（不含结束值）'}`,
    `- 数据库事务：只读`,
    '',
    '## 数据筛选',
    '',
    `- SELECT 行数：${report.input.selectedRows}`,
    `- 纳入对局：${report.input.eligibleMatches}`,
    `- 排除行数：${report.input.excludedRows}`,
    `- 纳入条件：${report.input.eligibility}`,
    '',
    '| 排除原因 | 数量 |',
    '| --- | ---: |',
    ...countObjectRows(report.input.exclusions),
    '',
    '### SELECT 结果状态',
    '',
    '| 状态 | 数量 |',
    '| --- | ---: |',
    ...countObjectRows(report.input.selectedStatusCounts),
    '',
    '### 被排除行的状态',
    '',
    '| 状态 | 数量 |',
    '| --- | ---: |',
    ...countObjectRows(report.input.excludedStatusCounts),
    '',
    '## 对局概况',
    '',
    `- 匿名玩家数：${report.matchSummary.playerCount}`,
    `- 完成至少 ${report.algorithm.placementMatchCount} 局：${report.matchSummary.placementCompletePlayerCount}`,
    `- 影子对局时间：${report.matchSummary.firstMatchEndedAt ?? '无'} ～ ${report.matchSummary.lastMatchEndedAt ?? '无'}`,
    `- 先手胜：${report.matchSummary.firstSeatWins}`,
    `- 后手胜：${report.matchSummary.secondSeatWins}`,
    `- 先手胜率：${formatPercent(report.matchSummary.firstSeatWinRate)}`,
    '',
    '### 终局状态',
    '',
    '| 状态 | 数量 |',
    '| --- | ---: |',
    ...countObjectRows(report.matchSummary.statusCounts),
    '',
    '### 终局原因',
    '',
    '| 原因 | 数量 |',
    '| --- | ---: |',
    ...countObjectRows(report.matchSummary.endReasons),
    '',
    '## 分布',
    '',
    '| 指标 | min | p10 | p25 | median | p75 | p90 | max | mean |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    summaryRow('Rating', report.distributions.rating),
    summaryRow('RD', report.distributions.ratingDeviation),
    summaryRow('每人局数', report.distributions.matchesPerPlayer),
    summaryRow('单方每局绝对分差', report.distributions.absolutePerPlayerRatingChange),
    '',
    '## 对手重复',
    '',
    `- 不同玩家组合：${report.opponentMix.uniquePairs}`,
    `- 重复交手组合：${report.opponentMix.repeatedPairs}`,
    `- 属于重复组合的对局：${report.opponentMix.matchesInRepeatedPairs}（${formatPercent(report.opponentMix.repeatedPairMatchRate)}）`,
    `- 单一组合最多对局：${report.opponentMix.maximumMatchesForOnePair}`,
    `- 玩家连续再次遇到上一位对手的对局：${report.opponentMix.consecutiveRepeatMatches}（${formatPercent(report.opponentMix.consecutiveRepeatMatchRate)}）`,
    '',
    '## 匿名排行榜',
    '',
    '| 排名 | 玩家 | Rating | RD | 场次 | 胜-负 | 不同对手 | 单一对手最高占比 |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.leaderboard
      .slice(0, 50)
      .map((entry) =>
        [
          entry.rank ?? '定位中',
          entry.player,
          entry.displayedRating,
          round(entry.ratingDeviation, 1),
          entry.matches,
          `${entry.wins}-${entry.losses}`,
          entry.uniqueOpponents,
          formatPercent(entry.maxOpponentConcentration),
        ]
          .join(' | ')
          .replace(/^/, '| ')
          .replace(/$/, ' |')
      ),
    '',
    '## 每周样本',
    '',
    '| 周（UTC） | 对局 | 活跃玩家 | 先手胜率 |',
    '| --- | ---: | ---: | ---: |',
    ...report.weekly.map(
      (week) =>
        `| ${week.week} | ${week.matches} | ${week.activePlayers} | ${formatPercent(week.firstSeatWinRate)} |`
    ),
    '',
    '## 版本分布',
    '',
    '### 规则版本',
    '',
    '| 版本 | 对局 |',
    '| --- | ---: |',
    ...countObjectRows(report.versions.rules),
    '',
    '### 卡牌数据版本',
    '',
    '| 版本 | 对局 |',
    '| --- | ---: |',
    ...countObjectRows(report.versions.cardDataVersions),
    '',
    '### 对局卡组数据哈希',
    '',
    `- 不同哈希：${report.versions.runtimeDeckCardDataHashes.distinctHashes}`,
    `- 被多局复用的哈希：${report.versions.runtimeDeckCardDataHashes.hashesUsedByMultipleMatches}`,
    `- 单一哈希最多对应对局：${report.versions.runtimeDeckCardDataHashes.maximumMatchesPerHash}`,
    '- 该哈希由双方本局卡组快照生成，是对局级重放完整性标识，不是全局卡牌目录或赛季环境标识。',
    '',
    '## 限制',
    '',
    ...report.limitations.map((limitation) => `- ${limitation}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function countObjectRows(counts) {
  const entries = Object.entries(counts);
  return entries.length === 0
    ? ['| 无 | 0 |']
    : entries.map(([key, count]) => `| ${escapeMarkdown(key)} | ${count} |`);
}

function summaryRow(label, summary) {
  if (!summary) return `| ${label} | - | - | - | - | - | - | - | - |`;
  return `| ${label} | ${summary.min} | ${summary.p10} | ${summary.p25} | ${summary.median} | ${summary.p75} | ${summary.p90} | ${summary.max} | ${summary.mean} |`;
}

function escapeMarkdown(value) {
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
}

function formatPercent(value) {
  return value === null ? '-' : `${round(value * 100, 2)}%`;
}
