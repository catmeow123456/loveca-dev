CREATE TABLE "deck_point_table_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"action" text NOT NULL,
	"admin_user_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_point_table_audit_logs_action_check" CHECK ("deck_point_table_audit_logs"."action" IN ('DRAFT_CREATED', 'DRAFT_UPDATED', 'PUBLISHED_IMMEDIATELY', 'PUBLISHED_SCHEDULED', 'SCHEDULE_ACTIVATED', 'SCHEDULE_CANCELLED', 'ROLLBACK_DRAFT_CREATED'))
);
--> statement-breakpoint
CREATE TABLE "deck_point_table_entries" (
	"table_id" uuid NOT NULL,
	"base_card_code" text NOT NULL,
	"points" integer NOT NULL,
	CONSTRAINT "deck_point_table_entries_table_id_base_card_code_pk" PRIMARY KEY("table_id","base_card_code"),
	CONSTRAINT "deck_point_table_entries_base_code_check" CHECK (btrim("deck_point_table_entries"."base_card_code") <> ''),
	CONSTRAINT "deck_point_table_entries_points_check" CHECK ("deck_point_table_entries"."points" BETWEEN 1 AND 99)
);
--> statement-breakpoint
CREATE TABLE "deck_point_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle" text DEFAULT 'DRAFT' NOT NULL,
	"point_limit" integer DEFAULT 9 NOT NULL,
	"effective_from" timestamp with time zone,
	"published_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deck_point_tables_version_unique" UNIQUE("version"),
	CONSTRAINT "deck_point_tables_version_check" CHECK (btrim("deck_point_tables"."version") <> ''),
	CONSTRAINT "deck_point_tables_display_name_check" CHECK (btrim("deck_point_tables"."display_name") <> ''),
	CONSTRAINT "deck_point_tables_point_limit_check" CHECK ("deck_point_tables"."point_limit" BETWEEN 1 AND 99),
	CONSTRAINT "deck_point_tables_revision_check" CHECK ("deck_point_tables"."revision" > 0),
	CONSTRAINT "deck_point_tables_lifecycle_check" CHECK ("deck_point_tables"."lifecycle" IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'RETIRED')),
	CONSTRAINT "deck_point_tables_effective_from_check" CHECK (("deck_point_tables"."lifecycle" = 'DRAFT' AND "deck_point_tables"."effective_from" IS NULL) OR ("deck_point_tables"."lifecycle" <> 'DRAFT' AND "deck_point_tables"."effective_from" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO "deck_point_tables" (
	"id", "version", "display_name", "lifecycle", "point_limit",
	"effective_from", "published_at", "revision"
) VALUES
	(
		'11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a',
		'2026-04-03',
		'2026年4月3日PT限制表',
		CASE WHEN CURRENT_TIMESTAMP >= TIMESTAMPTZ '2026-08-07 16:00:00+00'
			THEN 'RETIRED' ELSE 'ACTIVE' END,
		9,
		TIMESTAMPTZ '2026-04-02 16:00:00+00',
		TIMESTAMPTZ '2026-04-02 16:00:00+00',
		1
	),
	(
		'7a81104d-947d-46e6-89f5-80ee1124b174',
		'2026-08-08',
		'2026年8月8日PT限制表',
		CASE WHEN CURRENT_TIMESTAMP >= TIMESTAMPTZ '2026-08-07 16:00:00+00'
			THEN 'ACTIVE' ELSE 'SCHEDULED' END,
		9,
		TIMESTAMPTZ '2026-08-07 16:00:00+00',
		CURRENT_TIMESTAMP,
		1
	);--> statement-breakpoint
INSERT INTO "deck_point_table_entries" ("table_id", "base_card_code", "points") VALUES
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'LL-bp2-001', 3),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!HS-bp2-014', 2),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!N-bp1-002', 2),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!N-bp1-003', 4),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!N-bp1-012', 3),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!N-bp1-029', 1),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!N-sd1-008', 2),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!SP-bp1-005', 1),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!SP-bp2-024', 1),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!SP-pb1-014', 1),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!SP-sd1-019', 1),
	('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a', 'PL!SP-sd1-020', 1),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'LL-bp2-001', 5),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!HS-bp2-014', 2),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!N-bp1-002', 2),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!N-bp1-003', 4),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!N-bp1-012', 3),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!N-bp1-029', 1),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!N-bp3-030', 1),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!N-bp4-030', 1),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!N-pb1-011', 2),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!N-sd1-008', 2),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!SP-bp1-005', 1),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!SP-pb1-014', 1),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!SP-sd1-019', 1),
	('7a81104d-947d-46e6-89f5-80ee1124b174', 'PL!SP-sd1-020', 1);--> statement-breakpoint
INSERT INTO "deck_point_table_audit_logs" ("table_id", "action", "detail") VALUES
	(
		'11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a',
		'PUBLISHED_IMMEDIATELY',
		'{"source":"INITIAL_MIGRATION","effectiveDateTime":"2026-04-03T00:00:00","platformTimeZone":"Asia/Shanghai"}'::jsonb
	),
	(
		'7a81104d-947d-46e6-89f5-80ee1124b174',
		CASE WHEN CURRENT_TIMESTAMP >= TIMESTAMPTZ '2026-08-07 16:00:00+00'
			THEN 'SCHEDULE_ACTIVATED' ELSE 'PUBLISHED_SCHEDULED' END,
		'{"source":"INITIAL_MIGRATION","effectiveDateTime":"2026-08-08T00:00:00","platformTimeZone":"Asia/Shanghai"}'::jsonb
	);--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "validated_point_table_version" text;--> statement-breakpoint
UPDATE "decks" SET "validated_point_table_version" = '2026-04-03';--> statement-breakpoint
ALTER TABLE "decks" ALTER COLUMN "validated_point_table_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_point_table_audit_logs" ADD CONSTRAINT "deck_point_table_audit_logs_table_id_deck_point_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."deck_point_tables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_point_table_audit_logs" ADD CONSTRAINT "deck_point_table_audit_logs_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_point_table_entries" ADD CONSTRAINT "deck_point_table_entries_table_id_deck_point_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."deck_point_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_point_tables" ADD CONSTRAINT "deck_point_tables_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_point_tables" ADD CONSTRAINT "deck_point_tables_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_deck_point_table_audit_logs_table_created" ON "deck_point_table_audit_logs" USING btree ("table_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_deck_point_table_entries_base_code" ON "deck_point_table_entries" USING btree ("base_card_code");--> statement-breakpoint
CREATE INDEX "idx_deck_point_tables_lifecycle_effective" ON "deck_point_tables" USING btree ("lifecycle","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_point_tables_active" ON "deck_point_tables" USING btree ((true)) WHERE "deck_point_tables"."lifecycle" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deck_point_tables_scheduled" ON "deck_point_tables" USING btree ((true)) WHERE "deck_point_tables"."lifecycle" = 'SCHEDULED';
