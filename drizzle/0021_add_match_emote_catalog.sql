CREATE TABLE "match_emote_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_fingerprint" text NOT NULL,
	"static_object_key" text NOT NULL,
	"animated_object_key" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"frame_count" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"static_bytes" integer NOT NULL,
	"animated_bytes" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_emote_assets_content_fingerprint_unique" UNIQUE("content_fingerprint"),
	CONSTRAINT "match_emote_assets_fingerprint_check" CHECK ("match_emote_assets"."content_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "match_emote_assets_static_key_check" CHECK ("match_emote_assets"."static_object_key" ~ '^emotes/[0-9a-f]{64}\.webp$'),
	CONSTRAINT "match_emote_assets_animated_key_check" CHECK ("match_emote_assets"."animated_object_key" IS NULL OR "match_emote_assets"."animated_object_key" ~ '^emotes/[0-9a-f]{64}\.webp$'),
	CONSTRAINT "match_emote_assets_dimensions_check" CHECK ("match_emote_assets"."width" BETWEEN 1 AND 512 AND "match_emote_assets"."height" BETWEEN 1 AND 512),
	CONSTRAINT "match_emote_assets_frames_check" CHECK ("match_emote_assets"."frame_count" BETWEEN 1 AND 48),
	CONSTRAINT "match_emote_assets_duration_check" CHECK ("match_emote_assets"."duration_ms" BETWEEN 0 AND 6000),
	CONSTRAINT "match_emote_assets_size_check" CHECK ("match_emote_assets"."static_bytes" > 0 AND ("match_emote_assets"."animated_bytes" IS NULL OR "match_emote_assets"."animated_bytes" > 0))
);
--> statement-breakpoint
CREATE TABLE "match_emote_catalog_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"active_version_id" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_emote_catalog_config_id_check" CHECK ("match_emote_catalog_config"."id" = 'default')
);
--> statement-breakpoint
CREATE TABLE "match_emote_catalog_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entries" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_emote_catalog_versions_entries_check" CHECK (jsonb_typeof("match_emote_catalog_versions"."entries") = 'array' AND jsonb_array_length("match_emote_catalog_versions"."entries") BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "match_emote_assets" ADD CONSTRAINT "match_emote_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_emote_catalog_config" ADD CONSTRAINT "match_emote_catalog_config_active_version_id_match_emote_catalog_versions_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."match_emote_catalog_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_emote_catalog_config" ADD CONSTRAINT "match_emote_catalog_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_emote_catalog_versions" ADD CONSTRAINT "match_emote_catalog_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_match_emote_assets_created_at" ON "match_emote_assets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_match_emote_catalog_versions_created_at" ON "match_emote_catalog_versions" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "match_emote_assets" (
	"id", "content_fingerprint", "static_object_key", "animated_object_key", "width", "height",
	"frame_count", "duration_ms", "static_bytes", "animated_bytes"
) VALUES
	('00000000-0000-4000-8000-000000000101', 'sha256:4f6301dc9a11bea2f70113ef9aaf0f4329f4dd046e767699ec207821eaa44e53', 'emotes/4ee0ede6830fdb2fbe9f1bb78abee56adefde09bb5ee70d74cc6ee91ad51a293.webp', 'emotes/d93b5b127e5f4eca1627f992f4c531370bea7ebe16a8b162f7bdd5366cb0e830.webp', 192, 192, 6, 1260, 5018, 5186),
	('00000000-0000-4000-8000-000000000102', 'sha256:0a9de1b5289f8cc3fec94e6ba948d7a4d58c11cae6c3b5ab20de0c341b523f6e', 'emotes/cf80f2d30b9d325139325bda1127dae34ec14564521ecb68016d903308a12a06.webp', NULL, 192, 192, 1, 0, 5292, NULL),
	('00000000-0000-4000-8000-000000000103', 'sha256:89decb989c5aed22c9a2d477d28aa0449ee1fe16ad1c187e8ba20175e827a3c8', 'emotes/dc0fa260abaa4001673c49b4632ab1c52115aa900cf78d936cff8bbec8f86013.webp', NULL, 192, 192, 1, 0, 5630, NULL),
	('00000000-0000-4000-8000-000000000104', 'sha256:01d15e5204e6506991cbb7f189d6ecda1ce3e7cc31c20c5d53813b3ab3cb277d', 'emotes/0571689b809b7f5b95396cad407967304ec1042c0eb20e95607f741309a6a37d.webp', NULL, 192, 192, 1, 0, 5792, NULL),
	('00000000-0000-4000-8000-000000000105', 'sha256:77f09408078b7b5d75709030014e8d2193afcf3c2612aba87f9f7cc03c6c3afa', 'emotes/d9e17b36eb2d949fb41ad0ecd0d97773648c74b9eb264d77b1db675a3c958bc7.webp', NULL, 192, 192, 1, 0, 5552, NULL),
	('00000000-0000-4000-8000-000000000106', 'sha256:32202e583abc895d4df7da1329a769a8ae2a351732a78d30ad7909054a84410a', 'emotes/f1942955145fda9a4e4b67c1627df923e344e9b1747b8054acf839f37485712c.webp', NULL, 192, 192, 1, 0, 5952, NULL);--> statement-breakpoint
INSERT INTO "match_emote_catalog_versions" ("id", "entries") VALUES (
	'00000000-0000-4000-8000-000000000201',
	'[
		{"id":"DEEP_THINKING","label":"深度思考中…","shortLabel":"思考中","sortOrder":0,"enabled":true,"assetId":"00000000-0000-4000-8000-000000000101"},
		{"id":"THANK_YOU","label":"谢谢！","shortLabel":"谢谢","sortOrder":1,"enabled":true,"assetId":"00000000-0000-4000-8000-000000000102"},
		{"id":"NICE_TO_MEET_YOU","label":"请多指教！","shortLabel":"请多指教","sortOrder":2,"enabled":true,"assetId":"00000000-0000-4000-8000-000000000103"},
		{"id":"NICE_PLAY","label":"漂亮！","shortLabel":"漂亮","sortOrder":3,"enabled":true,"assetId":"00000000-0000-4000-8000-000000000104"},
		{"id":"GOOD_GAME","label":"好局！","shortLabel":"好局","sortOrder":4,"enabled":true,"assetId":"00000000-0000-4000-8000-000000000105"},
		{"id":"SORRY_TO_KEEP_YOU_WAITING","label":"抱歉，久等了","shortLabel":"久等了","sortOrder":5,"enabled":true,"assetId":"00000000-0000-4000-8000-000000000106"}
	]'::jsonb
);--> statement-breakpoint
INSERT INTO "match_emote_catalog_config" ("id", "active_version_id")
VALUES ('default', '00000000-0000-4000-8000-000000000201');
