import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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

export type UserRole = 'user' | 'admin';
export type CardType = 'MEMBER' | 'LIVE' | 'ENERGY';
export type CardStatus = 'DRAFT' | 'PUBLISHED';
export type SiteStatusLifecycle =
  | 'NORMAL'
  | 'SCHEDULED'
  | 'RESTRICTING_NEW_GAMES'
  | 'MAINTENANCE'
  | 'COMPLETED'
  | 'POSTPONED'
  | 'CANCELLED';
export type SiteAnnouncementType = 'MAINTENANCE' | 'UPDATE' | 'NEWS';
export type SiteAnnouncementStatus = 'DRAFT' | 'PUBLISHED';

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
    check('profiles_role_check', sql`${table.role} IN ('user', 'admin')`),
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
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_site_status_config_lifecycle').on(table.lifecycle),
    check(
      'site_status_config_lifecycle_check',
      sql`${table.lifecycle} IN ('NORMAL', 'SCHEDULED', 'RESTRICTING_NEW_GAMES', 'MAINTENANCE', 'COMPLETED', 'POSTPONED', 'CANCELLED')`
    ),
    check('site_status_config_id_check', sql`${table.id} = 'default'`),
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
      sql`${table.originKind} IN ('ONLINE_ROOM', 'SOLITAIRE')`
    ),
    check(
      'match_records_status_check',
      sql`${table.status} IN ('IN_PROGRESS', 'COMPLETED', 'SURRENDERED', 'INTERRUPTED', 'CORRUPTED')`
    ),
    check(
      'match_records_completeness_check',
      sql`${table.completeness} IN ('FULL', 'PARTIAL', 'INCOMPLETE')`
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
