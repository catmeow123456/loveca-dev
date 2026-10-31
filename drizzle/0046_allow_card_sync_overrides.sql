ALTER TABLE "cards" DROP CONSTRAINT "cards_card_code_format_check";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_card_code_nonempty_check" CHECK (length(btrim("cards"."card_code")) > 0) NOT VALID;
