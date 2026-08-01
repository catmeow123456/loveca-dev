CREATE TABLE "theme_matchup_pair_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"theme_table_version_id" uuid NOT NULL,
	"first_deck_version_id" uuid NOT NULL,
	"second_deck_version_id" uuid NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"test_summary" jsonb NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_matchup_pair_weight_check" CHECK ("theme_matchup_pair_versions"."weight" > 0),
	CONSTRAINT "theme_matchup_pair_canonical_order_check" CHECK ("theme_matchup_pair_versions"."first_deck_version_id" <= "theme_matchup_pair_versions"."second_deck_version_id")
);
--> statement-breakpoint
CREATE TABLE "theme_prebuilt_deck_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"theme_table_version_id" uuid NOT NULL,
	"deck_key" text NOT NULL,
	"display_name" text NOT NULL,
	"runtime_deck" jsonb NOT NULL,
	"deck_list" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"play_style_tags" jsonb NOT NULL,
	"difficulty" text NOT NULL,
	"source_label" text NOT NULL,
	"source_url" text,
	"review_note" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_prebuilt_deck_difficulty_check" CHECK ("theme_prebuilt_deck_versions"."difficulty" IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED'))
);
--> statement-breakpoint
CREATE TABLE "theme_table_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"theme_table_version_id" uuid NOT NULL,
	"matchup_pair_version_id" uuid NOT NULL,
	"first_ticket_deck_version_id" uuid NOT NULL,
	"second_ticket_deck_version_id" uuid NOT NULL,
	"allocation_algorithm_version" text NOT NULL,
	"eligible_pair_snapshot_hash" text NOT NULL,
	"entropy_commitment" text NOT NULL,
	"allocation_proof" jsonb NOT NULL,
	"match_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_table_assignments_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "theme_table_assignments_match_id_unique" UNIQUE("match_id")
);
--> statement-breakpoint
CREATE TABLE "theme_table_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_key" text NOT NULL,
	"name" text NOT NULL,
	"lifecycle" text DEFAULT 'DRAFT' NOT NULL,
	"environment_id" text NOT NULL,
	"rules_environment_id" text NOT NULL,
	"card_catalog_hash" text NOT NULL,
	"allocation_algorithm_version" text NOT NULL,
	"platform_time_zone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"open_windows" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"schedule_label" text NOT NULL,
	"summary" text NOT NULL,
	"announcement" text NOT NULL,
	"evaluation_policy" jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_table_versions_version_key_unique" UNIQUE("version_key"),
	CONSTRAINT "theme_table_versions_environment_id_unique" UNIQUE("environment_id"),
	CONSTRAINT "theme_table_versions_lifecycle_check" CHECK ("theme_table_versions"."lifecycle" IN ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED')),
	CONSTRAINT "theme_table_versions_window_check" CHECK ("theme_table_versions"."ends_at" > "theme_table_versions"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "gameplay_participations" DROP CONSTRAINT "gameplay_participations_kind_check";--> statement-breakpoint
ALTER TABLE "public_table_reservations" DROP CONSTRAINT "public_table_reservations_queue_kind_check";--> statement-breakpoint
ALTER TABLE "public_table_reservations" DROP CONSTRAINT "public_table_reservations_ranked_season_check";--> statement-breakpoint
ALTER TABLE "public_table_tickets" DROP CONSTRAINT "public_table_tickets_queue_kind_check";--> statement-breakpoint
ALTER TABLE "public_table_tickets" DROP CONSTRAINT "public_table_tickets_ranked_season_check";--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD COLUMN "theme_table_version_id" uuid;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD COLUMN "theme_table_version_id" uuid;--> statement-breakpoint
ALTER TABLE "theme_matchup_pair_versions" ADD CONSTRAINT "theme_matchup_pair_versions_theme_table_version_id_theme_table_versions_id_fk" FOREIGN KEY ("theme_table_version_id") REFERENCES "public"."theme_table_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_matchup_pair_versions" ADD CONSTRAINT "theme_matchup_pair_versions_first_deck_version_id_theme_prebuilt_deck_versions_id_fk" FOREIGN KEY ("first_deck_version_id") REFERENCES "public"."theme_prebuilt_deck_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_matchup_pair_versions" ADD CONSTRAINT "theme_matchup_pair_versions_second_deck_version_id_theme_prebuilt_deck_versions_id_fk" FOREIGN KEY ("second_deck_version_id") REFERENCES "public"."theme_prebuilt_deck_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_prebuilt_deck_versions" ADD CONSTRAINT "theme_prebuilt_deck_versions_theme_table_version_id_theme_table_versions_id_fk" FOREIGN KEY ("theme_table_version_id") REFERENCES "public"."theme_table_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_table_assignments" ADD CONSTRAINT "theme_table_assignments_reservation_id_public_table_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."public_table_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_table_assignments" ADD CONSTRAINT "theme_table_assignments_theme_table_version_id_theme_table_versions_id_fk" FOREIGN KEY ("theme_table_version_id") REFERENCES "public"."theme_table_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_table_assignments" ADD CONSTRAINT "theme_table_assignments_matchup_pair_version_id_theme_matchup_pair_versions_id_fk" FOREIGN KEY ("matchup_pair_version_id") REFERENCES "public"."theme_matchup_pair_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_table_assignments" ADD CONSTRAINT "theme_table_assignments_first_ticket_deck_version_id_theme_prebuilt_deck_versions_id_fk" FOREIGN KEY ("first_ticket_deck_version_id") REFERENCES "public"."theme_prebuilt_deck_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_table_assignments" ADD CONSTRAINT "theme_table_assignments_second_ticket_deck_version_id_theme_prebuilt_deck_versions_id_fk" FOREIGN KEY ("second_ticket_deck_version_id") REFERENCES "public"."theme_prebuilt_deck_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_theme_matchup_pairs_active" ON "theme_matchup_pair_versions" USING btree ("theme_table_version_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_theme_matchup_pair" ON "theme_matchup_pair_versions" USING btree ("theme_table_version_id","first_deck_version_id","second_deck_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_theme_prebuilt_deck_key" ON "theme_prebuilt_deck_versions" USING btree ("theme_table_version_id","deck_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_theme_prebuilt_deck_content" ON "theme_prebuilt_deck_versions" USING btree ("theme_table_version_id","content_hash");--> statement-breakpoint
CREATE INDEX "idx_theme_table_assignments_theme" ON "theme_table_assignments" USING btree ("theme_table_version_id");--> statement-breakpoint
CREATE INDEX "idx_theme_table_versions_lifecycle_window" ON "theme_table_versions" USING btree ("lifecycle","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_theme_table_versions_single_active" ON "theme_table_versions" USING btree ("lifecycle") WHERE "theme_table_versions"."lifecycle" = 'ACTIVE';--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD CONSTRAINT "public_table_reservations_theme_table_version_id_theme_table_versions_id_fk" FOREIGN KEY ("theme_table_version_id") REFERENCES "public"."theme_table_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_theme_table_version_id_theme_table_versions_id_fk" FOREIGN KEY ("theme_table_version_id") REFERENCES "public"."theme_table_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplay_participations" ADD CONSTRAINT "gameplay_participations_kind_check" CHECK ("gameplay_participations"."kind" IN ('PUBLIC_QUEUE', 'RANKED_QUEUE', 'THEME_QUEUE', 'ONLINE_ROOM', 'ONLINE_MATCH'));--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD CONSTRAINT "public_table_reservations_queue_kind_check" CHECK ("public_table_reservations"."queue_kind" IN ('CASUAL', 'RANKED', 'THEME'));--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD CONSTRAINT "public_table_reservations_ranked_season_check" CHECK (("public_table_reservations"."queue_kind" = 'CASUAL' AND "public_table_reservations"."season_id" IS NULL AND "public_table_reservations"."theme_table_version_id" IS NULL) OR ("public_table_reservations"."queue_kind" = 'RANKED' AND "public_table_reservations"."season_id" IS NOT NULL AND "public_table_reservations"."theme_table_version_id" IS NULL) OR ("public_table_reservations"."queue_kind" = 'THEME' AND "public_table_reservations"."season_id" IS NULL AND "public_table_reservations"."theme_table_version_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_queue_kind_check" CHECK ("public_table_tickets"."queue_kind" IN ('CASUAL', 'RANKED', 'THEME'));--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_ranked_season_check" CHECK (("public_table_tickets"."queue_kind" = 'CASUAL' AND "public_table_tickets"."season_id" IS NULL AND "public_table_tickets"."theme_table_version_id" IS NULL) OR ("public_table_tickets"."queue_kind" = 'RANKED' AND "public_table_tickets"."season_id" IS NOT NULL AND "public_table_tickets"."theme_table_version_id" IS NULL) OR ("public_table_tickets"."queue_kind" = 'THEME' AND "public_table_tickets"."season_id" IS NULL AND "public_table_tickets"."theme_table_version_id" IS NOT NULL));