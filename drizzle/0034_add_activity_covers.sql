CREATE TABLE "activity_cover_configs" (
	"activity_type" text NOT NULL,
	"activity_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"revision" integer NOT NULL,
	"mask_level" text NOT NULL,
	"master_object_key" text,
	"master_width" integer,
	"master_height" integer,
	"master_sha256" text,
	"wide_object_key" text,
	"wide_crop" jsonb,
	"wide_focus" jsonb,
	"compact_object_key" text,
	"compact_crop" jsonb,
	"compact_focus" jsonb,
	"last_idempotency_key" text NOT NULL,
	"last_request_fingerprint" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_cover_configs_pk" PRIMARY KEY("activity_type","activity_id"),
	CONSTRAINT "activity_cover_configs_activity_type_check" CHECK ("activity_cover_configs"."activity_type" IN ('RANKED', 'THEME')),
	CONSTRAINT "activity_cover_configs_mode_check" CHECK ("activity_cover_configs"."mode" IN ('DEFAULT', 'CUSTOM')),
	CONSTRAINT "activity_cover_configs_revision_check" CHECK ("activity_cover_configs"."revision" > 0),
	CONSTRAINT "activity_cover_configs_mask_check" CHECK ("activity_cover_configs"."mask_level" IN ('STANDARD', 'STRONG')),
	CONSTRAINT "activity_cover_configs_object_key_check" CHECK ((
        "activity_cover_configs"."master_object_key" IS NULL OR
        "activity_cover_configs"."master_object_key" ~ '^activity-covers/[0-9a-f-]{36}/master[.]webp$'
      ) AND (
        "activity_cover_configs"."wide_object_key" IS NULL OR
        "activity_cover_configs"."wide_object_key" ~ '^activity-covers/[0-9a-f-]{36}/wide[.]webp$'
      ) AND (
        "activity_cover_configs"."compact_object_key" IS NULL OR
        "activity_cover_configs"."compact_object_key" ~ '^activity-covers/[0-9a-f-]{36}/compact[.]webp$'
      )),
	CONSTRAINT "activity_cover_configs_fingerprint_check" CHECK ("activity_cover_configs"."last_request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "activity_cover_configs_idempotency_key_check" CHECK (char_length("activity_cover_configs"."last_idempotency_key") BETWEEN 8 AND 160),
	CONSTRAINT "activity_cover_configs_shape_check" CHECK ((
        "activity_cover_configs"."mode" = 'DEFAULT'
        AND "activity_cover_configs"."master_object_key" IS NULL
        AND "activity_cover_configs"."master_width" IS NULL
        AND "activity_cover_configs"."master_height" IS NULL
        AND "activity_cover_configs"."master_sha256" IS NULL
        AND "activity_cover_configs"."wide_object_key" IS NULL
        AND "activity_cover_configs"."wide_crop" IS NULL
        AND "activity_cover_configs"."wide_focus" IS NULL
        AND "activity_cover_configs"."compact_object_key" IS NULL
        AND "activity_cover_configs"."compact_crop" IS NULL
        AND "activity_cover_configs"."compact_focus" IS NULL
      ) OR (
        "activity_cover_configs"."mode" = 'CUSTOM'
        AND "activity_cover_configs"."master_object_key" IS NOT NULL
        AND "activity_cover_configs"."master_width" > 0
        AND "activity_cover_configs"."master_height" > 0
        AND "activity_cover_configs"."master_sha256" ~ '^[0-9a-f]{64}$'
        AND "activity_cover_configs"."wide_object_key" IS NOT NULL
        AND "activity_cover_configs"."wide_crop" IS NOT NULL
        AND "activity_cover_configs"."wide_focus" IS NOT NULL
        AND "activity_cover_configs"."compact_object_key" IS NOT NULL
        AND "activity_cover_configs"."compact_crop" IS NOT NULL
        AND "activity_cover_configs"."compact_focus" IS NOT NULL
      ))
);
--> statement-breakpoint
ALTER TABLE "activity_cover_configs" ADD CONSTRAINT "activity_cover_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
