ALTER TABLE "deck_classification_assignments" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_classification_runs" ADD COLUMN "match_limit" integer;--> statement-breakpoint
-- Backfill only successfully served results; retain the exact source release/run.
WITH latest AS (
  SELECT DISTINCT ON (assignment.match_id, assignment.seat)
         assignment.match_id, assignment.seat, assignment.release_id
  FROM deck_classification_assignments AS assignment
  JOIN deck_classifier_releases AS release ON release.id = assignment.release_id
  JOIN deck_classification_runs AS run ON run.id = assignment.run_id
  WHERE release.status IN ('ACTIVE', 'SUPERSEDED') AND run.status = 'SUCCEEDED'
  ORDER BY assignment.match_id, assignment.seat, release.version DESC
)
UPDATE deck_classification_assignments AS assignment SET is_current = true
FROM latest WHERE assignment.match_id = latest.match_id AND assignment.seat = latest.seat
  AND assignment.release_id = latest.release_id;
--> statement-breakpoint
UPDATE deck_classification_runs SET match_limit = 200
WHERE status = 'QUEUED' AND trigger IN ('AUTO_NEW_OBSERVATIONS', 'MANUAL_OVERRIDE');
--> statement-breakpoint
ALTER TABLE deck_classifier_settings ADD COLUMN recent_match_limit integer DEFAULT 200 NOT NULL;
--> statement-breakpoint
ALTER TABLE deck_classifier_settings ADD CONSTRAINT deck_classifier_settings_recent_match_limit_check CHECK (recent_match_limit BETWEEN 1 AND 10000);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_classification_assignments_current" ON "deck_classification_assignments" USING btree ("match_id","seat") WHERE "deck_classification_assignments"."is_current" = true;--> statement-breakpoint
ALTER TABLE "deck_classification_runs" ADD CONSTRAINT "deck_classification_runs_match_limit_check" CHECK ("deck_classification_runs"."match_limit" IS NULL OR "deck_classification_runs"."match_limit" BETWEEN 1 AND 10000);
