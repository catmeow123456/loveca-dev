import type {
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

interface PlayerSeasonRow {
  readonly completed_matches: string;
  readonly wins: string;
  readonly losses: string;
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
        availability: { state: 'NO_EVENT', canJoin: false, message: '当前没有公开的主题活动' },
        player: null,
        queue,
      };
    }
    const [decks, availability, player] = await Promise.all([
      this.loadDecks(event.id),
      this.getAvailability(event),
      this.loadPlayerSeason(event.id, userId),
    ]);
    return { event: mapEvent(event, decks), availability, player, queue };
  }

  async join(userId: string) {
    const event = await this.requireJoinableTheme();
    return publicTableService.join(userId, null, 'DIRECT', toQueueContext(event));
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

  async confirm(userId: string) {
    return publicTableService.confirm(userId, await this.requireUserQueueContext(userId));
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
       ORDER BY starts_at DESC
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
    if (!theme) throw playerError('THEME_TABLE_NOT_FOUND', '主题活动不存在', 404);
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

  private async requireJoinableTheme(): Promise<ThemeRow> {
    const event = await this.loadVisibleTheme();
    if (!event) throw playerError('THEME_TABLE_NOT_FOUND', '当前没有公开的主题活动', 404);
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
      return { state: 'PAUSED', canJoin: false, message: '本期主题牌桌暂时停止入场' };
    }
    if (theme.lifecycle === 'CLOSED' || now >= new Date(theme.ends_at).getTime()) {
      return { state: 'CLOSED', canJoin: false, message: '本期主题牌桌已经结束' };
    }
    if (now < new Date(theme.starts_at).getTime()) {
      return { state: 'UPCOMING', canJoin: false, message: '本期主题牌桌尚未开始' };
    }
    if (theme.lifecycle !== 'ACTIVE') {
      return { state: 'PAUSED', canJoin: false, message: '本期主题牌桌暂不开放' };
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
    return { state: 'OPEN', canJoin: true, message: '可以加入主题牌桌' };
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
    if (!context) throw playerError('THEME_QUEUE_TICKET_NOT_FOUND', '当前没有主题牌桌候场', 404);
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

function mapEvent(theme: ThemeRow, decks: readonly ThemePrebuiltDeckView[]): ThemeTableEventView {
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
    prebuiltDecks: decks,
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
