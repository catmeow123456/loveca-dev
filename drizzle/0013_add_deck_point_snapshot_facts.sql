ALTER TABLE "match_deck_snapshots" ADD COLUMN "point_table_version" text;--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD COLUMN "point_total" integer;--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD COLUMN "point_limit" integer;--> statement-breakpoint
UPDATE "match_deck_snapshots" snapshot
SET
	"point_table_version" = '2026-04-03',
	"point_limit" = 9,
	"point_total" = COALESCE((
		SELECT SUM(CASE regexp_replace(card_code, '-[^-]+$', '')
			WHEN 'LL-bp2-001' THEN 3
			WHEN 'PL!N-bp1-003' THEN 4
			WHEN 'PL!N-bp1-012' THEN 3
			WHEN 'PL!N-bp1-002' THEN 2
			WHEN 'PL!N-sd1-008' THEN 2
			WHEN 'PL!HS-bp2-014' THEN 2
			WHEN 'PL!SP-bp1-005' THEN 1
			WHEN 'PL!N-bp1-029' THEN 1
			WHEN 'PL!SP-sd1-019' THEN 1
			WHEN 'PL!SP-sd1-020' THEN 1
			WHEN 'PL!SP-pb1-014' THEN 1
			WHEN 'PL!SP-bp2-024' THEN 1
			ELSE 0
		END)
		FROM jsonb_array_elements_text(snapshot."main_deck") AS card_code
	), 0);--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ALTER COLUMN "point_table_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ALTER COLUMN "point_total" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ALTER COLUMN "point_limit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD COLUMN "point_table_version" text;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD COLUMN "point_total" integer;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD COLUMN "point_limit" integer;--> statement-breakpoint
UPDATE "public_table_tickets" ticket
SET
	"point_table_version" = '2026-04-03',
	"point_limit" = 9,
	"point_total" = COALESCE((
		SELECT SUM(CASE regexp_replace(card->>'cardCode', '-[^-]+$', '')
			WHEN 'LL-bp2-001' THEN 3
			WHEN 'PL!N-bp1-003' THEN 4
			WHEN 'PL!N-bp1-012' THEN 3
			WHEN 'PL!N-bp1-002' THEN 2
			WHEN 'PL!N-sd1-008' THEN 2
			WHEN 'PL!HS-bp2-014' THEN 2
			WHEN 'PL!SP-bp1-005' THEN 1
			WHEN 'PL!N-bp1-029' THEN 1
			WHEN 'PL!SP-sd1-019' THEN 1
			WHEN 'PL!SP-sd1-020' THEN 1
			WHEN 'PL!SP-pb1-014' THEN 1
			WHEN 'PL!SP-bp2-024' THEN 1
			ELSE 0
		END)
		FROM jsonb_array_elements(ticket.runtime_deck->'mainDeck') AS card
	), 0);--> statement-breakpoint
ALTER TABLE "public_table_tickets" ALTER COLUMN "point_table_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ALTER COLUMN "point_total" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ALTER COLUMN "point_limit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD CONSTRAINT "match_deck_snapshots_point_total_check" CHECK ("match_deck_snapshots"."point_total" >= 0);--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD CONSTRAINT "match_deck_snapshots_point_limit_check" CHECK ("match_deck_snapshots"."point_limit" > 0);--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_point_total_check" CHECK ("public_table_tickets"."point_total" >= 0);--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_point_limit_check" CHECK ("public_table_tickets"."point_limit" > 0);
