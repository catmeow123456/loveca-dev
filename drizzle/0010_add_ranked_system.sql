CREATE TABLE "ranked_matches" (
	"match_id" text PRIMARY KEY NOT NULL,
	"season_id" uuid NOT NULL,
	"first_user_id" uuid NOT NULL,
	"second_user_id" uuid NOT NULL,
	"rating_status" text DEFAULT 'PENDING' NOT NULL,
	"winner_seat" text,
	"result_type" text,
	"used_free" boolean DEFAULT false NOT NULL,
	"rules_version" text NOT NULL,
	"card_catalog_version" text NOT NULL,
	"card_catalog_hash" text NOT NULL,
	"deck_policy_version" text NOT NULL,
	"rating_algorithm_version" text NOT NULL,
	"ended_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_matches_rating_status_check" CHECK ("ranked_matches"."rating_status" IN ('PENDING', 'SETTLED', 'VOIDED')),
	CONSTRAINT "ranked_matches_winner_seat_check" CHECK ("ranked_matches"."winner_seat" IS NULL OR "ranked_matches"."winner_seat" IN ('FIRST', 'SECOND')),
	CONSTRAINT "ranked_matches_result_type_check" CHECK ("ranked_matches"."result_type" IS NULL OR "ranked_matches"."result_type" IN ('NORMAL', 'SURRENDER', 'DISCONNECT_FORFEIT', 'PLATFORM_NO_CONTEST')),
	CONSTRAINT "ranked_matches_result_consistency_check" CHECK (("ranked_matches"."rating_status" = 'PENDING' AND "ranked_matches"."winner_seat" IS NULL AND ("ranked_matches"."result_type" IS NULL OR "ranked_matches"."result_type" = 'DISCONNECT_FORFEIT')) OR ("ranked_matches"."rating_status" = 'SETTLED' AND "ranked_matches"."winner_seat" IN ('FIRST', 'SECOND') AND "ranked_matches"."result_type" IN ('NORMAL', 'SURRENDER', 'DISCONNECT_FORFEIT')) OR ("ranked_matches"."rating_status" = 'VOIDED' AND "ranked_matches"."winner_seat" IS NULL AND "ranked_matches"."result_type" = 'PLATFORM_NO_CONTEST')),
	CONSTRAINT "ranked_matches_distinct_players_check" CHECK ("ranked_matches"."first_user_id" <> "ranked_matches"."second_user_id"),
	CONSTRAINT "ranked_matches_catalog_hash_check" CHECK ("ranked_matches"."card_catalog_hash" LIKE 'sha256:%')
);
--> statement-breakpoint
CREATE TABLE "ranked_player_ratings" (
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" double precision NOT NULL,
	"rating_deviation" double precision NOT NULL,
	"rated_match_count" integer DEFAULT 0 NOT NULL,
	"last_rated_at" timestamp with time zone,
	"ledger_revision" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_player_ratings_pk" PRIMARY KEY("season_id","user_id"),
	CONSTRAINT "ranked_player_ratings_rd_check" CHECK ("ranked_player_ratings"."rating_deviation" > 0),
	CONSTRAINT "ranked_player_ratings_match_count_check" CHECK ("ranked_player_ratings"."rated_match_count" >= 0),
	CONSTRAINT "ranked_player_ratings_revision_check" CHECK ("ranked_player_ratings"."ledger_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ranked_player_seeds" (
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_season_id" uuid,
	"rating" double precision NOT NULL,
	"rating_deviation" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_player_seeds_pk" PRIMARY KEY("season_id","user_id"),
	CONSTRAINT "ranked_player_seeds_rd_check" CHECK ("ranked_player_seeds"."rating_deviation" > 0)
);
--> statement-breakpoint
CREATE TABLE "ranked_rating_event_steps" (
	"event_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"source_result_event_id" uuid NOT NULL,
	"match_id" text NOT NULL,
	"first_user_id" uuid NOT NULL,
	"second_user_id" uuid NOT NULL,
	"winner_seat" text NOT NULL,
	"rated_at" timestamp with time zone NOT NULL,
	"first_before_rating" double precision NOT NULL,
	"first_before_deviation" double precision NOT NULL,
	"first_before_match_count" integer NOT NULL,
	"first_before_last_rated_at" timestamp with time zone,
	"first_after_rating" double precision NOT NULL,
	"first_after_deviation" double precision NOT NULL,
	"first_after_match_count" integer NOT NULL,
	"first_after_last_rated_at" timestamp with time zone,
	"second_before_rating" double precision NOT NULL,
	"second_before_deviation" double precision NOT NULL,
	"second_before_match_count" integer NOT NULL,
	"second_before_last_rated_at" timestamp with time zone,
	"second_after_rating" double precision NOT NULL,
	"second_after_deviation" double precision NOT NULL,
	"second_after_match_count" integer NOT NULL,
	"second_after_last_rated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_rating_event_steps_pk" PRIMARY KEY("event_id","step_index"),
	CONSTRAINT "ranked_rating_event_steps_index_check" CHECK ("ranked_rating_event_steps"."step_index" >= 0),
	CONSTRAINT "ranked_rating_event_steps_winner_check" CHECK ("ranked_rating_event_steps"."winner_seat" IN ('FIRST', 'SECOND')),
	CONSTRAINT "ranked_rating_event_steps_distinct_players_check" CHECK ("ranked_rating_event_steps"."first_user_id" <> "ranked_rating_event_steps"."second_user_id")
);
--> statement-breakpoint
CREATE TABLE "ranked_rating_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"event_sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"match_id" text NOT NULL,
	"target_event_id" uuid,
	"first_user_id" uuid NOT NULL,
	"second_user_id" uuid NOT NULL,
	"winner_seat" text,
	"result_type" text NOT NULL,
	"rated_at" timestamp with time zone NOT NULL,
	"algorithm_version" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_rating_events_type_check" CHECK ("ranked_rating_events"."event_type" IN ('SETTLEMENT', 'VOID', 'REPLACEMENT')),
	CONSTRAINT "ranked_rating_events_target_check" CHECK (("ranked_rating_events"."event_type" = 'SETTLEMENT' AND "ranked_rating_events"."target_event_id" IS NULL) OR ("ranked_rating_events"."event_type" IN ('VOID', 'REPLACEMENT') AND "ranked_rating_events"."target_event_id" IS NOT NULL)),
	CONSTRAINT "ranked_rating_events_winner_check" CHECK (("ranked_rating_events"."event_type" = 'VOID' AND "ranked_rating_events"."winner_seat" IS NULL) OR ("ranked_rating_events"."event_type" IN ('SETTLEMENT', 'REPLACEMENT') AND "ranked_rating_events"."winner_seat" IN ('FIRST', 'SECOND'))),
	CONSTRAINT "ranked_rating_events_result_type_check" CHECK (("ranked_rating_events"."event_type" = 'VOID' AND "ranked_rating_events"."result_type" = 'PLATFORM_NO_CONTEST') OR ("ranked_rating_events"."event_type" IN ('SETTLEMENT', 'REPLACEMENT') AND "ranked_rating_events"."result_type" IN ('NORMAL', 'SURRENDER', 'DISCONNECT_FORFEIT'))),
	CONSTRAINT "ranked_rating_events_reason_check" CHECK ("ranked_rating_events"."event_type" = 'SETTLEMENT' OR btrim(COALESCE("ranked_rating_events"."reason", '')) <> ''),
	CONSTRAINT "ranked_rating_events_distinct_players_check" CHECK ("ranked_rating_events"."first_user_id" <> "ranked_rating_events"."second_user_id"),
	CONSTRAINT "ranked_rating_events_sequence_check" CHECK ("ranked_rating_events"."event_sequence" > 0),
	CONSTRAINT "ranked_rating_events_idempotency_check" CHECK (btrim("ranked_rating_events"."idempotency_key") <> '')
);
--> statement-breakpoint
CREATE TABLE "ranked_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_key" text NOT NULL,
	"name" text NOT NULL,
	"competitive_environment_id" text NOT NULL,
	"lifecycle" text DEFAULT 'DRAFT' NOT NULL,
	"queue_admission" text DEFAULT 'PAUSED' NOT NULL,
	"platform_time_zone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"open_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"scheduled_ends_at" timestamp with time zone NOT NULL,
	"finalizing_deadline_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"rules_version" text NOT NULL,
	"card_catalog_version" text NOT NULL,
	"card_catalog_hash" text NOT NULL,
	"deck_policy_version" text NOT NULL,
	"rating_algorithm_version" text NOT NULL,
	"rating_config" jsonb NOT NULL,
	"leaderboard_minimum_match_count" integer DEFAULT 10 NOT NULL,
	"ledger_revision" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_seasons_season_key_unique" UNIQUE("season_key"),
	CONSTRAINT "ranked_seasons_lifecycle_check" CHECK ("ranked_seasons"."lifecycle" IN ('DRAFT', 'ACTIVE', 'FINALIZING', 'CLOSED')),
	CONSTRAINT "ranked_seasons_queue_admission_check" CHECK ("ranked_seasons"."queue_admission" IN ('OPEN', 'PAUSED')),
	CONSTRAINT "ranked_seasons_key_check" CHECK (btrim("ranked_seasons"."season_key") <> ''),
	CONSTRAINT "ranked_seasons_name_check" CHECK (btrim("ranked_seasons"."name") <> ''),
	CONSTRAINT "ranked_seasons_schedule_check" CHECK ("ranked_seasons"."starts_at" < "ranked_seasons"."scheduled_ends_at" AND "ranked_seasons"."scheduled_ends_at" <= "ranked_seasons"."finalizing_deadline_at"),
	CONSTRAINT "ranked_seasons_catalog_hash_check" CHECK ("ranked_seasons"."card_catalog_hash" LIKE 'sha256:%'),
	CONSTRAINT "ranked_seasons_leaderboard_minimum_match_count_check" CHECK ("ranked_seasons"."leaderboard_minimum_match_count" BETWEEN 1 AND 100),
	CONSTRAINT "ranked_seasons_ledger_revision_check" CHECK ("ranked_seasons"."ledger_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gameplay_participations" DROP CONSTRAINT "gameplay_participations_kind_check";--> statement-breakpoint
ALTER TABLE "match_records" DROP CONSTRAINT "match_records_origin_kind_check";--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD COLUMN "queue_kind" text DEFAULT 'CASUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD COLUMN "season_id" uuid;--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD COLUMN "bootstrap_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD COLUMN "queue_kind" text DEFAULT 'CASUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD COLUMN "season_id" uuid;--> statement-breakpoint
ALTER TABLE "ranked_matches" ADD CONSTRAINT "ranked_matches_match_id_match_records_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_records"("match_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_matches" ADD CONSTRAINT "ranked_matches_season_id_ranked_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_matches" ADD CONSTRAINT "ranked_matches_first_user_id_profiles_id_fk" FOREIGN KEY ("first_user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_matches" ADD CONSTRAINT "ranked_matches_second_user_id_profiles_id_fk" FOREIGN KEY ("second_user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_player_ratings" ADD CONSTRAINT "ranked_player_ratings_season_id_ranked_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_player_ratings" ADD CONSTRAINT "ranked_player_ratings_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_player_seeds" ADD CONSTRAINT "ranked_player_seeds_season_id_ranked_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_player_seeds" ADD CONSTRAINT "ranked_player_seeds_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_player_seeds" ADD CONSTRAINT "ranked_player_seeds_source_season_id_ranked_seasons_id_fk" FOREIGN KEY ("source_season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_event_steps" ADD CONSTRAINT "ranked_rating_event_steps_event_id_ranked_rating_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."ranked_rating_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_event_steps" ADD CONSTRAINT "ranked_rating_event_steps_source_result_event_id_ranked_rating_events_id_fk" FOREIGN KEY ("source_result_event_id") REFERENCES "public"."ranked_rating_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_event_steps" ADD CONSTRAINT "ranked_rating_event_steps_match_id_ranked_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."ranked_matches"("match_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_event_steps" ADD CONSTRAINT "ranked_rating_event_steps_first_user_id_profiles_id_fk" FOREIGN KEY ("first_user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_event_steps" ADD CONSTRAINT "ranked_rating_event_steps_second_user_id_profiles_id_fk" FOREIGN KEY ("second_user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_events" ADD CONSTRAINT "ranked_rating_events_season_id_ranked_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_events" ADD CONSTRAINT "ranked_rating_events_match_id_ranked_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."ranked_matches"("match_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_events" ADD CONSTRAINT "ranked_rating_events_target_event_id_ranked_rating_events_id_fk" FOREIGN KEY ("target_event_id") REFERENCES "public"."ranked_rating_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_events" ADD CONSTRAINT "ranked_rating_events_first_user_id_profiles_id_fk" FOREIGN KEY ("first_user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_events" ADD CONSTRAINT "ranked_rating_events_second_user_id_profiles_id_fk" FOREIGN KEY ("second_user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_events" ADD CONSTRAINT "ranked_rating_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_seasons" ADD CONSTRAINT "ranked_seasons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_seasons" ADD CONSTRAINT "ranked_seasons_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ranked_matches_season_status" ON "ranked_matches" USING btree ("season_id","rating_status","ended_at");--> statement-breakpoint
CREATE INDEX "idx_ranked_matches_first_user" ON "ranked_matches" USING btree ("season_id","first_user_id");--> statement-breakpoint
CREATE INDEX "idx_ranked_matches_second_user" ON "ranked_matches" USING btree ("season_id","second_user_id");--> statement-breakpoint
CREATE INDEX "idx_ranked_player_ratings_leaderboard" ON "ranked_player_ratings" USING btree ("season_id","rating","user_id");--> statement-breakpoint
CREATE INDEX "idx_ranked_rating_event_steps_source" ON "ranked_rating_event_steps" USING btree ("source_result_event_id");--> statement-breakpoint
CREATE INDEX "idx_ranked_rating_event_steps_match" ON "ranked_rating_event_steps" USING btree ("match_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ranked_rating_events_season_sequence" ON "ranked_rating_events" USING btree ("season_id","event_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ranked_rating_events_season_idempotency" ON "ranked_rating_events" USING btree ("season_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ranked_rating_events_initial_settlement" ON "ranked_rating_events" USING btree ("season_id","match_id") WHERE "ranked_rating_events"."event_type" = 'SETTLEMENT';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ranked_rating_events_correction_target" ON "ranked_rating_events" USING btree ("target_event_id") WHERE "ranked_rating_events"."target_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_ranked_rating_events_match" ON "ranked_rating_events" USING btree ("season_id","match_id","event_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ranked_seasons_effective_environment" ON "ranked_seasons" USING btree ((true)) WHERE "ranked_seasons"."lifecycle" IN ('ACTIVE', 'FINALIZING');--> statement-breakpoint
CREATE INDEX "idx_ranked_seasons_lifecycle" ON "ranked_seasons" USING btree ("lifecycle","starts_at");--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD CONSTRAINT "public_table_reservations_season_id_ranked_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_season_id_ranked_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplay_participations" ADD CONSTRAINT "gameplay_participations_kind_check" CHECK ("gameplay_participations"."kind" IN ('PUBLIC_QUEUE', 'RANKED_QUEUE', 'ONLINE_ROOM', 'ONLINE_MATCH'));--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_origin_kind_check" CHECK ("match_records"."origin_kind" IN ('ONLINE_ROOM', 'PUBLIC_TABLE', 'RANKED', 'SOLITAIRE'));--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD CONSTRAINT "public_table_reservations_queue_kind_check" CHECK ("public_table_reservations"."queue_kind" IN ('CASUAL', 'RANKED'));--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD CONSTRAINT "public_table_reservations_ranked_season_check" CHECK (("public_table_reservations"."queue_kind" = 'CASUAL' AND "public_table_reservations"."season_id" IS NULL) OR ("public_table_reservations"."queue_kind" = 'RANKED' AND "public_table_reservations"."season_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_queue_kind_check" CHECK ("public_table_tickets"."queue_kind" IN ('CASUAL', 'RANKED'));--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_ranked_season_check" CHECK (("public_table_tickets"."queue_kind" = 'CASUAL' AND "public_table_tickets"."season_id" IS NULL) OR ("public_table_tickets"."queue_kind" = 'RANKED' AND "public_table_tickets"."season_id" IS NOT NULL));
