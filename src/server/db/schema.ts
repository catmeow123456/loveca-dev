import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  MatchAutomationGameMode,
  MatchDeckSnapshotSource,
  MatchDeckSnapshotValidationState,
  MatchDecisionRecordStatus,
  MatchDecisionSubmissionSummary,
  MatchDecisionTransitionSemantics,
  MatchDecisionType,
  MatchDecisionVisibleContextSummary,
  MatchMode,
  MatchOriginKind,
  MatchParticipantKind,
  MatchRecordCompleteness,
  MatchRecordReplayAccess,
  MatchRecordStatus,
  ReplayCapability,
  ReplayCheckpointType,
  ReplayLimitation,
  ReplayRecordFrameType,
  ReplaySerializedPayloadEnvelope,
  ReplayVisibilityScope,
} from '../../online/replay-types.js';
import type { PrivateEvent, PublicEvent, Seat } from '../../online/types.js';
import type { RankedRatingConfig } from '../rating/ranked-rating.js';
import type {
  CompactWallpaperMode,
  PlayerWallpaperSolidPreset,
  WallpaperCrop,
  WallpaperFocus,
  WideWallpaperMode,
} from '../../online/player-wallpaper-types.js';
import type { UserRole } from '../../shared/auth/permissions.js';

export type { UserRole } from '../../shared/auth/permissions.js';
export type CardType = 'MEMBER' | 'LIVE' | 'ENERGY';
export type CardStatus = 'DRAFT' | 'PUBLISHED';
export type CardSyncRunKind = 'PREVIEW' | 'APPLY';
export type CardSyncRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type CardSyncRunItemKind = 'CANDIDATE' | 'BLOCKED' | 'APPLY_RESULT';
export type CardSyncRunItemResult =
  'READY' | 'BLOCKED' | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
export type DeckPointTableLifecycle = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'RETIRED';
export type DeckPointTableRetirementReason =
  'REPLACED' | 'SCHEDULE_CANCELLED' | 'MANUALLY_DISCARDED';
export type DeckPointTableAuditAction =
  | 'DRAFT_CREATED'
  | 'TABLE_UPDATED'
  | 'PUBLISHED_IMMEDIATELY'
  | 'PUBLISHED_SCHEDULED'
  | 'SCHEDULE_ACTIVATED'
  | 'RETIRED_BY_REPLACEMENT'
  | 'SCHEDULE_CANCELLED'
  | 'MANUALLY_DISCARDED'
  | 'ACTIVATED_AS_REPLACEMENT'
  | 'ROLLBACK_DRAFT_CREATED';
export type SiteStatusLifecycle = 'NORMAL' | 'RESTRICTING_NEW_GAMES' | 'MAINTENANCE';
export type SiteAnnouncementType = 'MAINTENANCE' | 'UPDATE' | 'NEWS';
export type SiteAnnouncementStatus = 'DRAFT' | 'PUBLISHED';
export type AiEffectExtractionAuditAction = 'CONFIG_UPDATED';
export interface StoredMatchEmoteCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
  readonly assetId: string;
}
export type GameplayParticipationKind =
  'PUBLIC_QUEUE' | 'RANKED_QUEUE' | 'THEME_QUEUE' | 'ONLINE_ROOM' | 'ONLINE_MATCH';
export type MatchmakingQueueKind = 'CASUAL' | 'RANKED' | 'THEME';
export type PublicTableTicketState = 'WAITING' | 'RESERVED' | 'MATCHED' | 'CANCELED' | 'EXPIRED';
export type PublicTableReservationState =
  'PENDING_CONFIRMATION' | 'CREATING_ROOM' | 'MATCHED' | 'RELEASED';
export type RankedSeasonLifecycle = 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
export type RankedQueueAdmission = 'OPEN' | 'PAUSED';
export type RankedMatchRatingStatus = 'PENDING' | 'SETTLED' | 'VOIDED';
export type RankedMatchResultType =
  'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT' | 'PLATFORM_NO_CONTEST';
export type RankedRatingEventType = 'SETTLEMENT' | 'VOID' | 'REPLACEMENT';
export type DeckArchetypeLifecycle = 'ACTIVE' | 'ARCHIVED';
export type DeckClassifierDisplayMode = 'HIDDEN' | 'PLAYER_EQUAL' | 'MATCH_EQUAL' | 'BOTH';
export type DeckClassifierReleaseStatus = 'BUILDING' | 'ACTIVE' | 'SUPERSEDED' | 'FAILED';
export type DeckClassificationRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type DeckClassificationRunTrigger =
  'RELEASE_PUBLISHED' | 'MANUAL_RECLASSIFY' | 'MANUAL_OVERRIDE' | 'AUTO_NEW_OBSERVATIONS';
export type DeckClassificationStatus =
  'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS' | 'INVALID' | 'EXCLUDED';
export type DeckClassificationMethod =
  'MANUAL' | 'EXACT' | 'RULE' | 'SIMILARITY' | 'UNKNOWN' | 'AMBIGUOUS' | 'INVALID';
export type ThemeTableLifecycle = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type ThemeDeckDifficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type PlayerWallpaperAssetKind = 'MASTER' | 'WIDE_DISPLAY' | 'COMPACT_DISPLAY';
export type PlayerWallpaperIdempotencyStatus = 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
export type PlayerWallpaperOperation = 'PUBLISH' | 'RESET' | 'ADMIN_REMOVE';

export interface RankedDeckObservationCard {
  readonly baseCardCode: string;
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: Extract<CardType, 'MEMBER' | 'LIVE'>;
  readonly count: number;
  readonly imageFilename?: string;
}

export interface PlayerBadgeEvidence {
  readonly qualification: 'RANKED_RATED_MATCH_COUNT';
  readonly minimumRatedMatchCount: number;
  readonly observedRatedMatchCount: number;
  readonly seasonLedgerRevision: number;
  readonly qualificationMatchId: string;
}

export interface RankedSeasonOpenWindow {
  readonly weekdays: readonly number[];
  readonly startMinute: number;
  readonly endMinute: number;
}

export type DeckEntry = {
  card_code: string;
  count: number;
};

export type HeartRequirement = {
  color: string;
  count: number;
};

export type BladeHeart = {
  effect: string;
  heartColor?: string;
  value?: number;
};

export type CardSourceFlags = {
  excelOnly?: boolean;
  oldSourceOnly?: boolean;
  fieldConflict?: boolean;
  derivedFromBase?: boolean;
  cloudbaseOnly?: boolean;
  importedBy?: string;
  missingRuleFields?: string[];
  parseWarnings?: string[];
  missingImage?: boolean;
  imageSkipped?: boolean;
  imageDownloadFailed?: boolean;
  imageProcessFailed?: boolean;
  imageUploadFailed?: boolean;
  [key: string]: unknown;
};

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_users_email').on(table.email)]
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_refresh_tokens_user_id').on(table.userId),
    index('idx_refresh_tokens_expires_at').on(table.expiresAt),
  ]
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_email_verification_tokens_token').on(table.token)]
);

export const emailChangeTokens = pgTable(
  'email_change_tokens',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    newEmail: text('new_email').notNull(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_email_change_tokens_token').on(table.token),
    index('idx_email_change_tokens_expires_at').on(table.expiresAt),
  ]
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_password_reset_tokens_token').on(table.token)]
);

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: text('username').notNull().unique(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    role: text('role').$type<UserRole>().notNull().default('user'),
    deckCount: integer('deck_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_profiles_username').on(table.username),
    index('idx_profiles_role').on(table.role),
    check('profiles_role_check', sql`${table.role} IN ('user', 'season_admin', 'admin')`),
  ]
);

export const managementAuditLogs = pgTable(
  'management_audit_logs',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role').$type<UserRole>().notNull(),
    scope: text('scope').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    requestId: text('request_id').notNull(),
    result: text('result').notNull(),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_management_audit_actor_created').on(table.actorUserId, table.createdAt),
    index('idx_management_audit_scope_target_created').on(
      table.scope,
      table.targetType,
      table.targetId,
      table.createdAt
    ),
    index('idx_management_audit_created').on(table.createdAt),
    check(
      'management_audit_actor_role_check',
      sql`${table.actorRole} IN ('user', 'season_admin', 'admin')`
    ),
    check(
      'management_audit_scope_check',
      sql`${table.scope} IN ('RANKED', 'DECK_CLASSIFIER', 'THEME_TABLE', 'SEASON_ENTRY_VISIBILITY')`
    ),
    check('management_audit_action_check', sql`btrim(${table.action}) <> ''`),
    check('management_audit_target_type_check', sql`btrim(${table.targetType}) <> ''`),
    check('management_audit_target_id_check', sql`btrim(${table.targetId}) <> ''`),
    check('management_audit_request_id_check', sql`btrim(${table.requestId}) <> ''`),
    check('management_audit_result_check', sql`${table.result} IN ('SUCCEEDED', 'FAILED')`),
  ]
);

export const playerWallpaperAssets = pgTable(
  'player_wallpaper_assets',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<PlayerWallpaperAssetKind>().notNull(),
    objectKey: text('object_key').notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_player_wallpaper_assets_user').on(table.userId),
    index('idx_player_wallpaper_assets_retired').on(table.retiredAt),
    check(
      'player_wallpaper_assets_kind_check',
      sql`${table.kind} IN ('MASTER', 'WIDE_DISPLAY', 'COMPACT_DISPLAY')`
    ),
    check(
      'player_wallpaper_assets_dimensions_check',
      sql`${table.width} > 0 AND ${table.height} > 0`
    ),
    check('player_wallpaper_assets_bytes_check', sql`${table.byteSize} > 0`),
    check('player_wallpaper_assets_sha_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'player_wallpaper_assets_object_key_check',
      sql`${table.objectKey} ~ '^wallpapers/[0-9a-f-]{36}/(master|wide|compact)[.]webp$'`
    ),
  ]
);

