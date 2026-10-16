ALTER TABLE "site_status_config" ADD COLUMN "double_disconnect_no_contest_window_seconds" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_status_config" ADD COLUMN "room_destroy_after_all_absent_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_status_config" ADD COLUMN "casual_heartbeat_grace_seconds" integer DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_status_config" ADD COLUMN "casual_confirmation_ttl_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_status_config" ADD CONSTRAINT "site_status_config_double_disconnect_no_contest_window_check" CHECK ("site_status_config"."double_disconnect_no_contest_window_seconds" BETWEEN 2 AND 30);--> statement-breakpoint
ALTER TABLE "site_status_config" ADD CONSTRAINT "site_status_config_room_destroy_after_all_absent_check" CHECK ("site_status_config"."room_destroy_after_all_absent_seconds" BETWEEN 30 AND 600);--> statement-breakpoint
ALTER TABLE "site_status_config" ADD CONSTRAINT "site_status_config_casual_heartbeat_grace_check" CHECK ("site_status_config"."casual_heartbeat_grace_seconds" BETWEEN 45 AND 300);--> statement-breakpoint
ALTER TABLE "site_status_config" ADD CONSTRAINT "site_status_config_casual_confirmation_ttl_check" CHECK ("site_status_config"."casual_confirmation_ttl_seconds" BETWEEN 30 AND 300);