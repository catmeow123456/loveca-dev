ALTER TABLE "profiles"
  ADD COLUMN "matchmaking_bgm_enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN "matchmaking_match_sound_enabled" boolean DEFAULT true NOT NULL;
