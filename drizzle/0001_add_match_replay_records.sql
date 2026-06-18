CREATE TABLE IF NOT EXISTS "match_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"room_code" text NOT NULL,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"completeness" text DEFAULT 'FULL' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"sealed_at" timestamp with time zone,
	"first_user_id" text NOT NULL,
	"second_user_id" text NOT NULL,
	"winner_seat" text,
	"end_reason" text,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"last_timeline_seq" integer DEFAULT 0 NOT NULL,
	"last_checkpoint_seq" integer DEFAULT 0 NOT NULL,
	"last_public_seq" integer DEFAULT 0 NOT NULL,
	"last_private_seq_by_seat" jsonb DEFAULT '{"FIRST":0,"SECOND":0}'::jsonb NOT NULL,
	"last_audit_seq" integer DEFAULT 0 NOT NULL,
	"last_command_seq" integer DEFAULT 0 NOT NULL,
	"last_game_event_seq" integer DEFAULT 0 NOT NULL,
	"record_version" integer DEFAULT 1 NOT NULL,
	"rules_version" text NOT NULL,
	"card_data_version" text NOT NULL,
	"card_data_hash" text NOT NULL,
	"replay_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"partial_reason" text,
	"last_recorder_error" text,
	"append_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_records_match_id_unique" UNIQUE("match_id"),
	CONSTRAINT "match_records_status_check" CHECK ("match_records"."status" IN ('IN_PROGRESS', 'COMPLETED', 'SURRENDERED', 'INTERRUPTED', 'CORRUPTED')),
	CONSTRAINT "match_records_completeness_check" CHECK ("match_records"."completeness" IN ('FULL', 'PARTIAL', 'INCOMPLETE')),
	CONSTRAINT "match_records_winner_seat_check" CHECK ("match_records"."winner_seat" IS NULL OR "match_records"."winner_seat" IN ('FIRST', 'SECOND'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_deck_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"seat" text NOT NULL,
	"user_id" text NOT NULL,
	"source_deck_id" text,
	"source_deck_name" text,
	"source" text NOT NULL,
	"main_deck" jsonb NOT NULL,
	"energy_deck" jsonb NOT NULL,
	"card_summaries" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_state" text DEFAULT 'RUNTIME_ACCEPTED' NOT NULL,
	"card_data_version" text NOT NULL,
	"card_data_hash" text NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_deck_snapshots_seat_check" CHECK ("match_deck_snapshots"."seat" IN ('FIRST', 'SECOND')),
	CONSTRAINT "match_deck_snapshots_source_check" CHECK ("match_deck_snapshots"."source" IN ('ONLINE_RUNTIME_DECK', 'PUBLISHED_CARDS_SNAPSHOT')),
	CONSTRAINT "match_deck_snapshots_validation_state_check" CHECK ("match_deck_snapshots"."validation_state" IN ('RUNTIME_ACCEPTED', 'VALID', 'INVALID'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"user_id" text NOT NULL,
	"seat" text NOT NULL,
	"display_name" text NOT NULL,
	"player_id" text NOT NULL,
	"deck_snapshot_id" uuid,
	"replay_access" text DEFAULT 'PARTICIPANT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_participants_seat_check" CHECK ("match_participants"."seat" IN ('FIRST', 'SECOND')),
	CONSTRAINT "match_participants_replay_access_check" CHECK ("match_participants"."replay_access" IN ('PARTICIPANT', 'ADMIN'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_timeline_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"timeline_seq" integer NOT NULL,
	"frame_type" text NOT NULL,
	"visibility_scope" text NOT NULL,
	"related_checkpoint_seq" integer,
	"related_public_seq" integer,
	"related_private_seq" integer,
	"related_private_seq_by_seat" jsonb DEFAULT '{"FIRST":0,"SECOND":0}'::jsonb NOT NULL,
	"related_audit_seq" integer,
	"related_command_seq" integer,
	"related_game_event_seq" integer,
	"related_decision_id" text,
	"dedupe_key" text NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"phase" text NOT NULL,
	"sub_phase" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_timeline_entries_visibility_scope_check" CHECK ("match_timeline_entries"."visibility_scope" IN ('PUBLIC', 'PRIVATE', 'ADMIN', 'SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_record_public_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"timeline_seq" integer NOT NULL,
	"event_seq" integer NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"source" text,
	"actor_seat" text,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "match_record_public_events_actor_seat_check" CHECK ("match_record_public_events"."actor_seat" IS NULL OR "match_record_public_events"."actor_seat" IN ('FIRST', 'SECOND'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_record_private_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"seat" text NOT NULL,
	"timeline_seq" integer NOT NULL,
	"event_seq" integer NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"related_public_seq" integer NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "match_record_private_events_seat_check" CHECK ("match_record_private_events"."seat" IN ('FIRST', 'SECOND'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"checkpoint_seq" integer NOT NULL,
	"timeline_seq" integer NOT NULL,
	"checkpoint_type" text NOT NULL,
	"related_public_seq" integer,
	"related_command_seq" integer,
	"related_game_event_seq" integer,
	"turn_count" integer NOT NULL,
	"phase" text NOT NULL,
	"sub_phase" text NOT NULL,
	"schema_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_compression" text DEFAULT 'NONE' NOT NULL,
	"payload_hash" text NOT NULL,
	"visibility_scope" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_checkpoints_type_check" CHECK ("match_checkpoints"."checkpoint_type" IN ('AUTHORITY', 'PLAYER_VIEW', 'PUBLIC_VIEW')),
	CONSTRAINT "match_checkpoints_visibility_scope_check" CHECK ("match_checkpoints"."visibility_scope" IN ('PUBLIC', 'PRIVATE', 'ADMIN', 'SYSTEM'))
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_deck_snapshots_match_id_match_records_match_id_fk') THEN
		ALTER TABLE "match_deck_snapshots" ADD CONSTRAINT "match_deck_snapshots_match_id_match_records_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_records"("match_id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_participants_match_id_match_records_match_id_fk') THEN
		ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_match_records_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_records"("match_id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_participants_deck_snapshot_id_match_deck_snapshots_id_fk') THEN
		ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_deck_snapshot_id_match_deck_snapshots_id_fk" FOREIGN KEY ("deck_snapshot_id") REFERENCES "public"."match_deck_snapshots"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_timeline_entries_match_id_match_records_match_id_fk') THEN
		ALTER TABLE "match_timeline_entries" ADD CONSTRAINT "match_timeline_entries_match_id_match_records_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_records"("match_id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_record_public_events_match_id_match_records_match_id_fk') THEN
		ALTER TABLE "match_record_public_events" ADD CONSTRAINT "match_record_public_events_match_id_match_records_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_records"("match_id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_record_private_events_match_id_match_records_match_id_fk') THEN
		ALTER TABLE "match_record_private_events" ADD CONSTRAINT "match_record_private_events_match_id_match_records_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_records"("match_id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_checkpoints_match_id_match_records_match_id_fk') THEN
		ALTER TABLE "match_checkpoints" ADD CONSTRAINT "match_checkpoints_match_id_match_records_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_records"("match_id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_deck_snapshots_match_seat" ON "match_deck_snapshots" USING btree ("match_id","seat");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_deck_snapshots_user_id" ON "match_deck_snapshots" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_participants_match_seat" ON "match_participants" USING btree ("match_id","seat");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_participants_match_user" ON "match_participants" USING btree ("match_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_participants_user_id" ON "match_participants" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_records_first_user_id" ON "match_records" USING btree ("first_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_records_second_user_id" ON "match_records" USING btree ("second_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_records_status" ON "match_records" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_records_started_at" ON "match_records" USING btree ("started_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_timeline_entries_match_seq" ON "match_timeline_entries" USING btree ("match_id","timeline_seq");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_timeline_entries_match_dedupe" ON "match_timeline_entries" USING btree ("match_id","dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_timeline_entries_match_created_at" ON "match_timeline_entries" USING btree ("match_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_timeline_entries_checkpoint" ON "match_timeline_entries" USING btree ("match_id","related_checkpoint_seq");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_record_public_events_match_seq" ON "match_record_public_events" USING btree ("match_id","event_seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_record_public_events_timeline" ON "match_record_public_events" USING btree ("match_id","timeline_seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_record_public_events_type" ON "match_record_public_events" USING btree ("match_id","event_type");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_record_private_events_match_seat_seq" ON "match_record_private_events" USING btree ("match_id","seat","event_seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_record_private_events_timeline" ON "match_record_private_events" USING btree ("match_id","timeline_seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_record_private_events_seat" ON "match_record_private_events" USING btree ("match_id","seat");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_checkpoints_match_seq" ON "match_checkpoints" USING btree ("match_id","checkpoint_seq");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_checkpoints_match_timeline" ON "match_checkpoints" USING btree ("match_id","timeline_seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_checkpoints_match_created_at" ON "match_checkpoints" USING btree ("match_id","created_at");
