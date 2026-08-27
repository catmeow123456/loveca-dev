import type {
  ThemeDeckChoiceView,
  ThemeMatchupStatisticsView,
  ThemePrebuiltDeckView,
  ThemeTableAvailabilityState,
  ThemeTableEventView,
  ThemeTableOverviewView,
  ThemeTablePlayerSeasonView,
} from '../../online/theme-table-types.js';
import { pool } from '../db/pool.js';
import { getCurrentRankedCardCatalogIdentity } from '../rating/ranked-environment.js';
import {
  PublicTableServiceError,
  publicTableService,
  type MatchmakingQueueContext,
} from './public-table-service.js';
import { REPLAY_RULES_VERSION } from './replay-constants.js';
import {
  getRankedQueueWindowTiming,
  type RankedSeasonOpenWindow,
} from './ranked-season-service.js';
import { activityCoverService } from './activity-cover-service.js';
import { buildThemeDeckCandidateIds } from './theme-table-deck-choice.js';

interface ThemeRow {
  readonly id: string;
  readonly version_key: string;
  readonly name: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
  readonly environment_id: string;
  readonly rules_environment_id: string;
  readonly card_catalog_hash: string;
  readonly platform_time_zone: string;
  readonly open_windows: RankedSeasonOpenWindow[];
  readonly allocation_algorithm_version: string;
  readonly deck_choice_count: number;
  readonly starts_at: Date | string;
  readonly ends_at: Date | string;
  readonly schedule_label: string;
  readonly summary: string;
  readonly announcement: string;
}

interface DeckRow {
  readonly id: string;
  readonly deck_key: string;
  readonly display_name: string;
  readonly deck_list: unknown;
  readonly content_hash: string;
  readonly play_style_tags: unknown;
  readonly difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  readonly source_label: string;
  readonly source_url: string | null;
}

interface QueueContextRow {
  readonly theme_table_version_id: string;
  readonly environment_id: string;
}

interface ThemeReservationSeatRow {
  readonly ticket_id: string;
  readonly first_ticket_id: string;
  readonly source_deck_name: string;
  readonly deck_content_hash: string;
}

interface PlayerSeasonRow {
  readonly completed_matches: string;
  readonly wins: string;
  readonly losses: string;
  readonly draws: string;
}

interface MatchupStatisticsRow {
  readonly first_deck_version_id: string;
  readonly second_deck_version_id: string;
  readonly completed_matches: string;
  readonly first_deck_wins: string;
  readonly second_deck_wins: string;
  readonly draws: string;
}

interface ThemeQueueContext extends MatchmakingQueueContext {
  readonly queueKind: 'THEME';
  readonly participationKind: 'THEME_QUEUE';
  readonly themeTableVersionId: string;
}

export class ThemeTablePlayerServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ThemeTablePlayerServiceError';
  }
}

export class ThemeTablePlayerService {
  constructor(private readonly now: () => number = () => Date.now()) {}

  async getOverview(userId: string): Promise<ThemeTableOverviewView> {
    const queueContext = await this.loadUserQueueContext(userId);
    const event = queueContext
      ? await this.loadThemeById(queueContext.themeTableVersionId)
      : await this.loadVisibleTheme();
    const context = queueContext ?? (event ? toQueueContext(event) : noThemeContext());
    const queue = await publicTableService.getStatus(userId, context);
    if (!event) {
      return {
        event: null,
        availability: { state: 'NO_EVENT', canJoin: false, message: '当前没有开放的娱乐模式' },
        player: null,
        queue,
        deckChoice: null,
      };
    }
    const [decks, matchupStatistics, availability, player, cover] = await Promise.all([
      this.loadDecks(event.id),
      this.loadMatchupStatistics(event.id),
      this.getAvailability(event),
      this.loadPlayerSeason(event.id, userId),
      activityCoverService.getPublic('THEME', event.id),
    ]);
    const eventView = mapEvent(event, decks, matchupStatistics, cover);
    const deckChoice =
      queue.state === 'PENDING_CONFIRMATION' && queue.reservationId
        ? await this.loadDeckChoice(
            userId,
            event,
            eventView.prebuiltDecks,
            eventView.matchupStatistics,
            queue.reservationId
          )
        : null;
    return {
      event: eventView,
      availability,
      player,
      queue,
      deckChoice,
    };
  }

