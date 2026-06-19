ALTER TABLE "match_deck_snapshots" DROP CONSTRAINT "match_deck_snapshots_source_check";--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN "participant_kind" text DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN "match_mode" text DEFAULT 'ONLINE' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN "automation_game_mode" text DEFAULT 'DEBUG' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN "origin_kind" text DEFAULT 'ONLINE_ROOM' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN "origin_label" text DEFAULT '在线房间' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN "replay_limitations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_match_participants_owner_user_id" ON "match_participants" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_match_records_match_mode" ON "match_records" USING btree ("match_mode");--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD CONSTRAINT "match_deck_snapshots_source_check" CHECK ("match_deck_snapshots"."source" IN ('ONLINE_RUNTIME_DECK', 'PUBLISHED_CARDS_SNAPSHOT', 'SOLITAIRE_DEFAULT_DECK'));--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_kind_check" CHECK ("match_participants"."participant_kind" IN ('USER', 'SYSTEM'));--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_match_mode_check" CHECK ("match_records"."match_mode" IN ('ONLINE', 'SOLITAIRE'));--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_automation_game_mode_check" CHECK ("match_records"."automation_game_mode" IN ('DEBUG', 'SOLITAIRE'));--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_origin_kind_check" CHECK ("match_records"."origin_kind" IN ('ONLINE_ROOM', 'SOLITAIRE'));