# Drizzle Data Migrations

This directory stores one-off, version-bound data migration scripts. These scripts are not Drizzle SQL migrations and are not executed by `pnpm db:migrate`.

Run them only from the matching `drizzle/migration-notes/` release instructions, usually in a maintenance window, with a dry-run/report step and post-run SQL validation.