export const playerWallpaperConfigs = pgTable(
  'player_wallpaper_configs',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(0),
    wideMode: text('wide_mode').$type<WideWallpaperMode>().notNull().default('DEFAULT'),
    compactMode: text('compact_mode').$type<CompactWallpaperMode>().notNull().default('INHERIT_PC'),
    wideSolidPreset: text('wide_solid_preset').$type<PlayerWallpaperSolidPreset>(),
    compactSolidPreset: text('compact_solid_preset').$type<PlayerWallpaperSolidPreset>(),
    wideMasterAssetId: uuid('wide_master_asset_id').references(() => playerWallpaperAssets.id, {
      onDelete: 'restrict',
    }),
    compactMasterAssetId: uuid('compact_master_asset_id').references(
      () => playerWallpaperAssets.id,
      { onDelete: 'restrict' }
    ),
    wideDisplayAssetId: uuid('wide_display_asset_id').references(() => playerWallpaperAssets.id, {
      onDelete: 'restrict',
    }),
    compactDisplayAssetId: uuid('compact_display_asset_id').references(
      () => playerWallpaperAssets.id,
      { onDelete: 'restrict' }
    ),
    wideCrop: jsonb('wide_crop').$type<WallpaperCrop>(),
    compactCrop: jsonb('compact_crop').$type<WallpaperCrop>(),
    wideFocus: jsonb('wide_focus').$type<WallpaperFocus>(),
    compactFocus: jsonb('compact_focus').$type<WallpaperFocus>(),
    activeFingerprint: text('active_fingerprint').notNull(),
    lastPublishedAt: timestamp('last_published_at', { withTimezone: true }),
    adminRemovedAt: timestamp('admin_removed_at', { withTimezone: true }),
    adminRemovedBy: uuid('admin_removed_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    adminRemovalReason: text('admin_removal_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('player_wallpaper_configs_version_check', sql`${table.version} >= 0`),
    check(
      'player_wallpaper_configs_wide_mode_check',
      sql`${table.wideMode} IN ('DEFAULT', 'SOLID', 'CUSTOM')`
    ),
    check(
      'player_wallpaper_configs_compact_mode_check',
      sql`${table.compactMode} IN ('INHERIT_PC', 'SOLID', 'CUSTOM')`
    ),
    check(
      'player_wallpaper_configs_wide_solid_preset_check',
      sql`${table.wideSolidPreset} IS NULL OR ${table.wideSolidPreset} IN ('NIGHT_INK', 'SAKURA', 'OCEAN', 'FOREST', 'AMBER', 'LILAC')`
    ),
    check(
      'player_wallpaper_configs_compact_solid_preset_check',
      sql`${table.compactSolidPreset} IS NULL OR ${table.compactSolidPreset} IN ('NIGHT_INK', 'SAKURA', 'OCEAN', 'FOREST', 'AMBER', 'LILAC')`
    ),
    check(
      'player_wallpaper_configs_wide_shape_check',
      sql`(
        ${table.wideMode} = 'DEFAULT'
        AND ${table.wideMasterAssetId} IS NULL
        AND ${table.wideDisplayAssetId} IS NULL
        AND ${table.wideCrop} IS NULL
        AND ${table.wideFocus} IS NULL
        AND ${table.wideSolidPreset} IS NULL
      ) OR (
        ${table.wideMode} = 'SOLID'
        AND ${table.wideMasterAssetId} IS NULL
        AND ${table.wideDisplayAssetId} IS NULL
        AND ${table.wideCrop} IS NULL
        AND ${table.wideFocus} IS NULL
        AND ${table.wideSolidPreset} IS NOT NULL
      ) OR (
        ${table.wideMode} = 'CUSTOM'
        AND ${table.wideMasterAssetId} IS NOT NULL
        AND ${table.wideDisplayAssetId} IS NOT NULL
        AND ${table.wideCrop} IS NOT NULL
        AND ${table.wideFocus} IS NOT NULL
        AND ${table.wideSolidPreset} IS NULL
      )`
    ),
    check(
      'player_wallpaper_configs_compact_shape_check',
      sql`(
        ${table.compactMode} = 'INHERIT_PC'
        AND ${table.compactSolidPreset} IS NULL
        AND (
          (${table.wideMode} IN ('DEFAULT', 'SOLID')
            AND ${table.compactMasterAssetId} IS NULL
            AND ${table.compactDisplayAssetId} IS NULL
            AND ${table.compactCrop} IS NULL
            AND ${table.compactFocus} IS NULL)
          OR
          (${table.wideMode} = 'CUSTOM'
            AND ${table.compactMasterAssetId} = ${table.wideMasterAssetId}
            AND ${table.compactDisplayAssetId} IS NOT NULL
            AND ${table.compactCrop} IS NOT NULL
            AND ${table.compactFocus} IS NOT NULL)
        )
      ) OR (
        ${table.compactMode} = 'SOLID'
        AND ${table.compactMasterAssetId} IS NULL
        AND ${table.compactDisplayAssetId} IS NULL
        AND ${table.compactCrop} IS NULL
        AND ${table.compactFocus} IS NULL
        AND ${table.compactSolidPreset} IS NOT NULL
      ) OR (
        ${table.compactMode} = 'CUSTOM'
        AND ${table.compactMasterAssetId} IS NOT NULL
        AND ${table.compactDisplayAssetId} IS NOT NULL
        AND ${table.compactCrop} IS NOT NULL
        AND ${table.compactFocus} IS NOT NULL
        AND ${table.compactSolidPreset} IS NULL
      )`
    ),
    check(
      'player_wallpaper_configs_fingerprint_check',
      sql`${table.activeFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'player_wallpaper_configs_admin_removal_check',
      sql`(${table.adminRemovedAt} IS NULL AND ${table.adminRemovalReason} IS NULL)
        OR (${table.adminRemovedAt} IS NOT NULL AND btrim(${table.adminRemovalReason}) <> '')`
    ),
  ]
);

export const playerWallpaperPublicationDays = pgTable(
  'player_wallpaper_publication_days',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    publishDay: text('publish_day').notNull(),
    configVersion: integer('config_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.publishDay] }),
    check(
      'player_wallpaper_publication_days_day_check',
      sql`${table.publishDay} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`
    ),
    check('player_wallpaper_publication_days_version_check', sql`${table.configVersion} > 0`),
  ]
);

export const playerWallpaperAdminAuditLogs = pgTable(
  'player_wallpaper_admin_audit_logs',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    adminUserId: uuid('admin_user_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    configVersion: integer('config_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_player_wallpaper_admin_audit_user').on(table.userId, table.createdAt),
    index('idx_player_wallpaper_admin_audit_admin').on(table.adminUserId, table.createdAt),
    check('player_wallpaper_admin_audit_action_check', sql`${table.action} IN ('REMOVED')`),
    check('player_wallpaper_admin_audit_reason_check', sql`btrim(${table.reason}) <> ''`),
    check('player_wallpaper_admin_audit_version_check', sql`${table.configVersion} > 0`),
  ]
);

export const playerWallpaperIdempotency = pgTable(
  'player_wallpaper_idempotency',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    operation: text('operation').$type<PlayerWallpaperOperation>().notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    status: text('status').$type<PlayerWallpaperIdempotencyStatus>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    configVersion: integer('config_version'),
    errorCode: text('error_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.idempotencyKey] }),
    index('idx_player_wallpaper_idempotency_expires').on(table.expiresAt),
    check(
      'player_wallpaper_idempotency_key_check',
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 160`
    ),
    check(
      'player_wallpaper_idempotency_operation_check',
      sql`${table.operation} IN ('PUBLISH', 'RESET', 'ADMIN_REMOVE')`
    ),
    check(
      'player_wallpaper_idempotency_status_check',
      sql`${table.status} IN ('PROCESSING', 'SUCCEEDED', 'FAILED')`
    ),
    check(
      'player_wallpaper_idempotency_fingerprint_check',
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

export const playerBadgeRules = pgTable(
  'player_badge_rules',
  {
    badgeKey: text('badge_key').primaryKey(),
    sourceSeasonId: uuid('source_season_id')
      .notNull()
      .references(() => rankedSeasons.id, { onDelete: 'restrict' }),
    criteriaType: text('criteria_type').notNull(),
    minimumValue: integer('minimum_value').notNull(),
    criteriaVersion: text('criteria_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_player_badge_rules_source_season').on(table.sourceSeasonId),
    check('player_badge_rules_key_check', sql`btrim(${table.badgeKey}) <> ''`),
    check(
      'player_badge_rules_criteria_type_check',
      sql`${table.criteriaType} IN ('RANKED_RATED_MATCH_COUNT')`
    ),
    check('player_badge_rules_minimum_value_check', sql`${table.minimumValue} > 0`),
    check('player_badge_rules_criteria_version_check', sql`btrim(${table.criteriaVersion}) <> ''`),
  ]
);

export const playerBadges = pgTable(
  'player_badges',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    badgeKey: text('badge_key')
      .notNull()
      .references(() => playerBadgeRules.badgeKey, { onDelete: 'restrict' }),
    sourceSeasonId: uuid('source_season_id').references(() => rankedSeasons.id, {
      onDelete: 'restrict',
    }),
    criteriaVersion: text('criteria_version').notNull(),
    evidence: jsonb('evidence').$type<PlayerBadgeEvidence>().notNull(),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_player_badges_user_badge').on(table.userId, table.badgeKey),
    index('idx_player_badges_user_awarded_at').on(table.userId, table.awardedAt),
    index('idx_player_badges_source_season').on(table.sourceSeasonId),
    check('player_badges_key_check', sql`btrim(${table.badgeKey}) <> ''`),
    check('player_badges_criteria_version_check', sql`btrim(${table.criteriaVersion}) <> ''`),
  ]
);

export const decks = pgTable(
  'decks',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    mainDeck: jsonb('main_deck')
      .$type<DeckEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    energyDeck: jsonb('energy_deck')
      .$type<DeckEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isValid: boolean('is_valid').notNull().default(false),
    validationErrors: jsonb('validation_errors')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`),
    validatedPointTableVersion: text('validated_point_table_version').notNull(),
    isPublic: boolean('is_public').notNull().default(false),
    shareId: uuid('share_id')
      .default(sql`gen_random_uuid()`)
      .unique(),
    shareEnabled: boolean('share_enabled').notNull().default(false),
    sharedAt: timestamp('shared_at', { withTimezone: true }),
    forkedFromDeckId: uuid('forked_from_deck_id').references((): AnyPgColumn => decks.id, {
      onDelete: 'set null',
    }),
    forkedFromShareId: uuid('forked_from_share_id'),
    forkedAt: timestamp('forked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_decks_user_id').on(table.userId),
    index('idx_decks_is_public')
      .on(table.isPublic)
      .where(sql`${table.isPublic} = true`),
    index('idx_decks_share_id').on(table.shareId),
    index('idx_decks_share_enabled')
      .on(table.shareEnabled)
      .where(sql`${table.shareEnabled} = true`),
  ]
);

export const cards = pgTable(
  'cards',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    cardCode: text('card_code').notNull().unique(),
    cardType: text('card_type').$type<CardType>().notNull(),
    nameJp: text('name_jp'),
    nameCn: text('name_cn'),
    workNames: jsonb('work_names').$type<string[] | null>(),
    groupNames: jsonb('group_names').$type<string[] | null>(),
    unitName: text('unit_name'),
    unitNameRaw: text('unit_name_raw'),
    cost: integer('cost'),
    blade: integer('blade'),
    hearts: jsonb('hearts')
      .$type<HeartRequirement[]>()
      .default(sql`'[]'::jsonb`),
    bladeHearts: jsonb('blade_hearts')
      .$type<BladeHeart[] | null>()
      .default(sql`NULL`),
    score: integer('score'),
    requirements: jsonb('requirements')
      .$type<HeartRequirement[]>()
      .default(sql`'[]'::jsonb`),
    cardTextJp: text('card_text_jp'),
    cardTextCn: text('card_text_cn'),
    imageFilename: text('image_filename'),
    imageSourceUri: text('image_source_uri'),
    rare: text('rare'),
    product: text('product'),
    productCode: text('product_code'),
    sourceExternalId: text('source_external_id'),
    sourceFlags: jsonb('source_flags').$type<CardSourceFlags | null>(),
    status: text('status').$type<CardStatus>().notNull().default('DRAFT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (table) => [
    index('idx_cards_card_code').on(table.cardCode),
    index('idx_cards_card_type').on(table.cardType),
    index('idx_cards_rare').on(table.rare),
    index('idx_cards_status').on(table.status),
    check('cards_card_type_check', sql`${table.cardType} IN ('MEMBER', 'LIVE', 'ENERGY')`),
    check(
      'cards_name_language_check',
      sql`(${table.nameJp} IS NOT NULL AND btrim(${table.nameJp}) <> '') OR (${table.nameCn} IS NOT NULL AND btrim(${table.nameCn}) <> '')`
    ),
    check('cards_status_check', sql`${table.status} IN ('DRAFT', 'PUBLISHED')`),
  ]
);

export const cardSyncRuns = pgTable(
  'card_sync_runs',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    kind: text('kind').$type<CardSyncRunKind>().notNull(),
    status: text('status').$type<CardSyncRunStatus>().notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    requestId: text('request_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    previewRunId: uuid('preview_run_id').references((): AnyPgColumn => cardSyncRuns.id, {
      onDelete: 'restrict',
    }),
    sourceCollection: text('source_collection').notNull().default('loveca'),
    sourceHash: text('source_hash'),
    sourceSummary: jsonb('source_summary').$type<Record<string, unknown> | null>(),
    resultSummary: jsonb('result_summary').$type<Record<string, unknown> | null>(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    previewExpiresAt: timestamp('preview_expires_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_card_sync_runs_actor_kind_idempotency').on(
      table.actorUserId,
      table.kind,
      table.idempotencyKey
    ),
    uniqueIndex('uq_card_sync_runs_active_apply')
      .on(sql`(true)`)
      .where(sql`${table.kind} = 'APPLY' AND ${table.status} IN ('QUEUED', 'RUNNING')`),
    index('idx_card_sync_runs_created_at').on(table.createdAt),
    index('idx_card_sync_runs_preview_run').on(table.previewRunId),
    check('card_sync_runs_kind_check', sql`${table.kind} IN ('PREVIEW', 'APPLY')`),
    check(
      'card_sync_runs_status_check',
      sql`${table.status} IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')`
    ),
    check('card_sync_runs_request_id_check', sql`btrim(${table.requestId}) <> ''`),
    check('card_sync_runs_idempotency_key_check', sql`btrim(${table.idempotencyKey}) <> ''`),
    check('card_sync_runs_source_collection_check', sql`${table.sourceCollection} = 'loveca'`),
    check(
      'card_sync_runs_shape_check',
      sql`(${table.kind} = 'PREVIEW' AND ${table.previewRunId} IS NULL) OR (${table.kind} = 'APPLY' AND ${table.previewRunId} IS NOT NULL)`
    ),
  ]
);

