ALTER TABLE "site_status_config" DROP CONSTRAINT "site_status_config_lifecycle_check";--> statement-breakpoint
UPDATE "site_status_config"
SET
	"lifecycle" = 'NORMAL',
	"title" = NULL,
	"summary" = NULL,
	"detail" = NULL,
	"starts_at" = NULL,
	"estimated_ends_at" = NULL,
	"restricts_new_games_at" = NULL,
	"impact_scopes" = '[]'::jsonb,
	"restrictions" = '[]'::jsonb,
	"action" = NULL,
	"updated_at" = now()
WHERE "lifecycle" IN ('SCHEDULED', 'COMPLETED', 'POSTPONED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "site_status_config" ADD CONSTRAINT "site_status_config_lifecycle_check" CHECK ("site_status_config"."lifecycle" IN ('NORMAL', 'RESTRICTING_NEW_GAMES', 'MAINTENANCE'));
