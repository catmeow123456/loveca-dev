ALTER TABLE "deck_point_tables" ADD COLUMN "retirement_reason" text;--> statement-breakpoint
UPDATE "deck_point_tables"
SET "retirement_reason" = 'REPLACED'
WHERE "lifecycle" = 'RETIRED';--> statement-breakpoint
ALTER TABLE "deck_point_tables" ADD CONSTRAINT "deck_point_tables_retirement_reason_check" CHECK (("deck_point_tables"."lifecycle" = 'RETIRED' AND "deck_point_tables"."retirement_reason" IN ('REPLACED', 'SCHEDULE_CANCELLED')) OR ("deck_point_tables"."lifecycle" <> 'RETIRED' AND "deck_point_tables"."retirement_reason" IS NULL));
