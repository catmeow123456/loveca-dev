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
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export type UserRole = 'user' | 'admin';
export type CardType = 'MEMBER' | 'LIVE' | 'ENERGY';
export type CardStatus = 'DRAFT' | 'PUBLISHED';

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

export const users = pgTable(
  'users',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
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
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
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
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
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
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
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
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    mainDeck: jsonb('main_deck').$type<DeckEntry[]>().notNull().default(sql`'[]'::jsonb`),
    energyDeck: jsonb('energy_deck').$type<DeckEntry[]>().notNull().default(sql`'[]'::jsonb`),
    isValid: boolean('is_valid').notNull().default(false),
    validationErrors: jsonb('validation_errors').$type<string[]>().default(sql`'[]'::jsonb`),
    isPublic: boolean('is_public').notNull().default(false),
    shareId: uuid('share_id').default(sql`gen_random_uuid()`).unique(),
    shareEnabled: boolean('share_enabled').notNull().default(false),
    sharedAt: timestamp('shared_at', { withTimezone: true }),
    forkedFromDeckId: uuid('forked_from_deck_id').references((): AnyPgColumn => decks.id, { onDelete: 'set null' }),
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
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    cardCode: text('card_code').notNull().unique(),
    cardType: text('card_type').$type<CardType>().notNull(),
    name: text('name').notNull(),
    groupName: text('group_name'),
    unitName: text('unit_name'),
    cost: integer('cost'),
    blade: integer('blade'),
    hearts: jsonb('hearts').$type<HeartRequirement[]>().default(sql`'[]'::jsonb`),
    bladeHearts: jsonb('blade_hearts').$type<BladeHeart[] | null>().default(sql`NULL`),
    score: integer('score'),
    requirements: jsonb('requirements').$type<HeartRequirement[]>().default(sql`'[]'::jsonb`),
    cardText: text('card_text'),
    imageFilename: text('image_filename'),
    rare: text('rare'),
    product: text('product'),
    status: text('status').$type<CardStatus>().notNull().default('DRAFT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (table) => [
    index('idx_cards_card_code').on(table.cardCode),
    index('idx_cards_card_type').on(table.cardType),
    index('idx_cards_group_name').on(table.groupName),
    index('idx_cards_name').on(table.name),
    index('idx_cards_rare').on(table.rare),
    index('idx_cards_status').on(table.status),
    check('cards_card_type_check', sql`${table.cardType} IN ('MEMBER', 'LIVE', 'ENERGY')`),
    check('cards_status_check', sql`${table.status} IN ('DRAFT', 'PUBLISHED')`),
  ]
);
