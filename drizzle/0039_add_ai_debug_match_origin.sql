ALTER TABLE "match_records" DROP CONSTRAINT "match_records_origin_kind_check";
--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_origin_kind_check"
CHECK ("origin_kind" IN ('ONLINE_ROOM', 'PUBLIC_TABLE', 'RANKED', 'SOLITAIRE', 'AI_DEBUG'));
