CREATE TABLE "card_sync_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"card_code" text,
	"result" text NOT NULL,
	"summary" jsonb,
	"message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_sync_run_items_ordinal_check" CHECK ("card_sync_run_items"."ordinal" >= 0),
	CONSTRAINT "card_sync_run_items_kind_check" CHECK ("card_sync_run_items"."kind" IN ('CANDIDATE', 'BLOCKED', 'APPLY_RESULT')),
	CONSTRAINT "card_sync_run_items_result_check" CHECK ("card_sync_run_items"."result" IN ('READY', 'BLOCKED', 'PENDING', 'RUNNING', 'SUCCEEDED', 'SKIPPED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "card_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"actor_user_id" uuid,
	"request_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"preview_run_id" uuid,
	"source_collection" text DEFAULT 'loveca' NOT NULL,
	"source_hash" text,
	"source_summary" jsonb,
	"result_summary" jsonb,
	"error_code" text,
	"error_message" text,
	"preview_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_sync_runs_kind_check" CHECK ("card_sync_runs"."kind" IN ('PREVIEW', 'APPLY')),
	CONSTRAINT "card_sync_runs_status_check" CHECK ("card_sync_runs"."status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
	CONSTRAINT "card_sync_runs_request_id_check" CHECK (btrim("card_sync_runs"."request_id") <> ''),
	CONSTRAINT "card_sync_runs_idempotency_key_check" CHECK (btrim("card_sync_runs"."idempotency_key") <> ''),
	CONSTRAINT "card_sync_runs_source_collection_check" CHECK ("card_sync_runs"."source_collection" = 'loveca'),
	CONSTRAINT "card_sync_runs_shape_check" CHECK (("card_sync_runs"."kind" = 'PREVIEW' AND "card_sync_runs"."preview_run_id" IS NULL) OR ("card_sync_runs"."kind" = 'APPLY' AND "card_sync_runs"."preview_run_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "card_sync_run_items" ADD CONSTRAINT "card_sync_run_items_run_id_card_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."card_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_sync_runs" ADD CONSTRAINT "card_sync_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_sync_runs" ADD CONSTRAINT "card_sync_runs_preview_run_id_card_sync_runs_id_fk" FOREIGN KEY ("preview_run_id") REFERENCES "public"."card_sync_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_card_sync_run_items_ordinal" ON "card_sync_run_items" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE INDEX "idx_card_sync_run_items_run_result" ON "card_sync_run_items" USING btree ("run_id","result");--> statement-breakpoint
CREATE INDEX "idx_card_sync_run_items_card_code" ON "card_sync_run_items" USING btree ("card_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_card_sync_runs_actor_kind_idempotency" ON "card_sync_runs" USING btree ("actor_user_id","kind","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_card_sync_runs_active_apply" ON "card_sync_runs" USING btree ((true)) WHERE "card_sync_runs"."kind" = 'APPLY' AND "card_sync_runs"."status" IN ('QUEUED', 'RUNNING');--> statement-breakpoint
CREATE INDEX "idx_card_sync_runs_created_at" ON "card_sync_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_card_sync_runs_preview_run" ON "card_sync_runs" USING btree ("preview_run_id");