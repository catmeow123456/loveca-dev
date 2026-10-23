ALTER TABLE "match_records" ADD COLUMN "casual_rule_mode" text;--> statement-breakpoint
ALTER TABLE "casual_tables" ADD CONSTRAINT "casual_tables_environment_check" CHECK ("casual_tables"."environment_id" IN ('CASUAL_TABLE_V1', 'CASUAL_UNLIMITED_PT_V1'));
--> statement-breakpoint
UPDATE "match_records" AS record SET "casual_rule_mode" = 'NORMAL'
WHERE record.origin_kind IN ('ONLINE_ROOM', 'PUBLIC_TABLE') AND record.match_mode = 'ONLINE'
  AND NOT EXISTS (SELECT 1 FROM theme_table_assignments activity WHERE activity.match_id = record.match_id);
--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_casual_rule_mode_check"
CHECK ("casual_rule_mode" IS NULL OR ("casual_rule_mode" IN ('NORMAL', 'UNLIMITED') AND "match_mode" = 'ONLINE' AND "origin_kind" IN ('ONLINE_ROOM', 'PUBLIC_TABLE')));
