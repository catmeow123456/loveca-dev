CREATE TABLE "site_status_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"lifecycle" text DEFAULT 'NORMAL' NOT NULL,
	"title" text,
	"summary" text,
	"detail" text,
	"starts_at" timestamp with time zone,
	"estimated_ends_at" timestamp with time zone,
	"restricts_new_games_at" timestamp with time zone,
	"impact_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restrictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_status_config_lifecycle_check" CHECK ("site_status_config"."lifecycle" IN ('NORMAL', 'SCHEDULED', 'RESTRICTING_NEW_GAMES', 'MAINTENANCE', 'COMPLETED', 'POSTPONED', 'CANCELLED')),
	CONSTRAINT "site_status_config_id_check" CHECK ("site_status_config"."id" = 'default')
);
--> statement-breakpoint
ALTER TABLE "site_status_config" ADD CONSTRAINT "site_status_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_site_status_config_lifecycle" ON "site_status_config" USING btree ("lifecycle");