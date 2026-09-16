ALTER TABLE "match_records" ADD COLUMN "ai_billing" jsonb;
--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_ai_billing_origin_check"
CHECK ("ai_billing" IS NULL OR "origin_kind" = 'AI_DEBUG');