export const cardSyncRunItems = pgTable(
  'card_sync_run_items',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => cardSyncRuns.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    kind: text('kind').$type<CardSyncRunItemKind>().notNull(),
    cardCode: text('card_code'),
    result: text('result').$type<CardSyncRunItemResult>().notNull(),
    summary: jsonb('summary').$type<Record<string, unknown> | null>(),
    message: text('message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_card_sync_run_items_ordinal').on(table.runId, table.ordinal),
    index('idx_card_sync_run_items_run_result').on(table.runId, table.result),
    index('idx_card_sync_run_items_card_code').on(table.cardCode),
    check('card_sync_run_items_ordinal_check', sql`${table.ordinal} >= 0`),
    check(
      'card_sync_run_items_kind_check',
      sql`${table.kind} IN ('CANDIDATE', 'BLOCKED', 'APPLY_RESULT')`
    ),
    check(
      'card_sync_run_items_result_check',
      sql`${table.result} IN ('READY', 'BLOCKED', 'PENDING', 'RUNNING', 'SUCCEEDED', 'SKIPPED', 'FAILED')`
    ),
  ]
);

export const deckPointTables = pgTable(
  'deck_point_tables',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    version: text('version').notNull().unique(),
    displayName: text('display_name').notNull(),
    lifecycle: text('lifecycle').$type<DeckPointTableLifecycle>().notNull().default('DRAFT'),
    retirementReason: text('retirement_reason').$type<DeckPointTableRetirementReason>(),
    pointLimit: integer('point_limit').notNull().default(9),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_deck_point_tables_lifecycle_effective').on(table.lifecycle, table.effectiveFrom),
    uniqueIndex('uq_deck_point_tables_active')
      .on(sql`(true)`)
      .where(sql`${table.lifecycle} = 'ACTIVE'`),
    uniqueIndex('uq_deck_point_tables_scheduled')
      .on(sql`(true)`)
      .where(sql`${table.lifecycle} = 'SCHEDULED'`),
    check('deck_point_tables_version_check', sql`btrim(${table.version}) <> ''`),
    check('deck_point_tables_display_name_check', sql`btrim(${table.displayName}) <> ''`),
    check('deck_point_tables_point_limit_check', sql`${table.pointLimit} BETWEEN 1 AND 99`),
    check('deck_point_tables_revision_check', sql`${table.revision} > 0`),
    check(
      'deck_point_tables_lifecycle_check',
      sql`${table.lifecycle} IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'RETIRED')`
    ),
    check(
      'deck_point_tables_effective_from_check',
      sql`(${table.lifecycle} = 'DRAFT' AND ${table.effectiveFrom} IS NULL) OR (${table.lifecycle} IN ('SCHEDULED', 'ACTIVE') AND ${table.effectiveFrom} IS NOT NULL) OR ${table.lifecycle} = 'RETIRED'`
    ),
    check(
      'deck_point_tables_retirement_reason_check',
      sql`(${table.lifecycle} = 'RETIRED' AND ${table.retirementReason} IS NOT NULL AND ${table.retirementReason} IN ('REPLACED', 'SCHEDULE_CANCELLED', 'MANUALLY_DISCARDED')) OR (${table.lifecycle} <> 'RETIRED' AND ${table.retirementReason} IS NULL)`
    ),
  ]
);

export const deckPointTableEntries = pgTable(
  'deck_point_table_entries',
  {
    tableId: uuid('table_id')
      .notNull()
      .references(() => deckPointTables.id, { onDelete: 'cascade' }),
    baseCardCode: text('base_card_code').notNull(),
    points: integer('points').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tableId, table.baseCardCode] }),
    index('idx_deck_point_table_entries_base_code').on(table.baseCardCode),
    check('deck_point_table_entries_base_code_check', sql`btrim(${table.baseCardCode}) <> ''`),
    check('deck_point_table_entries_points_check', sql`${table.points} BETWEEN 1 AND 99`),
  ]
);

export const deckPointTableAuditLogs = pgTable(
  'deck_point_table_audit_logs',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => deckPointTables.id, { onDelete: 'cascade' }),
    action: text('action').$type<DeckPointTableAuditAction>().notNull(),
    adminUserId: uuid('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
    detail: jsonb('detail')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_deck_point_table_audit_logs_table_created').on(table.tableId, table.createdAt),
    check(
      'deck_point_table_audit_logs_action_check',
      sql`${table.action} IN ('DRAFT_CREATED', 'TABLE_UPDATED', 'PUBLISHED_IMMEDIATELY', 'PUBLISHED_SCHEDULED', 'SCHEDULE_ACTIVATED', 'RETIRED_BY_REPLACEMENT', 'SCHEDULE_CANCELLED', 'MANUALLY_DISCARDED', 'ACTIVATED_AS_REPLACEMENT', 'ROLLBACK_DRAFT_CREATED')`
    ),
  ]
);

export const siteAnnouncements = pgTable(
  'site_announcements',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    type: text('type').$type<SiteAnnouncementType>().notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    detail: text('detail'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    priority: integer('priority').notNull().default(0),
    impactScopes: jsonb('impact_scopes')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text('status').$type<SiteAnnouncementStatus>().notNull().default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_site_announcements_status').on(table.status),
    index('idx_site_announcements_published_at').on(table.publishedAt),
    index('idx_site_announcements_ends_at').on(table.endsAt),
    check('site_announcements_type_check', sql`${table.type} IN ('MAINTENANCE', 'UPDATE', 'NEWS')`),
    check('site_announcements_status_check', sql`${table.status} IN ('DRAFT', 'PUBLISHED')`),
    check('site_announcements_title_check', sql`btrim(${table.title}) <> ''`),
    check('site_announcements_summary_check', sql`btrim(${table.summary}) <> ''`),
  ]
);

export const siteStatusConfig = pgTable(
  'site_status_config',
  {
    id: text('id').primaryKey().default('default'),
    lifecycle: text('lifecycle').$type<SiteStatusLifecycle>().notNull().default('NORMAL'),
    title: text('title'),
    summary: text('summary'),
    detail: text('detail'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    estimatedEndsAt: timestamp('estimated_ends_at', { withTimezone: true }),
    restrictsNewGamesAt: timestamp('restricts_new_games_at', { withTimezone: true }),
    impactScopes: jsonb('impact_scopes')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    restrictions: jsonb('restrictions')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    action: text('action'),
    rankedEntryVisible: boolean('ranked_entry_visible').notNull().default(true),
    themeTableEntryVisible: boolean('theme_table_entry_visible').notNull().default(true),
    playerActionTimeoutSeconds: integer('player_action_timeout_seconds').notNull().default(180),
    reconnectGracePeriodSeconds: integer('reconnect_grace_period_seconds').notNull().default(60),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_site_status_config_lifecycle').on(table.lifecycle),
    check(
      'site_status_config_lifecycle_check',
      sql`${table.lifecycle} IN ('NORMAL', 'RESTRICTING_NEW_GAMES', 'MAINTENANCE')`
    ),
    check('site_status_config_id_check', sql`${table.id} = 'default'`),
    check(
      'site_status_config_player_action_timeout_check',
      sql`${table.playerActionTimeoutSeconds} BETWEEN 60 AND 900`
    ),
    check(
      'site_status_config_reconnect_grace_period_check',
      sql`${table.reconnectGracePeriodSeconds} BETWEEN 15 AND 300`
    ),
  ]
);

export const matchEmoteAssets = pgTable(
  'match_emote_assets',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    contentFingerprint: text('content_fingerprint').notNull().unique(),
    staticObjectKey: text('static_object_key').notNull(),
    animatedObjectKey: text('animated_object_key'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    frameCount: integer('frame_count').notNull(),
    durationMs: integer('duration_ms').notNull(),
    staticBytes: integer('static_bytes').notNull(),
    animatedBytes: integer('animated_bytes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_match_emote_assets_created_at').on(table.createdAt),
    check(
      'match_emote_assets_fingerprint_check',
      sql`${table.contentFingerprint} ~ '^sha256:[0-9a-f]{64}$'`
    ),
    check(
      'match_emote_assets_static_key_check',
      sql`${table.staticObjectKey} ~ '^emotes/[0-9a-f]{64}\\.webp$'`
    ),
    check(
      'match_emote_assets_animated_key_check',
      sql`${table.animatedObjectKey} IS NULL OR ${table.animatedObjectKey} ~ '^emotes/[0-9a-f]{64}\\.webp$'`
    ),
    check(
      'match_emote_assets_dimensions_check',
      sql`${table.width} BETWEEN 1 AND 512 AND ${table.height} BETWEEN 1 AND 512`
    ),
    check('match_emote_assets_frames_check', sql`${table.frameCount} BETWEEN 1 AND 48`),
    check('match_emote_assets_duration_check', sql`${table.durationMs} BETWEEN 0 AND 6000`),
    check(
      'match_emote_assets_size_check',
      sql`${table.staticBytes} > 0 AND (${table.animatedBytes} IS NULL OR ${table.animatedBytes} > 0)`
    ),
  ]
);

export const matchEmoteCatalogVersions = pgTable(
  'match_emote_catalog_versions',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    previousVersionId: uuid('previous_version_id').references(
      (): AnyPgColumn => matchEmoteCatalogVersions.id,
      { onDelete: 'restrict' }
    ),
    entries: jsonb('entries').$type<StoredMatchEmoteCatalogEntry[]>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_match_emote_catalog_versions_created_at').on(table.createdAt),
    check(
      'match_emote_catalog_versions_entries_check',
      sql`jsonb_typeof(${table.entries}) = 'array' AND jsonb_array_length(${table.entries}) BETWEEN 1 AND 12`
    ),
  ]
);

