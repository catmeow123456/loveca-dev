CREATE TABLE "email_change_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"new_email" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_change_tokens_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "email_change_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "email_change_tokens" ADD CONSTRAINT "email_change_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_change_tokens_token" ON "email_change_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_email_change_tokens_expires_at" ON "email_change_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.cleanup_expired_tokens()
RETURNS integer AS $$
DECLARE
  total integer := 0;
  cnt integer;
BEGIN
  DELETE FROM public.refresh_tokens WHERE expires_at < now();
  GET DIAGNOSTICS cnt = ROW_COUNT;
  total := total + cnt;

  DELETE FROM public.email_verification_tokens WHERE expires_at < now();
  GET DIAGNOSTICS cnt = ROW_COUNT;
  total := total + cnt;

  DELETE FROM public.email_change_tokens WHERE expires_at < now();
  GET DIAGNOSTICS cnt = ROW_COUNT;
  total := total + cnt;

  DELETE FROM public.password_reset_tokens WHERE expires_at < now() OR used_at IS NOT NULL;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  total := total + cnt;

  RETURN total;
END;
$$ LANGUAGE plpgsql;
