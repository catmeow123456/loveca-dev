CREATE TABLE "player_wallpaper_admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"admin_user_id" uuid,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"config_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_wallpaper_admin_audit_action_check" CHECK ("player_wallpaper_admin_audit_logs"."action" IN ('REMOVED')),
	CONSTRAINT "player_wallpaper_admin_audit_reason_check" CHECK (btrim("player_wallpaper_admin_audit_logs"."reason") <> ''),
	CONSTRAINT "player_wallpaper_admin_audit_version_check" CHECK ("player_wallpaper_admin_audit_logs"."config_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "player_wallpaper_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "player_wallpaper_assets_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "player_wallpaper_assets_kind_check" CHECK ("player_wallpaper_assets"."kind" IN ('MASTER', 'WIDE_DISPLAY', 'COMPACT_DISPLAY')),
	CONSTRAINT "player_wallpaper_assets_dimensions_check" CHECK ("player_wallpaper_assets"."width" > 0 AND "player_wallpaper_assets"."height" > 0),
	CONSTRAINT "player_wallpaper_assets_bytes_check" CHECK ("player_wallpaper_assets"."byte_size" > 0),
	CONSTRAINT "player_wallpaper_assets_sha_check" CHECK ("player_wallpaper_assets"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "player_wallpaper_assets_object_key_check" CHECK ("player_wallpaper_assets"."object_key" ~ '^wallpapers/[0-9a-f-]{36}/(master|wide|compact)[.]webp$')
);
--> statement-breakpoint
CREATE TABLE "player_wallpaper_configs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"wide_mode" text DEFAULT 'DEFAULT' NOT NULL,
	"compact_mode" text DEFAULT 'INHERIT_PC' NOT NULL,
	"wide_solid_preset" text,
	"compact_solid_preset" text,
	"wide_master_asset_id" uuid,
	"compact_master_asset_id" uuid,
	"wide_display_asset_id" uuid,
	"compact_display_asset_id" uuid,
	"wide_crop" jsonb,
	"compact_crop" jsonb,
	"wide_focus" jsonb,
	"compact_focus" jsonb,
	"active_fingerprint" text NOT NULL,
	"last_published_at" timestamp with time zone,
	"admin_removed_at" timestamp with time zone,
	"admin_removed_by" uuid,
	"admin_removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_wallpaper_configs_version_check" CHECK ("player_wallpaper_configs"."version" >= 0),
	CONSTRAINT "player_wallpaper_configs_wide_mode_check" CHECK ("player_wallpaper_configs"."wide_mode" IN ('DEFAULT', 'SOLID', 'CUSTOM')),
	CONSTRAINT "player_wallpaper_configs_compact_mode_check" CHECK ("player_wallpaper_configs"."compact_mode" IN ('INHERIT_PC', 'SOLID', 'CUSTOM')),
	CONSTRAINT "player_wallpaper_configs_wide_solid_preset_check" CHECK ("player_wallpaper_configs"."wide_solid_preset" IS NULL OR "player_wallpaper_configs"."wide_solid_preset" IN ('NIGHT_INK', 'SAKURA', 'OCEAN', 'FOREST', 'AMBER', 'LILAC')),
	CONSTRAINT "player_wallpaper_configs_compact_solid_preset_check" CHECK ("player_wallpaper_configs"."compact_solid_preset" IS NULL OR "player_wallpaper_configs"."compact_solid_preset" IN ('NIGHT_INK', 'SAKURA', 'OCEAN', 'FOREST', 'AMBER', 'LILAC')),
	CONSTRAINT "player_wallpaper_configs_wide_shape_check" CHECK ((
        "player_wallpaper_configs"."wide_mode" = 'DEFAULT'
        AND "player_wallpaper_configs"."wide_master_asset_id" IS NULL
        AND "player_wallpaper_configs"."wide_display_asset_id" IS NULL
        AND "player_wallpaper_configs"."wide_crop" IS NULL
        AND "player_wallpaper_configs"."wide_focus" IS NULL
        AND "player_wallpaper_configs"."wide_solid_preset" IS NULL
      ) OR (
        "player_wallpaper_configs"."wide_mode" = 'SOLID'
        AND "player_wallpaper_configs"."wide_master_asset_id" IS NULL
        AND "player_wallpaper_configs"."wide_display_asset_id" IS NULL
        AND "player_wallpaper_configs"."wide_crop" IS NULL
        AND "player_wallpaper_configs"."wide_focus" IS NULL
        AND "player_wallpaper_configs"."wide_solid_preset" IS NOT NULL
      ) OR (
        "player_wallpaper_configs"."wide_mode" = 'CUSTOM'
        AND "player_wallpaper_configs"."wide_master_asset_id" IS NOT NULL
        AND "player_wallpaper_configs"."wide_display_asset_id" IS NOT NULL
        AND "player_wallpaper_configs"."wide_crop" IS NOT NULL
        AND "player_wallpaper_configs"."wide_focus" IS NOT NULL
        AND "player_wallpaper_configs"."wide_solid_preset" IS NULL
      )),
	CONSTRAINT "player_wallpaper_configs_compact_shape_check" CHECK ((
        "player_wallpaper_configs"."compact_mode" = 'INHERIT_PC'
        AND "player_wallpaper_configs"."compact_solid_preset" IS NULL
        AND (
          ("player_wallpaper_configs"."wide_mode" IN ('DEFAULT', 'SOLID')
            AND "player_wallpaper_configs"."compact_master_asset_id" IS NULL
            AND "player_wallpaper_configs"."compact_display_asset_id" IS NULL
            AND "player_wallpaper_configs"."compact_crop" IS NULL
            AND "player_wallpaper_configs"."compact_focus" IS NULL)
          OR
          ("player_wallpaper_configs"."wide_mode" = 'CUSTOM'
            AND "player_wallpaper_configs"."compact_master_asset_id" = "player_wallpaper_configs"."wide_master_asset_id"
            AND "player_wallpaper_configs"."compact_display_asset_id" IS NOT NULL
            AND "player_wallpaper_configs"."compact_crop" IS NOT NULL
            AND "player_wallpaper_configs"."compact_focus" IS NOT NULL)
        )
      ) OR (
        "player_wallpaper_configs"."compact_mode" = 'SOLID'
        AND "player_wallpaper_configs"."compact_master_asset_id" IS NULL
        AND "player_wallpaper_configs"."compact_display_asset_id" IS NULL
        AND "player_wallpaper_configs"."compact_crop" IS NULL
        AND "player_wallpaper_configs"."compact_focus" IS NULL
        AND "player_wallpaper_configs"."compact_solid_preset" IS NOT NULL
      ) OR (
        "player_wallpaper_configs"."compact_mode" = 'CUSTOM'
        AND "player_wallpaper_configs"."compact_master_asset_id" IS NOT NULL
        AND "player_wallpaper_configs"."compact_display_asset_id" IS NOT NULL
        AND "player_wallpaper_configs"."compact_crop" IS NOT NULL
        AND "player_wallpaper_configs"."compact_focus" IS NOT NULL
        AND "player_wallpaper_configs"."compact_solid_preset" IS NULL
      )),
	CONSTRAINT "player_wallpaper_configs_fingerprint_check" CHECK ("player_wallpaper_configs"."active_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "player_wallpaper_configs_admin_removal_check" CHECK (("player_wallpaper_configs"."admin_removed_at" IS NULL AND "player_wallpaper_configs"."admin_removal_reason" IS NULL)
        OR ("player_wallpaper_configs"."admin_removed_at" IS NOT NULL AND btrim("player_wallpaper_configs"."admin_removal_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "player_wallpaper_idempotency" (
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"config_version" integer,
	"error_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_wallpaper_idempotency_user_id_idempotency_key_pk" PRIMARY KEY("user_id","idempotency_key"),
	CONSTRAINT "player_wallpaper_idempotency_key_check" CHECK (char_length("player_wallpaper_idempotency"."idempotency_key") BETWEEN 8 AND 160),
	CONSTRAINT "player_wallpaper_idempotency_operation_check" CHECK ("player_wallpaper_idempotency"."operation" IN ('PUBLISH', 'RESET', 'ADMIN_REMOVE')),
	CONSTRAINT "player_wallpaper_idempotency_status_check" CHECK ("player_wallpaper_idempotency"."status" IN ('PROCESSING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "player_wallpaper_idempotency_fingerprint_check" CHECK ("player_wallpaper_idempotency"."request_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "player_wallpaper_publication_days" (
	"user_id" uuid NOT NULL,
	"publish_day" text NOT NULL,
	"config_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_wallpaper_publication_days_user_id_publish_day_pk" PRIMARY KEY("user_id","publish_day"),
	CONSTRAINT "player_wallpaper_publication_days_day_check" CHECK ("player_wallpaper_publication_days"."publish_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "player_wallpaper_publication_days_version_check" CHECK ("player_wallpaper_publication_days"."config_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "player_wallpaper_admin_audit_logs" ADD CONSTRAINT "player_wallpaper_admin_audit_logs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_admin_audit_logs" ADD CONSTRAINT "player_wallpaper_admin_audit_logs_admin_user_id_profiles_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_assets" ADD CONSTRAINT "player_wallpaper_assets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_configs" ADD CONSTRAINT "player_wallpaper_configs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_configs" ADD CONSTRAINT "player_wallpaper_configs_wide_master_asset_id_player_wallpaper_assets_id_fk" FOREIGN KEY ("wide_master_asset_id") REFERENCES "public"."player_wallpaper_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_configs" ADD CONSTRAINT "player_wallpaper_configs_compact_master_asset_id_player_wallpaper_assets_id_fk" FOREIGN KEY ("compact_master_asset_id") REFERENCES "public"."player_wallpaper_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_configs" ADD CONSTRAINT "player_wallpaper_configs_wide_display_asset_id_player_wallpaper_assets_id_fk" FOREIGN KEY ("wide_display_asset_id") REFERENCES "public"."player_wallpaper_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_configs" ADD CONSTRAINT "player_wallpaper_configs_compact_display_asset_id_player_wallpaper_assets_id_fk" FOREIGN KEY ("compact_display_asset_id") REFERENCES "public"."player_wallpaper_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_configs" ADD CONSTRAINT "player_wallpaper_configs_admin_removed_by_profiles_id_fk" FOREIGN KEY ("admin_removed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_idempotency" ADD CONSTRAINT "player_wallpaper_idempotency_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_wallpaper_publication_days" ADD CONSTRAINT "player_wallpaper_publication_days_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_player_wallpaper_admin_audit_user" ON "player_wallpaper_admin_audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_player_wallpaper_admin_audit_admin" ON "player_wallpaper_admin_audit_logs" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_player_wallpaper_assets_user" ON "player_wallpaper_assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_player_wallpaper_assets_retired" ON "player_wallpaper_assets" USING btree ("retired_at");--> statement-breakpoint
CREATE INDEX "idx_player_wallpaper_idempotency_expires" ON "player_wallpaper_idempotency" USING btree ("expires_at");