export const matchEmoteCatalogConfig = pgTable(
  'match_emote_catalog_config',
  {
    id: text('id').primaryKey().default('default'),
    activeVersionId: uuid('active_version_id')
      .notNull()
      .references(() => matchEmoteCatalogVersions.id, { onDelete: 'restrict' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('match_emote_catalog_config_id_check', sql`${table.id} = 'default'`)]
);

export const aiEffectExtractionConfig = pgTable(
  'ai_effect_extraction_config',
  {
    id: text('id').primaryKey().default('default'),
    revision: integer('revision').notNull().default(1),
    enabled: boolean('enabled').notNull().default(false),
    baseUrl: text('base_url').notNull().default(''),
    modelId: text('model_id').notNull().default(''),
    encryptedApiKey: text('encrypted_api_key'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('ai_effect_extraction_config_id_check', sql`${table.id} = 'default'`),
    check('ai_effect_extraction_config_revision_check', sql`${table.revision} > 0`),
    check(
      'ai_effect_extraction_config_enabled_fields_check',
      sql`NOT ${table.enabled} OR (btrim(${table.baseUrl}) <> '' AND btrim(${table.modelId}) <> '' AND ${table.encryptedApiKey} IS NOT NULL)`
    ),
  ]
);

export const aiEffectExtractionAuditLogs = pgTable(
  'ai_effect_extraction_audit_logs',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    action: text('action').$type<AiEffectExtractionAuditAction>().notNull(),
    adminUserId: uuid('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
    previousRevision: integer('previous_revision').notNull(),
    nextRevision: integer('next_revision').notNull(),
    detail: jsonb('detail')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ai_effect_extraction_audit_created_at').on(table.createdAt),
    check('ai_effect_extraction_audit_action_check', sql`${table.action} IN ('CONFIG_UPDATED')`),
    check(
      'ai_effect_extraction_audit_revision_check',
      sql`${table.previousRevision} > 0 AND ${table.nextRevision} = ${table.previousRevision} + 1`
    ),
  ]
);

export const themeTableVersions = pgTable(
  'theme_table_versions',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    versionKey: text('version_key').notNull().unique(),
    name: text('name').notNull(),
    lifecycle: text('lifecycle').$type<ThemeTableLifecycle>().notNull().default('DRAFT'),
    environmentId: text('environment_id').notNull().unique(),
    rulesEnvironmentId: text('rules_environment_id').notNull(),
    cardCatalogHash: text('card_catalog_hash').notNull(),
    allocationAlgorithmVersion: text('allocation_algorithm_version').notNull(),
    platformTimeZone: text('platform_time_zone').notNull().default('Asia/Shanghai'),
    openWindows: jsonb('open_windows').$type<RankedSeasonOpenWindow[]>().notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    scheduleLabel: text('schedule_label').notNull(),
    summary: text('summary').notNull(),
    announcement: text('announcement').notNull(),
    evaluationPolicy: jsonb('evaluation_policy').$type<Record<string, unknown>>().notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_theme_table_versions_lifecycle_window').on(
      table.lifecycle,
      table.startsAt,
      table.endsAt
    ),
    uniqueIndex('uq_theme_table_versions_single_active')
      .on(table.lifecycle)
      .where(sql`${table.lifecycle} = 'ACTIVE'`),
    check(
      'theme_table_versions_lifecycle_check',
      sql`${table.lifecycle} IN ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED')`
    ),
    check('theme_table_versions_window_check', sql`${table.endsAt} > ${table.startsAt}`),
  ]
);

export const themePrebuiltDeckVersions = pgTable(
  'theme_prebuilt_deck_versions',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    themeTableVersionId: uuid('theme_table_version_id')
      .notNull()
      .references(() => themeTableVersions.id, { onDelete: 'restrict' }),
    deckKey: text('deck_key').notNull(),
    displayName: text('display_name').notNull(),
    runtimeDeck: jsonb('runtime_deck').$type<unknown>().notNull(),
    deckList: jsonb('deck_list')
      .$type<{
        readonly mainDeck: readonly { readonly cardCode: string; readonly count: number }[];
        readonly energyDeck: readonly { readonly cardCode: string; readonly count: number }[];
      }>()
      .notNull(),
    contentHash: text('content_hash').notNull(),
    playStyleTags: jsonb('play_style_tags').$type<readonly string[]>().notNull(),
    difficulty: text('difficulty').$type<ThemeDeckDifficulty>().notNull(),
    sourceLabel: text('source_label').notNull(),
    sourceUrl: text('source_url'),
    reviewNote: text('review_note').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_theme_prebuilt_deck_key')
      .on(table.themeTableVersionId, table.deckKey)
      .where(sql`${table.retiredAt} IS NULL`),
    uniqueIndex('uq_theme_prebuilt_deck_content')
      .on(table.themeTableVersionId, table.contentHash)
      .where(sql`${table.retiredAt} IS NULL`),
    check(
      'theme_prebuilt_deck_difficulty_check',
      sql`${table.difficulty} IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')`
    ),
  ]
);

export const themeMatchupPairVersions = pgTable(
  'theme_matchup_pair_versions',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    themeTableVersionId: uuid('theme_table_version_id')
      .notNull()
      .references(() => themeTableVersions.id, { onDelete: 'restrict' }),
    firstDeckVersionId: uuid('first_deck_version_id')
      .notNull()
      .references(() => themePrebuiltDeckVersions.id, { onDelete: 'restrict' }),
    secondDeckVersionId: uuid('second_deck_version_id')
      .notNull()
      .references(() => themePrebuiltDeckVersions.id, { onDelete: 'restrict' }),
    weight: integer('weight').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),
    testSummary: jsonb('test_summary').$type<Record<string, unknown>>().notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_theme_matchup_pairs_active').on(table.themeTableVersionId, table.enabled),
    uniqueIndex('uq_theme_matchup_pair').on(
      table.themeTableVersionId,
      table.firstDeckVersionId,
      table.secondDeckVersionId
    ),
    check('theme_matchup_pair_weight_check', sql`${table.weight} > 0`),
    check(
      'theme_matchup_pair_canonical_order_check',
      sql`${table.firstDeckVersionId} <= ${table.secondDeckVersionId}`
    ),
  ]
);

export const publicTableTickets = pgTable(
  'public_table_tickets',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    queueKind: text('queue_kind').$type<MatchmakingQueueKind>().notNull().default('CASUAL'),
    seasonId: uuid('season_id').references(() => rankedSeasons.id, {
      onDelete: 'restrict',
    }),
    themeTableVersionId: uuid('theme_table_version_id').references(
      (): AnyPgColumn => themeTableVersions.id,
      { onDelete: 'restrict' }
    ),
    environmentId: text('environment_id').notNull().default('PUBLIC_TABLE_V1'),
    sourceDeckId: uuid('source_deck_id').references(() => decks.id, { onDelete: 'set null' }),
    sourceDeckName: text('source_deck_name').notNull(),
    runtimeDeck: jsonb('runtime_deck').$type<unknown>().notNull(),
    deckContentHash: text('deck_content_hash').notNull(),
    pointTableVersion: text('point_table_version').notNull(),
    pointTotal: integer('point_total').notNull(),
    pointLimit: integer('point_limit').notNull(),
    deckLockedAt: timestamp('deck_locked_at', { withTimezone: true }).notNull().defaultNow(),
    state: text('state').$type<PublicTableTicketState>().notNull().default('WAITING'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
    matchableAfter: timestamp('matchable_after', { withTimezone: true }).notNull().defaultNow(),
    reservationId: uuid('reservation_id'),
    matchedRoomGeneration: text('matched_room_generation'),
    matchedMatchId: text('matched_match_id'),
    entrySource: text('entry_source').notNull().default('DIRECT'),
    requeuedFromTicketId: uuid('requeued_from_ticket_id').references(
      (): AnyPgColumn => publicTableTickets.id,
      { onDelete: 'set null' }
    ),
    terminalReason: text('terminal_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_public_table_tickets_matchable').on(
      table.environmentId,
      table.state,
      table.matchableAfter,
      table.joinedAt
    ),
    index('idx_public_table_tickets_reservation_id').on(table.reservationId),
    uniqueIndex('uq_public_table_tickets_active_user')
      .on(table.userId)
      .where(sql`${table.state} IN ('WAITING', 'RESERVED')`),
    uniqueIndex('uq_public_table_tickets_requeued_from')
      .on(table.requeuedFromTicketId)
      .where(sql`${table.requeuedFromTicketId} IS NOT NULL`),
    check(
      'public_table_tickets_state_check',
      sql`${table.state} IN ('WAITING', 'RESERVED', 'MATCHED', 'CANCELED', 'EXPIRED')`
    ),
    check(
      'public_table_tickets_queue_kind_check',
      sql`${table.queueKind} IN ('CASUAL', 'RANKED', 'THEME')`
    ),
    check('public_table_tickets_point_total_check', sql`${table.pointTotal} >= 0`),
    check('public_table_tickets_point_limit_check', sql`${table.pointLimit} > 0`),
    check(
      'public_table_tickets_ranked_season_check',
      sql`(${table.queueKind} = 'CASUAL' AND ${table.seasonId} IS NULL AND ${table.themeTableVersionId} IS NULL) OR (${table.queueKind} = 'RANKED' AND ${table.seasonId} IS NOT NULL AND ${table.themeTableVersionId} IS NULL) OR (${table.queueKind} = 'THEME' AND ${table.seasonId} IS NULL AND ${table.themeTableVersionId} IS NOT NULL)`
    ),
  ]
);

export const publicTableReservations = pgTable(
  'public_table_reservations',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    queueKind: text('queue_kind').$type<MatchmakingQueueKind>().notNull().default('CASUAL'),
    seasonId: uuid('season_id').references(() => rankedSeasons.id, {
      onDelete: 'restrict',
    }),
    themeTableVersionId: uuid('theme_table_version_id').references(
      (): AnyPgColumn => themeTableVersions.id,
      { onDelete: 'restrict' }
    ),
    environmentId: text('environment_id').notNull().default('PUBLIC_TABLE_V1'),
    firstTicketId: uuid('first_ticket_id')
      .notNull()
      .references(() => publicTableTickets.id, { onDelete: 'restrict' }),
    secondTicketId: uuid('second_ticket_id')
      .notNull()
      .references(() => publicTableTickets.id, { onDelete: 'restrict' }),
    state: text('state')
      .$type<PublicTableReservationState>()
      .notNull()
      .default('PENDING_CONFIRMATION'),
    firstConfirmedAt: timestamp('first_confirmed_at', { withTimezone: true }),
    secondConfirmedAt: timestamp('second_confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    bootstrapLeaseUntil: timestamp('bootstrap_lease_until', { withTimezone: true }),
    bootstrapAttemptCount: integer('bootstrap_attempt_count').notNull().default(0),
    roomCode: text('room_code'),
    roomGeneration: text('room_generation').unique(),
    matchId: text('match_id'),
    failureReason: text('failure_reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_public_table_reservations_state_expires').on(table.state, table.expiresAt),
    uniqueIndex('uq_public_table_reservation_ticket_pair').on(
      table.firstTicketId,
      table.secondTicketId
    ),
    check(
      'public_table_reservations_state_check',
      sql`${table.state} IN ('PENDING_CONFIRMATION', 'CREATING_ROOM', 'MATCHED', 'RELEASED')`
    ),
    check(
      'public_table_reservations_distinct_tickets_check',
      sql`${table.firstTicketId} <> ${table.secondTicketId}`
    ),
    check(
      'public_table_reservations_queue_kind_check',
      sql`${table.queueKind} IN ('CASUAL', 'RANKED', 'THEME')`
    ),
    check(
      'public_table_reservations_ranked_season_check',
      sql`(${table.queueKind} = 'CASUAL' AND ${table.seasonId} IS NULL AND ${table.themeTableVersionId} IS NULL) OR (${table.queueKind} = 'RANKED' AND ${table.seasonId} IS NOT NULL AND ${table.themeTableVersionId} IS NULL) OR (${table.queueKind} = 'THEME' AND ${table.seasonId} IS NULL AND ${table.themeTableVersionId} IS NOT NULL)`
    ),
  ]
);

export const themeTableAssignments = pgTable(
  'theme_table_assignments',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    reservationId: uuid('reservation_id')
      .notNull()
      .unique()
      .references(() => publicTableReservations.id, { onDelete: 'restrict' }),
    themeTableVersionId: uuid('theme_table_version_id')
      .notNull()
      .references(() => themeTableVersions.id, { onDelete: 'restrict' }),
    matchupPairVersionId: uuid('matchup_pair_version_id')
      .notNull()
      .references(() => themeMatchupPairVersions.id, { onDelete: 'restrict' }),
    firstTicketDeckVersionId: uuid('first_ticket_deck_version_id')
      .notNull()
      .references(() => themePrebuiltDeckVersions.id, { onDelete: 'restrict' }),
    secondTicketDeckVersionId: uuid('second_ticket_deck_version_id')
      .notNull()
      .references(() => themePrebuiltDeckVersions.id, { onDelete: 'restrict' }),
    allocationAlgorithmVersion: text('allocation_algorithm_version').notNull(),
    eligiblePairSnapshotHash: text('eligible_pair_snapshot_hash').notNull(),
    entropyCommitment: text('entropy_commitment').notNull(),
    allocationProof: jsonb('allocation_proof').$type<Record<string, unknown>>().notNull(),
    matchId: text('match_id').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_theme_table_assignments_theme').on(table.themeTableVersionId)]
);

