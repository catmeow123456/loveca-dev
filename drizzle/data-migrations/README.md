# Drizzle Data Migrations

This directory stores one-off, version-bound data migration scripts. These scripts are not Drizzle SQL migrations and are not executed by `pnpm db:migrate`.

Run them only from the matching `drizzle/migration-notes/` release instructions, usually in a maintenance window, with a dry-run/report step and post-run SQL validation.

Current scripts:

- `auth-v1-to-v2-credential-cutover.ts`: wraps recognizable v1 bcrypt password hashes in an explicit compatibility format before deploying the v2 runtime. Successful logins upgrade those hashes to the current pre-hashed format. Follow `drizzle/migration-notes/auth-v1-to-v2-credential-cutover.md`; reset-required or unknown credentials block apply because their original passwords cannot be guaranteed.
