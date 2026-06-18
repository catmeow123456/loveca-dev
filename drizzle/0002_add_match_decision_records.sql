CREATE TABLE IF NOT EXISTS "match_decision_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"timeline_seq" integer NOT NULL,
	"decision_schema_version" integer DEFAULT 1 NOT NULL,
	"decision_type" text NOT NULL,
	"status" text NOT NULL,
	"player_id" text,
	"event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_type" text,
	"source_card_object_id" text,
	"source_card_code" text,
	"source_base_card_code" text,
	"source_zone" text,
	"source_slot" text,
	"ability_id" text,
	"trigger_condition" text,
	"ability_category" text,
	"ability_source_zone" text,
	"effect_text_snapshot" text,
	"step_id" text,
	"step_text" text,
	"waiting_seat" text,
	"visible_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audit_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visible_context_summary" jsonb,
	"min_select" integer,
	"max_select" integer,
	"can_skip" boolean,
	"opened_checkpoint_seq" integer,
	"submitted_timeline_seq" integer,
	"submitted_command_seq" integer,
	"submission" jsonb,
	"result_summary" text,
	"replay_capability" text DEFAULT 'DECISION_RECORDS_PARTIAL' NOT NULL,
	"transition_semantics" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_decision_records_type_check" CHECK ("match_decision_records"."decision_type" IN ('ACTIVE_EFFECT_OPENED', 'ACTIVE_EFFECT_SUBMITTED', 'PENDING_ABILITY_ORDER_SUBMITTED', 'ACTIVATE_ABILITY_SUBMITTED', 'MULLIGAN_SUBMITTED', 'SET_LIVE_CARD_SUBMITTED', 'SELECT_SUCCESS_LIVE_SUBMITTED')),
	CONSTRAINT "match_decision_records_status_check" CHECK ("match_decision_records"."status" IN ('OPENED', 'SUBMITTED')),
	CONSTRAINT "match_decision_records_waiting_seat_check" CHECK ("match_decision_records"."waiting_seat" IS NULL OR "match_decision_records"."waiting_seat" IN ('FIRST', 'SECOND')),
	CONSTRAINT "match_decision_records_transition_semantics_check" CHECK ("match_decision_records"."transition_semantics" IN ('STRUCTURED', 'SNAPSHOT_AUDIT_ONLY', 'UNSTRUCTURED_MANUAL'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "match_decision_records" ADD CONSTRAINT "match_decision_records_match_id_match_records_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_records"("match_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_decision_records_match_decision" ON "match_decision_records" USING btree ("match_id","decision_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_decision_records_timeline" ON "match_decision_records" USING btree ("match_id","timeline_seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_decision_records_waiting_seat" ON "match_decision_records" USING btree ("match_id","waiting_seat");