export const gameplayParticipations = pgTable(
  'gameplay_participations',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<GameplayParticipationKind>().notNull(),
    ticketId: uuid('ticket_id').references(() => publicTableTickets.id, {
      onDelete: 'cascade',
    }),
    roomGeneration: text('room_generation'),
    matchId: text('match_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_gameplay_participations_kind').on(table.kind),
    check(
      'gameplay_participations_kind_check',
      sql`${table.kind} IN ('PUBLIC_QUEUE', 'RANKED_QUEUE', 'THEME_QUEUE', 'ONLINE_ROOM', 'ONLINE_MATCH')`
    ),
  ]
);

export const matchRecords = pgTable(
  'match_records',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    matchId: text('match_id').notNull().unique(),
    roomCode: text('room_code').notNull(),
    matchMode: text('match_mode').$type<MatchMode>().notNull().default('ONLINE'),
    automationGameMode: text('automation_game_mode')
      .$type<MatchAutomationGameMode>()
      .notNull()
      .default('DEBUG'),
    originKind: text('origin_kind').$type<MatchOriginKind>().notNull().default('ONLINE_ROOM'),
    originLabel: text('origin_label').notNull().default('在线房间'),
    status: text('status').$type<MatchRecordStatus>().notNull().default('IN_PROGRESS'),
    completeness: text('completeness').$type<MatchRecordCompleteness>().notNull().default('FULL'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    sealedAt: timestamp('sealed_at', { withTimezone: true }),
    firstUserId: text('first_user_id').notNull(),
    secondUserId: text('second_user_id').notNull(),
    winnerSeat: text('winner_seat'),
    endReason: text('end_reason'),
    turnCount: integer('turn_count').notNull().default(0),
    lastTimelineSeq: integer('last_timeline_seq').notNull().default(0),
    lastCheckpointSeq: integer('last_checkpoint_seq').notNull().default(0),
    lastPublicSeq: integer('last_public_seq').notNull().default(0),
    lastPrivateSeqBySeat: jsonb('last_private_seq_by_seat')
      .$type<Record<'FIRST' | 'SECOND', number>>()
      .notNull()
      .default(sql`'{"FIRST":0,"SECOND":0}'::jsonb`),
    lastAuditSeq: integer('last_audit_seq').notNull().default(0),
    lastCommandSeq: integer('last_command_seq').notNull().default(0),
    lastGameEventSeq: integer('last_game_event_seq').notNull().default(0),
    recordVersion: integer('record_version').notNull().default(1),
    rulesVersion: text('rules_version').notNull(),
    cardDataVersion: text('card_data_version').notNull(),
    cardDataHash: text('card_data_hash').notNull(),
    replayCapabilities: jsonb('replay_capabilities')
      .$type<ReplayCapability[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    replayLimitations: jsonb('replay_limitations')
      .$type<ReplayLimitation[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    partialReason: text('partial_reason'),
    lastRecorderError: text('last_recorder_error'),
    appendFailureAt: timestamp('append_failure_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_match_records_first_user_id').on(table.firstUserId),
    index('idx_match_records_second_user_id').on(table.secondUserId),
    index('idx_match_records_match_mode').on(table.matchMode),
    index('idx_match_records_status').on(table.status),
    index('idx_match_records_started_at').on(table.startedAt),
    check('match_records_match_mode_check', sql`${table.matchMode} IN ('ONLINE', 'SOLITAIRE')`),
    check(
      'match_records_automation_game_mode_check',
      sql`${table.automationGameMode} IN ('DEBUG', 'SOLITAIRE')`
    ),
    check(
      'match_records_origin_kind_check',
      sql`${table.originKind} IN ('ONLINE_ROOM', 'PUBLIC_TABLE', 'RANKED', 'SOLITAIRE')`
    ),
    check(
      'match_records_status_check',
      sql`${table.status} IN ('IN_PROGRESS', 'COMPLETED', 'SURRENDERED', 'INTERRUPTED', 'CORRUPTED')`
    ),
    check(
      'match_records_completeness_check',
      sql`${table.completeness} IN ('FULL', 'PARTIAL', 'INCOMPLETE', 'METADATA_ONLY')`
    ),
    check(
      'match_records_winner_seat_check',
      sql`${table.winnerSeat} IS NULL OR ${table.winnerSeat} IN ('FIRST', 'SECOND')`
    ),
  ]
);

export const matchDeckSnapshots = pgTable(
  'match_deck_snapshots',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matchRecords.matchId, { onDelete: 'cascade' }),
    seat: text('seat').$type<'FIRST' | 'SECOND'>().notNull(),
    userId: text('user_id').notNull(),
    sourceDeckId: text('source_deck_id'),
    sourceDeckName: text('source_deck_name'),
    source: text('source').$type<MatchDeckSnapshotSource>().notNull(),
    mainDeck: jsonb('main_deck').$type<string[]>().notNull(),
    energyDeck: jsonb('energy_deck').$type<string[]>().notNull(),
    cardSummaries: jsonb('card_summaries')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    validationState: text('validation_state')
      .$type<MatchDeckSnapshotValidationState>()
      .notNull()
      .default('RUNTIME_ACCEPTED'),
    pointTableVersion: text('point_table_version').notNull(),
    pointTotal: integer('point_total').notNull(),
    pointLimit: integer('point_limit').notNull(),
    cardDataVersion: text('card_data_version').notNull(),
    cardDataHash: text('card_data_hash').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_match_deck_snapshots_match_seat').on(table.matchId, table.seat),
    index('idx_match_deck_snapshots_user_id').on(table.userId),
    check('match_deck_snapshots_seat_check', sql`${table.seat} IN ('FIRST', 'SECOND')`),
    check(
      'match_deck_snapshots_source_check',
      sql`${table.source} IN ('ONLINE_RUNTIME_DECK', 'PUBLISHED_CARDS_SNAPSHOT', 'SOLITAIRE_DEFAULT_DECK')`
    ),
    check(
      'match_deck_snapshots_validation_state_check',
      sql`${table.validationState} IN ('RUNTIME_ACCEPTED', 'VALID', 'INVALID')`
    ),
    check('match_deck_snapshots_point_total_check', sql`${table.pointTotal} >= 0`),
    check('match_deck_snapshots_point_limit_check', sql`${table.pointLimit} > 0`),
  ]
);

export const matchParticipants = pgTable(
  'match_participants',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matchRecords.matchId, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    seat: text('seat').$type<'FIRST' | 'SECOND'>().notNull(),
    displayName: text('display_name').notNull(),
    playerId: text('player_id').notNull(),
    participantKind: text('participant_kind')
      .$type<MatchParticipantKind>()
      .notNull()
      .default('USER'),
    ownerUserId: text('owner_user_id'),
    deckSnapshotId: uuid('deck_snapshot_id').references(() => matchDeckSnapshots.id, {
      onDelete: 'set null',
    }),
    replayAccess: text('replay_access')
      .$type<MatchRecordReplayAccess>()
      .notNull()
      .default('PARTICIPANT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_match_participants_match_seat').on(table.matchId, table.seat),
    uniqueIndex('uq_match_participants_match_user').on(table.matchId, table.userId),
    index('idx_match_participants_user_id').on(table.userId),
    index('idx_match_participants_owner_user_id').on(table.ownerUserId),
    check('match_participants_seat_check', sql`${table.seat} IN ('FIRST', 'SECOND')`),
    check('match_participants_kind_check', sql`${table.participantKind} IN ('USER', 'SYSTEM')`),
    check(
      'match_participants_replay_access_check',
      sql`${table.replayAccess} IN ('PARTICIPANT', 'ADMIN')`
    ),
  ]
);

export const matchTimelineEntries = pgTable(
  'match_timeline_entries',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matchRecords.matchId, { onDelete: 'cascade' }),
    timelineSeq: integer('timeline_seq').notNull(),
    frameType: text('frame_type').$type<ReplayRecordFrameType>().notNull(),
    visibilityScope: text('visibility_scope').$type<ReplayVisibilityScope>().notNull(),
    relatedCheckpointSeq: integer('related_checkpoint_seq'),
    relatedPublicSeq: integer('related_public_seq'),
    relatedPrivateSeq: integer('related_private_seq'),
    relatedPrivateSeqBySeat: jsonb('related_private_seq_by_seat')
      .$type<Record<'FIRST' | 'SECOND', number>>()
      .notNull()
      .default(sql`'{"FIRST":0,"SECOND":0}'::jsonb`),
    relatedAuditSeq: integer('related_audit_seq'),
    relatedCommandSeq: integer('related_command_seq'),
    relatedGameEventSeq: integer('related_game_event_seq'),
    relatedDecisionId: text('related_decision_id'),
    dedupeKey: text('dedupe_key').notNull(),
    turnCount: integer('turn_count').notNull().default(0),
    phase: text('phase').notNull(),
    subPhase: text('sub_phase').notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_match_timeline_entries_match_seq').on(table.matchId, table.timelineSeq),
    uniqueIndex('uq_match_timeline_entries_match_dedupe').on(table.matchId, table.dedupeKey),
    index('idx_match_timeline_entries_match_created_at').on(table.matchId, table.createdAt),
    index('idx_match_timeline_entries_checkpoint').on(table.matchId, table.relatedCheckpointSeq),
    check(
      'match_timeline_entries_visibility_scope_check',
      sql`${table.visibilityScope} IN ('PUBLIC', 'PRIVATE', 'ADMIN', 'SYSTEM')`
    ),
  ]
);

export const matchRecordPublicEvents = pgTable(
  'match_record_public_events',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matchRecords.matchId, { onDelete: 'cascade' }),
    timelineSeq: integer('timeline_seq').notNull(),
    eventSeq: integer('event_seq').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    source: text('source'),
    actorSeat: text('actor_seat').$type<Seat>(),
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<PublicEvent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_match_record_public_events_match_timeline_seq').on(
      table.matchId,
      table.timelineSeq,
      table.eventSeq
    ),
    index('idx_match_record_public_events_timeline').on(table.matchId, table.timelineSeq),
    index('idx_match_record_public_events_type').on(table.matchId, table.eventType),
    check(
      'match_record_public_events_actor_seat_check',
      sql`${table.actorSeat} IS NULL OR ${table.actorSeat} IN ('FIRST', 'SECOND')`
    ),
  ]
);

export const matchDecisionRecords = pgTable(
  'match_decision_records',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matchRecords.matchId, { onDelete: 'cascade' }),
    decisionId: text('decision_id').notNull(),
    timelineSeq: integer('timeline_seq').notNull(),
    decisionSchemaVersion: integer('decision_schema_version').notNull().default(1),
    decisionType: text('decision_type').$type<MatchDecisionType>().notNull(),
    status: text('status').$type<MatchDecisionRecordStatus>().notNull(),
    playerId: text('player_id'),
    eventIds: jsonb('event_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceType: text('source_type'),
    sourceCardObjectId: text('source_card_object_id'),
    sourceCardCode: text('source_card_code'),
    sourceBaseCardCode: text('source_base_card_code'),
    sourceZone: text('source_zone'),
    sourceSlot: text('source_slot'),
    abilityId: text('ability_id'),
    triggerCondition: text('trigger_condition'),
    abilityCategory: text('ability_category'),
    abilitySourceZone: text('ability_source_zone'),
    effectTextSnapshot: text('effect_text_snapshot'),
    stepId: text('step_id'),
    stepText: text('step_text'),
    waitingSeat: text('waiting_seat').$type<Seat>(),
    visibleCandidates: jsonb('visible_candidates')
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    auditCandidates: jsonb('audit_candidates')
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    visibleContextSummary:
      jsonb('visible_context_summary').$type<MatchDecisionVisibleContextSummary>(),
    minSelect: integer('min_select'),
    maxSelect: integer('max_select'),
    canSkip: boolean('can_skip'),
    openedCheckpointSeq: integer('opened_checkpoint_seq'),
    submittedTimelineSeq: integer('submitted_timeline_seq'),
    submittedCommandSeq: integer('submitted_command_seq'),
    submission: jsonb('submission').$type<MatchDecisionSubmissionSummary>(),
    resultSummary: text('result_summary'),
    replayCapability: text('replay_capability')
      .$type<ReplayCapability>()
      .notNull()
      .default('DECISION_RECORDS_PARTIAL'),
    transitionSemantics: text('transition_semantics')
      .$type<MatchDecisionTransitionSemantics>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_match_decision_records_match_decision').on(table.matchId, table.decisionId),
    index('idx_match_decision_records_timeline').on(table.matchId, table.timelineSeq),
    index('idx_match_decision_records_waiting_seat').on(table.matchId, table.waitingSeat),
    check(
      'match_decision_records_type_check',
      sql`${table.decisionType} IN ('ACTIVE_EFFECT_OPENED', 'ACTIVE_EFFECT_SUBMITTED', 'PENDING_ABILITY_ORDER_SUBMITTED', 'ACTIVATE_ABILITY_SUBMITTED', 'MULLIGAN_SUBMITTED', 'SET_LIVE_CARD_SUBMITTED', 'SELECT_SUCCESS_LIVE_SUBMITTED')`
    ),
    check('match_decision_records_status_check', sql`${table.status} IN ('OPENED', 'SUBMITTED')`),
    check(
      'match_decision_records_waiting_seat_check',
      sql`${table.waitingSeat} IS NULL OR ${table.waitingSeat} IN ('FIRST', 'SECOND')`
    ),
    check(
      'match_decision_records_transition_semantics_check',
      sql`${table.transitionSemantics} IN ('STRUCTURED', 'SNAPSHOT_AUDIT_ONLY', 'UNSTRUCTURED_MANUAL')`
    ),
  ]
);

