import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('activity cover migration', () => {
  it('stores only current cover facts that are not available from another authority', () => {
    const sql = readFileSync('drizzle/0034_add_activity_covers.sql', 'utf8');

    expect(sql).toContain('CREATE TABLE "activity_cover_configs"');
    expect(sql).toContain('"master_width" integer');
    expect(sql).toContain('"wide_crop" jsonb');
    expect(sql).toContain('"last_request_fingerprint" text NOT NULL');
    expect(sql).toContain('"updated_at" timestamp with time zone');

    for (const redundantColumn of [
      'master_byte_size',
      'wide_width',
      'wide_height',
      'wide_byte_size',
      'compact_width',
      'compact_height',
      'compact_byte_size',
      'active_fingerprint',
      'created_by',
      'created_at',
    ]) {
      expect(sql).not.toContain(`"${redundantColumn}"`);
    }
  });
});
