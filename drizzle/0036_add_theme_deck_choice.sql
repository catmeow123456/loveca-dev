ALTER TABLE "theme_table_versions" ADD COLUMN "deck_choice_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "theme_table_versions" ADD CONSTRAINT "theme_table_versions_deck_choice_count_check" CHECK ("theme_table_versions"."deck_choice_count" > 0);
