CREATE TABLE "ai_battle_evidence_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"entry" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_battle_evidence_entries" ADD CONSTRAINT "ai_battle_evidence_entries_match_id_match_records_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_records"("match_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_ai_battle_evidence_match_id_id" ON "ai_battle_evidence_entries" USING btree ("match_id","id");
