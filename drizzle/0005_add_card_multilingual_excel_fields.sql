ALTER TABLE "cards" RENAME COLUMN "name" TO "name_cn";--> statement-breakpoint
ALTER TABLE "cards" RENAME COLUMN "card_text" TO "card_text_cn";--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "name_cn" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "idx_cards_group_name";--> statement-breakpoint
DROP INDEX "idx_cards_name";--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "name_jp" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "work_names" jsonb;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "group_names" jsonb;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "unit_name_raw" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "card_text_jp" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "image_source_uri" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "product_code" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "source_external_id" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "source_flags" jsonb;--> statement-breakpoint
UPDATE "cards"
SET "work_names" = to_jsonb(regexp_split_to_array("group_name", E'\n'))
WHERE "group_name" IS NOT NULL AND btrim("group_name") <> '';--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "group_name";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_name_language_check" CHECK (("name_jp" IS NOT NULL AND btrim("name_jp") <> '') OR ("name_cn" IS NOT NULL AND btrim("name_cn") <> ''));