  async join(userId: string) {
    const event = await this.requireJoinableTheme();
    const context = toQueueContext(event);
    const current = await publicTableService.getStatus(userId, context);
    if (current.state !== 'IDLE') return current;
    return publicTableService.join(userId, null, 'DIRECT', context);
  }

  async heartbeat(userId: string) {
    const context = await this.requireUserQueueContext(userId);
    const theme = await this.loadThemeById(context.themeTableVersionId);
    const availability = await this.getAvailability(theme);
    const status = await publicTableService.getStatus(userId, context);
    if (status.state === 'WAITING' && !availability.canJoin) {
      await publicTableService.expireWaitingTickets(context, 'THEME_WINDOW_CLOSED');
      return publicTableService.getStatus(userId, context);
    }
    return publicTableService.heartbeat(userId, context);
  }

  async confirm(userId: string, requestedDeckVersionId?: string) {
    const context = await this.requireUserQueueContext(userId);
    const status = await publicTableService.getStatus(userId, context);
    if (status.state !== 'PENDING_CONFIRMATION' || !status.reservationId) {
      return publicTableService.confirm(userId, context);
    }
    const event = await this.loadThemeById(context.themeTableVersionId);
    const [decks, matchups] = await Promise.all([
      this.loadDecks(event.id),
      this.loadEnabledMatchups(event.id),
    ]);
    const choice = await this.loadDeckChoice(userId, event, decks, matchups, status.reservationId);
    const selectedDeckId =
      event.deck_choice_count === 1 ? choice?.candidates[0]?.id : requestedDeckVersionId;
    if (!selectedDeckId || !choice?.candidates.some((deck) => deck.id === selectedDeckId)) {
      throw playerError(
        'THEME_DECK_CHOICE_INVALID',
        event.deck_choice_count === 1 ? '本次匹配没有可用卡组' : '请选择本次匹配抽到的一副卡组',
        409
      );
    }
    const locked = await pool.query<{ ticket_id: string }>(
      `UPDATE public_table_tickets AS ticket
       SET source_deck_name = deck.display_name,
           runtime_deck = deck.runtime_deck,
           deck_content_hash = deck.content_hash,
           deck_locked_at = $4,
           updated_at = $4
       FROM gameplay_participations AS participation,
            public_table_reservations AS reservation,
            theme_prebuilt_deck_versions AS deck
       WHERE participation.user_id = $1
         AND participation.kind = 'THEME_QUEUE'
         AND participation.ticket_id = ticket.id
         AND ticket.reservation_id = $2
         AND ticket.state = 'RESERVED'
         AND reservation.id = ticket.reservation_id
         AND reservation.state = 'PENDING_CONFIRMATION'
         AND ((reservation.first_ticket_id = ticket.id AND reservation.first_confirmed_at IS NULL)
           OR (reservation.second_ticket_id = ticket.id AND reservation.second_confirmed_at IS NULL))
         AND deck.id = $3
         AND deck.theme_table_version_id = ticket.theme_table_version_id
         AND deck.retired_at IS NULL
       RETURNING ticket.id AS ticket_id`,
      [userId, status.reservationId, selectedDeckId, new Date(this.now())]
    );
    if (!locked.rows[0]) {
      throw playerError('THEME_DECK_CHOICE_STALE', '本次匹配或候选卡组已经失效', 409);
    }
    return publicTableService.confirm(userId, context);
  }

  async cancel(userId: string) {
    const context = await this.loadUserQueueContext(userId);
    return publicTableService.cancel(userId, context ?? noThemeContext());
  }

  private async loadVisibleTheme(): Promise<ThemeRow | null> {
    const result = await pool.query<ThemeRow>(
      `SELECT *
       FROM theme_table_versions
       WHERE lifecycle IN ('ACTIVE', 'PAUSED')
       ORDER BY CASE lifecycle WHEN 'ACTIVE' THEN 0 ELSE 1 END, starts_at DESC
       LIMIT 1`
    );
    if (result.rows[0]) return result.rows[0];
    const recent = await pool.query<ThemeRow>(
      `SELECT *
       FROM theme_table_versions
       WHERE lifecycle = 'CLOSED'
       ORDER BY ends_at DESC
       LIMIT 1`
    );
    return recent.rows[0] ?? null;
  }

