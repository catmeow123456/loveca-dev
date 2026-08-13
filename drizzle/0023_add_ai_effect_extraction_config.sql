CREATE TABLE "ai_effect_extraction_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"admin_user_id" uuid,
	"previous_revision" integer NOT NULL,
	"next_revision" integer NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_effect_extraction_audit_action_check" CHECK ("ai_effect_extraction_audit_logs"."action" IN ('CONFIG_UPDATED')),
	CONSTRAINT "ai_effect_extraction_audit_revision_check" CHECK ("ai_effect_extraction_audit_logs"."previous_revision" > 0 AND "ai_effect_extraction_audit_logs"."next_revision" = "ai_effect_extraction_audit_logs"."previous_revision" + 1)
);
--> statement-breakpoint
CREATE TABLE "ai_effect_extraction_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"model_id" text DEFAULT '' NOT NULL,
	"encrypted_api_key" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_effect_extraction_config_id_check" CHECK ("ai_effect_extraction_config"."id" = 'default'),
	CONSTRAINT "ai_effect_extraction_config_revision_check" CHECK ("ai_effect_extraction_config"."revision" > 0),
	CONSTRAINT "ai_effect_extraction_config_enabled_fields_check" CHECK (NOT "ai_effect_extraction_config"."enabled" OR (btrim("ai_effect_extraction_config"."base_url") <> '' AND btrim("ai_effect_extraction_config"."model_id") <> '' AND "ai_effect_extraction_config"."encrypted_api_key" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "ai_effect_extraction_audit_logs" ADD CONSTRAINT "ai_effect_extraction_audit_logs_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_effect_extraction_config" ADD CONSTRAINT "ai_effect_extraction_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_effect_extraction_audit_created_at" ON "ai_effect_extraction_audit_logs" USING btree ("created_at");
--> statement-breakpoint
INSERT INTO "ai_effect_extraction_config" ("id") VALUES ('default');
