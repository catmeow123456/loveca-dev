INSERT INTO "match_emote_assets" (
	"id", "content_fingerprint", "static_object_key", "animated_object_key", "width", "height",
	"frame_count", "duration_ms", "static_bytes", "animated_bytes"
) VALUES
	('00000000-0000-4000-8000-000000000107', 'sha256:cdaaa3f2fa5fd097a194066f3cceb21dd8cf50beb0ccea3f74b6cb5a302d9b9f', 'emotes/9df3ead2b0996c79cf460972e1e6963366cd8fc50325edc181599dfeef48da9a.webp', NULL, 192, 192, 1, 0, 25622, NULL),
	('00000000-0000-4000-8000-000000000108', 'sha256:084eb8600c7ccfb24742621eba634c94412b335a1183c28b38dbc3b35e6bf99d', 'emotes/73cfc73f8f198c585d12fd949f26fd5816d5c387c9f544b5b1064568e9085a1b.webp', NULL, 192, 192, 1, 0, 17016, NULL),
	('00000000-0000-4000-8000-000000000109', 'sha256:424e0d10717988efb7b2f045859ae7c628a5dd4c9982e05a81b24b030b6bd9dd', 'emotes/f63990566b472b47e04b4fcc3ebc049e4c1df56cae3557dc99dda3a1239b8c18.webp', NULL, 192, 192, 1, 0, 17954, NULL);--> statement-breakpoint
DO $$
DECLARE
	current_version_id uuid;
	current_entries jsonb;
	next_sort_order integer;
BEGIN
	SELECT config.active_version_id, version.entries
	INTO current_version_id, current_entries
	FROM "match_emote_catalog_config" config
	JOIN "match_emote_catalog_versions" version ON version.id = config.active_version_id
	WHERE config.id = 'default'
	FOR UPDATE OF config;

	IF current_version_id IS NULL OR current_entries IS NULL THEN
		RAISE EXCEPTION 'Cannot append sticker emotes because the active match emote catalog is missing';
	END IF;

	IF jsonb_array_length(current_entries) > 9 THEN
		RAISE EXCEPTION 'Cannot append three sticker emotes to a catalog with more than nine entries';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM jsonb_array_elements(current_entries) entry
		WHERE entry->>'id' IN ('ALL_IN_LIVE', 'OH_NO', 'WHERE_IS_MY_LIVE')
	) THEN
		RAISE EXCEPTION 'Cannot append sticker emotes because a stable emote ID is already in use';
	END IF;

	SELECT COALESCE(MAX((entry->>'sortOrder')::integer), -1) + 1
	INTO next_sort_order
	FROM jsonb_array_elements(current_entries) entry;

	INSERT INTO "match_emote_catalog_versions" ("id", "entries", "previous_version_id")
	VALUES (
		'00000000-0000-4000-8000-000000000202',
		current_entries || jsonb_build_array(
			jsonb_build_object(
				'id', 'ALL_IN_LIVE',
				'label', '跟你爆了！',
				'shortLabel', '跟你爆了',
				'sortOrder', next_sort_order,
				'enabled', true,
				'assetId', '00000000-0000-4000-8000-000000000107'
			),
			jsonb_build_object(
				'id', 'OH_NO',
				'label', 'Oh no!',
				'shortLabel', 'Oh no',
				'sortOrder', next_sort_order + 1,
				'enabled', true,
				'assetId', '00000000-0000-4000-8000-000000000108'
			),
			jsonb_build_object(
				'id', 'WHERE_IS_MY_LIVE',
				'label', '我 LIVE 呢',
				'shortLabel', '我 LIVE 呢',
				'sortOrder', next_sort_order + 2,
				'enabled', true,
				'assetId', '00000000-0000-4000-8000-000000000109'
			)
		),
		current_version_id
	);

	UPDATE "match_emote_catalog_config"
	SET "active_version_id" = '00000000-0000-4000-8000-000000000202',
		"updated_by" = NULL,
		"updated_at" = now()
	WHERE "id" = 'default';
END $$;
