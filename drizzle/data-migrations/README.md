# Drizzle Data Migrations

This directory stores one-off, version-bound data migration scripts. These scripts are not Drizzle SQL migrations and are not executed by `pnpm db:migrate`.

Run them only from the matching `drizzle/migration-notes/` release instructions, usually in a maintenance window, with a dry-run/report step and post-run SQL validation.

Current scripts:

- `auth-v1-to-v2-credential-cutover.ts`: removes v1 authentication credential states before deploying the v2-only runtime. Follow `drizzle/migration-notes/auth-v1-to-v2-credential-cutover.md`; legacy passwords cannot be transformed and must be reset.
