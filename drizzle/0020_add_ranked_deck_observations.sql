CREATE TABLE "ranked_deck_observations" (
	"match_id" text NOT NULL,
	"seat" text NOT NULL,
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"deck_fingerprint" text NOT NULL,
	"main_deck_cards" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_deck_observations_pk" PRIMARY KEY("match_id","seat"),
	CONSTRAINT "ranked_deck_observations_seat_check" CHECK ("ranked_deck_observations"."seat" IN ('FIRST', 'SECOND')),
	CONSTRAINT "ranked_deck_observations_fingerprint_check" CHECK ("ranked_deck_observations"."deck_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "ranked_deck_observations_main_deck_check" CHECK (jsonb_typeof("ranked_deck_observations"."main_deck_cards") = 'array' AND jsonb_array_length("ranked_deck_observations"."main_deck_cards") > 0)
);
--> statement-breakpoint
ALTER TABLE "ranked_deck_observations" ADD CONSTRAINT "ranked_deck_observations_match_id_ranked_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."ranked_matches"("match_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_deck_observations" ADD CONSTRAINT "ranked_deck_observations_season_id_ranked_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranked_deck_observations" ADD CONSTRAINT "ranked_deck_observations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ranked_deck_observations_match_user" ON "ranked_deck_observations" USING btree ("match_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_ranked_deck_observations_season_user" ON "ranked_deck_observations" USING btree ("season_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_ranked_deck_observations_season_fingerprint" ON "ranked_deck_observations" USING btree ("season_id","deck_fingerprint");