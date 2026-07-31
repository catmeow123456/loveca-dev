ALTER TABLE "match_records" DROP CONSTRAINT "match_records_completeness_check";--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_completeness_check" CHECK ("match_records"."completeness" IN ('FULL', 'PARTIAL', 'INCOMPLETE', 'METADATA_ONLY'));
