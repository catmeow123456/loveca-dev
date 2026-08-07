ALTER TABLE "match_deck_snapshots" ADD COLUMN "point_table_version" text;--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD COLUMN "point_total" integer;--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD COLUMN "point_limit" integer;--> statement-breakpoint
UPDATE "match_deck_snapshots" snapshot
SET
	"point_table_version" = '2026-04-03',
	"point_limit" = 9,
	"point_total" = COALESCE((
		SELECT SUM(point_entry."points")
		FROM jsonb_array_elements_text(snapshot."main_deck") AS deck_card(card_code)
		JOIN "deck_point_tables" point_table
			ON point_table."version" = '2026-04-03'
		JOIN "deck_point_table_entries" point_entry
			ON point_entry."table_id" = point_table."id"
			AND point_entry."base_card_code" = CASE
				WHEN cardinality(string_to_array(deck_card.card_code, '-')) > 3
					THEN regexp_replace(replace(deck_card.card_code, '＋', '+'), '-[^-]+$', '')
				ELSE replace(deck_card.card_code, '＋', '+')
			END
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
		SELECT SUM(point_entry."points")
		FROM jsonb_array_elements(ticket.runtime_deck->'mainDeck') AS deck_card(card)
		JOIN "deck_point_tables" point_table
			ON point_table."version" = '2026-04-03'
		JOIN "deck_point_table_entries" point_entry
			ON point_entry."table_id" = point_table."id"
			AND point_entry."base_card_code" = CASE
				WHEN cardinality(string_to_array(deck_card.card->>'cardCode', '-')) > 3
					THEN regexp_replace(replace(deck_card.card->>'cardCode', '＋', '+'), '-[^-]+$', '')
				ELSE replace(deck_card.card->>'cardCode', '＋', '+')
			END
	), 0);--> statement-breakpoint
ALTER TABLE "public_table_tickets" ALTER COLUMN "point_table_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ALTER COLUMN "point_total" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public_table_tickets" ALTER COLUMN "point_limit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD CONSTRAINT "match_deck_snapshots_point_total_check" CHECK ("match_deck_snapshots"."point_total" >= 0);--> statement-breakpoint
ALTER TABLE "match_deck_snapshots" ADD CONSTRAINT "match_deck_snapshots_point_limit_check" CHECK ("match_deck_snapshots"."point_limit" > 0);--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_point_total_check" CHECK ("public_table_tickets"."point_total" >= 0);--> statement-breakpoint
ALTER TABLE "public_table_tickets" ADD CONSTRAINT "public_table_tickets_point_limit_check" CHECK ("public_table_tickets"."point_limit" > 0);
