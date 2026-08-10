CREATE TABLE "player_badge_rules" (
	"badge_key" text PRIMARY KEY NOT NULL,
	"source_season_id" uuid NOT NULL,
	"criteria_type" text NOT NULL,
	"minimum_value" integer NOT NULL,
	"criteria_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_badge_rules_key_check" CHECK (btrim("player_badge_rules"."badge_key") <> ''),
	CONSTRAINT "player_badge_rules_criteria_type_check" CHECK ("player_badge_rules"."criteria_type" IN ('RANKED_RATED_MATCH_COUNT')),
	CONSTRAINT "player_badge_rules_minimum_value_check" CHECK ("player_badge_rules"."minimum_value" > 0),
	CONSTRAINT "player_badge_rules_criteria_version_check" CHECK (btrim("player_badge_rules"."criteria_version") <> '')
);
--> statement-breakpoint
CREATE TABLE "player_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"badge_key" text NOT NULL,
	"source_season_id" uuid,
	"criteria_version" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_badges_key_check" CHECK (btrim("player_badges"."badge_key") <> ''),
	CONSTRAINT "player_badges_criteria_version_check" CHECK (btrim("player_badges"."criteria_version") <> '')
);
--> statement-breakpoint
ALTER TABLE "player_badge_rules" ADD CONSTRAINT "player_badge_rules_source_season_id_ranked_seasons_id_fk" FOREIGN KEY ("source_season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_badges" ADD CONSTRAINT "player_badges_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_badges" ADD CONSTRAINT "player_badges_badge_key_player_badge_rules_badge_key_fk" FOREIGN KEY ("badge_key") REFERENCES "public"."player_badge_rules"("badge_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_badges" ADD CONSTRAINT "player_badges_source_season_id_ranked_seasons_id_fk" FOREIGN KEY ("source_season_id") REFERENCES "public"."ranked_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_player_badge_rules_source_season" ON "player_badge_rules" USING btree ("source_season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_player_badges_user_badge" ON "player_badges" USING btree ("user_id","badge_key");--> statement-breakpoint
CREATE INDEX "idx_player_badges_user_awarded_at" ON "player_badges" USING btree ("user_id","awarded_at");--> statement-breakpoint
CREATE INDEX "idx_player_badges_source_season" ON "player_badges" USING btree ("source_season_id");
