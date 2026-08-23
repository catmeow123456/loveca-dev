CREATE TABLE "deck_archetype_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"archetype_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"definition" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_archetype_rules_name_check" CHECK (btrim("deck_archetype_rules"."name") <> ''),
	CONSTRAINT "deck_archetype_rules_definition_check" CHECK (jsonb_typeof("deck_archetype_rules"."definition") = 'object'),
	CONSTRAINT "deck_archetype_rules_priority_check" CHECK ("deck_archetype_rules"."priority" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deck_archetype_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"archetype_id" uuid NOT NULL,
	"name" text NOT NULL,
	"deck_fingerprint" text NOT NULL,
	"cards" jsonb NOT NULL,
	"source_kind" text NOT NULL,
	"source_match_id" text,
	"source_seat" text,
	"source_note" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_archetype_templates_name_check" CHECK (btrim("deck_archetype_templates"."name") <> ''),
	CONSTRAINT "deck_archetype_templates_fingerprint_check" CHECK ("deck_archetype_templates"."deck_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "deck_archetype_templates_cards_check" CHECK (jsonb_typeof("deck_archetype_templates"."cards") = 'array' AND jsonb_array_length("deck_archetype_templates"."cards") > 0),
	CONSTRAINT "deck_archetype_templates_source_kind_check" CHECK ("deck_archetype_templates"."source_kind" IN ('MATCH_OBSERVATION', 'SEED_PACKAGE', 'MANUAL')),
	CONSTRAINT "deck_archetype_templates_source_seat_check" CHECK ("deck_archetype_templates"."source_seat" IS NULL OR "deck_archetype_templates"."source_seat" IN ('FIRST', 'SECOND')),
	CONSTRAINT "deck_archetype_templates_source_shape_check" CHECK (("deck_archetype_templates"."source_kind" = 'MATCH_OBSERVATION' AND (("deck_archetype_templates"."source_match_id" IS NOT NULL AND "deck_archetype_templates"."source_seat" IS NOT NULL) OR ("deck_archetype_templates"."source_match_id" IS NULL AND "deck_archetype_templates"."source_seat" IS NULL))) OR ("deck_archetype_templates"."source_kind" <> 'MATCH_OBSERVATION' AND "deck_archetype_templates"."source_match_id" IS NULL AND "deck_archetype_templates"."source_seat" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "deck_archetypes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"archetype_key" text NOT NULL,
	"name" text NOT NULL,
	"group_name" text DEFAULT '其他' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color_key" text NOT NULL,
	"representative_card_code" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"lifecycle" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_archetypes_archetype_key_unique" UNIQUE("archetype_key"),
	CONSTRAINT "deck_archetypes_key_check" CHECK ("deck_archetypes"."archetype_key" ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
	CONSTRAINT "deck_archetypes_name_check" CHECK (btrim("deck_archetypes"."name") <> ''),
	CONSTRAINT "deck_archetypes_group_check" CHECK (btrim("deck_archetypes"."group_name") <> ''),
	CONSTRAINT "deck_archetypes_color_check" CHECK ("deck_archetypes"."color_key" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "deck_archetypes_lifecycle_check" CHECK ("deck_archetypes"."lifecycle" IN ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "deck_classification_assignments" (
	"match_id" text NOT NULL,
	"seat" text NOT NULL,
	"release_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"archetype_id" uuid,
	"status" text NOT NULL,
	"method" text NOT NULL,
	"best_distance" double precision,
	"second_distance" double precision,
	"margin" double precision,
	"evidence" jsonb NOT NULL,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_classification_assignments_pk" PRIMARY KEY("match_id","seat","release_id"),
	CONSTRAINT "deck_classification_assignments_seat_check" CHECK ("deck_classification_assignments"."seat" IN ('FIRST', 'SECOND')),
	CONSTRAINT "deck_classification_assignments_status_check" CHECK ("deck_classification_assignments"."status" IN ('CLASSIFIED', 'UNKNOWN', 'AMBIGUOUS', 'INVALID', 'EXCLUDED')),
	CONSTRAINT "deck_classification_assignments_method_check" CHECK ("deck_classification_assignments"."method" IN ('MANUAL', 'EXACT', 'RULE', 'SIMILARITY', 'UNKNOWN', 'AMBIGUOUS', 'INVALID')),
	CONSTRAINT "deck_classification_assignments_shape_check" CHECK (("deck_classification_assignments"."status" = 'CLASSIFIED' AND "deck_classification_assignments"."archetype_id" IS NOT NULL) OR ("deck_classification_assignments"."status" <> 'CLASSIFIED' AND "deck_classification_assignments"."archetype_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "deck_classification_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deck_fingerprint" text NOT NULL,
	"archetype_id" uuid,
	"target_status" text NOT NULL,
	"reason" text NOT NULL,
	"applies_to_future_releases" boolean DEFAULT true NOT NULL,
	"release_id" uuid,
	"created_by" uuid,
	"request_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_classification_overrides_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "deck_classification_overrides_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "deck_classification_overrides_fingerprint_check" CHECK ("deck_classification_overrides"."deck_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "deck_classification_overrides_target_status_check" CHECK ("deck_classification_overrides"."target_status" IN ('CLASSIFIED', 'UNKNOWN', 'EXCLUDED')),
	CONSTRAINT "deck_classification_overrides_reason_check" CHECK (btrim("deck_classification_overrides"."reason") <> ''),
	CONSTRAINT "deck_classification_overrides_request_id_check" CHECK (btrim("deck_classification_overrides"."request_id") <> ''),
	CONSTRAINT "deck_classification_overrides_idempotency_key_check" CHECK (btrim("deck_classification_overrides"."idempotency_key") <> ''),
	CONSTRAINT "deck_classification_overrides_shape_check" CHECK (("deck_classification_overrides"."target_status" = 'CLASSIFIED' AND "deck_classification_overrides"."archetype_id" IS NOT NULL) OR ("deck_classification_overrides"."target_status" <> 'CLASSIFIED' AND "deck_classification_overrides"."archetype_id" IS NULL)),
	CONSTRAINT "deck_classification_overrides_scope_check" CHECK (("deck_classification_overrides"."applies_to_future_releases" = true AND "deck_classification_overrides"."release_id" IS NULL) OR ("deck_classification_overrides"."applies_to_future_releases" = false AND "deck_classification_overrides"."release_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "deck_classification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"trigger" text NOT NULL,
	"scope_season_id" uuid,
	"requested_by" uuid,
	"request_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"classified_count" integer DEFAULT 0 NOT NULL,
	"unknown_count" integer DEFAULT 0 NOT NULL,
	"ambiguous_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_classification_runs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "uq_deck_classification_runs_id_release" UNIQUE("id","release_id"),
	CONSTRAINT "deck_classification_runs_status_check" CHECK ("deck_classification_runs"."status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "deck_classification_runs_trigger_check" CHECK ("deck_classification_runs"."trigger" IN ('RELEASE_PUBLISHED', 'MANUAL_RECLASSIFY', 'MANUAL_OVERRIDE', 'AUTO_NEW_OBSERVATIONS')),
	CONSTRAINT "deck_classification_runs_request_id_check" CHECK (btrim("deck_classification_runs"."request_id") <> ''),
	CONSTRAINT "deck_classification_runs_idempotency_key_check" CHECK (btrim("deck_classification_runs"."idempotency_key") <> ''),
	CONSTRAINT "deck_classification_runs_reason_check" CHECK (btrim("deck_classification_runs"."reason") <> ''),
	CONSTRAINT "deck_classification_runs_counts_check" CHECK ("deck_classification_runs"."total_count" >= 0 AND "deck_classification_runs"."processed_count" >= 0 AND "deck_classification_runs"."processed_count" <= "deck_classification_runs"."total_count" AND "deck_classification_runs"."classified_count" >= 0 AND "deck_classification_runs"."unknown_count" >= 0 AND "deck_classification_runs"."ambiguous_count" >= 0 AND "deck_classification_runs"."invalid_count" >= 0 AND "deck_classification_runs"."excluded_count" >= 0 AND "deck_classification_runs"."changed_count" >= 0 AND ("deck_classification_runs"."classified_count" + "deck_classification_runs"."unknown_count" + "deck_classification_runs"."ambiguous_count" + "deck_classification_runs"."invalid_count" + "deck_classification_runs"."excluded_count") <= "deck_classification_runs"."processed_count")
);
--> statement-breakpoint
CREATE TABLE "deck_classifier_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"reason" text NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_classifier_releases_version_unique" UNIQUE("version"),
	CONSTRAINT "deck_classifier_releases_version_check" CHECK ("deck_classifier_releases"."version" > 0),
	CONSTRAINT "deck_classifier_releases_status_check" CHECK ("deck_classifier_releases"."status" IN ('BUILDING', 'ACTIVE', 'SUPERSEDED', 'FAILED')),
	CONSTRAINT "deck_classifier_releases_snapshot_check" CHECK (jsonb_typeof("deck_classifier_releases"."snapshot_json") = 'object'),
	CONSTRAINT "deck_classifier_releases_hash_check" CHECK ("deck_classifier_releases"."config_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "deck_classifier_releases_reason_check" CHECK (btrim("deck_classifier_releases"."reason") <> ''),
	CONSTRAINT "deck_classifier_releases_activation_check" CHECK (("deck_classifier_releases"."status" IN ('BUILDING', 'FAILED') AND "deck_classifier_releases"."activated_at" IS NULL) OR ("deck_classifier_releases"."status" IN ('ACTIVE', 'SUPERSEDED') AND "deck_classifier_releases"."activated_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "deck_classifier_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"display_mode" text DEFAULT 'BOTH' NOT NULL,
	"show_usage" boolean DEFAULT true NOT NULL,
	"show_winner" boolean DEFAULT true NOT NULL,
	"show_top_ranked" boolean DEFAULT false NOT NULL,
	"top_ranked_player_count" integer DEFAULT 30 NOT NULL,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_classifier_settings_singleton_check" CHECK ("deck_classifier_settings"."id" = 1),
	CONSTRAINT "deck_classifier_settings_draft_revision_check" CHECK ("deck_classifier_settings"."draft_revision" >= 0),
	CONSTRAINT "deck_classifier_settings_display_mode_check" CHECK ("deck_classifier_settings"."display_mode" IN ('HIDDEN', 'PLAYER_EQUAL', 'MATCH_EQUAL', 'BOTH')),
	CONSTRAINT "deck_classifier_settings_top_ranked_player_count_check" CHECK ("deck_classifier_settings"."top_ranked_player_count" BETWEEN 10 AND 100),
	CONSTRAINT "deck_classifier_settings_visibility_check" CHECK (("deck_classifier_settings"."display_mode" = 'HIDDEN') = (NOT "deck_classifier_settings"."show_usage" AND NOT "deck_classifier_settings"."show_winner" AND NOT "deck_classifier_settings"."show_top_ranked"))
);
--> statement-breakpoint
INSERT INTO "deck_classifier_settings" (
	"id", "display_mode", "show_usage", "show_winner", "show_top_ranked", "draft_revision"
)
VALUES (1, 'HIDDEN', false, false, false, 0)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "management_audit_logs" DROP CONSTRAINT "management_audit_scope_check";--> statement-breakpoint
ALTER TABLE "deck_archetype_rules" ADD CONSTRAINT "deck_archetype_rules_archetype_id_deck_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."deck_archetypes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_archetype_rules" ADD CONSTRAINT "deck_archetype_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_archetype_rules" ADD CONSTRAINT "deck_archetype_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_archetype_templates" ADD CONSTRAINT "deck_archetype_templates_archetype_id_deck_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."deck_archetypes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_archetype_templates" ADD CONSTRAINT "deck_archetype_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_archetype_templates" ADD CONSTRAINT "deck_archetype_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_archetype_templates" ADD CONSTRAINT "deck_archetype_templates_source_observation_fk" FOREIGN KEY ("source_match_id","source_seat") REFERENCES "public"."ranked_deck_observations"("match_id","seat") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_archetypes" ADD CONSTRAINT "deck_archetypes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_archetypes" ADD CONSTRAINT "deck_archetypes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_archetypes" ADD CONSTRAINT "deck_archetypes_representative_card_code_cards_card_code_fk" FOREIGN KEY ("representative_card_code") REFERENCES "public"."cards"("card_code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_assignments" ADD CONSTRAINT "deck_classification_assignments_release_id_deck_classifier_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."deck_classifier_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_assignments" ADD CONSTRAINT "deck_classification_assignments_archetype_id_deck_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."deck_archetypes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_assignments" ADD CONSTRAINT "deck_classification_assignments_observation_fk" FOREIGN KEY ("match_id","seat") REFERENCES "public"."ranked_deck_observations"("match_id","seat") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_assignments" ADD CONSTRAINT "deck_classification_assignments_run_release_fk" FOREIGN KEY ("run_id","release_id") REFERENCES "public"."deck_classification_runs"("id","release_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_overrides" ADD CONSTRAINT "deck_classification_overrides_archetype_id_deck_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."deck_archetypes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_overrides" ADD CONSTRAINT "deck_classification_overrides_release_id_deck_classifier_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."deck_classifier_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_overrides" ADD CONSTRAINT "deck_classification_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_overrides" ADD CONSTRAINT "deck_classification_overrides_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_runs" ADD CONSTRAINT "deck_classification_runs_release_id_deck_classifier_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."deck_classifier_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_runs" ADD CONSTRAINT "deck_classification_runs_scope_season_id_ranked_seasons_id_fk" FOREIGN KEY ("scope_season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classification_runs" ADD CONSTRAINT "deck_classification_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classifier_releases" ADD CONSTRAINT "deck_classifier_releases_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_classifier_settings" ADD CONSTRAINT "deck_classifier_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_deck_archetype_rules_archetype" ON "deck_archetype_rules" USING btree ("archetype_id","enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_archetype_templates_active_fingerprint" ON "deck_archetype_templates" USING btree ("deck_fingerprint") WHERE "deck_archetype_templates"."enabled" = true;--> statement-breakpoint
CREATE INDEX "idx_deck_archetype_templates_archetype" ON "deck_archetype_templates" USING btree ("archetype_id","enabled");--> statement-breakpoint
CREATE INDEX "idx_deck_archetype_templates_source_match" ON "deck_archetype_templates" USING btree ("source_match_id","source_seat");--> statement-breakpoint
CREATE INDEX "idx_deck_archetypes_lifecycle_order" ON "deck_archetypes" USING btree ("lifecycle","sort_order");--> statement-breakpoint
CREATE INDEX "idx_ranked_deck_observations_fingerprint_observed" ON "ranked_deck_observations" USING btree ("deck_fingerprint","observed_at");--> statement-breakpoint
CREATE INDEX "idx_deck_classification_assignments_release_status" ON "deck_classification_assignments" USING btree ("release_id","status","archetype_id");--> statement-breakpoint
CREATE INDEX "idx_deck_classification_assignments_run" ON "deck_classification_assignments" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_classification_overrides_active_global" ON "deck_classification_overrides" USING btree ("deck_fingerprint") WHERE "deck_classification_overrides"."revoked_at" IS NULL AND "deck_classification_overrides"."applies_to_future_releases" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_classification_overrides_active_release" ON "deck_classification_overrides" USING btree ("deck_fingerprint","release_id") WHERE "deck_classification_overrides"."revoked_at" IS NULL AND "deck_classification_overrides"."applies_to_future_releases" = false;--> statement-breakpoint
CREATE INDEX "idx_deck_classification_overrides_archetype" ON "deck_classification_overrides" USING btree ("archetype_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_classification_runs_active" ON "deck_classification_runs" USING btree ((true)) WHERE "deck_classification_runs"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "idx_deck_classification_runs_release_created" ON "deck_classification_runs" USING btree ("release_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_deck_classification_runs_scope_season" ON "deck_classification_runs" USING btree ("scope_season_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_classifier_releases_active" ON "deck_classifier_releases" USING btree ((true)) WHERE "deck_classifier_releases"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_classifier_releases_building" ON "deck_classifier_releases" USING btree ((true)) WHERE "deck_classifier_releases"."status" = 'BUILDING';--> statement-breakpoint
CREATE INDEX "idx_deck_classifier_releases_published_at" ON "deck_classifier_releases" USING btree ("published_at");--> statement-breakpoint
ALTER TABLE "management_audit_logs" ADD CONSTRAINT "management_audit_scope_check" CHECK ("management_audit_logs"."scope" IN ('RANKED', 'DECK_CLASSIFIER', 'THEME_TABLE', 'SEASON_ENTRY_VISIBILITY'));
