CREATE TABLE "site_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"impact_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_announcements_type_check" CHECK ("site_announcements"."type" IN ('MAINTENANCE', 'UPDATE', 'NEWS')),
	CONSTRAINT "site_announcements_status_check" CHECK ("site_announcements"."status" IN ('DRAFT', 'PUBLISHED')),
	CONSTRAINT "site_announcements_title_check" CHECK (btrim("site_announcements"."title") <> ''),
	CONSTRAINT "site_announcements_summary_check" CHECK (btrim("site_announcements"."summary") <> '')
);
--> statement-breakpoint
ALTER TABLE "site_announcements" ADD CONSTRAINT "site_announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_announcements" ADD CONSTRAINT "site_announcements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_site_announcements_status" ON "site_announcements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_site_announcements_published_at" ON "site_announcements" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_site_announcements_ends_at" ON "site_announcements" USING btree ("ends_at");
