ALTER TABLE "match_deck_snapshots" DROP CONSTRAINT IF EXISTS "match_deck_snapshots_source_check";--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN IF NOT EXISTS "participant_kind" text DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_participants" ALTER COLUMN "participant_kind" SET DEFAULT 'USER';--> statement-breakpoint
UPDATE "match_participants" SET "participant_kind" = 'USER' WHERE "participant_kind" IS NULL;--> statement-breakpoint
ALTER TABLE "match_participants" ALTER COLUMN "participant_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN IF NOT EXISTS "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN IF NOT EXISTS "match_mode" text DEFAULT 'ONLINE' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "match_mode" SET DEFAULT 'ONLINE';--> statement-breakpoint
UPDATE "match_records" SET "match_mode" = 'ONLINE' WHERE "match_mode" IS NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "match_mode" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN IF NOT EXISTS "automation_game_mode" text DEFAULT 'DEBUG' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "automation_game_mode" SET DEFAULT 'DEBUG';--> statement-breakpoint
UPDATE "match_records" SET "automation_game_mode" = 'DEBUG' WHERE "automation_game_mode" IS NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "automation_game_mode" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN IF NOT EXISTS "origin_kind" text DEFAULT 'ONLINE_ROOM' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "origin_kind" SET DEFAULT 'ONLINE_ROOM';--> statement-breakpoint
UPDATE "match_records" SET "origin_kind" = 'ONLINE_ROOM' WHERE "origin_kind" IS NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "origin_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN IF NOT EXISTS "origin_label" text DEFAULT '在线房间' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "origin_label" SET DEFAULT '在线房间';--> statement-breakpoint
UPDATE "match_records" SET "origin_label" = '在线房间' WHERE "origin_label" IS NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "origin_label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN IF NOT EXISTS "replay_limitations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "replay_limitations" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
UPDATE "match_records" SET "replay_limitations" = '[]'::jsonb WHERE "replay_limitations" IS NULL;--> statement-breakpoint
ALTER TABLE "match_records" ALTER COLUMN "replay_limitations" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_participants_owner_user_id" ON "match_participants" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_records_match_mode" ON "match_records" USING btree ("match_mode");--> statement-breakpoint
ALTER TABLE "match_participants" DROP CONSTRAINT IF EXISTS "match_participants_kind_check";--> statement-breakpoint
ALTER TABLE "match_participants" DROP CONSTRAINT IF EXISTS "match_participants_participant_kind_check";--> statement-breakpoint
ALTER TABLE "match_records" DROP CONSTRAINT IF EXISTS "match_records_match_mode_check";--> statement-breakpoint
ALTER TABLE "match_records" DROP CONSTRAINT IF EXISTS "match_records_automation_game_mode_check";--> statement-breakpoint
ALTER TABLE "match_records" DROP CONSTRAINT IF EXISTS "match_records_origin_kind_check";--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD CONSTRAINT "match_deck_snapshots_source_check" CHECK ("match_deck_snapshots"."source" IN ('ONLINE_RUNTIME_DECK', 'PUBLISHED_CARDS_SNAPSHOT', 'SOLITAIRE_DEFAULT_DECK'));--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_kind_check" CHECK ("match_participants"."participant_kind" IN ('USER', 'SYSTEM'));--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_match_mode_check" CHECK ("match_records"."match_mode" IN ('ONLINE', 'SOLITAIRE'));--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_automation_game_mode_check" CHECK ("match_records"."automation_game_mode" IN ('DEBUG', 'SOLITAIRE'));--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_origin_kind_check" CHECK ("match_records"."origin_kind" IN ('ONLINE_ROOM', 'SOLITAIRE'));