  private async loadThemeById(themeId: string): Promise<ThemeRow> {
    const result = await pool.query<ThemeRow>(`SELECT * FROM theme_table_versions WHERE id = $1`, [
      themeId,
    ]);
    const theme = result.rows[0];
    if (!theme) throw playerError('THEME_TABLE_NOT_FOUND', '娱乐模式不存在', 404);
    return theme;
  }

  private async loadDecks(themeId: string): Promise<ThemePrebuiltDeckView[]> {
    const result = await pool.query<DeckRow>(
      `SELECT DISTINCT deck.id, deck.deck_key, deck.display_name, deck.deck_list,
              deck.content_hash, deck.play_style_tags, deck.difficulty,
              deck.source_label, deck.source_url
       FROM theme_prebuilt_deck_versions AS deck
       JOIN theme_matchup_pair_versions AS pair
         ON pair.theme_table_version_id = deck.theme_table_version_id
        AND pair.enabled = TRUE
        AND (pair.first_deck_version_id = deck.id OR pair.second_deck_version_id = deck.id)
       WHERE deck.theme_table_version_id = $1
         AND deck.retired_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM theme_prebuilt_deck_versions AS first_deck
           JOIN theme_prebuilt_deck_versions AS second_deck
             ON second_deck.id = pair.second_deck_version_id
            AND second_deck.retired_at IS NULL
           WHERE first_deck.id = pair.first_deck_version_id
             AND first_deck.retired_at IS NULL
         )
       ORDER BY deck.deck_key, deck.id`,
      [themeId]
    );
    return result.rows.map(mapDeck);
  }

  private async loadEnabledMatchups(themeId: string): Promise<ThemeMatchupStatisticsView[]> {
    const result = await pool.query<{
      first_deck_version_id: string;
      second_deck_version_id: string;
    }>(
      `SELECT pair.first_deck_version_id, pair.second_deck_version_id
       FROM theme_matchup_pair_versions AS pair
       JOIN theme_prebuilt_deck_versions AS first_deck
         ON first_deck.id = pair.first_deck_version_id AND first_deck.retired_at IS NULL
       JOIN theme_prebuilt_deck_versions AS second_deck
         ON second_deck.id = pair.second_deck_version_id AND second_deck.retired_at IS NULL
       WHERE pair.theme_table_version_id = $1
         AND pair.enabled = TRUE
       ORDER BY pair.id`,
      [themeId]
    );
    return result.rows.map((row) => ({
      firstDeckVersionId: row.first_deck_version_id,
      secondDeckVersionId: row.second_deck_version_id,
      completedMatches: 0,
      firstDeckWins: 0,
      secondDeckWins: 0,
      draws: 0,
    }));
  }

  private async loadDeckChoice(
    userId: string,
    theme: ThemeRow,
    decks: readonly ThemePrebuiltDeckView[],
    matchups: readonly ThemeMatchupStatisticsView[],
    reservationId: string
  ): Promise<ThemeDeckChoiceView | null> {
    const seat = await pool.query<ThemeReservationSeatRow>(
      `SELECT ticket.id AS ticket_id,
              reservation.first_ticket_id,
              ticket.source_deck_name,
              ticket.deck_content_hash
       FROM gameplay_participations AS participation
       JOIN public_table_tickets AS ticket ON ticket.id = participation.ticket_id
       JOIN public_table_reservations AS reservation ON reservation.id = ticket.reservation_id
       WHERE participation.user_id = $1
         AND participation.kind = 'THEME_QUEUE'
         AND ticket.theme_table_version_id = $2
         AND ticket.reservation_id = $3
         AND ticket.state = 'RESERVED'
         AND reservation.state = 'PENDING_CONFIRMATION'
       LIMIT 1`,
      [userId, theme.id, reservationId]
    );
    const row = seat.rows[0];
    if (!row) return null;
    const candidateIds = buildThemeDeckCandidateIds(
      reservationId,
      theme.deck_choice_count,
      matchups
    );
    const ownIds = row.ticket_id === row.first_ticket_id ? candidateIds.first : candidateIds.second;
    const decksById = new Map(decks.map((deck) => [deck.id, deck]));
    const candidates = ownIds.flatMap((deckId) => {
      const deck = decksById.get(deckId);
      return deck ? [deck] : [];
    });
    const selectedDeckVersionId =
      row.source_deck_name !== '匹配成功后抽取'
        ? (candidates.find((deck) => deck.contentHash === row.deck_content_hash)?.id ?? null)
        : null;
    return {
      reservationId,
      candidates,
      selectedDeckVersionId,
    };
  }

