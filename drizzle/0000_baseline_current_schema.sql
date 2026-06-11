-- Baseline migration for the Loveca PostgreSQL schema.
-- This file is intentionally a no-op: current databases and docker/init.sql
-- already contain the schema represented by drizzle/meta/0000_snapshot.json.
-- Keep this migration so Drizzle can record the baseline before applying future
-- incremental migrations.
SELECT 1;
