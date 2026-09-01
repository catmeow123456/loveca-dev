CREATE TABLE "matchmaking_bgm_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"storage_key" text NOT NULL,
	"byte_size" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matchmaking_bgm_tracks_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "matchmaking_bgm_tracks_title_check" CHECK (btrim("matchmaking_bgm_tracks"."title") <> '' AND char_length("matchmaking_bgm_tracks"."title") <= 100),
	CONSTRAINT "matchmaking_bgm_tracks_storage_key_check" CHECK ("matchmaking_bgm_tracks"."storage_key" ~ '^music/[a-z0-9][a-z0-9._-]*[.]mp3$' OR "matchmaking_bgm_tracks"."storage_key" ~ '^matchmaking-bgm/[0-9a-f]{64}[.]mp3$'),
	CONSTRAINT "matchmaking_bgm_tracks_byte_size_check" CHECK ("matchmaking_bgm_tracks"."byte_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "matchmaking_bgm_tracks" ADD CONSTRAINT "matchmaking_bgm_tracks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_matchmaking_bgm_tracks_created_at" ON "matchmaking_bgm_tracks" USING btree ("created_at");
--> statement-breakpoint
INSERT INTO "matchmaking_bgm_tracks" ("title", "storage_key", "byte_size", "is_default") VALUES
	('Event 2 Theme', 'music/event-2-theme.mp3', 2102380, true),
	('Event Menu Theme', 'music/event-menu-theme.mp3', 1909704, true),
	('Intro Theme', 'music/intro-theme.mp3', 2111155, true);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "matchmaking_bgm_track_ids" uuid[];