  private async loadPlayerSeason(
    themeId: string,
    userId: string
  ): Promise<ThemeTablePlayerSeasonView> {
    const result = await pool.query<PlayerSeasonRow>(
      `SELECT
         COUNT(*) FILTER (
           WHERE (record.status IN ('COMPLETED', 'SURRENDERED')
               AND record.winner_seat IN ('FIRST', 'SECOND'))
             OR (record.status = 'COMPLETED' AND record.winner_seat IS NULL)
         )::text AS completed_matches,
         COUNT(*) FILTER (
           WHERE record.status IN ('COMPLETED', 'SURRENDERED')
             AND ((record.first_user_id = $2 AND record.winner_seat = 'FIRST')
               OR (record.second_user_id = $2 AND record.winner_seat = 'SECOND'))
         )::text AS wins,
         COUNT(*) FILTER (
           WHERE record.status IN ('COMPLETED', 'SURRENDERED')
             AND ((record.first_user_id = $2 AND record.winner_seat = 'SECOND')
               OR (record.second_user_id = $2 AND record.winner_seat = 'FIRST'))
         )::text AS losses,
         COUNT(*) FILTER (
           WHERE record.status = 'COMPLETED'
             AND record.winner_seat IS NULL
         )::text AS draws
       FROM theme_table_assignments AS assignment
       JOIN match_records AS record ON record.match_id = assignment.match_id
       WHERE assignment.theme_table_version_id = $1
         AND (record.first_user_id = $2 OR record.second_user_id = $2)`,
      [themeId, userId]
    );
    const row = result.rows[0];
    const completedMatches = Number(row?.completed_matches ?? 0);
    const wins = Number(row?.wins ?? 0);
    return {
      completedMatches,
      wins,
      losses: Number(row?.losses ?? 0),
      draws: Number(row?.draws ?? 0),
      winRate: completedMatches === 0 ? null : wins / completedMatches,
    };
  }

  private async loadMatchupStatistics(themeId: string): Promise<ThemeMatchupStatisticsView[]> {
    const result = await pool.query<MatchupStatisticsRow>(
      `SELECT pair.first_deck_version_id, pair.second_deck_version_id,
         COUNT(record.match_id) FILTER (
           WHERE (record.status IN ('COMPLETED', 'SURRENDERED')
               AND record.winner_seat IN ('FIRST', 'SECOND'))
             OR (record.status = 'COMPLETED' AND record.winner_seat IS NULL)
         )::text AS completed_matches,
         COUNT(record.match_id) FILTER (
           WHERE record.status IN ('COMPLETED', 'SURRENDERED')
             AND ((assignment.first_ticket_deck_version_id = pair.first_deck_version_id
                   AND record.winner_seat = 'FIRST')
               OR (assignment.second_ticket_deck_version_id = pair.first_deck_version_id
                   AND record.winner_seat = 'SECOND'))
         )::text AS first_deck_wins,
         COUNT(record.match_id) FILTER (
           WHERE record.status IN ('COMPLETED', 'SURRENDERED')
             AND ((assignment.first_ticket_deck_version_id = pair.second_deck_version_id
                   AND record.winner_seat = 'FIRST')
               OR (assignment.second_ticket_deck_version_id = pair.second_deck_version_id
                   AND record.winner_seat = 'SECOND'))
         )::text AS second_deck_wins,
         COUNT(record.match_id) FILTER (
           WHERE record.status = 'COMPLETED' AND record.winner_seat IS NULL
         )::text AS draws
       FROM theme_matchup_pair_versions AS pair
       JOIN theme_prebuilt_deck_versions AS first_deck
         ON first_deck.id = pair.first_deck_version_id AND first_deck.retired_at IS NULL
       JOIN theme_prebuilt_deck_versions AS second_deck
         ON second_deck.id = pair.second_deck_version_id AND second_deck.retired_at IS NULL
       LEFT JOIN theme_table_assignments AS assignment
         ON assignment.matchup_pair_version_id = pair.id
       LEFT JOIN match_records AS record ON record.match_id = assignment.match_id
       WHERE pair.theme_table_version_id = $1
         AND pair.enabled = TRUE
       GROUP BY pair.id, pair.first_deck_version_id, pair.second_deck_version_id
       ORDER BY pair.created_at, pair.id`,
      [themeId]
    );
    return result.rows.map((row) => ({
      firstDeckVersionId: row.first_deck_version_id,
      secondDeckVersionId: row.second_deck_version_id,
      completedMatches: Number(row.completed_matches),
      firstDeckWins: Number(row.first_deck_wins),
      secondDeckWins: Number(row.second_deck_wins),
      draws: Number(row.draws),
    }));
  }

