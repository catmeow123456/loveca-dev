#!/usr/bin/env node

/**
 * Read-only report for a real ranked season.
 *
 * It reads only ranked tables plus profiles.display_name/username. The output
 * deliberately includes public player names (at the operator's request), but
 * never includes emails, user IDs, match IDs, deck data, rooms, or replays.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const REPORT_SCHEMA_VERSION = 'loveca-ranked-volatility-report-v1';

const HELP = `Loveca 排位积分波动报告（只读）

用法：
  node scripts/generate-ranked-volatility-report.mjs [选项]

选项：
  --season-id=<UUID>        指定赛季；省略时要求恰有一个 ACTIVE/FINALIZING 赛季
  --output-dir=<目录>       输出目录，默认 ./ranked-volatility-output
  --statement-timeout-ms=N  SELECT 超时，默认 60000，范围 1000～300000
  --help                    显示帮助

环境变量：
  DATABASE_URL              必填；不会被输出

输出：
  loveca-ranked-volatility-<时间>.json
  loveca-ranked-volatility-<时间>.md

报告包含显示名称/用户名，以便核对排行榜；不包含邮箱、用户 ID、match ID、
卡组、房间号、聊天、checkpoint 或隐藏对局数据。`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const generatedAt = new Date();
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    application_name: 'loveca-ranked-volatility-report',
  });
  let payload;
  const client = await pool.connect();
  try {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(`SET LOCAL statement_timeout TO '${args.statementTimeoutMs}ms'`);
    await client.query("SET LOCAL lock_timeout TO '2000ms'");
    const mode = await client.query('SHOW transaction_read_only');
    if (mode.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('database transaction is not read-only; refusing to continue');
    }
    const result = await client.query(RANKED_VOLATILITY_REPORT_SQL, [args.seasonId]);
    payload = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Keep the root error.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const report = buildRankedVolatilityReport(payload, generatedAt);
  const markdown = formatRankedVolatilityReportMarkdown(report);
  const stamp = generatedAt.toISOString().replace(/[-:.]/g, '');
  const outputDirectory = path.resolve(args.outputDir);
  const jsonPath = path.join(outputDirectory, `loveca-ranked-volatility-${stamp}.json`);
  const markdownPath = path.join(outputDirectory, `loveca-ranked-volatility-${stamp}.md`);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(markdownPath, markdown, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        ok: true,
        readOnly: true,
        season: report.season.seasonKey,
        effectiveRatedMatches: report.ratingLedger.effectiveRatedMatches,
        players: report.playerStability.playerCount,
        jsonPath,
        markdownPath,
      },
      null,
      2
    )
  );
}

export const RANKED_VOLATILITY_REPORT_SQL = `
WITH candidate_seasons AS (
  SELECT id, season_key, name, lifecycle, queue_admission, starts_at, scheduled_ends_at,
         rating_algorithm_version, rating_config, leaderboard_minimum_match_count, ledger_revision
  FROM ranked_seasons
  WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
     OR ($1::uuid IS NULL AND lifecycle IN ('ACTIVE', 'FINALIZING'))
  ORDER BY starts_at DESC
  LIMIT 2
), selected AS (
  SELECT * FROM candidate_seasons
), selected_players AS (
  SELECT DISTINCT user_id FROM ranked_player_ratings WHERE season_id IN (SELECT id FROM selected)
  UNION
  SELECT DISTINCT user_id FROM ranked_player_seeds WHERE season_id IN (SELECT id FROM selected)
  UNION
  SELECT first_user_id FROM ranked_rating_events WHERE season_id IN (SELECT id FROM selected)
  UNION
  SELECT second_user_id FROM ranked_rating_events WHERE season_id IN (SELECT id FROM selected)
)
SELECT
  COALESCE((SELECT jsonb_agg(to_jsonb(selected) ORDER BY starts_at DESC) FROM selected), '[]'::jsonb) AS seasons,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', event.id, 'eventSequence', event.event_sequence, 'eventType', event.event_type,
    'matchId', event.match_id, 'targetEventId', event.target_event_id,
    'firstUserId', event.first_user_id, 'secondUserId', event.second_user_id,
    'winnerSeat', event.winner_seat, 'resultType', event.result_type,
    'ratedAt', event.rated_at, 'algorithmVersion', event.algorithm_version
  ) ORDER BY event.event_sequence ASC) FROM ranked_rating_events event
    WHERE event.season_id IN (SELECT id FROM selected)), '[]'::jsonb) AS events,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'userId', seed.user_id, 'rating', seed.rating, 'ratingDeviation', seed.rating_deviation
  ) ORDER BY seed.user_id) FROM ranked_player_seeds seed
    WHERE seed.season_id IN (SELECT id FROM selected)), '[]'::jsonb) AS seeds,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'userId', rating.user_id, 'rating', rating.rating, 'ratingDeviation', rating.rating_deviation,
    'ratedMatchCount', rating.rated_match_count, 'lastRatedAt', rating.last_rated_at
  ) ORDER BY rating.user_id) FROM ranked_player_ratings rating
    WHERE rating.season_id IN (SELECT id FROM selected)), '[]'::jsonb) AS projections,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'userId', profile.id, 'name', COALESCE(NULLIF(profile.display_name, ''), profile.username)
  ) ORDER BY profile.id) FROM profiles profile WHERE profile.id IN (SELECT user_id FROM selected_players)), '[]'::jsonb) AS players,
  COALESCE((SELECT jsonb_object_agg(key, count) FROM (
    SELECT rating_status || ':' || COALESCE(result_type, 'NULL') AS key, COUNT(*)::int AS count
    FROM ranked_matches WHERE season_id IN (SELECT id FROM selected)
    GROUP BY rating_status, result_type
  ) counts), '{}'::jsonb) AS match_status_counts
`;

export function buildRankedVolatilityReport(payload, generatedAt = new Date()) {
  const seasons = array(payload?.seasons);
  if (seasons.length === 0) throw new Error('no matching ranked season found');
  if (seasons.length > 1)
    throw new Error('multiple active/finalizing seasons found; pass --season-id');
  const season = seasons[0];
  const config = parseConfig(season.rating_config);
  if (config.algorithmVersion !== season.rating_algorithm_version) {
    throw new Error('season rating algorithm version does not match rating_config');
  }
  const names = new Map(
    array(payload.players).map((player) => [player.userId, safeName(player.name)])
  );
  const events = array(payload.events).map(normalizeEvent);
  const effectiveEvents = resolveEffectiveEvents(events, config.algorithmVersion);
  const seeds = new Map(
    array(payload.seeds).map((seed) => [
      seed.userId,
      {
        rating: number(seed.rating),
        ratingDeviation: clampDeviation(number(seed.ratingDeviation), config),
        ratedMatchCount: 0,
        lastRatedAt: null,
      },
    ])
  );
  const players = new Map([...seeds.entries()].map(([id, state]) => [id, cloneState(state)]));
  const playerStats = new Map();
  const allChanges = [];
  const winnerChanges = [];
  const loserChanges = [];
  const asymmetry = [];
  const changeBands = new Map([
    ['第 1 局', []],
    ['第 2～3 局', []],
    ['第 4～9 局', []],
    ['第 10 局及以后', []],
  ]);

  for (const event of effectiveEvents) {
    const firstBefore = cloneState(players.get(event.firstUserId) ?? initialState(config));
    const secondBefore = cloneState(players.get(event.secondUserId) ?? initialState(config));
    const rated = rateHeadToHead(
      firstBefore,
      secondBefore,
      event.winnerSeat === 'FIRST' ? 1 : 0,
      event.ratedAt,
      config
    );
    players.set(event.firstUserId, rated.first);
    players.set(event.secondUserId, rated.second);
    const firstDelta = rated.first.rating - firstBefore.rating;
    const secondDelta = rated.second.rating - secondBefore.rating;
    allChanges.push(Math.abs(firstDelta), Math.abs(secondDelta));
    const winnerDelta = event.winnerSeat === 'FIRST' ? firstDelta : secondDelta;
    const loserDelta = event.winnerSeat === 'FIRST' ? secondDelta : firstDelta;
    winnerChanges.push(winnerDelta);
    loserChanges.push(Math.abs(loserDelta));
    asymmetry.push(Math.abs(Math.abs(firstDelta) - Math.abs(secondDelta)));
    const firstBand = matchBand(firstBefore.ratedMatchCount);
    const secondBand = matchBand(secondBefore.ratedMatchCount);
    changeBands.get(firstBand).push(Math.abs(firstDelta));
    changeBands.get(secondBand).push(Math.abs(secondDelta));
    recordPlayerMatch(
      playerStats,
      event.firstUserId,
      event.secondUserId,
      event.winnerSeat === 'FIRST'
    );
    recordPlayerMatch(
      playerStats,
      event.secondUserId,
      event.firstUserId,
      event.winnerSeat === 'SECOND'
    );
  }

  const projection = new Map(array(payload.projections).map((row) => [row.userId, row]));
  const projectionMismatches = [];
  for (const [userId, state] of players) {
    const stored = projection.get(userId);
    if (
      !stored ||
      Math.abs(number(stored.rating) - state.rating) > 0.001 ||
      Math.abs(number(stored.ratingDeviation) - state.ratingDeviation) > 0.001 ||
      Number(stored.ratedMatchCount) !== state.ratedMatchCount ||
      nullableTime(stored.lastRatedAt) !== nullableTime(state.lastRatedAt)
    ) {
      projectionMismatches.push(userId);
    }
  }
  for (const userId of projection.keys())
    if (!players.has(userId)) projectionMismatches.push(userId);

  const leaderboard = [...players.entries()]
    .map(([userId, state]) => {
      const stats = playerStats.get(userId) ?? { wins: 0, losses: 0, opponents: new Map() };
      const opponentCounts = [...stats.opponents.values()];
      return {
        player: names.get(userId) ?? '（已删除用户）',
        rating: round(state.rating, 3),
        displayedRating: Math.round(state.rating),
        ratingDeviation: round(state.ratingDeviation, 3),
        matches: state.ratedMatchCount,
        wins: stats.wins,
        losses: stats.losses,
        winRate: ratio(stats.wins, state.ratedMatchCount),
        uniqueOpponents: stats.opponents.size,
        maxSameOpponentMatches: Math.max(0, ...opponentCounts),
        maxOpponentConcentration: ratio(Math.max(0, ...opponentCounts), state.ratedMatchCount),
      };
    })
    .sort((a, b) => b.rating - a.rating || a.player.localeCompare(b.player, 'zh-Hans-CN'));
  const leaderboardMinimum = Number(season.leaderboard_minimum_match_count);
  assignRanks(leaderboard, leaderboardMinimum);
  const scenarios = [1, 3, 5, 10].map((minimumMatches) => ({
    minimumMatches,
    eligiblePlayers: leaderboard.filter((player) => player.matches >= minimumMatches).length,
    leader: leaderboard.find((player) => player.matches >= minimumMatches) ?? null,
  }));
  const earlyLeaders = leaderboard.filter((player) => player.matches <= 3).slice(0, 10);
  const stabilityBands = [
    ['1～3 场', 1, 3],
    ['4～9 场', 4, 9],
    ['10 场以上', 10, Infinity],
  ].map(([label, low, high]) => {
    const entries = leaderboard.filter((player) => player.matches >= low && player.matches <= high);
    return {
      label,
      players: entries.length,
      ratingDeviation: numericSummary(entries.map((p) => p.ratingDeviation)),
      rating: numericSummary(entries.map((p) => p.rating)),
    };
  });

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    privacy:
      'Includes display names/usernames by operator approval; excludes emails, user IDs, match IDs, decks, rooms, and replay payloads.',
    season: {
      seasonKey: season.season_key,
      name: season.name,
      lifecycle: season.lifecycle,
      queueAdmission: season.queue_admission,
      startsAt: iso(season.starts_at),
      scheduledEndsAt: iso(season.scheduled_ends_at),
      algorithmVersion: season.rating_algorithm_version,
      leaderboardMinimumMatchCount: leaderboardMinimum,
      configuredPlacementMatchCount: config.placementMatchCount,
      ledgerRevision: Number(season.ledger_revision),
    },
    algorithm: publicConfig(config),
    input: {
      source: 'ranked tables + public player display names, one repeatable-read read-only SELECT',
      matchStatusCounts: payload.match_status_counts ?? {},
    },
    ratingLedger: {
      totalEvents: events.length,
      effectiveRatedMatches: effectiveEvents.length,
      voidedOrReplacedDirectives: events.length - effectiveEvents.length,
      projectionMatchesLedger: projectionMismatches.length === 0,
      projectionMismatchPlayerCount: projectionMismatches.length,
    },
    perMatchChange: {
      absolutePerPlayerDelta: numericSummary(allChanges),
      winnerGain: numericSummary(winnerChanges),
      loserLoss: numericSummary(loserChanges),
      twoPlayerAbsoluteDeltaGap: numericSummary(asymmetry),
      byPlayerPreMatchCount: Object.fromEntries(
        [...changeBands.entries()].map(([label, values]) => [label, numericSummary(values)])
      ),
    },
    playerStability: {
      playerCount: leaderboard.length,
      matchBands: stabilityBands,
      earlySampleLeaders: earlyLeaders,
    },
    leaderboardScenarios: scenarios,
    leaderboard,
    limitations: [
      '描述性报告，不将少量对局解释为玩家真实强度或因果关系。',
      'Glicko 允许双方变化不对称；单局两人加减分不要求零和。',
      '更正流水会按最终有效指令重放；报告不保留任何 match ID。',
      '报告含显示名称，请只在获授权的运营/开发渠道传递。',
    ],
  };
}

function resolveEffectiveEvents(events, algorithmVersion) {
  const latestByMatch = new Map();
  for (const event of [...events].sort(
    (a, b) => a.eventSequence - b.eventSequence || a.id.localeCompare(b.id)
  )) {
    const latest = latestByMatch.get(event.matchId);
    if (event.eventType === 'SETTLEMENT') {
      if (latest || event.targetEventId !== null) throw new Error('invalid settlement chain');
    } else if (!latest || event.targetEventId !== latest.id) {
      throw new Error('stale ranked correction chain');
    } else if (
      event.firstUserId !== latest.firstUserId ||
      event.secondUserId !== latest.secondUserId ||
      event.ratedAt.getTime() !== latest.ratedAt.getTime()
    ) {
      throw new Error('ranked correction identity mismatch');
    }
    latestByMatch.set(event.matchId, event);
  }
  for (const event of latestByMatch.values()) {
    if (event.algorithmVersion !== algorithmVersion) {
      throw new Error('effective rating event algorithm version mismatch');
    }
  }
  return [...latestByMatch.values()]
    .filter((event) => event.eventType !== 'VOID' && event.winnerSeat !== null)
    .sort(
      (a, b) =>
        a.ratedAt.getTime() - b.ratedAt.getTime() ||
        a.matchId.localeCompare(b.matchId) ||
        a.eventSequence - b.eventSequence
    );
}

function parseConfig(raw) {
  const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const keys = [
    'ratingScale',
    'initialRating',
    'initialRatingDeviation',
    'minimumRatingDeviation',
    'maximumRatingDeviation',
    'inactivityTimeUnitMs',
    'deviationIncreasePerTimeUnit',
    'placementMatchCount',
  ];
  for (const key of keys)
    if (!Number.isFinite(Number(config?.[key]))) throw new Error(`invalid rating_config.${key}`);
  if (config.ratingPeriodMode !== 'PER_MATCH')
    throw new Error('only PER_MATCH Glicko seasons are supported');
  if (typeof config.algorithmVersion !== 'string' || !config.algorithmVersion)
    throw new Error('invalid rating_config.algorithmVersion');
  return config;
}

function publicConfig(config) {
  return {
    ratingScale: Number(config.ratingScale),
    initialRating: Number(config.initialRating),
    initialRatingDeviation: Number(config.initialRatingDeviation),
    minimumRatingDeviation: Number(config.minimumRatingDeviation),
    maximumRatingDeviation: Number(config.maximumRatingDeviation),
    inactivityTimeUnitMs: Number(config.inactivityTimeUnitMs),
    deviationIncreasePerTimeUnit: Number(config.deviationIncreasePerTimeUnit),
    placementMatchCount: Number(config.placementMatchCount),
    displayDecimalPlaces: Number(config.displayDecimalPlaces),
    ...(config.growthPool ? { growthPool: config.growthPool } : {}),
  };
}

function initialState(config) {
  return {
    rating: Number(config.initialRating),
    ratingDeviation: Number(config.initialRatingDeviation),
    ratedMatchCount: 0,
    lastRatedAt: null,
  };
}
function cloneState(state) {
  return { ...state, lastRatedAt: state.lastRatedAt ? new Date(state.lastRatedAt) : null };
}
function rateHeadToHead(first, second, firstScore, ratedAt, config) {
  const preparedFirst = { ...first, ratingDeviation: increasedDeviation(first, ratedAt, config) };
  const preparedSecond = {
    ...second,
    ratingDeviation: increasedDeviation(second, ratedAt, config),
  };
  const firstAfter = ratePeriod(preparedFirst, preparedSecond, firstScore, config);
  const secondAfter = ratePeriod(preparedSecond, preparedFirst, 1 - firstScore, config);
  const result = {
    first: { ...firstAfter, ratedMatchCount: first.ratedMatchCount + 1, lastRatedAt: ratedAt },
    second: { ...secondAfter, ratedMatchCount: second.ratedMatchCount + 1, lastRatedAt: ratedAt },
  };
  const growth = config.growthPool;
  if (
    !growth?.enabled ||
    first.ratedMatchCount < Number(config.placementMatchCount) ||
    second.ratedMatchCount < Number(config.placementMatchCount)
  )
    return result;
  if (growth.mode !== 'POST_PLACEMENT_AVERAGE_CENTERED' || growth.positiveSplitMode !== 'EQUAL') {
    throw new Error('unsupported ranked growth configuration');
  }
  const total =
    Number(growth.maximumTotalAdjustment) *
    Math.tanh(
      (Number(growth.centerRating) - (first.rating + second.rating) / 2) /
        Number(growth.transitionWidth)
    );
  const winnerShare = Number(growth.negativeWinnerShare);
  const firstAdjustment =
    total >= 0 ? total / 2 : total * (firstScore === 1 ? winnerShare : 1 - winnerShare);
  const secondAdjustment = total - firstAdjustment;
  return {
    first: { ...result.first, rating: result.first.rating + firstAdjustment },
    second: { ...result.second, rating: result.second.rating + secondAdjustment },
  };
}
function increasedDeviation(state, ratedAt, config) {
  if (!state.lastRatedAt) return state.ratingDeviation;
  const elapsed = ratedAt.getTime() - state.lastRatedAt.getTime();
  if (elapsed < 0) throw new Error('non-monotonic rating event time');
  return Math.min(
    Number(config.maximumRatingDeviation),
    Math.max(
      Number(config.minimumRatingDeviation),
      Math.sqrt(
        state.ratingDeviation ** 2 +
          (Number(config.deviationIncreasePerTimeUnit) ** 2 * elapsed) /
            Number(config.inactivityTimeUnitMs)
      )
    )
  );
}
function ratePeriod(player, opponent, score, config) {
  const q = Math.log(10) / Number(config.ratingScale);
  const impact = 1 / Math.sqrt(1 + (3 * q ** 2 * opponent.ratingDeviation ** 2) / Math.PI ** 2);
  const expected =
    1 / (1 + 10 ** ((-impact * (player.rating - opponent.rating)) / Number(config.ratingScale)));
  const variance = 1 / (q ** 2 * impact ** 2 * expected * (1 - expected));
  const precision = 1 / player.ratingDeviation ** 2 + 1 / variance;
  return {
    rating: player.rating + (q / precision) * impact * (score - expected),
    ratingDeviation: clampDeviation(Math.sqrt(1 / precision), config),
  };
}

function recordPlayerMatch(statsByPlayer, playerId, opponentId, won) {
  const stats = statsByPlayer.get(playerId) ?? { wins: 0, losses: 0, opponents: new Map() };
  if (won) stats.wins += 1;
  else stats.losses += 1;
  stats.opponents.set(opponentId, (stats.opponents.get(opponentId) ?? 0) + 1);
  statsByPlayer.set(playerId, stats);
}
function assignRanks(leaderboard, minimum) {
  let rank = 0;
  for (const player of leaderboard) player.rank = player.matches >= minimum ? ++rank : null;
}
function matchBand(matches) {
  return matches === 0
    ? '第 1 局'
    : matches <= 2
      ? '第 2～3 局'
      : matches <= 8
        ? '第 4～9 局'
        : '第 10 局及以后';
}
function normalizeEvent(event) {
  return {
    id: String(event.id),
    eventSequence: Number(event.eventSequence),
    eventType: String(event.eventType),
    matchId: String(event.matchId),
    targetEventId: event.targetEventId === null ? null : String(event.targetEventId),
    firstUserId: String(event.firstUserId),
    secondUserId: String(event.secondUserId),
    winnerSeat: event.winnerSeat === null ? null : String(event.winnerSeat),
    ratedAt: new Date(event.ratedAt),
    algorithmVersion: String(event.algorithmVersion),
  };
}
function numericSummary(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    min: round(sorted[0], 3),
    p10: round(quantile(sorted, 0.1), 3),
    p25: round(quantile(sorted, 0.25), 3),
    median: round(quantile(sorted, 0.5), 3),
    p75: round(quantile(sorted, 0.75), 3),
    p90: round(quantile(sorted, 0.9), 3),
    p95: round(quantile(sorted, 0.95), 3),
    max: round(sorted.at(-1), 3),
    mean: round(sum / sorted.length, 3),
  };
}
function quantile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}
function ratio(n, d) {
  return d === 0 ? null : round(n / d, 4);
}
function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
function array(value) {
  return Array.isArray(value) ? value : typeof value === 'string' ? JSON.parse(value) : [];
}
function number(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('expected finite number');
  return parsed;
}
function clampDeviation(value, config) {
  return Math.min(
    Number(config.maximumRatingDeviation),
    Math.max(Number(config.minimumRatingDeviation), value)
  );
}
function nullableTime(value) {
  return value == null ? null : new Date(value).getTime();
}
function iso(value) {
  return new Date(value).toISOString();
}
function safeName(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '（未命名）';
}

export function formatRankedVolatilityReportMarkdown(report) {
  const lines = [
    '# Loveca 排位积分波动报告',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 赛季：${escapeMarkdown(report.season.name)}（${escapeMarkdown(report.season.seasonKey)}）`,
    `- 算法：\`${report.season.algorithmVersion}\``,
    `- 数据库事务：REPEATABLE READ / READ ONLY`,
    `- 当前参榜门槛：${report.season.leaderboardMinimumMatchCount} 场；算法配置定位场次：${report.season.configuredPlacementMatchCount} 场`,
    '',
    '## 结算完整性',
    '',
    `- 有效计分对局：${report.ratingLedger.effectiveRatedMatches}；流水事件：${report.ratingLedger.totalEvents}`,
    `- 与当前 rating 投影一致：${report.ratingLedger.projectionMatchesLedger ? '是' : `否（${report.ratingLedger.projectionMismatchPlayerCount} 名玩家不一致）`}`,
    '',
    '## 单局积分变化',
    '',
    '| 指标 | 中位数 | P90 | P95 | 最大值 |',
    '| --- | ---: | ---: | ---: | ---: |',
    summaryRow('单方绝对变化', report.perMatchChange.absolutePerPlayerDelta),
    summaryRow('胜者加分', report.perMatchChange.winnerGain),
    summaryRow('负者扣分绝对值', report.perMatchChange.loserLoss),
    summaryRow('同局双方绝对变化差', report.perMatchChange.twoPlayerAbsoluteDeltaGap),
    '',
    '### 按赛前场次',
    '',
    '| 场次 | 中位数 | P90 | 最大值 |',
    '| --- | ---: | ---: | ---: |',
    ...Object.entries(report.perMatchChange.byPlayerPreMatchCount).map(
      ([label, value]) =>
        `| ${label} | ${summaryValue(value, 'median')} | ${summaryValue(value, 'p90')} | ${summaryValue(value, 'max')} |`
    ),
    '',
    '## 参榜门槛情景',
    '',
    '| 门槛 | 可上榜人数 | 第一名 | 积分 | RD | 场次 |',
    '| ---: | ---: | --- | ---: | ---: | ---: |',
    ...report.leaderboardScenarios.map(
      (scenario) =>
        `| ${scenario.minimumMatches} | ${scenario.eligiblePlayers} | ${escapeMarkdown(scenario.leader?.player ?? '—')} | ${scenario.leader?.displayedRating ?? '—'} | ${scenario.leader ? round(scenario.leader.ratingDeviation, 1) : '—'} | ${scenario.leader?.matches ?? '—'} |`
    ),
    '',
    '## 当前榜首与短样本',
    '',
    '| 排名 | 玩家 | 积分 | RD | 场次 | 胜-负 | 对手数 |',
    '| ---: | --- | ---: | ---: | ---: | --- |',
    ...report.leaderboard.slice(0, 20).map(playerRow),
    '',
    '### 仅 1～3 场玩家中的最高积分者',
    '',
    '| 玩家 | 积分 | RD | 场次 | 胜-负 |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.playerStability.earlySampleLeaders.map(
      (player) =>
        `| ${escapeMarkdown(player.player)} | ${player.displayedRating} | ${round(player.ratingDeviation, 1)} | ${player.matches} | ${player.wins}-${player.losses} |`
    ),
    '',
    '## RD 稳定性',
    '',
    '| 场次 | 玩家数 | RD 中位数 | RD P90 | RD 最大值 |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.playerStability.matchBands.map(
      (band) =>
        `| ${band.label} | ${band.players} | ${summaryValue(band.ratingDeviation, 'median')} | ${summaryValue(band.ratingDeviation, 'p90')} | ${summaryValue(band.ratingDeviation, 'max')} |`
    ),
    '',
    '## 说明',
    '',
    ...report.limitations.map((item) => `- ${item}`),
    '',
  ];
  return lines.join('\n');
}
function summaryRow(label, value) {
  return `| ${label} | ${summaryValue(value, 'median')} | ${summaryValue(value, 'p90')} | ${summaryValue(value, 'p95')} | ${summaryValue(value, 'max')} |`;
}
function summaryValue(summary, key) {
  return summary ? summary[key] : '—';
}
function playerRow(player) {
  return `| ${player.rank ?? '定位中'} | ${escapeMarkdown(player.player)} | ${player.displayedRating} | ${round(player.ratingDeviation, 1)} | ${player.matches} | ${player.wins}-${player.losses} | ${player.uniqueOpponents} |`;
}
function escapeMarkdown(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function parseArgs(rawArgs) {
  const args = {
    seasonId: null,
    outputDir: 'ranked-volatility-output',
    statementTimeoutMs: 60_000,
    help: false,
  };
  for (const arg of rawArgs) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!arg.startsWith('--') || !arg.includes('='))
      throw new Error(`options must use --name=value form: ${arg}`);
    const [name, value] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
    if (name === '--season-id') {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
        throw new Error('--season-id must be a UUID');
      args.seasonId = value;
    } else if (name === '--output-dir') {
      if (!value) throw new Error('--output-dir must not be empty');
      args.outputDir = value;
    } else if (name === '--statement-timeout-ms') {
      const timeout = Number(value);
      if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 300_000)
        throw new Error('--statement-timeout-ms must be an integer from 1000 to 300000');
      args.statementTimeoutMs = timeout;
    } else throw new Error(`unknown option: ${name}`);
  }
  return args;
}
function isDirectExecution() {
  return (
    Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  );
}

if (isDirectExecution()) {
  await main();
}
