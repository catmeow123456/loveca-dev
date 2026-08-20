import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('season administrator migration', () => {
  it('accepts exactly the three supported roles and creates the management audit boundary', () => {
    const sql = readFileSync('drizzle/0028_add_season_admin_role.sql', 'utf8');

    expect(sql).toContain(`"profiles"."role" IN ('user', 'season_admin', 'admin')`);
    expect(sql).toContain('CREATE TABLE "management_audit_logs"');
    expect(sql).not.toContain("'USERS'");
    expect(sql).toContain('idx_management_audit_actor_created');
    expect(sql).toContain('idx_management_audit_scope_target_created');
  });
});