export const matchRecordPrivateEvents = pgTable(
  'match_record_private_events',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matchRecords.matchId, { onDelete: 'cascade' }),
    seat: text('seat').$type<Seat>().notNull(),
    timelineSeq: integer('timeline_seq').notNull(),
    eventSeq: integer('event_seq').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    relatedPublicSeq: integer('related_public_seq').notNull(),
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<PrivateEvent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_match_record_private_events_match_seat_seq').on(
      table.matchId,
      table.seat,
      table.timelineSeq,
      table.eventSeq
    ),
    index('idx_match_record_private_events_timeline').on(table.matchId, table.timelineSeq),
    index('idx_match_record_private_events_seat').on(table.matchId, table.seat),
    check('match_record_private_events_seat_check', sql`${table.seat} IN ('FIRST', 'SECOND')`),
  ]
);

export const matchCheckpoints = pgTable(
  'match_checkpoints',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matchRecords.matchId, { onDelete: 'cascade' }),
    checkpointSeq: integer('checkpoint_seq').notNull(),
    timelineSeq: integer('timeline_seq').notNull(),
    checkpointType: text('checkpoint_type').$type<ReplayCheckpointType>().notNull(),
    relatedPublicSeq: integer('related_public_seq'),
    relatedCommandSeq: integer('related_command_seq'),
    relatedGameEventSeq: integer('related_game_event_seq'),
    turnCount: integer('turn_count').notNull(),
    phase: text('phase').notNull(),
    subPhase: text('sub_phase').notNull(),
    schemaVersion: text('schema_version').notNull(),
    payload: jsonb('payload').$type<ReplaySerializedPayloadEnvelope>().notNull(),
    payloadCompression: text('payload_compression').notNull().default('NONE'),
    payloadHash: text('payload_hash').notNull(),
    visibilityScope: text('visibility_scope').$type<ReplayVisibilityScope>().notNull(),
    capabilities: jsonb('capabilities')
      .$type<ReplayCapability[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_match_checkpoints_match_seq').on(table.matchId, table.checkpointSeq),
    uniqueIndex('uq_match_checkpoints_match_timeline').on(table.matchId, table.timelineSeq),
    index('idx_match_checkpoints_match_created_at').on(table.matchId, table.createdAt),
    check(
      'match_checkpoints_type_check',
      sql`${table.checkpointType} IN ('AUTHORITY', 'PLAYER_VIEW', 'PUBLIC_VIEW')`
    ),
    check(
      'match_checkpoints_visibility_scope_check',
      sql`${table.visibilityScope} IN ('PUBLIC', 'PRIVATE', 'ADMIN', 'SYSTEM')`
    ),
  ]
);

export const rankedSeasons = pgTable(
  'ranked_seasons',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    seasonKey: text('season_key').notNull().unique(),
    name: text('name').notNull(),
    announcement: text('announcement').notNull().default(''),
    competitiveEnvironmentId: text('competitive_environment_id').notNull(),
    lifecycle: text('lifecycle').$type<RankedSeasonLifecycle>().notNull().default('DRAFT'),
    queueAdmission: text('queue_admission')
      .$type<RankedQueueAdmission>()
      .notNull()
      .default('PAUSED'),
    platformTimeZone: text('platform_time_zone').notNull().default('Asia/Shanghai'),
    openWindows: jsonb('open_windows')
      .$type<RankedSeasonOpenWindow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    scheduledEndsAt: timestamp('scheduled_ends_at', { withTimezone: true }).notNull(),
    finalizingDeadlineAt: timestamp('finalizing_deadline_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    rulesVersion: text('rules_version').notNull(),
    cardCatalogVersion: text('card_catalog_version').notNull(),
    cardCatalogHash: text('card_catalog_hash').notNull(),
    deckPolicyVersion: text('deck_policy_version').notNull(),
    ratingAlgorithmVersion: text('rating_algorithm_version').notNull(),
    ratingConfig: jsonb('rating_config').$type<RankedRatingConfig>().notNull(),
    leaderboardMinimumMatchCount: integer('leaderboard_minimum_match_count').notNull().default(10),
    ledgerRevision: integer('ledger_revision').notNull().default(0),
    activeRatingRevisionId: uuid('active_rating_revision_id').references(
      (): AnyPgColumn => rankedRatingRevisions.id,
      { onDelete: 'restrict' }
    ),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_ranked_seasons_effective_environment')
      .on(sql`(true)`)
      .where(sql`${table.lifecycle} IN ('ACTIVE', 'FINALIZING')`),
    index('idx_ranked_seasons_lifecycle').on(table.lifecycle, table.startsAt),
    check(
      'ranked_seasons_lifecycle_check',
      sql`${table.lifecycle} IN ('DRAFT', 'ACTIVE', 'FINALIZING', 'CLOSED')`
    ),
    check(
      'ranked_seasons_queue_admission_check',
      sql`${table.queueAdmission} IN ('OPEN', 'PAUSED')`
    ),
    check('ranked_seasons_key_check', sql`btrim(${table.seasonKey}) <> ''`),
    check('ranked_seasons_name_check', sql`btrim(${table.name}) <> ''`),
    check(
      'ranked_seasons_announcement_length_check',
      sql`char_length(${table.announcement}) <= 2000`
    ),
    check(
      'ranked_seasons_schedule_check',
      sql`${table.startsAt} < ${table.scheduledEndsAt} AND ${table.scheduledEndsAt} <= ${table.finalizingDeadlineAt}`
    ),
    check('ranked_seasons_catalog_hash_check', sql`${table.cardCatalogHash} LIKE 'sha256:%'`),
    check(
      'ranked_seasons_leaderboard_minimum_match_count_check',
      sql`${table.leaderboardMinimumMatchCount} BETWEEN 1 AND 100`
    ),
    check('ranked_seasons_ledger_revision_check', sql`${table.ledgerRevision} >= 0`),
  ]
);

export const rankedMatches = pgTable(
  'ranked_matches',
  {
    matchId: text('match_id')
      .primaryKey()
      .references(() => matchRecords.matchId, { onDelete: 'restrict' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => rankedSeasons.id, { onDelete: 'restrict' }),
    firstUserId: uuid('first_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    secondUserId: uuid('second_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    ratingStatus: text('rating_status')
      .$type<RankedMatchRatingStatus>()
      .notNull()
      .default('PENDING'),
    winnerSeat: text('winner_seat').$type<'FIRST' | 'SECOND'>(),
    resultType: text('result_type').$type<RankedMatchResultType>(),
    usedFree: boolean('used_free').notNull().default(false),
    rulesVersion: text('rules_version').notNull(),
    cardCatalogVersion: text('card_catalog_version').notNull(),
    cardCatalogHash: text('card_catalog_hash').notNull(),
    deckPolicyVersion: text('deck_policy_version').notNull(),
    ratingAlgorithmVersion: text('rating_algorithm_version').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ranked_matches_season_status').on(table.seasonId, table.ratingStatus, table.endedAt),
    index('idx_ranked_matches_first_user').on(table.seasonId, table.firstUserId),
    index('idx_ranked_matches_second_user').on(table.seasonId, table.secondUserId),
    check(
      'ranked_matches_rating_status_check',
      sql`${table.ratingStatus} IN ('PENDING', 'SETTLED', 'VOIDED')`
    ),
    check(
      'ranked_matches_winner_seat_check',
      sql`${table.winnerSeat} IS NULL OR ${table.winnerSeat} IN ('FIRST', 'SECOND')`
    ),
    check(
      'ranked_matches_result_type_check',
      sql`${table.resultType} IS NULL OR ${table.resultType} IN ('NORMAL', 'SURRENDER', 'DISCONNECT_FORFEIT', 'PLATFORM_NO_CONTEST')`
    ),
    check(
      'ranked_matches_result_consistency_check',
      sql`(${table.ratingStatus} = 'PENDING' AND ${table.winnerSeat} IS NULL AND (${table.resultType} IS NULL OR ${table.resultType} = 'DISCONNECT_FORFEIT')) OR (${table.ratingStatus} = 'SETTLED' AND ${table.winnerSeat} IN ('FIRST', 'SECOND') AND ${table.resultType} IN ('NORMAL', 'SURRENDER', 'DISCONNECT_FORFEIT')) OR (${table.ratingStatus} = 'VOIDED' AND ${table.winnerSeat} IS NULL AND ${table.resultType} = 'PLATFORM_NO_CONTEST')`
    ),
    check(
      'ranked_matches_distinct_players_check',
      sql`${table.firstUserId} <> ${table.secondUserId}`
    ),
    check('ranked_matches_catalog_hash_check', sql`${table.cardCatalogHash} LIKE 'sha256:%'`),
  ]
);

export const rankedDeckObservations = pgTable(
  'ranked_deck_observations',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => rankedMatches.matchId, { onDelete: 'cascade' }),
    seat: text('seat').$type<'FIRST' | 'SECOND'>().notNull(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => rankedSeasons.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    deckFingerprint: text('deck_fingerprint').notNull(),
    mainDeckCards: jsonb('main_deck_cards').$type<RankedDeckObservationCard[]>().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.matchId, table.seat],
      name: 'ranked_deck_observations_pk',
    }),
    uniqueIndex('uq_ranked_deck_observations_match_user').on(table.matchId, table.userId),
    index('idx_ranked_deck_observations_season_user').on(table.seasonId, table.userId),
    index('idx_ranked_deck_observations_season_fingerprint').on(
      table.seasonId,
      table.deckFingerprint
    ),
    index('idx_ranked_deck_observations_fingerprint_observed').on(
      table.deckFingerprint,
      table.observedAt
    ),
    check('ranked_deck_observations_seat_check', sql`${table.seat} IN ('FIRST', 'SECOND')`),
    check(
      'ranked_deck_observations_fingerprint_check',
      sql`${table.deckFingerprint} ~ '^sha256:[0-9a-f]{64}$'`
    ),
    check(
      'ranked_deck_observations_main_deck_check',
      sql`jsonb_typeof(${table.mainDeckCards}) = 'array' AND jsonb_array_length(${table.mainDeckCards}) > 0`
    ),
  ]
);

/**
 * Mutable classifier draft entities. Published player-facing behavior never reads these rows
 * directly; a release freezes their complete configuration in snapshot_json.
 */
