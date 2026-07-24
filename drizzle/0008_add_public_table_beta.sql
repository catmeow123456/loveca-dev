CREATE TABLE "gameplay_participations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ticket_id" uuid,
	"room_generation" text,
	"match_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gameplay_participations_kind_check" CHECK ("gameplay_participations"."kind" IN ('PUBLIC_QUEUE', 'ONLINE_ROOM', 'ONLINE_MATCH'))
);
--> statement-breakpoint
CREATE TABLE "public_table_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" text DEFAULT 'PUBLIC_TABLE_V1' NOT NULL,
	"first_ticket_id" uuid NOT NULL,
	"second_ticket_id" uuid NOT NULL,
	"state" text DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	"first_confirmed_at" timestamp with time zone,
	"second_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"bootstrap_lease_until" timestamp with time zone,
	"room_code" text,
	"room_generation" text,
	"match_id" text,
	"failure_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_table_reservations_room_generation_unique" UNIQUE("room_generation"),
	CONSTRAINT "public_table_reservations_state_check" CHECK ("public_table_reservations"."state" IN ('PENDING_CONFIRMATION', 'CREATING_ROOM', 'MATCHED', 'RELEASED')),
	CONSTRAINT "public_table_reservations_distinct_tickets_check" CHECK ("public_table_reservations"."first_ticket_id" <> "public_table_reservations"."second_ticket_id")
);
--> statement-breakpoint
CREATE TABLE "public_table_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"environment_id" text DEFAULT 'PUBLIC_TABLE_V1' NOT NULL,
	"source_deck_id" uuid,
	"source_deck_name" text NOT NULL,
	"runtime_deck" jsonb NOT NULL,
	"deck_content_hash" text NOT NULL,
	"deck_locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'WAITING' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matchable_after" timestamp with time zone DEFAULT now() NOT NULL,
	"reservation_id" uuid,
	"matched_room_generation" text,
	"matched_match_id" text,
	"entry_source" text DEFAULT 'DIRECT' NOT NULL,
	"requeued_from_ticket_id" uuid,
	"terminal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_table_tickets_state_check" CHECK ("public_table_tickets"."state" IN ('WAITING', 'RESERVED', 'MATCHED', 'CANCELED', 'EXPIRED'))
);
--> statement-breakpoint
ALTER TABLE "match_records" DROP CONSTRAINT "match_records_origin_kind_check";--> statement-breakpoint
ALTER TABLE "gameplay_participations" ADD CONSTRAINT "gameplay_participations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameplay_participations" ADD CONSTRAINT "gameplay_participations_ticket_id_public_table_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."public_table_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD CONSTRAINT "public_table_reservations_first_ticket_id_public_table_tickets_id_fk" FOREIGN KEY ("first_ticket_id") REFERENCES "public"."public_table_tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_table_reservations" ADD CONSTRAINT "public_table_reservations_second_ticket_id_public_table_tickets_id_fk" FOREIGN KEY ("second_ticket_id") REFERENCES "public"."public_table_tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_source_deck_id_decks_id_fk" FOREIGN KEY ("source_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_requeued_from_ticket_id_public_table_tickets_id_fk" FOREIGN KEY ("requeued_from_ticket_id") REFERENCES "public"."public_table_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gameplay_participations_kind" ON "gameplay_participations" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_public_table_reservations_state_expires" ON "public_table_reservations" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_public_table_reservation_ticket_pair" ON "public_table_reservations" USING btree ("first_ticket_id","second_ticket_id");--> statement-breakpoint
CREATE INDEX "idx_public_table_tickets_matchable" ON "public_table_tickets" USING btree ("environment_id","state","matchable_after","joined_at");--> statement-breakpoint
CREATE INDEX "idx_public_table_tickets_reservation_id" ON "public_table_tickets" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_public_table_tickets_active_user" ON "public_table_tickets" USING btree ("user_id") WHERE "public_table_tickets"."state" IN ('WAITING', 'RESERVED');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_public_table_tickets_requeued_from" ON "public_table_tickets" USING btree ("requeued_from_ticket_id") WHERE "public_table_tickets"."requeued_from_ticket_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_origin_kind_check" CHECK ("match_records"."origin_kind" IN ('ONLINE_ROOM', 'PUBLIC_TABLE', 'SOLITAIRE'));