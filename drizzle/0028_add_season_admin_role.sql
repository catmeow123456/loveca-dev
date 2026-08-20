CREATE TABLE "management_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text NOT NULL,
	"scope" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"request_id" text NOT NULL,
	"result" text NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_audit_actor_role_check" CHECK ("management_audit_logs"."actor_role" IN ('user', 'season_admin', 'admin')),
	CONSTRAINT "management_audit_scope_check" CHECK ("management_audit_logs"."scope" IN ('RANKED', 'THEME_TABLE', 'SEASON_ENTRY_VISIBILITY')),
	CONSTRAINT "management_audit_action_check" CHECK (btrim("management_audit_logs"."action") <> ''),
	CONSTRAINT "management_audit_target_type_check" CHECK (btrim("management_audit_logs"."target_type") <> ''),
	CONSTRAINT "management_audit_target_id_check" CHECK (btrim("management_audit_logs"."target_id") <> ''),
	CONSTRAINT "management_audit_request_id_check" CHECK (btrim("management_audit_logs"."request_id") <> ''),
	CONSTRAINT "management_audit_result_check" CHECK ("management_audit_logs"."result" IN ('SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_role_check";--> statement-breakpoint
ALTER TABLE "management_audit_logs" ADD CONSTRAINT "management_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_management_audit_actor_created" ON "management_audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_management_audit_scope_target_created" ON "management_audit_logs" USING btree ("scope","target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_management_audit_created" ON "management_audit_logs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_role_check" CHECK ("profiles"."role" IN ('user', 'season_admin', 'admin'));