export const deckArchetypes = pgTable(
  'deck_archetypes',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    archetypeKey: text('archetype_key').notNull().unique(),
    name: text('name').notNull(),
    groupName: text('group_name').notNull().default('其他'),
    description: text('description').notNull().default(''),
    colorKey: text('color_key').notNull(),
    representativeCardCode: text('representative_card_code').references(() => cards.cardCode, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    lifecycle: text('lifecycle').$type<DeckArchetypeLifecycle>().notNull().default('ACTIVE'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_deck_archetypes_lifecycle_order').on(table.lifecycle, table.sortOrder),
    check('deck_archetypes_key_check', sql`${table.archetypeKey} ~ '^[a-z0-9][a-z0-9_-]{1,63}$'`),
    check('deck_archetypes_name_check', sql`btrim(${table.name}) <> ''`),
    check('deck_archetypes_group_check', sql`btrim(${table.groupName}) <> ''`),
    check('deck_archetypes_color_check', sql`${table.colorKey} ~ '^#[0-9A-Fa-f]{6}$'`),
    check('deck_archetypes_lifecycle_check', sql`${table.lifecycle} IN ('ACTIVE', 'ARCHIVED')`),
  ]
);

export const deckArchetypeTemplates = pgTable(
  'deck_archetype_templates',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    archetypeId: uuid('archetype_id')
      .notNull()
      .references(() => deckArchetypes.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    deckFingerprint: text('deck_fingerprint').notNull(),
    cards: jsonb('cards').$type<readonly Record<string, unknown>[]>().notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceMatchId: text('source_match_id'),
    sourceSeat: text('source_seat').$type<'FIRST' | 'SECOND'>(),
    sourceNote: text('source_note').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_deck_archetype_templates_active_fingerprint')
      .on(table.deckFingerprint)
      .where(sql`${table.enabled} = true`),
    index('idx_deck_archetype_templates_archetype').on(table.archetypeId, table.enabled),
    index('idx_deck_archetype_templates_source_match').on(table.sourceMatchId, table.sourceSeat),
    foreignKey({
      columns: [table.sourceMatchId, table.sourceSeat],
      foreignColumns: [rankedDeckObservations.matchId, rankedDeckObservations.seat],
      name: 'deck_archetype_templates_source_observation_fk',
    }).onDelete('set null'),
    check('deck_archetype_templates_name_check', sql`btrim(${table.name}) <> ''`),
    check(
      'deck_archetype_templates_fingerprint_check',
      sql`${table.deckFingerprint} ~ '^sha256:[0-9a-f]{64}$'`
    ),
    check(
      'deck_archetype_templates_cards_check',
      sql`jsonb_typeof(${table.cards}) = 'array' AND jsonb_array_length(${table.cards}) > 0`
    ),
    check(
      'deck_archetype_templates_source_kind_check',
      sql`${table.sourceKind} IN ('MATCH_OBSERVATION', 'SEED_PACKAGE', 'MANUAL')`
    ),
    check(
      'deck_archetype_templates_source_seat_check',
      sql`${table.sourceSeat} IS NULL OR ${table.sourceSeat} IN ('FIRST', 'SECOND')`
    ),
    check(
      'deck_archetype_templates_source_shape_check',
      sql`(${table.sourceKind} = 'MATCH_OBSERVATION' AND ((${table.sourceMatchId} IS NOT NULL AND ${table.sourceSeat} IS NOT NULL) OR (${table.sourceMatchId} IS NULL AND ${table.sourceSeat} IS NULL))) OR (${table.sourceKind} <> 'MATCH_OBSERVATION' AND ${table.sourceMatchId} IS NULL AND ${table.sourceSeat} IS NULL)`
    ),
  ]
);

export const deckArchetypeRules = pgTable(
  'deck_archetype_rules',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    archetypeId: uuid('archetype_id')
      .notNull()
      .references(() => deckArchetypes.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    priority: integer('priority').notNull().default(100),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_deck_archetype_rules_archetype').on(
      table.archetypeId,
      table.enabled,
      table.priority
    ),
    check('deck_archetype_rules_name_check', sql`btrim(${table.name}) <> ''`),
    check(
      'deck_archetype_rules_definition_check',
      sql`jsonb_typeof(${table.definition}) = 'object'`
    ),
    check('deck_archetype_rules_priority_check', sql`${table.priority} >= 0`),
  ]
);

export const deckClassifierReleases = pgTable(
  'deck_classifier_releases',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    version: integer('version').notNull().unique(),
    status: text('status').$type<DeckClassifierReleaseStatus>().notNull(),
    snapshotJson: jsonb('snapshot_json').$type<Record<string, unknown>>().notNull(),
    configHash: text('config_hash').notNull(),
    reason: text('reason').notNull(),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_deck_classifier_releases_active')
      .on(sql`(true)`)
      .where(sql`${table.status} = 'ACTIVE'`),
    uniqueIndex('uq_deck_classifier_releases_building')
      .on(sql`(true)`)
      .where(sql`${table.status} = 'BUILDING'`),
    index('idx_deck_classifier_releases_published_at').on(table.publishedAt),
    check('deck_classifier_releases_version_check', sql`${table.version} > 0`),
    check(
      'deck_classifier_releases_status_check',
      sql`${table.status} IN ('BUILDING', 'ACTIVE', 'SUPERSEDED', 'FAILED')`
    ),
    check(
      'deck_classifier_releases_snapshot_check',
      sql`jsonb_typeof(${table.snapshotJson}) = 'object'`
    ),
    check(
      'deck_classifier_releases_hash_check',
      sql`${table.configHash} ~ '^sha256:[0-9a-f]{64}$'`
    ),
    check('deck_classifier_releases_reason_check', sql`btrim(${table.reason}) <> ''`),
    check(
      'deck_classifier_releases_activation_check',
      sql`(${table.status} IN ('BUILDING', 'FAILED') AND ${table.activatedAt} IS NULL) OR (${table.status} IN ('ACTIVE', 'SUPERSEDED') AND ${table.activatedAt} IS NOT NULL)`
    ),
  ]
);

export const deckClassifierSettings = pgTable(
  'deck_classifier_settings',
  {
    id: integer('id').primaryKey().default(1),
    displayMode: text('display_mode').$type<DeckClassifierDisplayMode>().notNull().default('BOTH'),
    showUsage: boolean('show_usage').notNull().default(true),
    showWinner: boolean('show_winner').notNull().default(true),
    showTopRanked: boolean('show_top_ranked').notNull().default(false),
    topRankedPlayerCount: integer('top_ranked_player_count').notNull().default(30),
    draftRevision: integer('draft_revision').notNull().default(0),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('deck_classifier_settings_singleton_check', sql`${table.id} = 1`),
    check('deck_classifier_settings_draft_revision_check', sql`${table.draftRevision} >= 0`),
    check(
      'deck_classifier_settings_display_mode_check',
      sql`${table.displayMode} IN ('HIDDEN', 'PLAYER_EQUAL', 'MATCH_EQUAL', 'BOTH')`
    ),
    check(
      'deck_classifier_settings_top_ranked_player_count_check',
      sql`${table.topRankedPlayerCount} BETWEEN 10 AND 100`
    ),
    check(
      'deck_classifier_settings_visibility_check',
      sql`(${table.displayMode} = 'HIDDEN') = (NOT ${table.showUsage} AND NOT ${table.showWinner} AND NOT ${table.showTopRanked})`
    ),
  ]
);

export const deckClassificationRuns = pgTable(
  'deck_classification_runs',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => deckClassifierReleases.id, { onDelete: 'restrict' }),
    status: text('status').$type<DeckClassificationRunStatus>().notNull().default('QUEUED'),
    trigger: text('trigger').$type<DeckClassificationRunTrigger>().notNull(),
    scopeSeasonId: uuid('scope_season_id').references(() => rankedSeasons.id, {
      onDelete: 'restrict',
    }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    requestId: text('request_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    reason: text('reason').notNull(),
    totalCount: integer('total_count').notNull().default(0),
    processedCount: integer('processed_count').notNull().default(0),
    classifiedCount: integer('classified_count').notNull().default(0),
    unknownCount: integer('unknown_count').notNull().default(0),
    ambiguousCount: integer('ambiguous_count').notNull().default(0),
    invalidCount: integer('invalid_count').notNull().default(0),
    excludedCount: integer('excluded_count').notNull().default(0),
    changedCount: integer('changed_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_deck_classification_runs_active')
      .on(sql`(true)`)
      .where(sql`${table.status} = 'RUNNING'`),
    unique('uq_deck_classification_runs_id_release').on(table.id, table.releaseId),
    index('idx_deck_classification_runs_release_created').on(table.releaseId, table.createdAt),
    index('idx_deck_classification_runs_scope_season').on(table.scopeSeasonId, table.createdAt),
    check(
      'deck_classification_runs_status_check',
      sql`${table.status} IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')`
    ),
    check(
      'deck_classification_runs_trigger_check',
      sql`${table.trigger} IN ('RELEASE_PUBLISHED', 'MANUAL_RECLASSIFY', 'MANUAL_OVERRIDE', 'AUTO_NEW_OBSERVATIONS')`
    ),
    check('deck_classification_runs_request_id_check', sql`btrim(${table.requestId}) <> ''`),
    check(
      'deck_classification_runs_idempotency_key_check',
      sql`btrim(${table.idempotencyKey}) <> ''`
    ),
    check('deck_classification_runs_reason_check', sql`btrim(${table.reason}) <> ''`),
    check(
      'deck_classification_runs_counts_check',
      sql`${table.totalCount} >= 0 AND ${table.processedCount} >= 0 AND ${table.processedCount} <= ${table.totalCount} AND ${table.classifiedCount} >= 0 AND ${table.unknownCount} >= 0 AND ${table.ambiguousCount} >= 0 AND ${table.invalidCount} >= 0 AND ${table.excludedCount} >= 0 AND ${table.changedCount} >= 0 AND (${table.classifiedCount} + ${table.unknownCount} + ${table.ambiguousCount} + ${table.invalidCount} + ${table.excludedCount}) <= ${table.processedCount}`
    ),
  ]
);

export const deckClassificationOverrides = pgTable(
  'deck_classification_overrides',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    deckFingerprint: text('deck_fingerprint').notNull(),
    archetypeId: uuid('archetype_id').references(() => deckArchetypes.id, {
      onDelete: 'restrict',
    }),
    targetStatus: text('target_status').$type<'CLASSIFIED' | 'UNKNOWN' | 'EXCLUDED'>().notNull(),
    reason: text('reason').notNull(),
    appliesToFutureReleases: boolean('applies_to_future_releases').notNull().default(true),
    releaseId: uuid('release_id').references(() => deckClassifierReleases.id, {
      onDelete: 'restrict',
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    requestId: text('request_id').notNull().unique(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_deck_classification_overrides_active_global')
      .on(table.deckFingerprint)
      .where(sql`${table.revokedAt} IS NULL AND ${table.appliesToFutureReleases} = true`),
    uniqueIndex('uq_deck_classification_overrides_active_release')
      .on(table.deckFingerprint, table.releaseId)
      .where(sql`${table.revokedAt} IS NULL AND ${table.appliesToFutureReleases} = false`),
    index('idx_deck_classification_overrides_archetype').on(table.archetypeId, table.createdAt),
    check(
      'deck_classification_overrides_fingerprint_check',
      sql`${table.deckFingerprint} ~ '^sha256:[0-9a-f]{64}$'`
    ),
    check(
      'deck_classification_overrides_target_status_check',
      sql`${table.targetStatus} IN ('CLASSIFIED', 'UNKNOWN', 'EXCLUDED')`
    ),
    check('deck_classification_overrides_reason_check', sql`btrim(${table.reason}) <> ''`),
    check('deck_classification_overrides_request_id_check', sql`btrim(${table.requestId}) <> ''`),
    check(
      'deck_classification_overrides_idempotency_key_check',
      sql`btrim(${table.idempotencyKey}) <> ''`
    ),
    check(
      'deck_classification_overrides_shape_check',
      sql`(${table.targetStatus} = 'CLASSIFIED' AND ${table.archetypeId} IS NOT NULL) OR (${table.targetStatus} <> 'CLASSIFIED' AND ${table.archetypeId} IS NULL)`
    ),
    check(
      'deck_classification_overrides_scope_check',
      sql`(${table.appliesToFutureReleases} = true AND ${table.releaseId} IS NULL) OR (${table.appliesToFutureReleases} = false AND ${table.releaseId} IS NOT NULL)`
    ),
  ]
);

export const deckClassificationAssignments = pgTable(
  'deck_classification_assignments',
  {
    matchId: text('match_id').notNull(),
    seat: text('seat').$type<'FIRST' | 'SECOND'>().notNull(),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => deckClassifierReleases.id, { onDelete: 'restrict' }),
    runId: uuid('run_id').notNull(),
    archetypeId: uuid('archetype_id').references(() => deckArchetypes.id, {
      onDelete: 'restrict',
    }),
    status: text('status').$type<DeckClassificationStatus>().notNull(),
    method: text('method').$type<DeckClassificationMethod>().notNull(),
    bestDistance: doublePrecision('best_distance'),
    secondDistance: doublePrecision('second_distance'),
    margin: doublePrecision('margin'),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    classifiedAt: timestamp('classified_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.matchId, table.seat, table.releaseId],
      name: 'deck_classification_assignments_pk',
    }),
    foreignKey({
      columns: [table.matchId, table.seat],
      foreignColumns: [rankedDeckObservations.matchId, rankedDeckObservations.seat],
      name: 'deck_classification_assignments_observation_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.runId, table.releaseId],
      foreignColumns: [deckClassificationRuns.id, deckClassificationRuns.releaseId],
      name: 'deck_classification_assignments_run_release_fk',
    }).onDelete('restrict'),
    index('idx_deck_classification_assignments_release_status').on(
      table.releaseId,
      table.status,
      table.archetypeId
    ),
    index('idx_deck_classification_assignments_run').on(table.runId),
    check('deck_classification_assignments_seat_check', sql`${table.seat} IN ('FIRST', 'SECOND')`),
    check(
      'deck_classification_assignments_status_check',
      sql`${table.status} IN ('CLASSIFIED', 'UNKNOWN', 'AMBIGUOUS', 'INVALID', 'EXCLUDED')`
    ),
    check(
      'deck_classification_assignments_method_check',
      sql`${table.method} IN ('MANUAL', 'EXACT', 'RULE', 'SIMILARITY', 'UNKNOWN', 'AMBIGUOUS', 'INVALID')`
    ),
    check(
      'deck_classification_assignments_shape_check',
      sql`(${table.status} = 'CLASSIFIED' AND ${table.archetypeId} IS NOT NULL) OR (${table.status} <> 'CLASSIFIED' AND ${table.archetypeId} IS NULL)`
    ),
  ]
);

