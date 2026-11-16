-- Stop old writers and close BP7 rooms through the existing lifecycle before applying.
-- Archived tables and match snapshots are deliberately not rewritten.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM casual_tables WHERE environment_id = 'CASUAL_SEALED_BP7_V1' AND state <> 'CLOSED')
    OR EXISTS (SELECT 1 FROM gameplay_participations p JOIN casual_tables t ON t.id = p.casual_table_id WHERE t.environment_id = 'CASUAL_SEALED_BP7_V1') THEN
    RAISE EXCEPTION 'Close all BP7 rooms and release their participations before switching to BP8';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "casual_tables" DROP CONSTRAINT "casual_tables_environment_check";--> statement-breakpoint
ALTER TABLE "casual_tables" ADD CONSTRAINT "casual_tables_retired_bp7_check" CHECK ("casual_tables"."environment_id" <> 'CASUAL_SEALED_BP7_V1' OR "casual_tables"."state" = 'CLOSED');--> statement-breakpoint
ALTER TABLE "casual_tables" ADD CONSTRAINT "casual_tables_environment_check" CHECK ("casual_tables"."environment_id" IN ('CASUAL_TABLE_V1', 'CASUAL_UNLIMITED_PT_V1', 'CASUAL_SEALED_BP7_V1', 'CASUAL_SEALED_BP8_V1', 'CASUAL_HEXTECH_V1'));
