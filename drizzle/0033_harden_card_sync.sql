ALTER TABLE "card_sync_runs" ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "card_sync_runs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "card_sync_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_sync_runs" ADD CONSTRAINT "card_sync_runs_lease_generation_check" CHECK ("card_sync_runs"."lease_generation" >= 0);--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_card_code_format_check" CHECK ("cards"."card_code" ~ '^(PL!|PL!S|PL!N|PL!SP|PL!HS|PL!SIM|LL|IKZL|PYHN)-((sd|bp|cl|pb)[0-9]+|PR|E)-([0-9]{3}|E[0-9]{2,})-(SD|SD2|N|R|R[+]|P|P[+]|AR|CL|L|L[+]|SEC|SEC[+]|SECL|SECE|SECS|PR|PR[+]|PP|DUO|SRL|PE|PE[+]|RE|SRE|RM|LLE)$') NOT VALID;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_cost_non_negative_check" CHECK ("cards"."cost" IS NULL OR "cards"."cost" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_blade_non_negative_check" CHECK ("cards"."blade" IS NULL OR "cards"."blade" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_score_non_negative_check" CHECK ("cards"."score" IS NULL OR "cards"."score" >= 0) NOT VALID;
