import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('card sync job migration', () => {
  it('persists audit context, item results, idempotency, and a single active apply run', () => {
    const sql = readFileSync('drizzle/0031_add_card_sync_jobs.sql', 'utf8');

    expect(sql).toContain('CREATE TABLE "card_sync_runs"');
    expect(sql).toContain('CREATE TABLE "card_sync_run_items"');
    expect(sql).toContain('"actor_user_id" uuid');
    expect(sql).toContain('"request_id" text NOT NULL');
    expect(sql).toContain('"idempotency_key" text NOT NULL');
    expect(sql).toContain('"source_collection" text DEFAULT \'loveca\' NOT NULL');
    expect(sql).toContain("\"status\" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')");
    expect(sql).toContain('CREATE UNIQUE INDEX "uq_card_sync_runs_active_apply"');
    expect(sql).toContain(
      'WHERE "card_sync_runs"."kind" = \'APPLY\' AND "card_sync_runs"."status" IN (\'QUEUED\', \'RUNNING\')'
    );
  });

  it('adds execution fencing and enforces safe new-card fields without rewriting legacy rows', () => {
    const sql = readFileSync('drizzle/0033_harden_card_sync.sql', 'utf8');

    expect(sql).toContain('ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL');
    expect(sql).toContain('ADD COLUMN "lease_token" uuid');
    expect(sql).toContain('ADD COLUMN "lease_expires_at" timestamp with time zone');
    expect(sql).toContain('"card_sync_runs"."lease_generation" >= 0');
    expect(sql).toContain('cards_card_code_format_check');
    expect(sql).toContain('(sd|bp|cl|pb)[0-9]+');
    expect(sql).not.toContain('|bp8|');
    expect(sql).toContain('cards_cost_non_negative_check');
    expect(sql).toContain('cards_blade_non_negative_check');
    expect(sql).toContain('cards_score_non_negative_check');
    expect(sql.match(/NOT VALID/g)).toHaveLength(4);
  });
});
