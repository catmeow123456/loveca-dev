CREATE TABLE "casual_table_seats" (
	"table_id" uuid NOT NULL,
	"seat" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"source_deck_id" uuid,
	"deck_name" text NOT NULL,
	"runtime_deck" jsonb,
	"point_table_version" text NOT NULL,
	"point_total" integer NOT NULL,
	"point_limit" integer NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"waiting_since" timestamp with time zone NOT NULL,
	"continue_public" boolean NOT NULL,
	"spectator_enabled" boolean NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "casual_table_seats_table_id_seat_pk" PRIMARY KEY("table_id","seat"),
	CONSTRAINT "uq_casual_table_seats_user" UNIQUE("table_id","user_id"),
	CONSTRAINT "casual_table_seats_seat_check" CHECK ("casual_table_seats"."seat" IN (0, 1)),
	CONSTRAINT "casual_table_seats_points_check" CHECK ("casual_table_seats"."point_total" >= 0 AND "casual_table_seats"."point_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "casual_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_code" text NOT NULL,
	"discoverability" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"environment_id" text NOT NULL,
	"state" text NOT NULL,
	"round_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"waiting_since" timestamp with time zone NOT NULL,
	"confirmation_expires_at" timestamp with time zone,
	"bootstrap_lease_until" timestamp with time zone,
	"bootstrap_attempts" integer DEFAULT 0 NOT NULL,
	"room_generation" text,
	"created_by" uuid NOT NULL,
	"creation_key" uuid NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "uq_casual_tables_creation" UNIQUE("created_by","creation_key"),
	CONSTRAINT "casual_tables_discoverability_check" CHECK ("casual_tables"."discoverability" IN ('PUBLIC', 'UNLISTED')),
	CONSTRAINT "casual_tables_state_check" CHECK ("casual_tables"."state" IN ('WAITING', 'RESERVED', 'BOOTSTRAPPING', 'BOUND', 'CLOSED')),
	CONSTRAINT "casual_tables_revision_check" CHECK ("casual_tables"."revision" > 0 AND "casual_tables"."bootstrap_attempts" BETWEEN 0 AND 3),
	CONSTRAINT "casual_tables_note_check" CHECK (char_length("casual_tables"."note") <= 40),
	CONSTRAINT "casual_tables_lifecycle_check" CHECK (
      ("casual_tables"."state" = 'CLOSED') = ("casual_tables"."closed_at" IS NOT NULL)
      AND ("casual_tables"."state" = 'BOOTSTRAPPING') = ("casual_tables"."bootstrap_lease_until" IS NOT NULL)
      AND ("casual_tables"."state" = 'BOUND') = ("casual_tables"."room_generation" IS NOT NULL)
      AND ("casual_tables"."state" IN ('RESERVED', 'BOOTSTRAPPING')) = ("casual_tables"."confirmation_expires_at" IS NOT NULL)
    )
);
--> statement-breakpoint
ALTER TABLE "gameplay_participations" DROP CONSTRAINT "gameplay_participations_kind_check";--> statement-breakpoint
ALTER TABLE "gameplay_participations" ADD COLUMN "casual_table_id" uuid;--> statement-breakpoint
ALTER TABLE "casual_table_seats" ADD CONSTRAINT "casual_table_seats_table_id_casual_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."casual_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casual_table_seats" ADD CONSTRAINT "casual_table_seats_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casual_table_seats" ADD CONSTRAINT "casual_table_seats_source_deck_id_decks_id_fk" FOREIGN KEY ("source_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casual_tables" ADD CONSTRAINT "casual_tables_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_casual_tables_active_room_code" ON "casual_tables" USING btree ("room_code") WHERE "casual_tables"."state" <> 'CLOSED';--> statement-breakpoint
CREATE INDEX "idx_casual_tables_supply" ON "casual_tables" USING btree ("environment_id","state","waiting_since");--> statement-breakpoint
ALTER TABLE "gameplay_participations" ADD CONSTRAINT "gameplay_participations_casual_table_id_casual_tables_id_fk" FOREIGN KEY ("casual_table_id") REFERENCES "public"."casual_tables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gameplay_participations_casual_table" ON "gameplay_participations" USING btree ("casual_table_id");--> statement-breakpoint
ALTER TABLE "gameplay_participations" ADD CONSTRAINT "gameplay_participations_casual_ref_check" CHECK (
      ("gameplay_participations"."kind" <> 'CASUAL_TABLE' OR ("gameplay_participations"."casual_table_id" IS NOT NULL AND "gameplay_participations"."room_generation" IS NULL AND "gameplay_participations"."match_id" IS NULL))
      AND ("gameplay_participations"."casual_table_id" IS NULL OR ("gameplay_participations"."kind" IN ('CASUAL_TABLE', 'ONLINE_ROOM', 'ONLINE_MATCH') AND "gameplay_participations"."ticket_id" IS NULL))
    );--> statement-breakpoint
ALTER TABLE "gameplay_participations" ADD CONSTRAINT "gameplay_participations_kind_check" CHECK ("gameplay_participations"."kind" IN ('PUBLIC_QUEUE', 'RANKED_QUEUE', 'THEME_QUEUE', 'CASUAL_TABLE', 'ONLINE_ROOM', 'ONLINE_MATCH'));