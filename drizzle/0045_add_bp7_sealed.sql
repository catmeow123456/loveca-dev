ALTER TABLE "casual_tables" DROP CONSTRAINT "casual_tables_state_check";--> statement-breakpoint
ALTER TABLE "casual_tables" DROP CONSTRAINT "casual_tables_environment_check";--> statement-breakpoint
ALTER TABLE "casual_tables" DROP CONSTRAINT "casual_tables_lifecycle_check";--> statement-breakpoint
ALTER TABLE "casual_table_seats" ADD COLUMN "sealed_pool" jsonb;--> statement-breakpoint
ALTER TABLE "casual_table_seats" ADD COLUMN "sealed_draft" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "casual_table_seats" ADD COLUMN "draft_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "casual_tables" ADD COLUMN "sealed_rematch" jsonb;--> statement-breakpoint
ALTER TABLE "casual_tables" ADD CONSTRAINT "casual_tables_state_check" CHECK ("casual_tables"."state" IN ('WAITING', 'RESERVED', 'BUILDING', 'BOOTSTRAPPING', 'BOUND', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "casual_tables" ADD CONSTRAINT "casual_tables_environment_check" CHECK ("casual_tables"."environment_id" IN ('CASUAL_TABLE_V1', 'CASUAL_UNLIMITED_PT_V1', 'CASUAL_SEALED_BP7_V1'));--> statement-breakpoint
ALTER TABLE "casual_tables" ADD CONSTRAINT "casual_tables_lifecycle_check" CHECK (
      ("casual_tables"."state" = 'CLOSED') = ("casual_tables"."closed_at" IS NOT NULL)
      AND ("casual_tables"."state" = 'BOOTSTRAPPING') = ("casual_tables"."bootstrap_lease_until" IS NOT NULL)
      AND ("casual_tables"."state" = 'BOUND') = ("casual_tables"."room_generation" IS NOT NULL)
      AND ("casual_tables"."state" IN ('RESERVED', 'BUILDING', 'BOOTSTRAPPING')) = ("casual_tables"."confirmation_expires_at" IS NOT NULL)
    );