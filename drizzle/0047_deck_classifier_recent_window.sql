ALTER TABLE "deck_classification_assignments" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_classification_runs" ADD COLUMN "scope_mode" text DEFAULT 'FULL' NOT NULL;--> statement-breakpoint
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
UPDATE deck_classification_runs SET scope_mode = 'RECENT'
WHERE status = 'QUEUED' AND trigger IN ('AUTO_NEW_OBSERVATIONS', 'MANUAL_OVERRIDE');
--> statement-breakpoint
ALTER TABLE deck_classification_runs ALTER COLUMN scope_mode SET DEFAULT 'RECENT';
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_classification_assignments_current" ON "deck_classification_assignments" USING btree ("match_id","seat") WHERE "deck_classification_assignments"."is_current" = true;--> statement-breakpoint
ALTER TABLE "deck_classification_runs" ADD CONSTRAINT "deck_classification_runs_scope_mode_check" CHECK ("deck_classification_runs"."scope_mode" IN ('RECENT', 'FULL'));
