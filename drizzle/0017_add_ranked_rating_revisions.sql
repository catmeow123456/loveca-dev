CREATE TABLE "ranked_rating_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"season_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"source_revision_id" uuid,
	"source_algorithm_version" text NOT NULL,
	"target_algorithm_version" text NOT NULL,
	"source_config" jsonb NOT NULL,
	"target_config" jsonb NOT NULL,
	"source_config_hash" text NOT NULL,
	"target_config_hash" text NOT NULL,
	"target_competitive_environment_id" text NOT NULL,
	"source_ledger_revision" integer NOT NULL,
	"target_ledger_revision" integer NOT NULL,
	"reason" text NOT NULL,
	"preview_summary" jsonb NOT NULL,
	"applied_by" uuid,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_rating_revisions_number_check" CHECK ("ranked_rating_revisions"."revision_number" > 0),
	CONSTRAINT "ranked_rating_revisions_ledger_check" CHECK ("ranked_rating_revisions"."source_ledger_revision" >= 0 AND "ranked_rating_revisions"."target_ledger_revision" >= "ranked_rating_revisions"."source_ledger_revision"),
	CONSTRAINT "ranked_rating_revisions_reason_check" CHECK (btrim("ranked_rating_revisions"."reason") <> ''),
	CONSTRAINT "ranked_rating_revisions_source_hash_check" CHECK ("ranked_rating_revisions"."source_config_hash" LIKE 'sha256:%'),
	CONSTRAINT "ranked_rating_revisions_target_hash_check" CHECK ("ranked_rating_revisions"."target_config_hash" LIKE 'sha256:%')
);
--> statement-breakpoint
ALTER TABLE "ranked_seasons" ADD COLUMN "active_rating_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "ranked_rating_revisions" ADD CONSTRAINT "ranked_rating_revisions_season_id_ranked_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_revisions" ADD CONSTRAINT "ranked_rating_revisions_source_revision_id_ranked_rating_revisions_id_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."ranked_rating_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_rating_revisions" ADD CONSTRAINT "ranked_rating_revisions_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ranked_rating_revisions_season_number" ON "ranked_rating_revisions" USING btree ("season_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ranked_rating_revisions_season_algorithm" ON "ranked_rating_revisions" USING btree ("season_id","target_algorithm_version");--> statement-breakpoint
CREATE INDEX "idx_ranked_rating_revisions_season_applied_at" ON "ranked_rating_revisions" USING btree ("season_id","applied_at");--> statement-breakpoint
ALTER TABLE "ranked_seasons" ADD CONSTRAINT "ranked_seasons_active_rating_revision_id_ranked_rating_revisions_id_fk" FOREIGN KEY ("active_rating_revision_id") REFERENCES "public"."ranked_rating_revisions"("id") ON DELETE restrict ON UPDATE no action;