DROP INDEX IF EXISTS "uq_match_record_public_events_match_seq";--> statement-breakpoint
DROP INDEX IF EXISTS "uq_match_record_public_events_match_timeline_seq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_record_public_events_match_timeline_seq"
  ON "match_record_public_events" USING btree ("match_id","timeline_seq","event_seq");--> statement-breakpoint
DROP INDEX IF EXISTS "uq_match_record_private_events_match_seat_seq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_record_private_events_match_seat_seq"
  ON "match_record_private_events" USING btree ("match_id","seat","timeline_seq","event_seq");