  private async requireJoinableTheme(): Promise<ThemeRow> {
    const event = await this.loadVisibleTheme();
    if (!event) throw playerError('THEME_TABLE_NOT_FOUND', '当前没有开放的娱乐模式', 404);
    const availability = await this.getAvailability(event);
    if (!availability.canJoin) {
      throw playerError('THEME_TABLE_CLOSED', availability.message, 409);
    }
    return event;
  }

  private async getAvailability(theme: ThemeRow): Promise<{
    state: ThemeTableAvailabilityState;
    canJoin: boolean;
    message: string;
  }> {
    const now = this.now();
    if (theme.lifecycle === 'PAUSED') {
      return { state: 'PAUSED', canJoin: false, message: '本期娱乐模式暂时停止入场' };
    }
    if (theme.lifecycle === 'CLOSED' || now >= new Date(theme.ends_at).getTime()) {
      return { state: 'CLOSED', canJoin: false, message: '本期娱乐模式已经结束' };
    }
    if (now < new Date(theme.starts_at).getTime()) {
      return { state: 'UPCOMING', canJoin: false, message: '本期娱乐模式尚未开始' };
    }
    if (theme.lifecycle !== 'ACTIVE') {
      return { state: 'PAUSED', canJoin: false, message: '本期娱乐模式暂不开放' };
    }
    const timing = getRankedQueueWindowTiming(
      new Date(now),
      theme.platform_time_zone,
      theme.open_windows,
      new Date(theme.starts_at),
      new Date(theme.ends_at)
    );
    if (!timing.withinOpenWindow) {
      return { state: 'UPCOMING', canJoin: false, message: '当前不在本期开放时段' };
    }
    const catalog = await getCurrentRankedCardCatalogIdentity();
    if (
      theme.rules_environment_id !== REPLAY_RULES_VERSION ||
      theme.card_catalog_hash !== catalog.cardCatalogHash
    ) {
      return {
        state: 'ENVIRONMENT_CHANGED',
        canJoin: false,
        message: '当前规则或卡牌目录与本期冻结版本不一致',
      };
    }
    const pairs = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM theme_matchup_pair_versions AS pair
       JOIN theme_prebuilt_deck_versions AS first_deck ON first_deck.id = pair.first_deck_version_id
       JOIN theme_prebuilt_deck_versions AS second_deck ON second_deck.id = pair.second_deck_version_id
       WHERE pair.theme_table_version_id = $1
         AND pair.enabled = TRUE
         AND first_deck.theme_table_version_id = pair.theme_table_version_id
         AND second_deck.theme_table_version_id = pair.theme_table_version_id`,
      [theme.id]
    );
    if (Number(pairs.rows[0]?.count ?? 0) === 0) {
      return { state: 'PAUSED', canJoin: false, message: '本期对局组合正在调整' };
    }
    return { state: 'OPEN', canJoin: true, message: '可以加入娱乐模式' };
  }

  private async loadUserQueueContext(userId: string): Promise<ThemeQueueContext | null> {
    const result = await pool.query<QueueContextRow>(
      `SELECT ticket.theme_table_version_id, ticket.environment_id
       FROM gameplay_participations AS participation
       JOIN public_table_tickets AS ticket ON ticket.id = participation.ticket_id
       WHERE participation.user_id = $1
         AND ticket.queue_kind = 'THEME'
         AND ticket.theme_table_version_id IS NOT NULL
       LIMIT 1`,
      [userId]
    );
    const row = result.rows[0];
    return row
      ? {
          queueKind: 'THEME',
          participationKind: 'THEME_QUEUE',
          environmentId: row.environment_id,
          seasonId: null,
          themeTableVersionId: row.theme_table_version_id,
        }
      : null;
  }

  private async requireUserQueueContext(userId: string): Promise<ThemeQueueContext> {
    const context = await this.loadUserQueueContext(userId);
    if (!context) throw playerError('THEME_QUEUE_TICKET_NOT_FOUND', '当前没有娱乐模式候场', 404);
    return context;
  }
}

function toQueueContext(theme: ThemeRow): ThemeQueueContext {
  return {
    queueKind: 'THEME',
    participationKind: 'THEME_QUEUE',
    environmentId: theme.environment_id,
    seasonId: null,
    themeTableVersionId: theme.id,
  };
}

function noThemeContext(): MatchmakingQueueContext {
  return {
    queueKind: 'THEME',
    participationKind: 'THEME_QUEUE',
    environmentId: 'NO_ACTIVE_THEME_TABLE',
    seasonId: null,
    themeTableVersionId: null,
  };
}

function mapEvent(
  theme: ThemeRow,
  decks: readonly ThemePrebuiltDeckView[],
  matchupStatistics: readonly ThemeMatchupStatisticsView[],
  cover: ThemeTableEventView['cover']
): ThemeTableEventView {
  return {
    id: theme.id,
    versionKey: theme.version_key,
    name: theme.name,
    summary: theme.summary,
    announcement: theme.announcement,
    scheduleLabel: theme.schedule_label,
    startsAt: new Date(theme.starts_at).getTime(),
    endsAt: new Date(theme.ends_at).getTime(),
    allocationAlgorithmVersion: theme.allocation_algorithm_version,
    deckChoiceCount: theme.deck_choice_count,
    cover,
    prebuiltDecks: decks,
    matchupStatistics,
  };
}

function mapDeck(row: DeckRow): ThemePrebuiltDeckView {
  const list = readDeckList(row.deck_list);
  return {
    id: row.id,
    deckKey: row.deck_key,
    displayName: row.display_name,
    playStyleTags: Array.isArray(row.play_style_tags)
      ? row.play_style_tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    difficulty: row.difficulty,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    contentHash: row.content_hash,
    mainDeck: list.mainDeck,
    energyDeck: list.energyDeck,
  };
}

function readDeckList(value: unknown) {
  const candidate = value as {
    mainDeck?: unknown;
    energyDeck?: unknown;
  };
  return {
    mainDeck: readEntries(candidate?.mainDeck),
    energyDeck: readEntries(candidate?.energyDeck),
  };
}

function readEntries(value: unknown): { cardCode: string; count: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const cardCode = (entry as { cardCode?: unknown }).cardCode;
    const count = (entry as { count?: unknown }).count;
    return typeof cardCode === 'string' && Number.isInteger(count) && Number(count) > 0
      ? [{ cardCode, count: Number(count) }]
      : [];
  });
}

function playerError(code: string, message: string, statusCode = 400) {
  return new ThemeTablePlayerServiceError(code, message, statusCode);
}

export function isThemeTablePlayerError(
  error: unknown
): error is ThemeTablePlayerServiceError | PublicTableServiceError {
  return error instanceof ThemeTablePlayerServiceError || error instanceof PublicTableServiceError;
}

export const themeTablePlayerService = new ThemeTablePlayerService();
