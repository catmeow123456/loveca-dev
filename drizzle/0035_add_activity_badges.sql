ALTER TABLE "player_badge_rules" DROP CONSTRAINT "player_badge_rules_criteria_type_check";--> statement-breakpoint
ALTER TABLE "player_badge_rules" ALTER COLUMN "source_season_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD COLUMN "source_theme_table_version_id" uuid;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD COLUMN "image_object_key" text;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD COLUMN "image_sha256" text;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD COLUMN "revision" integer;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD COLUMN "last_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD COLUMN "last_request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "player_badges" ADD COLUMN "source_theme_table_version_id" uuid;--> statement-breakpoint
UPDATE "player_badge_rules"
SET "image_object_key" = 'activity-badges/1f16f56b-3d54-4b10-a0e5-034e26cd4bf5/badge.webp',
    "image_sha256" = '1662921b3edf6f56cd1449f5bb6f1000229ef46a72fabd6adb87d499eb42e768',
    "revision" = 1,
    "last_idempotency_key" = 'migration-0035-first-ranked-badge',
    "last_request_fingerprint" = 'f0122fba4c05a2fef71f829821989f482c1ba72bcab13b335338ee8e9de160c4',
    "updated_at" = now()
WHERE "badge_key" = 'ranked-first-season-qualified';--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "player_badge_rules"
    WHERE "image_object_key" IS NULL
       OR "image_sha256" IS NULL
       OR "revision" IS NULL
       OR "last_idempotency_key" IS NULL
       OR "last_request_fingerprint" IS NULL
  ) THEN
    RAISE EXCEPTION '0035 cannot migrate an unknown player badge rule; review and migrate it explicitly';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ALTER COLUMN "image_object_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ALTER COLUMN "image_sha256" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ALTER COLUMN "revision" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ALTER COLUMN "last_idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ALTER COLUMN "last_request_fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_source_theme_table_version_id_theme_table_versions_id_fk" FOREIGN KEY ("source_theme_table_version_id") REFERENCES "public"."theme_table_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_badges" ADD CONSTRAINT "player_badges_source_theme_table_version_id_theme_table_versions_id_fk" FOREIGN KEY ("source_theme_table_version_id") REFERENCES "public"."theme_table_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_player_badge_rules_source_theme" ON "player_badge_rules" USING btree ("source_theme_table_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_player_badge_rules_source_season" ON "player_badge_rules" USING btree ("source_season_id") WHERE "player_badge_rules"."source_season_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_player_badge_rules_source_theme" ON "player_badge_rules" USING btree ("source_theme_table_version_id") WHERE "player_badge_rules"."source_theme_table_version_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_player_badges_source_theme" ON "player_badges" USING btree ("source_theme_table_version_id");--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_source_check" CHECK (("player_badge_rules"."source_season_id" IS NOT NULL)::integer + ("player_badge_rules"."source_theme_table_version_id" IS NOT NULL)::integer = 1);--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_object_key_check" CHECK ("player_badge_rules"."image_object_key" ~ '^activity-badges/[0-9a-f-]{36}/badge[.]webp$');--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_image_hash_check" CHECK ("player_badge_rules"."image_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_revision_check" CHECK ("player_badge_rules"."revision" > 0);--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_idempotency_key_check" CHECK (char_length("player_badge_rules"."last_idempotency_key") BETWEEN 8 AND 160);--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_request_fingerprint_check" CHECK ("player_badge_rules"."last_request_fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_criteria_type_check" CHECK ("player_badge_rules"."criteria_type" IN ('RANKED_RATED_MATCH_COUNT', 'THEME_COMPLETED_MATCH_COUNT'));--> statement-breakpoint
ALTER TABLE "player_badges" ADD CONSTRAINT "player_badges_source_check" CHECK (("player_badges"."source_season_id" IS NOT NULL)::integer + ("player_badges"."source_theme_table_version_id" IS NOT NULL)::integer = 1);