export const rankedPlayerSeeds = pgTable(
  'ranked_player_seeds',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => rankedSeasons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    sourceSeasonId: uuid('source_season_id').references(() => rankedSeasons.id, {
      onDelete: 'set null',
    }),
    rating: doublePrecision('rating').notNull(),
    ratingDeviation: doublePrecision('rating_deviation').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.seasonId, table.userId],
      name: 'ranked_player_seeds_pk',
    }),
    check('ranked_player_seeds_rd_check', sql`${table.ratingDeviation} > 0`),
  ]
);

export const rankedPlayerRatings = pgTable(
  'ranked_player_ratings',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => rankedSeasons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    rating: doublePrecision('rating').notNull(),
    ratingDeviation: doublePrecision('rating_deviation').notNull(),
    ratedMatchCount: integer('rated_match_count').notNull().default(0),
    lastRatedAt: timestamp('last_rated_at', { withTimezone: true }),
    ledgerRevision: integer('ledger_revision').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.seasonId, table.userId],
      name: 'ranked_player_ratings_pk',
    }),
    index('idx_ranked_player_ratings_leaderboard').on(table.seasonId, table.rating, table.userId),
    check('ranked_player_ratings_rd_check', sql`${table.ratingDeviation} > 0`),
    check('ranked_player_ratings_match_count_check', sql`${table.ratedMatchCount} >= 0`),
    check('ranked_player_ratings_revision_check', sql`${table.ledgerRevision} >= 0`),
  ]
);

export const rankedRatingEvents = pgTable(
  'ranked_rating_events',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => rankedSeasons.id, { onDelete: 'restrict' }),
    eventSequence: integer('event_sequence').notNull(),
    eventType: text('event_type').$type<RankedRatingEventType>().notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    matchId: text('match_id')
      .notNull()
      .references(() => rankedMatches.matchId, { onDelete: 'restrict' }),
    targetEventId: uuid('target_event_id').references((): AnyPgColumn => rankedRatingEvents.id, {
      onDelete: 'restrict',
    }),
    firstUserId: uuid('first_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    secondUserId: uuid('second_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    winnerSeat: text('winner_seat').$type<'FIRST' | 'SECOND'>(),
    resultType: text('result_type').$type<RankedMatchResultType>().notNull(),
    ratedAt: timestamp('rated_at', { withTimezone: true }).notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_ranked_rating_events_season_sequence').on(table.seasonId, table.eventSequence),
    uniqueIndex('uq_ranked_rating_events_season_idempotency').on(
      table.seasonId,
      table.idempotencyKey
    ),
    uniqueIndex('uq_ranked_rating_events_initial_settlement')
      .on(table.seasonId, table.matchId)
      .where(sql`${table.eventType} = 'SETTLEMENT'`),
    uniqueIndex('uq_ranked_rating_events_correction_target')
      .on(table.targetEventId)
      .where(sql`${table.targetEventId} IS NOT NULL`),
    index('idx_ranked_rating_events_match').on(table.seasonId, table.matchId, table.eventSequence),
    check(
      'ranked_rating_events_type_check',
      sql`${table.eventType} IN ('SETTLEMENT', 'VOID', 'REPLACEMENT')`
    ),
    check(
      'ranked_rating_events_target_check',
      sql`(${table.eventType} = 'SETTLEMENT' AND ${table.targetEventId} IS NULL) OR (${table.eventType} IN ('VOID', 'REPLACEMENT') AND ${table.targetEventId} IS NOT NULL)`
    ),
    check(
      'ranked_rating_events_winner_check',
      sql`(${table.eventType} = 'VOID' AND ${table.winnerSeat} IS NULL) OR (${table.eventType} IN ('SETTLEMENT', 'REPLACEMENT') AND ${table.winnerSeat} IN ('FIRST', 'SECOND'))`
    ),
    check(
      'ranked_rating_events_result_type_check',
      sql`(${table.eventType} = 'VOID' AND ${table.resultType} = 'PLATFORM_NO_CONTEST') OR (${table.eventType} IN ('SETTLEMENT', 'REPLACEMENT') AND ${table.resultType} IN ('NORMAL', 'SURRENDER', 'DISCONNECT_FORFEIT'))`
    ),
    check(
      'ranked_rating_events_reason_check',
      sql`${table.eventType} = 'SETTLEMENT' OR btrim(COALESCE(${table.reason}, '')) <> ''`
    ),
    check(
      'ranked_rating_events_distinct_players_check',
      sql`${table.firstUserId} <> ${table.secondUserId}`
    ),
    check('ranked_rating_events_sequence_check', sql`${table.eventSequence} > 0`),
    check('ranked_rating_events_idempotency_check', sql`btrim(${table.idempotencyKey}) <> ''`),
  ]
);

export const rankedRatingEventSteps = pgTable(
  'ranked_rating_event_steps',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => rankedRatingEvents.id, { onDelete: 'restrict' }),
    stepIndex: integer('step_index').notNull(),
    sourceResultEventId: uuid('source_result_event_id')
      .notNull()
      .references(() => rankedRatingEvents.id, { onDelete: 'restrict' }),
    matchId: text('match_id')
      .notNull()
      .references(() => rankedMatches.matchId, { onDelete: 'restrict' }),
    firstUserId: uuid('first_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    secondUserId: uuid('second_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    winnerSeat: text('winner_seat').$type<'FIRST' | 'SECOND'>().notNull(),
    ratedAt: timestamp('rated_at', { withTimezone: true }).notNull(),
    firstBeforeRating: doublePrecision('first_before_rating').notNull(),
    firstBeforeDeviation: doublePrecision('first_before_deviation').notNull(),
    firstBeforeMatchCount: integer('first_before_match_count').notNull(),
    firstBeforeLastRatedAt: timestamp('first_before_last_rated_at', { withTimezone: true }),
    firstAfterRating: doublePrecision('first_after_rating').notNull(),
    firstAfterDeviation: doublePrecision('first_after_deviation').notNull(),
    firstAfterMatchCount: integer('first_after_match_count').notNull(),
    firstAfterLastRatedAt: timestamp('first_after_last_rated_at', { withTimezone: true }),
    secondBeforeRating: doublePrecision('second_before_rating').notNull(),
    secondBeforeDeviation: doublePrecision('second_before_deviation').notNull(),
    secondBeforeMatchCount: integer('second_before_match_count').notNull(),
    secondBeforeLastRatedAt: timestamp('second_before_last_rated_at', { withTimezone: true }),
    secondAfterRating: doublePrecision('second_after_rating').notNull(),
    secondAfterDeviation: doublePrecision('second_after_deviation').notNull(),
    secondAfterMatchCount: integer('second_after_match_count').notNull(),
    secondAfterLastRatedAt: timestamp('second_after_last_rated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.stepIndex],
      name: 'ranked_rating_event_steps_pk',
    }),
    index('idx_ranked_rating_event_steps_source').on(table.sourceResultEventId),
    index('idx_ranked_rating_event_steps_match').on(table.matchId, table.eventId),
    check('ranked_rating_event_steps_index_check', sql`${table.stepIndex} >= 0`),
    check(
      'ranked_rating_event_steps_winner_check',
      sql`${table.winnerSeat} IN ('FIRST', 'SECOND')`
    ),
    check(
      'ranked_rating_event_steps_distinct_players_check',
      sql`${table.firstUserId} <> ${table.secondUserId}`
    ),
  ]
);

export const rankedRatingRevisions = pgTable(
  'ranked_rating_revisions',
  {
    id: uuid('id').primaryKey(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => rankedSeasons.id, { onDelete: 'restrict' }),
    revisionNumber: integer('revision_number').notNull(),
    sourceRevisionId: uuid('source_revision_id').references(
      (): AnyPgColumn => rankedRatingRevisions.id,
      { onDelete: 'restrict' }
    ),
    sourceAlgorithmVersion: text('source_algorithm_version').notNull(),
    targetAlgorithmVersion: text('target_algorithm_version').notNull(),
    sourceConfig: jsonb('source_config').$type<RankedRatingConfig>().notNull(),
    targetConfig: jsonb('target_config').$type<RankedRatingConfig>().notNull(),
    sourceConfigHash: text('source_config_hash').notNull(),
    targetConfigHash: text('target_config_hash').notNull(),
    targetCompetitiveEnvironmentId: text('target_competitive_environment_id').notNull(),
    sourceLedgerRevision: integer('source_ledger_revision').notNull(),
    targetLedgerRevision: integer('target_ledger_revision').notNull(),
    reason: text('reason').notNull(),
    previewSummary: jsonb('preview_summary').$type<Readonly<Record<string, unknown>>>().notNull(),
    appliedBy: uuid('applied_by').references(() => users.id, { onDelete: 'set null' }),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_ranked_rating_revisions_season_number').on(
      table.seasonId,
      table.revisionNumber
    ),
    uniqueIndex('uq_ranked_rating_revisions_season_algorithm').on(
      table.seasonId,
      table.targetAlgorithmVersion
    ),
    index('idx_ranked_rating_revisions_season_applied_at').on(table.seasonId, table.appliedAt),
    check('ranked_rating_revisions_number_check', sql`${table.revisionNumber} > 0`),
    check(
      'ranked_rating_revisions_ledger_check',
      sql`${table.sourceLedgerRevision} >= 0 AND ${table.targetLedgerRevision} >= ${table.sourceLedgerRevision}`
    ),
    check('ranked_rating_revisions_reason_check', sql`btrim(${table.reason}) <> ''`),
    check(
      'ranked_rating_revisions_source_hash_check',
      sql`${table.sourceConfigHash} LIKE 'sha256:%'`
    ),
    check(
      'ranked_rating_revisions_target_hash_check',
      sql`${table.targetConfigHash} LIKE 'sha256:%'`
    ),
  ]
);
